-- ─────────────────────────────────────────────────────────────────────────
-- Recon estimates + the used-car-manager approve/decline gate.
--
-- The middle of the recon loop that was missing: the service department submits
-- a worksheet of line items (what the car needs / what it costs), the UCM
-- approves or declines per line. Lines under the dealer's auto-approve threshold
-- clear automatically so work isn't stalled waiting on the manager (the #1 recon
-- bottleneck). Mirrors the existing token-gated, SECURITY-DEFINER patterns:
--   • submit_recon_estimate   — anon, via the per-vehicle Get-Ready hub token
--   • get_recon_estimate      — anon, via the estimate's approval token
--   • decide_recon_line       — anon, token-gated per-line approve/decline/defer
--   • decide_recon_estimate   — anon, token-gated bulk approve/decline
-- Costs live here for internal use only; the customer packet recon object stays
-- cost-free.
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.recon_estimates (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL,
  vehicle_listing_id uuid,
  store_id           uuid,
  vin                text NOT NULL,
  ymm                text,
  approval_token     text NOT NULL UNIQUE,
  status             text NOT NULL DEFAULT 'submitted'
                       CHECK (status IN ('submitted','partially_approved','approved','declined','completed','voided')),
  submitted_by       text,
  submitted_role     text,
  subtotal           numeric NOT NULL DEFAULT 0,   -- sum of all line totals
  approved_total     numeric NOT NULL DEFAULT 0,   -- sum of approved/auto-approved
  notes              text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_recon_estimates_tenant_vin ON public.recon_estimates (tenant_id, vin);
CREATE INDEX IF NOT EXISTS idx_recon_estimates_status ON public.recon_estimates (tenant_id, status);

CREATE TABLE IF NOT EXISTS public.recon_estimate_lines (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  estimate_id     uuid NOT NULL REFERENCES public.recon_estimates(id) ON DELETE CASCADE,
  tenant_id       uuid NOT NULL,
  category        text,        -- mechanical | safety | tires | glass | cosmetic | interior | detail | keys | sublet
  description     text NOT NULL,
  severity        text DEFAULT 'recommended' CHECK (severity IN ('required','recommended','ok','na')),
  labor_cost      numeric NOT NULL DEFAULT 0,
  parts_cost      numeric NOT NULL DEFAULT 0,
  sublet_cost     numeric NOT NULL DEFAULT 0,
  line_total      numeric NOT NULL DEFAULT 0,
  vendor          text,
  photos          jsonb NOT NULL DEFAULT '[]'::jsonb,
  approval_status text NOT NULL DEFAULT 'pending'
                    CHECK (approval_status IN ('pending','approved','declined','deferred','auto_approved')),
  approved_amount numeric,
  decline_reason  text,
  decided_by      text,
  decided_role    text,
  decision_channel text,      -- link | desktop | mobile | auto
  decided_at      timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_recon_lines_estimate ON public.recon_estimate_lines (estimate_id);

-- Tenant members read both (the in-app approval queue + audit views). All writes
-- go through the SECURITY DEFINER RPCs below.
ALTER TABLE public.recon_estimates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recon_estimate_lines ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "recon estimates readable by tenant" ON public.recon_estimates;
CREATE POLICY "recon estimates readable by tenant" ON public.recon_estimates FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT tenant_id FROM public.tenant_members WHERE user_id = (SELECT auth.uid())));
DROP POLICY IF EXISTS "recon lines readable by tenant" ON public.recon_estimate_lines;
CREATE POLICY "recon lines readable by tenant" ON public.recon_estimate_lines FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT tenant_id FROM public.tenant_members WHERE user_id = (SELECT auth.uid())));

