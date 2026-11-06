-- Optional: schedules the Files.com inventory worker with pg_cron. Kept out of
-- the migrations because it reads Vault, which the Lovable migration tool
-- refuses. Applying this file schedules nothing by itself.
--
-- No credential is stored in the cron job. The job's command is only
--   SELECT public.files_inventory_worker_tick();
-- and the tick reads the worker key from Vault each time it runs. The key is a
-- dedicated secret that authorises the files-inventory-worker function and
-- nothing else (not the service-role key).
--
-- Before scheduling (owner approval required for each step):
--   1. Generate a random key and store it twice, with the same value:
--      Vault:        select vault.create_secret('<key>', 'files_inventory_worker_key');
--      Vault:        select vault.create_secret('https://<project>.supabase.co', 'supabase_url');
--      Edge secret:  FILES_INVENTORY_WORKER_KEY = <key>
--   2. Deploy files-inventory-worker (it accepts the x-files-inventory-worker-key header).
--   3. One manual tick to check: select public.files_inventory_worker_tick();
--      then read net._http_response for that request id (expect HTTP 200).
--   4. select schedule_files_inventory_worker('*/10 * * * *');
-- To stop: select unschedule_files_inventory_worker();
-- To rotate: update the Vault secret and the edge secret together.

-- A previous version of this file baked the decrypted service-role key into
-- the cron command. Remove any job it created before installing this one.
DO $$ BEGIN
  IF to_regclass('cron.job') IS NOT NULL THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'files-inventory-worker' AND command ILIKE '%bearer%';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.files_inventory_worker_tick()
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, vault, net AS $$
DECLARE c public.inventory_feed_controls%ROWTYPE; url text; key text;
BEGIN
  SELECT * INTO c FROM inventory_feed_controls WHERE id = 1;
  -- Paused or stopped: do not even wake the worker.
  IF NOT FOUND OR c.emergency_stop OR c.ingestion_paused THEN RETURN NULL; END IF;
  SELECT decrypted_secret INTO url FROM vault.decrypted_secrets WHERE name = 'supabase_url' LIMIT 1;
  SELECT decrypted_secret INTO key FROM vault.decrypted_secrets WHERE name = 'files_inventory_worker_key' LIMIT 1;
  IF url IS NULL OR key IS NULL OR length(trim(key)) < 32 THEN
    RAISE WARNING 'files_inventory_worker_tick: Vault entries supabase_url and files_inventory_worker_key (32+ characters) are required';
    RETURN NULL;
  END IF;
  RETURN net.http_post(
    url := rtrim(url, '/') || '/functions/v1/files-inventory-worker',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-files-inventory-worker-key', key),
    body := jsonb_build_object('reconcile', c.reconcile_enabled),
    timeout_milliseconds := 120000);
END $$;

CREATE OR REPLACE FUNCTION public.schedule_files_inventory_worker(_cron_expr text DEFAULT '*/10 * * * *')
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, vault, cron AS $$
DECLARE job_id bigint;
BEGIN
  IF _cron_expr IS NULL OR _cron_expr !~ '^[0-9*/,\- ]+$' OR array_length(regexp_split_to_array(trim(_cron_expr), '\s+'), 1) <> 5 THEN
    RAISE EXCEPTION 'cron_expression_invalid';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'files_inventory_worker_key')
     OR NOT EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'supabase_url') THEN
    RAISE EXCEPTION 'supabase_url and files_inventory_worker_key Vault entries required';
  END IF;
  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'files-inventory-worker';
  SELECT cron.schedule('files-inventory-worker', _cron_expr, 'SELECT public.files_inventory_worker_tick();') INTO job_id;
  RETURN job_id;
END $$;

CREATE OR REPLACE FUNCTION public.unschedule_files_inventory_worker()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, cron AS $$
BEGIN PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'files-inventory-worker'; END $$;

REVOKE ALL ON FUNCTION public.files_inventory_worker_tick() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.schedule_files_inventory_worker(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.unschedule_files_inventory_worker() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.schedule_files_inventory_worker(text), public.unschedule_files_inventory_worker() TO service_role;
