CREATE OR REPLACE FUNCTION public.claim_description_job(
  p_tenant_id uuid, p_vehicle_id uuid, p_case_id uuid,
  p_job_type text, p_idempotency_key text, p_payload jsonb DEFAULT '{}'::jsonb,
  p_allow_completed boolean DEFAULT false)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_id uuid;
BEGIN
  INSERT INTO public.description_jobs
    (tenant_id, vehicle_id, description_case_id, job_type, idempotency_key, payload_json,
     status, attempt_count, started_at)
  VALUES (p_tenant_id, p_vehicle_id, p_case_id, p_job_type, p_idempotency_key, p_payload,
     'running', 1, now())
  ON CONFLICT (idempotency_key) DO NOTHING
  RETURNING id INTO v_id;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;

  IF p_allow_completed THEN
    UPDATE public.description_jobs
       SET status='running', attempt_count = attempt_count + 1, started_at = now(),
           max_attempts = GREATEST(max_attempts, attempt_count + 1), updated_at = now()
     WHERE idempotency_key = p_idempotency_key
       AND status IN ('succeeded','failed_blocked','failed_retryable','cancelled')
    RETURNING id INTO v_id;
    IF v_id IS NOT NULL THEN RETURN v_id; END IF;
  END IF;

  UPDATE public.description_jobs
     SET status='running', attempt_count = attempt_count + 1, started_at = now(), updated_at = now()
   WHERE idempotency_key = p_idempotency_key
     AND status = 'failed_retryable' AND attempt_count < max_attempts
  RETURNING id INTO v_id;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;

  UPDATE public.description_jobs
     SET attempt_count = attempt_count + 1, started_at = now(), updated_at = now()
   WHERE idempotency_key = p_idempotency_key
     AND status = 'running' AND started_at < now() - interval '15 minutes'
     AND attempt_count < max_attempts
  RETURNING id INTO v_id;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;

  UPDATE public.description_jobs
     SET status='failed_blocked', failed_at = now(), updated_at = now(),
         last_error_code = COALESCE(last_error_code,'ATTEMPTS_EXHAUSTED')
   WHERE idempotency_key = p_idempotency_key
     AND status IN ('failed_retryable','running') AND attempt_count >= max_attempts;
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION public.archive_description_case(
  p_case_id uuid, p_reason text DEFAULT NULL, p_system boolean DEFAULT false)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_tenant uuid; v_vin text; v_uid uuid := (SELECT auth.uid());
BEGIN
  SELECT tenant_id, vin INTO v_tenant, v_vin FROM public.description_cases WHERE id = p_case_id;
  IF v_tenant IS NULL THEN RETURN false; END IF;

  IF NOT p_system AND v_uid IS NOT NULL
     AND NOT public.has_description_authority(v_tenant, 'approve') THEN
    RETURN false;
  END IF;

  UPDATE public.description_cases
     SET status='ARCHIVED', archived_at = now(), publication_eligibility='blocked',
         open_exception_count = 0, lock_version = lock_version + 1, updated_at = now()
   WHERE id = p_case_id;
  UPDATE public.description_exceptions
     SET status='dismissed', resolution = COALESCE(p_reason,'vehicle archived'), resolved_at = now()
   WHERE description_case_id = p_case_id AND status IN ('open','in_progress');
  UPDATE public.description_jobs SET status='cancelled', updated_at = now()
   WHERE description_case_id = p_case_id AND status IN ('queued','running');

  INSERT INTO public.audit_log (action, entity_type, entity_id, store_id, user_id, details)
  VALUES ('description_archived','description_case', p_case_id::text, v_tenant::text, v_uid,
          jsonb_build_object('vin', v_vin, 'reason', p_reason, 'system', p_system));
  RETURN true;
END $$;

REVOKE ALL ON FUNCTION public.claim_description_job(uuid, uuid, uuid, text, text, jsonb, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.archive_description_case(uuid, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_description_job(uuid, uuid, uuid, text, text, jsonb, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.archive_description_case(uuid, text, boolean) TO authenticated, service_role;