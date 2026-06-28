-- ─────────────────────────────────────────────────────────────────────────
-- Nightly-ingest orchestration: the fire-once recon dispatch on intake.
--
-- When a vehicle is ingested, the orchestrator (ingest-orchestrate edge fn)
-- runs exactly one bundle of work per car:
--   • seed a recon estimate from the dealer's required canned services
--   • in 'auto' dispatch mode, send it to service immediately (lines under the
--     auto-approve threshold clear; the rest route to the UCM approve link)
--   • in 'manual' mode, stage it for the UCM to OK + send from the daily queue
--   • notify installers on a pre-install, email the office the title link, etc.
--
-- Fire-once is enforced by vehicle_listings.orchestrated_at, claimed
-- atomically so a re-sync or the self-heal sweep can never double-dispatch.
-- ─────────────────────────────────────────────────────────────────────────

ALTER TABLE public.vehicle_listings
  ADD COLUMN IF NOT EXISTS orchestrated_at timestamptz;

-- Where the estimate came from + when (if ever) it was released to service.
ALTER TABLE public.recon_estimates
  ADD COLUMN IF NOT EXISTS origin text NOT NULL DEFAULT 'service',
  ADD COLUMN IF NOT EXISTS sent_to_service_at timestamptz;

-- Third-party / sublet installers the dealer notifies on a pre-install.
CREATE TABLE IF NOT EXISTS public.installer_contacts (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL,
  company    text NOT NULL,
  product    text,                          -- what they install (e.g. "Window tint")
  email      text,
  phone      text,
  active     boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_installer_contacts_tenant ON public.installer_contacts (tenant_id) WHERE active;

ALTER TABLE public.installer_contacts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "installer contacts readable by tenant" ON public.installer_contacts;
CREATE POLICY "installer contacts readable by tenant" ON public.installer_contacts FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT tenant_id FROM public.tenant_members WHERE user_id = (SELECT auth.uid())));
DROP POLICY IF EXISTS "installer contacts writable by tenant" ON public.installer_contacts;
CREATE POLICY "installer contacts writable by tenant" ON public.installer_contacts FOR ALL TO authenticated
  USING (tenant_id IN (SELECT tenant_id FROM public.tenant_members WHERE user_id = (SELECT auth.uid())))
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM public.tenant_members WHERE user_id = (SELECT auth.uid())));

