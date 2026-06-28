-- ─────────────────────────────────────────────────────────────────────────
-- Recon estimates: the logged-in interaction layer.
--
-- The token RPCs (20260629060000) power the no-login mobile approve link. This
-- adds the in-app workspace where service and the used-car manager work the
-- same estimate while signed in:
--   • recon_estimate_messages  — a Q&A thread on each estimate (ask questions)
--   • recon_submit_member      — service creates an estimate from the app
--   • recon_decide_member      — manager/admin/owner approve/decline (role-gated)
--   • recon_post_message       — either party posts a question/answer
-- Member RPCs resolve the tenant from the caller's membership and enforce role,
-- so the broad approval_token isn't the gate in-app.
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.recon_estimate_messages (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  estimate_id uuid NOT NULL REFERENCES public.recon_estimates(id) ON DELETE CASCADE,
  tenant_id   uuid NOT NULL,
  author_id   uuid,
  author_name text,
  author_role text,
  body        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_recon_messages_estimate ON public.recon_estimate_messages (estimate_id, created_at);

ALTER TABLE public.recon_estimate_messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "recon messages readable by tenant" ON public.recon_estimate_messages;
CREATE POLICY "recon messages readable by tenant" ON public.recon_estimate_messages FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT tenant_id FROM public.tenant_members WHERE user_id = (SELECT auth.uid())));

