-- Optional: schedules the Files.com inventory worker with pg_cron. Kept out
-- of 0006 because it reads the service key from Vault, which the Lovable
-- migration tool refuses. Apply it from the Supabase SQL editor only when the
-- worker should run on a schedule; it schedules nothing by itself.
--
-- Prerequisites (shared with supabase/manual/marketcheck_launch_transport.sql):
--   select vault.create_secret('https://<project-ref>.supabase.co', 'supabase_url');
--   select vault.create_secret('<service role key>', 'service_role_key');
--   pg_net and pg_cron enabled.
-- Check:    select files_inventory_worker_prerequisites();
-- Schedule: select schedule_files_inventory_worker('*/15 * * * *');
-- Stop:     select unschedule_files_inventory_worker();
--
-- The cron command holds no key: each tick reads Vault at run time. Scheduling
-- never unpauses a store; paused stores and unbound files stay quarantined.
-- vAuto delivers about every 4 hours, so a 15-minute tick with reconcile picks
-- up each file within 15 minutes; a version already claimed or applied is
-- never imported twice (inventory_feed_claim_version).

CREATE OR REPLACE FUNCTION public.files_inventory_worker_prerequisites() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_url text; v_key boolean; v_jobs integer := NULL;
BEGIN
  IF to_regclass('vault.decrypted_secrets') IS NOT NULL THEN
    EXECUTE $q$SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_url' LIMIT 1$q$ INTO v_url;
    EXECUTE $q$SELECT EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'service_role_key' AND length(decrypted_secret) > 20)$q$ INTO v_key;
  END IF;
  IF to_regclass('cron.job') IS NOT NULL THEN
    EXECUTE $q$SELECT count(*) FROM cron.job WHERE jobname = 'files-inventory-worker' OR command ~ '(files-inventory-worker|files_inventory_worker_tick)'$q$ INTO v_jobs;
  END IF;
  RETURN jsonb_build_object(
    'pg_net', to_regproc('net.http_post') IS NOT NULL,
    'pg_cron', to_regclass('cron.job') IS NOT NULL,
    'vault', to_regclass('vault.decrypted_secrets') IS NOT NULL,
    'vault_supabase_url', v_url IS NOT NULL AND v_url ~ '^https://[a-z0-9-]+\.supabase\.co$',
    'vault_service_role_key', COALESCE(v_key, false),
    'existing_jobs', v_jobs,
    'ingestion', (SELECT jsonb_build_object('paused', ingestion_paused, 'emergency_stop', emergency_stop) FROM inventory_feed_controls LIMIT 1),
    'stores', (SELECT COALESCE(jsonb_agg(jsonb_build_object('store', display_name, 'feed_import_paused', feed_import_paused) ORDER BY display_name), '[]'::jsonb) FROM dealer_stores WHERE status = 'active'));
END $$;

-- One tick: read Vault, call the worker with reconcile. Holds no key itself.
CREATE OR REPLACE FUNCTION public.files_inventory_worker_tick() RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_url text; v_key text; v_id bigint;
BEGIN
  EXECUTE $q$SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_url' LIMIT 1$q$ INTO v_url;
  EXECUTE $q$SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1$q$ INTO v_key;
  IF v_url IS NULL OR v_key IS NULL THEN RAISE EXCEPTION 'supabase_url and service_role_key Vault entries required'; END IF;
  EXECUTE $q$SELECT net.http_post(url := $1, body := '{"reconcile":true}'::jsonb,
                 headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || $2), timeout_milliseconds := 120000)$q$
    INTO v_id USING v_url || '/functions/v1/files-inventory-worker', v_key;
  RETURN v_id;
END $$;

-- Idempotent: always leaves exactly one job, whatever existed before.
CREATE OR REPLACE FUNCTION public.schedule_files_inventory_worker(_cron_expr text DEFAULT '*/15 * * * *')
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE pre jsonb := files_inventory_worker_prerequisites(); job_id bigint;
BEGIN
  IF NOT (pre->>'vault_supabase_url')::boolean OR NOT (pre->>'vault_service_role_key')::boolean THEN
    RAISE EXCEPTION 'supabase_url and service_role_key Vault entries required';
  END IF;
  IF NOT (pre->>'pg_net')::boolean OR NOT (pre->>'pg_cron')::boolean THEN RAISE EXCEPTION 'pg_net and pg_cron required'; END IF;
  IF _cron_expr !~ '^[0-9*/,-]+( [0-9*/,-]+){4}$' THEN RAISE EXCEPTION 'invalid_cron_expression'; END IF;
  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'files-inventory-worker' OR command ~ '(files-inventory-worker|files_inventory_worker_tick)';
  SELECT cron.schedule('files-inventory-worker', _cron_expr, 'SELECT public.files_inventory_worker_tick()') INTO job_id;
  RETURN job_id;
END $$;

CREATE OR REPLACE FUNCTION public.unschedule_files_inventory_worker()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'files-inventory-worker' OR command ~ '(files-inventory-worker|files_inventory_worker_tick)'; END $$;

REVOKE ALL ON FUNCTION public.files_inventory_worker_prerequisites(), public.files_inventory_worker_tick(),
  public.schedule_files_inventory_worker(text), public.unschedule_files_inventory_worker() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.files_inventory_worker_prerequisites(), public.schedule_files_inventory_worker(text),
  public.unschedule_files_inventory_worker() TO service_role;
