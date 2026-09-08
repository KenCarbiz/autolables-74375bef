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