-- Caller's role for a tenant (or NULL if not an accepted member).
CREATE OR REPLACE FUNCTION public.recon_caller_role(_tenant uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT role FROM public.tenant_members
   WHERE user_id = (SELECT auth.uid()) AND tenant_id = _tenant AND accepted_at IS NOT NULL
   LIMIT 1;
$$;

-- ── Service submits an estimate from the app (authed member) ────────────────
CREATE OR REPLACE FUNCTION public.recon_submit_member(
  _vin text, _ymm text, _notes text, _by text, _lines jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tenant uuid; v_role text; v_listing uuid; v_id uuid; v_token text; ln jsonb;
  v_labor numeric; v_parts numeric; v_sublet numeric; v_total numeric; v_auto boolean;
  v_threshold numeric; v_vin text := upper(btrim(coalesce(_vin,'')));
BEGIN
  v_tenant := public.current_tenant_id();
  IF v_tenant IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'no_tenant'); END IF;
  v_role := public.recon_caller_role(v_tenant);
  IF v_role IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_member'); END IF;
  IF v_vin = '' THEN RETURN jsonb_build_object('ok', false, 'reason', 'vin_required'); END IF;
  IF _lines IS NULL OR jsonb_array_length(_lines) = 0 THEN RETURN jsonb_build_object('ok', false, 'reason', 'no_lines'); END IF;

  SELECT id INTO v_listing FROM public.vehicle_listings WHERE tenant_id = v_tenant AND vin = v_vin LIMIT 1;
  SELECT (settings->>'recon_auto_approve_amount')::numeric INTO v_threshold FROM public.dealer_profiles WHERE tenant_id = v_tenant;
  v_threshold := coalesce(v_threshold, 0);

  v_token := encode(gen_random_bytes(16), 'hex');
  INSERT INTO public.recon_estimates (tenant_id, vehicle_listing_id, vin, ymm, approval_token, submitted_by, submitted_role, notes)
  VALUES (v_tenant, v_listing, v_vin, nullif(btrim(coalesce(_ymm,'')),''), v_token, nullif(btrim(coalesce(_by,'')),''), v_role, nullif(btrim(coalesce(_notes,'')),''))
  RETURNING id INTO v_id;

  FOR ln IN SELECT * FROM jsonb_array_elements(_lines) LOOP
    v_labor  := GREATEST(coalesce((ln->>'labor_cost')::numeric, 0), 0);
    v_parts  := GREATEST(coalesce((ln->>'parts_cost')::numeric, 0), 0);
    v_sublet := GREATEST(coalesce((ln->>'sublet_cost')::numeric, 0), 0);
    v_total  := v_labor + v_parts + v_sublet;
    v_auto   := v_threshold > 0 AND v_total <= v_threshold;
    INSERT INTO public.recon_estimate_lines
      (estimate_id, tenant_id, category, description, severity, labor_cost, parts_cost, sublet_cost, line_total, vendor, photos,
       approval_status, approved_amount, decided_at, decision_channel)
    VALUES (v_id, v_tenant, nullif(btrim(coalesce(ln->>'category','')),''), coalesce(nullif(btrim(coalesce(ln->>'description','')),''), 'Recon item'),
       CASE WHEN ln->>'severity' IN ('required','recommended','ok','na') THEN ln->>'severity' ELSE 'recommended' END,
       v_labor, v_parts, v_sublet, v_total, nullif(btrim(coalesce(ln->>'vendor','')),''), coalesce(ln->'photos','[]'::jsonb),
       CASE WHEN v_auto THEN 'auto_approved' ELSE 'pending' END,
       CASE WHEN v_auto THEN v_total ELSE NULL END,
       CASE WHEN v_auto THEN now() ELSE NULL END,
       CASE WHEN v_auto THEN 'auto' ELSE NULL END);
  END LOOP;

  UPDATE public.recon_estimates SET subtotal = (SELECT coalesce(sum(line_total),0) FROM public.recon_estimate_lines WHERE estimate_id = v_id) WHERE id = v_id;
  PERFORM public.recon_recompute_estimate(v_id);
  BEGIN
    INSERT INTO public.audit_log (action, entity_type, entity_id, store_id, details)
    VALUES ('recon_estimate_submitted', 'vehicle', v_vin, v_tenant, jsonb_build_object('estimate_id', v_id, 'by', _by, 'channel', 'app'));
  EXCEPTION WHEN OTHERS THEN NULL; END;

  RETURN jsonb_build_object('ok', true, 'estimate_id', v_id, 'approval_token', v_token,
    'needs_approval', EXISTS (SELECT 1 FROM public.recon_estimate_lines WHERE estimate_id = v_id AND approval_status = 'pending'));
END; $$;

-- ── Manager approves/declines in-app — role-gated (authed) ──────────────────
CREATE OR REPLACE FUNCTION public.recon_decide_member(
  _estimate_id uuid, _line_id uuid, _action text, _reason text DEFAULT NULL, _by text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE e public.recon_estimates%ROWTYPE; v_role text; v_status text;
BEGIN
  SELECT * INTO e FROM public.recon_estimates WHERE id = _estimate_id LIMIT 1;
  IF e.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found'); END IF;
  v_role := public.recon_caller_role(e.tenant_id);
  IF v_role IS NULL OR v_role NOT IN ('owner','admin','manager') THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_authorized'); END IF;
  v_status := CASE _action WHEN 'approve' THEN 'approved' WHEN 'decline' THEN 'declined' WHEN 'defer' THEN 'deferred' ELSE NULL END;
  IF v_status IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'bad_action'); END IF;
  IF v_status = 'declined' AND _line_id IS NOT NULL AND coalesce(btrim(_reason),'') = '' THEN RETURN jsonb_build_object('ok', false, 'reason', 'reason_required'); END IF;

  IF _line_id IS NULL THEN
    UPDATE public.recon_estimate_lines SET approval_status = v_status,
      approved_amount = CASE WHEN v_status='approved' THEN line_total ELSE NULL END,
      decline_reason = CASE WHEN v_status='declined' THEN nullif(btrim(coalesce(_reason,'')),'') ELSE NULL END,
      decided_by = nullif(btrim(coalesce(_by,'')),''), decided_role = v_role, decision_channel = 'app', decided_at = now()
    WHERE estimate_id = e.id AND approval_status = 'pending';
  ELSE
    UPDATE public.recon_estimate_lines SET approval_status = v_status,
      approved_amount = CASE WHEN v_status='approved' THEN line_total ELSE NULL END,
      decline_reason = CASE WHEN v_status='declined' THEN btrim(_reason) ELSE NULL END,
      decided_by = nullif(btrim(coalesce(_by,'')),''), decided_role = v_role, decision_channel = 'app', decided_at = now()
    WHERE id = _line_id AND estimate_id = e.id;
  END IF;
  PERFORM public.recon_recompute_estimate(e.id);
  BEGIN
    INSERT INTO public.audit_log (action, entity_type, entity_id, store_id, details)
    VALUES ('recon_' || coalesce(CASE WHEN _line_id IS NULL THEN 'estimate' ELSE 'line' END,'line') || '_' || v_status,
            'vehicle', e.vin, e.tenant_id, jsonb_build_object('estimate_id', e.id, 'line_id', _line_id, 'by', _by, 'role', v_role, 'channel', 'app'));
  EXCEPTION WHEN OTHERS THEN NULL; END;
  RETURN jsonb_build_object('ok', true);
END; $$;

-- ── Post a question/answer on the estimate (authed member) ──────────────────
CREATE OR REPLACE FUNCTION public.recon_post_message(_estimate_id uuid, _body text, _by text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE e public.recon_estimates%ROWTYPE; v_role text;
BEGIN
  IF coalesce(btrim(_body),'') = '' THEN RETURN jsonb_build_object('ok', false, 'reason', 'empty'); END IF;
  SELECT * INTO e FROM public.recon_estimates WHERE id = _estimate_id LIMIT 1;
  IF e.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found'); END IF;
  v_role := public.recon_caller_role(e.tenant_id);
  IF v_role IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_member'); END IF;
  INSERT INTO public.recon_estimate_messages (estimate_id, tenant_id, author_id, author_name, author_role, body)
  VALUES (e.id, e.tenant_id, (SELECT auth.uid()), nullif(btrim(coalesce(_by,'')),''), v_role, btrim(_body));
  RETURN jsonb_build_object('ok', true);
END; $$;

GRANT EXECUTE ON FUNCTION public.recon_caller_role(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.recon_submit_member(text, text, text, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.recon_decide_member(uuid, uuid, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.recon_post_message(uuid, text, text) TO authenticated;
