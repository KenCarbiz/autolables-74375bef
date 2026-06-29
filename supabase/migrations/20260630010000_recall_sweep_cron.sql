-- Nightly recall self-heal. Since auto-publish-on-ingest now puts cars live the
-- moment they land, the Recall backfill worklist (published listings whose
-- recall_check is missing or >30 days old) refills a little each night. This
-- schedules marketcheck-recalls in `sweep` mode to clear it automatically so the
-- admin screen stays empty on its own.
--
-- Runs at 03:45 UTC — after marketcheck-sync (03:00) and the ingest-orchestrate
-- sweep (03:30), so the freshly-ingested cars from tonight get a recall check in
-- the same window. Honors the same x-cron-secret path as schedule_marketcheck_sync
-- so a key rotation can never silently 401 the schedule.

CREATE OR REPLACE FUNCTION public.schedule_recall_sweep(
  _cron_expr TEXT DEFAULT '45 3 * * *',
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

  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'recall-sweep';
  SELECT cron.schedule('recall-sweep', _cron_expr, format(
    $job$
      SELECT net.http_post(
        url := %L,
        headers := %L::jsonb,
        body := '{"sweep": true, "limit": 500}'::jsonb,
        timeout_milliseconds := 240000
      );
    $job$,
    url || '/functions/v1/marketcheck-recalls',
    hdrs::text
  )) INTO job_id;
  RETURN job_id;
END $$;
GRANT EXECUTE ON FUNCTION public.schedule_recall_sweep(TEXT, TEXT, TEXT) TO service_role;

-- Activate the schedule now (no-op safe to re-run). Wrapped so a missing Vault
-- entry on first deploy doesn't fail the whole migration — the admin can call
-- schedule_recall_sweep() with explicit args later.
DO $$
BEGIN
  PERFORM public.schedule_recall_sweep();
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'recall-sweep not scheduled yet (%); call schedule_recall_sweep(cron, url, key) once Vault is set', SQLERRM;
END $$;
