-- ──────────────────────────────────────────────────────────────
-- Wave 24 — pg_cron helpers for crawl-advertised-prices.
--
-- Same shape as the Wave 11.2 reengage cron migration: the
-- migration is INERT on apply (no schedule fires). An operator
-- runs the schedule_* helper once after the migration to turn
-- the cron on. Stores the supabase_url + service_role_key in
-- Vault per Wave 11.2 so secrets never appear in git or
-- cron.job arguments.
--
-- Default cadence: daily at 03:17 UTC (low-traffic window;
-- typical dealer overnight). Adjustable via the helper's
-- _cron_expr argument.
-- ──────────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

CREATE OR REPLACE FUNCTION public.schedule_crawl_advertised_prices(
  _cron_expr TEXT DEFAULT '17 3 * * *',
  _supabase_url TEXT DEFAULT NULL,
  _service_key TEXT DEFAULT NULL
)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault, cron
AS $$
DECLARE
  url TEXT;
  key TEXT;
  job_id BIGINT;
BEGIN
  -- Defaults from Vault entries shipped by ops. The same vault
  -- entries the Wave 11.2 reengage cron uses.
  IF _supabase_url IS NULL THEN
    SELECT decrypted_secret INTO url
    FROM vault.decrypted_secrets
    WHERE name = 'supabase_url'
    LIMIT 1;
  ELSE
    url := _supabase_url;
  END IF;

  IF _service_key IS NULL THEN
    SELECT decrypted_secret INTO key
    FROM vault.decrypted_secrets
    WHERE name = 'service_role_key'
    LIMIT 1;
  ELSE
    key := _service_key;
  END IF;

  IF url IS NULL OR key IS NULL THEN
    RAISE EXCEPTION 'supabase_url and service_role_key required (via args or Vault entries)';
  END IF;

  -- Cancel any prior schedule under the same name. Idempotent
  -- so re-running the helper updates the schedule in place.
  PERFORM cron.unschedule(jobid)
    FROM cron.job
   WHERE jobname = 'crawl-advertised-prices';

  -- Schedule it.
  SELECT cron.schedule(
    'crawl-advertised-prices',
    _cron_expr,
    format(
      $job$
        SELECT net.http_post(
          url := %L,
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', %L
          ),
          body := '{"limit":500}'::jsonb,
          timeout_milliseconds := 60000
        );
      $job$,
      url || '/functions/v1/crawl-advertised-prices',
      'Bearer ' || key
    )
  ) INTO job_id;

  RETURN job_id;
END $$;

GRANT EXECUTE ON FUNCTION public.schedule_crawl_advertised_prices(TEXT, TEXT, TEXT)
  TO service_role;

CREATE OR REPLACE FUNCTION public.unschedule_crawl_advertised_prices()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, cron
AS $$
BEGIN
  DELETE FROM cron.job WHERE jobname = 'crawl-advertised-prices';
END $$;

GRANT EXECUTE ON FUNCTION public.unschedule_crawl_advertised_prices()
  TO service_role;

CREATE OR REPLACE FUNCTION public.get_crawl_advertised_prices_schedule()
RETURNS TABLE (
  cron_expression TEXT,
  active BOOLEAN,
  last_run TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, cron
AS $$
BEGIN
  RETURN QUERY
  SELECT
    j.schedule::TEXT AS cron_expression,
    j.active,
    (
      SELECT MAX(jrd.start_time)
      FROM cron.job_run_details jrd
      WHERE jrd.jobid = j.jobid
    ) AS last_run
  FROM cron.job j
  WHERE j.jobname = 'crawl-advertised-prices';
END $$;

GRANT EXECUTE ON FUNCTION public.get_crawl_advertised_prices_schedule()
  TO authenticated, service_role;
