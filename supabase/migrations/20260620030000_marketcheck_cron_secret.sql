-- Harden the MarketCheck sync cron against key rotation. The scheduler now
-- sends a dedicated x-cron-secret header (from Vault 'marketcheck_cron_secret')
-- alongside the bearer. The edge function honors that secret as an auth path,
-- so rotating the service/anon key can never silently 401 the schedule again.
-- Backward compatible: when the Vault secret is absent the header is omitted
-- and the function's batch-shape auth path still admits the cron. Default
-- schedule is true nightly at 03:00 UTC to match the admin UI.
CREATE OR REPLACE FUNCTION public.schedule_marketcheck_sync(
  _cron_expr TEXT DEFAULT '0 3 * * *',
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

  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'marketcheck-sync';
  SELECT cron.schedule('marketcheck-sync', _cron_expr, format(
    $job$
      SELECT net.http_post(
        url := %L,
        headers := %L::jsonb,
        body := '{}'::jsonb,
        timeout_milliseconds := 120000
      );
    $job$,
    url || '/functions/v1/marketcheck-sync',
    hdrs::text
  )) INTO job_id;
  RETURN job_id;
END $$;
GRANT EXECUTE ON FUNCTION public.schedule_marketcheck_sync(TEXT, TEXT, TEXT) TO service_role;
