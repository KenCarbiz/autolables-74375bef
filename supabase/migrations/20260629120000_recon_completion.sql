-- ─────────────────────────────────────────────────────────────────────────
-- Service confirms reconditioning work is DONE from the windshield QR.
--
-- The used-car manager approves recon lines; the service department does the
-- work, then scans the same Get-Ready QR and checks off each line they
-- completed. Adds per-line completion tracking + two anon, token-gated RPCs
-- (mirroring the K-208 / detail sign-off pattern) so the no-login QR can read
-- the approved work and mark it done.
-- ─────────────────────────────────────────────────────────────────────────

ALTER TABLE public.recon_estimate_lines
  ADD COLUMN IF NOT EXISTS completed_at    timestamptz,
  ADD COLUMN IF NOT EXISTS completed_by    text,
  ADD COLUMN IF NOT EXISTS completion_notes text;

-- ── List the approved recon work for a vehicle (anon, via the Get-Ready hub
-- token). Only approved / auto-approved lines — the work the shop should do. ──
CREATE OR REPLACE FUNCTION public.get_recon_for_token(_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.dept_signoff_tokens%ROWTYPE; v_lines jsonb;
BEGIN
  SELECT * INTO r FROM public.dept_signoff_tokens WHERE token = _token LIMIT 1;
  IF r.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found'); END IF;
  IF r.expires_at <= now() OR r.status <> 'pending' THEN RETURN jsonb_build_object('ok', false, 'reason', 'expired'); END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'id', l.id, 'category', l.category, 'description', l.description, 'severity', l.severity,
           'completed_at', l.completed_at, 'completed_by', l.completed_by) ORDER BY l.created_at), '[]'::jsonb)
    INTO v_lines
    FROM public.recon_estimate_lines l
    JOIN public.recon_estimates e ON e.id = l.estimate_id
   WHERE e.tenant_id = r.tenant_id AND e.vin = r.vin
     AND l.approval_status IN ('approved', 'auto_approved');

  RETURN jsonb_build_object('ok', true, 'vin', r.vin, 'ymm', r.ymm, 'lines', v_lines);
END; $$;

-- ── Mark recon lines completed (anon, via the Get-Ready hub token) ──────────
CREATE OR REPLACE FUNCTION public.recon_confirm_lines_done(
  _token text, _line_ids jsonb, _by text, _notes text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.dept_signoff_tokens%ROWTYPE; v_n int;
BEGIN
  SELECT * INTO r FROM public.dept_signoff_tokens WHERE token = _token LIMIT 1;
  IF r.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found'); END IF;
  IF r.expires_at <= now() OR r.status <> 'pending' THEN RETURN jsonb_build_object('ok', false, 'reason', 'expired'); END IF;
  IF coalesce(btrim(_by), '') = '' THEN RETURN jsonb_build_object('ok', false, 'reason', 'name_required'); END IF;
  IF _line_ids IS NULL OR jsonb_array_length(_line_ids) = 0 THEN RETURN jsonb_build_object('ok', false, 'reason', 'no_lines'); END IF;

  -- Only lines that belong to THIS vehicle's estimate and are approved can be
  -- confirmed — the token scopes the write to its own vehicle.
  UPDATE public.recon_estimate_lines l SET
    completed_at = now(), completed_by = btrim(_by), completion_notes = nullif(btrim(coalesce(_notes, '')), '')
  FROM public.recon_estimates e
  WHERE l.estimate_id = e.id
    AND e.tenant_id = r.tenant_id AND e.vin = r.vin
    AND l.approval_status IN ('approved', 'auto_approved')
    AND l.id IN (SELECT (jsonb_array_elements_text(_line_ids))::uuid);
  GET DIAGNOSTICS v_n = ROW_COUNT;

  BEGIN
    INSERT INTO public.audit_log (action, entity_type, entity_id, store_id, details)
    VALUES ('recon_work_completed', 'vehicle', r.vin, r.tenant_id, jsonb_build_object('lines', v_n, 'by', _by));
  EXCEPTION WHEN OTHERS THEN NULL; END;

  RETURN jsonb_build_object('ok', true, 'completed', v_n);
END; $$;

GRANT EXECUTE ON FUNCTION public.get_recon_for_token(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.recon_confirm_lines_done(text, jsonb, text, text) TO anon, authenticated;