-- ── Recompute estimate rollup from its lines (status + approved_total) ───────
CREATE OR REPLACE FUNCTION public.recon_recompute_estimate(_estimate_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n_total int; n_pending int; n_approved int; n_declined int; v_approved numeric;
BEGIN
  SELECT count(*),
         count(*) FILTER (WHERE approval_status = 'pending'),
         count(*) FILTER (WHERE approval_status IN ('approved','auto_approved')),
         count(*) FILTER (WHERE approval_status = 'declined'),
         coalesce(sum(approved_amount) FILTER (WHERE approval_status IN ('approved','auto_approved')), 0)
    INTO n_total, n_pending, n_approved, n_declined, v_approved
    FROM public.recon_estimate_lines WHERE estimate_id = _estimate_id;
  UPDATE public.recon_estimates SET
    approved_total = v_approved,
    status = CASE
      WHEN n_pending > 0 THEN 'submitted'
      WHEN n_approved > 0 AND n_declined > 0 THEN 'partially_approved'
      WHEN n_approved > 0 THEN 'approved'
      WHEN n_declined = n_total AND n_total > 0 THEN 'declined'
      ELSE status END,
    updated_at = now()
  WHERE id = _estimate_id;
END; $$;

-- ── Service submits the worksheet (anon, via the Get-Ready hub token) ────────
CREATE OR REPLACE FUNCTION public.submit_recon_estimate(
  _token text, _submitted_by text, _submitted_role text, _notes text,
  _lines jsonb, _auto_approve_under numeric DEFAULT 0
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r public.dept_signoff_tokens%ROWTYPE; v_id uuid; v_token text; ln jsonb;
  v_labor numeric; v_parts numeric; v_sublet numeric; v_total numeric; v_auto boolean; n int := 0;
  v_threshold numeric;
BEGIN
  SELECT * INTO r FROM public.dept_signoff_tokens WHERE token = _token LIMIT 1;
  IF r.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found'); END IF;
  IF r.expires_at <= now() OR r.status <> 'pending' THEN RETURN jsonb_build_object('ok', false, 'reason', 'expired'); END IF;
  IF _lines IS NULL OR jsonb_array_length(_lines) = 0 THEN RETURN jsonb_build_object('ok', false, 'reason', 'no_lines'); END IF;
  IF coalesce(btrim(_submitted_by), '') = '' THEN RETURN jsonb_build_object('ok', false, 'reason', 'name_required'); END IF;

  -- The auto-approve threshold is the dealer's configured value, read server-
  -- side — never trusted from the anonymous caller (who could otherwise
  -- self-approve everything). Falls back to the passed value only if unset.
  SELECT (settings->>'recon_auto_approve_amount')::numeric INTO v_threshold
    FROM public.dealer_profiles WHERE tenant_id = r.tenant_id;
  v_threshold := coalesce(v_threshold, _auto_approve_under, 0);

  v_token := encode(gen_random_bytes(16), 'hex');
  INSERT INTO public.recon_estimates (tenant_id, vehicle_listing_id, vin, ymm, approval_token, submitted_by, submitted_role, notes)
  VALUES (r.tenant_id, r.vehicle_listing_id, r.vin, r.ymm, v_token, btrim(_submitted_by), nullif(btrim(coalesce(_submitted_role,'')),''), nullif(btrim(coalesce(_notes,'')),''))
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
    VALUES (v_id, r.tenant_id, nullif(btrim(coalesce(ln->>'category','')),''), coalesce(nullif(btrim(coalesce(ln->>'description','')),''), 'Recon item'),
       CASE WHEN ln->>'severity' IN ('required','recommended','ok','na') THEN ln->>'severity' ELSE 'recommended' END,
       v_labor, v_parts, v_sublet, v_total, nullif(btrim(coalesce(ln->>'vendor','')),''),
       coalesce(ln->'photos', '[]'::jsonb),
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
    VALUES ('recon_estimate_submitted', 'vehicle', r.vin, r.tenant_id, jsonb_build_object('estimate_id', v_id, 'lines', n, 'by', _submitted_by));
  EXCEPTION WHEN OTHERS THEN NULL; END;

  RETURN jsonb_build_object('ok', true, 'estimate_id', v_id, 'approval_token', v_token,
    'needs_approval', EXISTS (SELECT 1 FROM public.recon_estimate_lines WHERE estimate_id = v_id AND approval_status = 'pending'));
END; $$;

-- ── Resolve an estimate for the approval page (anon, via approval token) ─────
CREATE OR REPLACE FUNCTION public.get_recon_estimate(_approval_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE e public.recon_estimates%ROWTYPE; v_price numeric; v_lines jsonb;
BEGIN
  SELECT * INTO e FROM public.recon_estimates WHERE approval_token = _approval_token LIMIT 1;
  IF e.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found'); END IF;
  SELECT price INTO v_price FROM public.vehicle_listings WHERE id = e.vehicle_listing_id OR (vin = e.vin AND tenant_id = e.tenant_id) LIMIT 1;
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'id', id, 'category', category, 'description', description, 'severity', severity,
           'labor_cost', labor_cost, 'parts_cost', parts_cost, 'sublet_cost', sublet_cost, 'line_total', line_total,
           'vendor', vendor, 'photos', photos, 'approval_status', approval_status,
           'approved_amount', approved_amount, 'decline_reason', decline_reason) ORDER BY created_at), '[]'::jsonb)
    INTO v_lines FROM public.recon_estimate_lines WHERE estimate_id = e.id;
  RETURN jsonb_build_object('ok', true,
    'estimate', jsonb_build_object('id', e.id, 'vin', e.vin, 'ymm', e.ymm, 'status', e.status,
      'submitted_by', e.submitted_by, 'submitted_role', e.submitted_role, 'notes', e.notes,
      'subtotal', e.subtotal, 'approved_total', e.approved_total, 'created_at', e.created_at,
      'vehicle_price', v_price),
    'lines', v_lines);
END; $$;

-- ── Per-line decision (anon, token-gated) ───────────────────────────────────
CREATE OR REPLACE FUNCTION public.decide_recon_line(
  _approval_token text, _line_id uuid, _action text, _reason text DEFAULT NULL,
  _by text DEFAULT NULL, _channel text DEFAULT 'link'
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE e public.recon_estimates%ROWTYPE; v_line public.recon_estimate_lines%ROWTYPE; v_status text;
BEGIN
  SELECT * INTO e FROM public.recon_estimates WHERE approval_token = _approval_token LIMIT 1;
  IF e.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found'); END IF;
  SELECT * INTO v_line FROM public.recon_estimate_lines WHERE id = _line_id AND estimate_id = e.id LIMIT 1;
  IF v_line.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'line_not_found'); END IF;
  v_status := CASE _action WHEN 'approve' THEN 'approved' WHEN 'decline' THEN 'declined' WHEN 'defer' THEN 'deferred' ELSE NULL END;
  IF v_status IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'bad_action'); END IF;
  IF v_status = 'declined' AND coalesce(btrim(_reason),'') = '' THEN RETURN jsonb_build_object('ok', false, 'reason', 'reason_required'); END IF;

  UPDATE public.recon_estimate_lines SET
    approval_status = v_status,
    approved_amount = CASE WHEN v_status = 'approved' THEN line_total ELSE NULL END,
    decline_reason  = CASE WHEN v_status = 'declined' THEN btrim(_reason) ELSE NULL END,
    decided_by = nullif(btrim(coalesce(_by,'')),''), decision_channel = _channel, decided_at = now()
  WHERE id = _line_id;
  PERFORM public.recon_recompute_estimate(e.id);

  BEGIN
    INSERT INTO public.audit_log (action, entity_type, entity_id, store_id, details)
    VALUES ('recon_line_' || v_status, 'vehicle', e.vin, e.tenant_id,
            jsonb_build_object('estimate_id', e.id, 'line_id', _line_id, 'amount', v_line.line_total, 'reason', _reason, 'by', _by, 'channel', _channel));
  EXCEPTION WHEN OTHERS THEN NULL; END;
  RETURN jsonb_build_object('ok', true);
