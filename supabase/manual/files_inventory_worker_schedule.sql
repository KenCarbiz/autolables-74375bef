-- Optional: schedules the Files.com inventory worker with pg_cron. Kept out
-- of 0006 because it reads the service key from Vault, which the Lovable
-- migration tool refuses. Apply it from the Supabase SQL editor only when the
-- worker should run on a schedule; it schedules nothing by itself. Then run
--   select schedule_files_inventory_worker('*/10 * * * *');
-- and to stop: select unschedule_files_inventory_worker();

CREATE OR REPLACE FUNCTION public.schedule_files_inventory_worker(_cron_expr text DEFAULT '*/10 * * * *')
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, vault, cron AS $$
DECLARE url text; key text; job_id bigint;
BEGIN
  SELECT decrypted_secret INTO url FROM vault.decrypted_secrets WHERE name = 'supabase_url' LIMIT 1;
  SELECT decrypted_secret INTO key FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1;
  IF url IS NULL OR key IS NULL THEN RAISE EXCEPTION 'supabase_url and service_role_key Vault entries required'; END IF;
  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'files-inventory-worker';
  SELECT cron.schedule('files-inventory-worker', _cron_expr, format(
    $job$ SELECT net.http_post(url := %L, headers := jsonb_build_object('Content-Type','application/json','Authorization',%L), body := '{"reconcile":true}'::jsonb, timeout_milliseconds := 120000); $job$,
    url || '/functions/v1/files-inventory-worker', 'Bearer ' || key)) INTO job_id;
  RETURN job_id;
END $$;

CREATE OR REPLACE FUNCTION public.unschedule_files_inventory_worker()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, cron AS $$
BEGIN PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'files-inventory-worker'; END $$;

REVOKE ALL ON FUNCTION public.schedule_files_inventory_worker(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.unschedule_files_inventory_worker() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.schedule_files_inventory_worker(text), public.unschedule_files_inventory_worker() TO service_role;
