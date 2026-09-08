-- oem-document-copy-sweep posted to oem-document-store with only x-cron-secret
-- and no Authorization header. config.toml pins verify_jwt = true for that
-- function on purpose -- it is the only place manufacturer document bytes are
-- fetched, and the entry carries a comment asking that it be argued with rather
-- than edited. So the gateway rejected every call with 401 before the function's
-- own isServiceOrCron check ever ran, and pg_cron recorded "succeeded" because
-- net.http_post successfully QUEUED the request. The job had never once done
-- work; its first scheduled run was 2026-09-08 10:20 UTC.
--
-- The caller was wrong, not the gate. Every other job in this project that hits
-- a verify_jwt = true function sends the project's service-role bearer, which is
-- what oem-brochure's config.toml comment documents as the intended pattern.
--
-- The bearer is copied from an existing job rather than read from Vault, which
-- is empty in this project (schedule_oem_document_copy_sweep raises on it, and
-- re-running that function would unschedule the working job). Applied to the
-- live database on 2026-09-08; this migration is the idempotent record of it and
-- a no-op where the job is already correct or does not exist.
DO $$
DECLARE
  v_jobid  bigint;
  v_bearer text;
  v_secret text;
BEGIN
  SELECT jobid, substring(command from '[0-9a-f]{40,64}')
    INTO v_jobid, v_secret
  FROM cron.job
  WHERE jobname = 'oem-document-copy-sweep'
    AND command NOT ILIKE '%Authorization%';

  IF v_jobid IS NULL THEN
    RAISE NOTICE 'oem-document-copy-sweep absent or already sends Authorization; nothing to do';
    RETURN;
  END IF;

  SELECT substring(command from 'Bearer ([A-Za-z0-9_.-]+)')
    INTO v_bearer
  FROM cron.job
  WHERE command ~ 'Bearer [A-Za-z0-9_.-]+'
  ORDER BY jobid
  LIMIT 1;

  IF v_bearer IS NULL OR v_secret IS NULL THEN
    RAISE WARNING 'cannot repair oem-document-copy-sweep: no bearer source (%) or cron secret (%)',
      v_bearer IS NOT NULL, v_secret IS NOT NULL;
    RETURN;
  END IF;

  PERFORM cron.alter_job(
    job_id  := v_jobid,
    command := format(
      'select net.http_post(url := %L, headers := jsonb_build_object(%L,%L,%L,%L,%L,%L), body := %L::jsonb, timeout_milliseconds := 120000);',
      'https://onnbmmdbrsgytfozfozn.supabase.co/functions/v1/oem-document-store',
      'Content-Type','application/json',
      'x-cron-secret', v_secret,
      'Authorization', 'Bearer '||v_bearer,
      '{"mode":"sweep","limit":500,"store_limit":8}'));
END $$;
