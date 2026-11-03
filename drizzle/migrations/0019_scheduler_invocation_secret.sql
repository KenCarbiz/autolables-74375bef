-- Scheduler credentials without Vault. The Lovable migration tool refuses SQL
-- that reads Vault and Lovable Cloud never exposes the service-role key, so
-- pg_cron jobs and the launch dispatcher authenticate to edge functions with
-- a random invocation secret generated here, inside the database. Nobody
-- copies or sees it: the scheduler reads it at run time, and the functions
-- verify it with scheduler_secret_matches through their own service client.
-- The gateway key is the project's publishable anon key (already public in
-- the frontend bundle); it only gets the request past JWT verification and
-- grants nothing by itself.
--
-- Replaces supabase/manual/files_inventory_worker_schedule.sql and
-- supabase/manual/marketcheck_launch_transport.sql. Installing this
-- schedules nothing: the dispatcher job stays OFF until START, and the
-- Files.com worker runs only after schedule_files_inventory_worker() is
-- called with the owner's approval.

CREATE TABLE IF NOT EXISTS public.scheduler_config (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  functions_base_url text NOT NULL CHECK (functions_base_url ~ '^https://[a-z0-9-]+\.supabase\.co$'),
  gateway_key text NOT NULL CHECK (length(gateway_key) > 20),
  invocation_secret text NOT NULL
    DEFAULT replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')
    CHECK (invocation_secret ~ '^[0-9a-f]{64}$'),
  rotated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.scheduler_config ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.scheduler_config FROM PUBLIC, anon, authenticated;

INSERT INTO public.scheduler_config (id, functions_base_url, gateway_key)
VALUES (1, 'https://onnbmmdbrsgytfozfozn.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9ubmJtbWRicnNneXRmb3pmb3puIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU4MjE1NDUsImV4cCI6MjA5MTM5NzU0NX0.NPYibMwwXXsttNlOcmC42qMSes7gJYSdB-GgMIhvcuo')
ON CONFLICT (id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.scheduler_secret_matches(p_secret text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p_secret IS NOT NULL AND p_secret ~ '^[0-9a-f]{64}$'
     AND EXISTS (SELECT 1 FROM scheduler_config WHERE id = 1 AND md5(invocation_secret) = md5(p_secret))
$$;

-- Both sides read the secret at run time, so a rotation takes effect on the
-- next tick with no redeploy.
CREATE OR REPLACE FUNCTION public.scheduler_rotate_secret() RETURNS timestamptz
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE scheduler_config
     SET invocation_secret = replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''), rotated_at = now()
   WHERE id = 1
  RETURNING rotated_at
$$;

CREATE OR REPLACE FUNCTION public.scheduler_post(p_function text, p_body jsonb, p_timeout_ms integer) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE s scheduler_config%ROWTYPE; v_id bigint;
BEGIN
  IF p_function IS NULL OR p_function !~ '^[a-z0-9-]{1,64}$' THEN RAISE EXCEPTION 'invalid_function_name'; END IF;
  SELECT * INTO s FROM scheduler_config WHERE id = 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'scheduler_not_configured'; END IF;
  SELECT net.http_post(
    url := s.functions_base_url || '/functions/v1/' || p_function,
    body := COALESCE(p_body, '{}'::jsonb),
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || s.gateway_key,
                                  'apikey', s.gateway_key, 'x-scheduler-secret', s.invocation_secret),
    timeout_milliseconds := p_timeout_ms) INTO v_id;
  RETURN v_id;
END $$;

-- ── Launch dispatcher transport (replaces the refusing defaults in 0018) ──
CREATE OR REPLACE FUNCTION public.marketcheck_launch_transport_ready() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_url text;
BEGIN
  IF to_regproc('net.http_post') IS NULL OR to_regclass('net._http_response') IS NULL THEN
    RETURN jsonb_build_object('ready', false, 'reason', 'pg_net_missing');
  END IF;
  SELECT functions_base_url INTO v_url FROM scheduler_config WHERE id = 1;
  IF v_url IS NULL THEN RETURN jsonb_build_object('ready', false, 'reason', 'scheduler_not_configured'); END IF;
  RETURN jsonb_build_object('ready', true, 'host', substring(v_url from '^https://([^/]+)'));
END $$;

-- Calls only the workload function named by the active plan.
CREATE OR REPLACE FUNCTION public.marketcheck_launch_transport(p_function text, p_body jsonb) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_fn text;
BEGIN
  SELECT p.workload->>'function' INTO v_fn FROM marketcheck_launch_control c JOIN marketcheck_launch_plans p ON p.version = c.plan_version WHERE c.id = 1;
  IF v_fn IS NULL OR p_function IS DISTINCT FROM v_fn THEN RAISE EXCEPTION 'transport_function_not_in_plan: %', p_function; END IF;
  RETURN scheduler_post(p_function, p_body, 60000);
END $$;

CREATE OR REPLACE FUNCTION public.marketcheck_launch_transport_result(p_request_id bigint) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE r jsonb;
BEGIN
  IF p_request_id IS NULL OR to_regclass('net._http_response') IS NULL THEN RETURN NULL; END IF;
  EXECUTE $q$SELECT jsonb_build_object('status_code', status_code, 'error', COALESCE(error_msg, CASE WHEN timed_out THEN 'timed_out' END),
                 'body', CASE WHEN content ~ '^\s*\{' THEN content::jsonb END) FROM net._http_response WHERE id = $1$q$
    INTO r USING p_request_id;
  RETURN r;
END $$;

-- ── Files.com inventory worker schedule ──────────────────────────────────
-- vAuto delivers about every 4 hours, so a 15-minute tick with reconcile
-- picks each file up within 15 minutes; a version already claimed or applied
-- is never imported twice (inventory_feed_claim_version). Scheduling never
-- unpauses a store.
CREATE OR REPLACE FUNCTION public.files_inventory_worker_prerequisites() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_jobs integer := NULL;
BEGIN
  IF to_regclass('cron.job') IS NOT NULL THEN
    EXECUTE $q$SELECT count(*) FROM cron.job WHERE jobname = 'files-inventory-worker' OR command ~ '(files-inventory-worker|files_inventory_worker_tick)'$q$ INTO v_jobs;
  END IF;
  RETURN jsonb_build_object(
    'pg_net', to_regproc('net.http_post') IS NOT NULL,
    'pg_cron', to_regclass('cron.job') IS NOT NULL,
    'scheduler_config', EXISTS (SELECT 1 FROM scheduler_config WHERE id = 1),
    'existing_jobs', v_jobs,
    'ingestion', (SELECT jsonb_build_object('paused', ingestion_paused, 'emergency_stop', emergency_stop) FROM inventory_feed_controls LIMIT 1),
    'stores', (SELECT COALESCE(jsonb_agg(jsonb_build_object('store', display_name, 'feed_import_paused', feed_import_paused) ORDER BY display_name), '[]'::jsonb) FROM dealer_stores WHERE status = 'active'));
END $$;

CREATE OR REPLACE FUNCTION public.files_inventory_worker_tick() RETURNS bigint
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT scheduler_post('files-inventory-worker', '{"reconcile":true}'::jsonb, 120000)
$$;

-- Idempotent: always leaves exactly one job, whatever existed before.
CREATE OR REPLACE FUNCTION public.schedule_files_inventory_worker(_cron_expr text DEFAULT '*/15 * * * *')
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE pre jsonb := files_inventory_worker_prerequisites(); job_id bigint;
BEGIN
  IF NOT (pre->>'scheduler_config')::boolean THEN RAISE EXCEPTION 'scheduler_not_configured'; END IF;
  IF NOT (pre->>'pg_net')::boolean OR NOT (pre->>'pg_cron')::boolean THEN RAISE EXCEPTION 'pg_net and pg_cron required'; END IF;
  IF _cron_expr IS NULL OR _cron_expr !~ '^[0-9*/,-]+( [0-9*/,-]+){4}$' THEN RAISE EXCEPTION 'invalid_cron_expression'; END IF;
  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'files-inventory-worker' OR command ~ '(files-inventory-worker|files_inventory_worker_tick)';
  SELECT cron.schedule('files-inventory-worker', _cron_expr, 'SELECT public.files_inventory_worker_tick()') INTO job_id;
  RETURN job_id;
END $$;

CREATE OR REPLACE FUNCTION public.unschedule_files_inventory_worker()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'files-inventory-worker' OR command ~ '(files-inventory-worker|files_inventory_worker_tick)'; END $$;

REVOKE ALL ON FUNCTION public.scheduler_secret_matches(text), public.scheduler_rotate_secret(),
  public.scheduler_post(text, jsonb, integer),
  public.marketcheck_launch_transport_ready(), public.marketcheck_launch_transport(text, jsonb),
  public.marketcheck_launch_transport_result(bigint),
  public.files_inventory_worker_prerequisites(), public.files_inventory_worker_tick(),
  public.schedule_files_inventory_worker(text), public.unschedule_files_inventory_worker()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.scheduler_secret_matches(text), public.scheduler_rotate_secret(),
  public.files_inventory_worker_prerequisites(), public.schedule_files_inventory_worker(text),
  public.unschedule_files_inventory_worker() TO service_role;
