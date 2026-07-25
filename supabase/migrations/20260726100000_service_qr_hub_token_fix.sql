-- ──────────────────────────────────────────────────────────────────────
-- S1: restore the hub-aware submit_safety_inspection (live QR regression).
--
-- 20260722180000 / 20260722194135 redefined submit_safety_inspection for the
-- complete-pending-in-place flow but regressed two behaviors that
-- 20260629080000:78,88 had established:
--   • the permanent per-vehicle hub token (department='vehicle') was rejected
--     with wrong_department, so the windshield Get-Ready QR could no longer
--     record a K-208 at all;
--   • the token was consumed unconditionally, so even if a 'vehicle' token had
--     been accepted, one sign-off would have killed the whole get-ready QR.
-- This merges the two lineages: hub token accepted and never consumed, legacy
-- single-use 'service' token consumed, pending ingest row completed in place,
-- created_by stamped for the signer-authority gate — plus a NEW server-side
-- already-passed guard: once an executed (signed, non-fail) K-208 exists for
-- the VIN, a second submission is refused instead of silently duplicated.
-- ──────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.submit_safety_inspection(
  _token text,
  _checklist jsonb,
  _result text,
  _failure_notes text,
  _notes text,
  _documents jsonb,
  _inspector_name text,
  _signature_data text,
  _content_hash text,
  _esign_consent jsonb,
  _ip text,
  _user_agent text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r public.dept_signoff_tokens%ROWTYPE;
  v_id uuid;
  v_done uuid;
  v_uid uuid := (SELECT auth.uid());
BEGIN
  SELECT * INTO r FROM public.dept_signoff_tokens WHERE token = _token LIMIT 1;
  IF r.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found'); END IF;
  IF r.status <> 'pending' THEN RETURN jsonb_build_object('ok', false, 'reason', 'used_or_revoked'); END IF;
  IF r.expires_at <= now() THEN RETURN jsonb_build_object('ok', false, 'reason', 'expired'); END IF;
  IF r.department NOT IN ('service','vehicle') THEN RETURN jsonb_build_object('ok', false, 'reason', 'wrong_department'); END IF;
  IF coalesce(trim(_inspector_name), '') = '' THEN RETURN jsonb_build_object('ok', false, 'reason', 'inspector_name_required'); END IF;

  -- Completed vehicle -> read-only record: a second signed non-fail inspection
  -- for the VIN is an error, never a duplicate. A signed FAIL does not trip
  -- this guard — re-inspection after repair is the intended path.
  SELECT id INTO v_done FROM public.safety_inspections
    WHERE tenant_id = r.tenant_id AND vin = r.vin
      AND status = 'signed' AND result IS DISTINCT FROM 'fail'
    LIMIT 1;
  IF v_done IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_completed', 'id', v_done);
  END IF;

  -- Complete the pending K-208 pre-created at ingest, if present.
  SELECT id INTO v_id FROM public.safety_inspections
    WHERE tenant_id = r.tenant_id AND vin = r.vin AND status = 'pending'
    ORDER BY created_at DESC LIMIT 1;

  IF v_id IS NOT NULL THEN
    UPDATE public.safety_inspections SET
      vehicle_listing_id = coalesce(vehicle_listing_id, r.vehicle_listing_id),
      ymm = coalesce(ymm, r.ymm),
      checklist = coalesce(_checklist, '[]'::jsonb), result = _result,
      failure_notes = _failure_notes, notes = _notes, documents = coalesce(_documents, '[]'::jsonb),
      inspector_name = _inspector_name, inspector_role = 'service',
      signature_data = _signature_data, signature_type = 'type', content_hash = _content_hash,
      esign_consent = _esign_consent, customer_ip = _ip, user_agent = _user_agent,
      submitted_via = 'qr', status = 'signed', signed_at = now(), updated_at = now(),
      -- The signer, not the ingest job, is who the authority gate must judge.
      created_by = coalesce(v_uid, created_by)
    WHERE id = v_id;
  ELSE
    INSERT INTO public.safety_inspections
      (tenant_id, vehicle_listing_id, vin, ymm, form_type, checklist, result, failure_notes, notes,
       documents, inspector_name, inspector_role, signature_data, signature_type, content_hash,
       esign_consent, customer_ip, user_agent, submitted_via, status, signed_at, created_by)
    VALUES
      (r.tenant_id, r.vehicle_listing_id, r.vin, r.ymm, 'CT-K208',
       coalesce(_checklist, '[]'::jsonb), _result, _failure_notes, _notes,
       coalesce(_documents, '[]'::jsonb), _inspector_name, 'service', _signature_data, 'type',
       _content_hash, _esign_consent, _ip, _user_agent, 'qr', 'signed', now(), v_uid)
    RETURNING id INTO v_id;
  END IF;

  -- Only the legacy single-use 'service' token is consumed; the hub token lives on.
  IF r.department = 'service' THEN
    UPDATE public.dept_signoff_tokens SET status = 'used', used_at = now(), updated_at = now() WHERE id = r.id;
  END IF;

  BEGIN
    INSERT INTO public.audit_log (action, entity_type, entity_id, store_id, details)
    VALUES ('safety_inspection_signed', 'vehicle', r.vin, r.tenant_id,
            jsonb_build_object('inspection_id', v_id, 'department', r.department, 'result', _result,
                               'via', 'qr', 'created_by', v_uid));
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN jsonb_build_object('ok', true, 'id', v_id);
END;
$$;

REVOKE ALL ON FUNCTION public.submit_safety_inspection(text, jsonb, text, text, text, jsonb, text, text, text, jsonb, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_safety_inspection(text, jsonb, text, text, text, jsonb, text, text, text, jsonb, text, text) TO anon, authenticated;