END; $$;

-- ── Bulk decision over all still-pending lines (anon, token-gated) ──────────
CREATE OR REPLACE FUNCTION public.decide_recon_estimate(
  _approval_token text, _action text, _by text DEFAULT NULL, _channel text DEFAULT 'link'
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE e public.recon_estimates%ROWTYPE; v_status text;
BEGIN
  SELECT * INTO e FROM public.recon_estimates WHERE approval_token = _approval_token LIMIT 1;
  IF e.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found'); END IF;
  v_status := CASE _action WHEN 'approve' THEN 'approved' WHEN 'decline' THEN 'declined' ELSE NULL END;
  IF v_status IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'bad_action'); END IF;
  UPDATE public.recon_estimate_lines SET
    approval_status = v_status,
    approved_amount = CASE WHEN v_status = 'approved' THEN line_total ELSE NULL END,
    decided_by = nullif(btrim(coalesce(_by,'')),''), decision_channel = _channel, decided_at = now()
  WHERE estimate_id = e.id AND approval_status = 'pending';
  PERFORM public.recon_recompute_estimate(e.id);
  BEGIN
    INSERT INTO public.audit_log (action, entity_type, entity_id, store_id, details)
    VALUES ('recon_estimate_' || v_status, 'vehicle', e.vin, e.tenant_id, jsonb_build_object('estimate_id', e.id, 'by', _by, 'channel', _channel));
  EXCEPTION WHEN OTHERS THEN NULL; END;
  RETURN jsonb_build_object('ok', true);
END; $$;

GRANT EXECUTE ON FUNCTION public.submit_recon_estimate(text, text, text, text, jsonb, numeric) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_recon_estimate(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.decide_recon_line(text, uuid, text, text, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.decide_recon_estimate(text, text, text, text) TO anon, authenticated;
