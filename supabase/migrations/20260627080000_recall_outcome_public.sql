-- ──────────────────────────────────────────────────────────────────────
-- No-login Service QR recall outcome. The service department scans the same
-- per-vehicle QR (/inspect/:token) and, when the vehicle has an open recall,
-- records one of the three approved outcomes. Token-gated (anon-callable),
-- mirrors the K-208 submit_safety_inspection pattern. The token is NOT consumed
-- (the recall review is independent of the single-use K-208 sign-off).
-- ──────────────────────────────────────────────────────────────────────

-- Read the open recall task for a token's vehicle (token-gated; anon).
CREATE OR REPLACE FUNCTION public.get_recall_task_for_token(_token text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r public.dept_signoff_tokens%ROWTYPE;
  t public.recall_service_tasks%ROWTYPE;
BEGIN
  SELECT * INTO r FROM public.dept_signoff_tokens WHERE token = _token LIMIT 1;
  IF r.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found'); END IF;
  IF r.expires_at <= now() THEN RETURN jsonb_build_object('ok', false, 'reason', 'expired'); END IF;

  SELECT * INTO t FROM public.recall_service_tasks
   WHERE vehicle_listing_id = r.vehicle_listing_id AND status = 'open_review'
   ORDER BY created_at DESC LIMIT 1;

  IF t.id IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'has_open_recall', false, 'vin', r.vin, 'ymm', r.ymm);
  END IF;

  RETURN jsonb_build_object(
    'ok', true, 'has_open_recall', true,
    'task_id', t.id, 'vin', t.vin, 'ymm', t.ymm,
    'open_recall_count', t.open_recall_count, 'recall_payload', t.recall_payload
  );
END;
$$;

-- Record a recall outcome from the QR (anon, token-gated).
CREATE OR REPLACE FUNCTION public.submit_recall_outcome_public(
  _token         text,
  _outcome       text,
  _employee_name text,
  _ro_number     text,
  _notes         text,
  _documents     jsonb DEFAULT '[]'::jsonb,
  _ip            text DEFAULT NULL,
  _user_agent    text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r public.dept_signoff_tokens%ROWTYPE;
  t public.recall_service_tasks%ROWTYPE;
BEGIN
  IF _outcome NOT IN ('recall_completed', 'no_fix_available', 'does_not_apply') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_outcome');
  END IF;
  IF coalesce(btrim(_employee_name), '') = '' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'employee_name_required');
  END IF;

  SELECT * INTO r FROM public.dept_signoff_tokens WHERE token = _token LIMIT 1;
  IF r.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found'); END IF;
  IF r.expires_at <= now() THEN RETURN jsonb_build_object('ok', false, 'reason', 'expired'); END IF;

  SELECT * INTO t FROM public.recall_service_tasks
   WHERE vehicle_listing_id = r.vehicle_listing_id AND status = 'open_review'
   ORDER BY created_at DESC LIMIT 1;
  IF t.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'no_open_recall'); END IF;

  UPDATE public.recall_service_tasks
     SET status        = 'resolved',
         outcome       = _outcome,
         employee_name = _employee_name,
         service_date  = now(),
         ro_number     = _ro_number,
         notes         = _notes,
         documents     = COALESCE(_documents, '[]'::jsonb),
         completed_at  = now(),
         updated_at    = now()
   WHERE id = t.id;

  BEGIN
    INSERT INTO public.audit_log (action, entity_type, entity_id, store_id, ip_address, user_agent, details)
    VALUES ('recall_service_outcome_recorded', 'vehicle_listing', t.vin, t.tenant_id::text, _ip, _user_agent,
            jsonb_build_object('outcome', _outcome, 'employee_name', _employee_name, 'ro_number', _ro_number,
                               'recall_signature', t.recall_signature, 'task_id', t.id, 'via', 'qr'));
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN jsonb_build_object('ok', true, 'task_id', t.id, 'outcome', _outcome);
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_recall_task_for_token(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_recall_outcome_public(text, text, text, text, text, jsonb, text, text) TO anon, authenticated;
