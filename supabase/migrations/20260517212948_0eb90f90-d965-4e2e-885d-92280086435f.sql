CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_net  WITH SCHEMA extensions;

CREATE OR REPLACE FUNCTION public.schedule_reengage_abandoned_signings(
  _cron_expr     TEXT DEFAULT '17 * * * *',
  _supabase_url  TEXT DEFAULT NULL,
  _service_key   TEXT DEFAULT NULL
) RETURNS BIGINT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  _jobid BIGINT;
  _url   TEXT;
  _key   TEXT;
  _sql   TEXT;
BEGIN
  _url := COALESCE(_supabase_url,
    (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_url' LIMIT 1));
  _key := COALESCE(_service_key,
    (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1));

  IF _url IS NULL OR _key IS NULL THEN
    RAISE EXCEPTION 'schedule_reengage_abandoned_signings: pass _supabase_url + _service_key, or store them in vault as supabase_url / service_role_key';
  END IF;

  PERFORM public.unschedule_reengage_abandoned_signings();

  _sql := format(
    $cron$
      SELECT extensions.http_post(
        url     := %L,
        headers := jsonb_build_object(
                    'Content-Type', 'application/json',
                    'Authorization', 'Bearer ' || %L
                  ),
        body    := jsonb_build_object(
                    'min_hours_since_open', 24,
                    'min_hours_since_retry', 72,
                    'limit', 100
                  )::text
      );
    $cron$,
    rtrim(_url, '/') || '/functions/v1/reengage-abandoned-signings',
    _key
  );

  SELECT cron.schedule('autolabels_reengage_abandoned_signings', _cron_expr, _sql) INTO _jobid;
  RETURN _jobid;
END;
$$;

GRANT EXECUTE ON FUNCTION public.schedule_reengage_abandoned_signings(TEXT, TEXT, TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public.unschedule_reengage_abandoned_signings()
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
BEGIN
  DELETE FROM cron.job WHERE jobname = 'autolabels_reengage_abandoned_signings';
END;
$$;

GRANT EXECUTE ON FUNCTION public.unschedule_reengage_abandoned_signings() TO service_role;

CREATE OR REPLACE FUNCTION public.get_reengage_schedule()
RETURNS TABLE (jobid BIGINT, schedule TEXT, active BOOLEAN)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, extensions AS $$
  SELECT j.jobid, j.schedule, j.active
    FROM cron.job j
   WHERE j.jobname = 'autolabels_reengage_abandoned_signings'
   LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.get_reengage_schedule() TO authenticated, service_role;