-- ── Atomic fire-once claim. Returns true to exactly one caller; every later
-- caller (re-sync, self-heal sweep) gets false and skips dispatch. ──────────
CREATE OR REPLACE FUNCTION public.claim_listing_orchestration(_listing_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_won boolean;
BEGIN
  IF _listing_id IS NULL THEN RETURN false; END IF;
  UPDATE public.vehicle_listings
     SET orchestrated_at = now()
   WHERE id = _listing_id AND orchestrated_at IS NULL
  RETURNING true INTO v_won;
  RETURN coalesce(v_won, false);
END; $$;

-- ── Seed the recon estimate from the dealer's required canned services. ─────
-- Idempotent: skips if an ingest estimate already exists for this vin. In
-- 'auto' mode the estimate is released to service on creation (sub-threshold
-- lines auto-approve); in 'manual' mode it waits for the UCM to send it.
CREATE OR REPLACE FUNCTION public.seed_recon_estimate_for_ingest(
  _tenant_id uuid, _vin text, _ymm text, _vehicle_listing_id uuid, _mode text DEFAULT 'manual'
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_vin text := upper(btrim(coalesce(_vin,''))); v_settings jsonb; v_services jsonb;
  v_threshold numeric; v_auto_mode boolean; v_id uuid; v_token text; svc jsonb;
  v_total numeric; v_auto boolean; v_sent timestamptz; n int := 0;
BEGIN
  IF _tenant_id IS NULL OR v_vin = '' THEN RETURN jsonb_build_object('ok', false, 'reason', 'bad_args'); END IF;

  -- One ingest-origin estimate per car, ever.
  IF EXISTS (SELECT 1 FROM public.recon_estimates WHERE tenant_id = _tenant_id AND vin = v_vin AND origin = 'ingest') THEN
    RETURN jsonb_build_object('ok', true, 'skipped', 'already_seeded');
  END IF;

  SELECT settings INTO v_settings FROM public.dealer_profiles WHERE tenant_id = _tenant_id;
  v_settings := coalesce(v_settings, '{}'::jsonb);
  v_services := coalesce(v_settings->'recon_canned_services', '[]'::jsonb);
  v_threshold := coalesce((v_settings->>'recon_auto_approve_amount')::numeric, 0);
  v_auto_mode := coalesce(_mode, v_settings->>'ingest_recon_dispatch', 'manual') = 'auto';

  -- Only required services seed the intake estimate; recommended items stay in
  -- the menu for service to add per car. Nothing to seed → no estimate.
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_services) s WHERE s->>'severity' = 'required') THEN
    RETURN jsonb_build_object('ok', true, 'skipped', 'no_required_services');
  END IF;

  v_sent := CASE WHEN v_auto_mode THEN now() ELSE NULL END;
  v_token := encode(gen_random_bytes(16), 'hex');
  INSERT INTO public.recon_estimates (tenant_id, vehicle_listing_id, vin, ymm, approval_token,
      submitted_by, submitted_role, notes, origin, sent_to_service_at)
  VALUES (_tenant_id, _vehicle_listing_id, v_vin, nullif(btrim(coalesce(_ymm,'')),''), v_token,
      'Auto-ingest', 'system', 'Seeded on intake from your standard recon menu.', 'ingest', v_sent)
  RETURNING id INTO v_id;

  FOR svc IN SELECT * FROM jsonb_array_elements(v_services) WHERE value->>'severity' = 'required' LOOP
    v_total := GREATEST(coalesce((svc->>'labor_cost')::numeric, 0), 0) + GREATEST(coalesce((svc->>'parts_cost')::numeric, 0), 0);
    -- Auto-approve only when the dealer chose auto dispatch AND the line is under
    -- their threshold. In manual mode every line waits for the UCM.
    v_auto := v_auto_mode AND v_threshold > 0 AND v_total <= v_threshold;
    INSERT INTO public.recon_estimate_lines
      (estimate_id, tenant_id, category, description, severity, labor_cost, parts_cost, line_total,
       approval_status, approved_amount, decided_at, decision_channel)
    VALUES (v_id, _tenant_id, nullif(btrim(coalesce(svc->>'category','')),''),
       coalesce(nullif(btrim(coalesce(svc->>'label','')),''), 'Recon item'), 'required',
       GREATEST(coalesce((svc->>'labor_cost')::numeric, 0), 0), GREATEST(coalesce((svc->>'parts_cost')::numeric, 0), 0), v_total,
       CASE WHEN v_auto THEN 'auto_approved' ELSE 'pending' END,
       CASE WHEN v_auto THEN v_total ELSE NULL END,
       CASE WHEN v_auto THEN now() ELSE NULL END,
       CASE WHEN v_auto THEN 'auto' ELSE NULL END);
    n := n + 1;
  END LOOP;

  UPDATE public.recon_estimates SET subtotal = (SELECT coalesce(sum(line_total),0) FROM public.recon_estimate_lines WHERE estimate_id = v_id) WHERE id = v_id;
  PERFORM public.recon_recompute_estimate(v_id);

  BEGIN
    INSERT INTO public.audit_log (action, entity_type, entity_id, store_id, details)
    VALUES ('recon_estimate_seeded', 'vehicle', v_vin, _tenant_id,
            jsonb_build_object('estimate_id', v_id, 'lines', n, 'mode', CASE WHEN v_auto_mode THEN 'auto' ELSE 'manual' END));
  EXCEPTION WHEN OTHERS THEN NULL; END;

  RETURN jsonb_build_object('ok', true, 'estimate_id', v_id, 'approval_token', v_token,
    'mode', CASE WHEN v_auto_mode THEN 'auto' ELSE 'manual' END,
    'needs_approval', EXISTS (SELECT 1 FROM public.recon_estimate_lines WHERE estimate_id = v_id AND approval_status = 'pending'));
END; $$;

-- ── UCM OKs + sends a staged (manual-mode) estimate to service. ─────────────
CREATE OR REPLACE FUNCTION public.recon_send_to_service(_estimate_id uuid, _by text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE e public.recon_estimates%ROWTYPE; v_role text;
BEGIN
  SELECT * INTO e FROM public.recon_estimates WHERE id = _estimate_id LIMIT 1;
  IF e.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found'); END IF;
  v_role := public.recon_caller_role(e.tenant_id);
  IF v_role IS NULL OR v_role NOT IN ('owner','admin','manager') THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_authorized'); END IF;
  IF e.sent_to_service_at IS NOT NULL THEN RETURN jsonb_build_object('ok', true, 'already_sent', true); END IF;
  UPDATE public.recon_estimates SET sent_to_service_at = now(), updated_at = now() WHERE id = e.id;
  BEGIN
    INSERT INTO public.audit_log (action, entity_type, entity_id, store_id, details)
    VALUES ('recon_estimate_sent', 'vehicle', e.vin, e.tenant_id, jsonb_build_object('estimate_id', e.id, 'by', _by, 'role', v_role));
  EXCEPTION WHEN OTHERS THEN NULL; END;
  RETURN jsonb_build_object('ok', true, 'approval_token', e.approval_token);
END; $$;

GRANT EXECUTE ON FUNCTION public.claim_listing_orchestration(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.seed_recon_estimate_for_ingest(uuid, text, text, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.recon_send_to_service(uuid, text) TO authenticated;
