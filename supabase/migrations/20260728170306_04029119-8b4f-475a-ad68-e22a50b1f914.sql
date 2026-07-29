CREATE OR REPLACE FUNCTION public.schedule_compliance_forms_sweep(
  _cron_expr TEXT DEFAULT '10,15,20,25 9 * * *',
  _supabase_url TEXT DEFAULT NULL,
  _service_key TEXT DEFAULT NULL
)
RETURNS BIGINT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, vault, cron AS $$
DECLARE url TEXT; key TEXT; secret TEXT; hdrs JSONB; job_id BIGINT;
BEGIN
  IF _supabase_url IS NULL THEN
    SELECT decrypted_secret INTO url FROM vault.decrypted_secrets WHERE name = 'supabase_url' LIMIT 1;
  ELSE url := _supabase_url; END IF;
  IF _service_key IS NULL THEN
    SELECT decrypted_secret INTO key FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1;
  ELSE key := _service_key; END IF;
  IF url IS NULL OR key IS NULL THEN
    RAISE EXCEPTION 'supabase_url and service_role_key required (via args or Vault entries)';
  END IF;
  SELECT decrypted_secret INTO secret FROM vault.decrypted_secrets WHERE name = 'marketcheck_cron_secret' LIMIT 1;

  hdrs := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || key);
  IF secret IS NOT NULL AND secret <> '' THEN
    hdrs := hdrs || jsonb_build_object('x-cron-secret', secret);
  END IF;

  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'compliance-forms-sweep';
  SELECT cron.schedule('compliance-forms-sweep', _cron_expr, format(
    $job$
      SELECT net.http_post(
        url := %L,
        headers := %L::jsonb,
        body := '{"action": "sweep", "limit": 500}'::jsonb,
        timeout_milliseconds := 60000
      );
    $job$,
    url || '/functions/v1/generate-vehicle-forms',
    hdrs::text
  )) INTO job_id;
  RETURN job_id;
END $$;
GRANT EXECUTE ON FUNCTION public.schedule_compliance_forms_sweep(TEXT, TEXT, TEXT) TO service_role;

DO $$
BEGIN
  PERFORM public.schedule_compliance_forms_sweep();
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'compliance-forms-sweep not scheduled yet (%); call schedule_compliance_forms_sweep(cron, url, key) once Vault is set', SQLERRM;
END $$;