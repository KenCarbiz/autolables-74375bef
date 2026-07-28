-- Nightly self-heal for OEM factory window stickers. There was no sweep for
-- them at all: a factory_sticker_record is only ever created by a live
-- orchestrate call, and the only automatic caller for a pre-existing vehicle
-- is marketcheck-sync, which needs the tenant to have a MarketCheck feed AND
-- the VIN to be in tonight's payload. Everything arriving from autocurb-sync,
-- the DMS webhook, a CSV import or a manual add got one attempt at ingest and
-- was never retried, which is how production ended up with 4 records against
-- 132 published vehicles.
--
-- Runs at 08:40, 08:45, 08:50 and 08:55 UTC — deliberately last in the nightly
-- chain and clear of everything in it. Enrich starts 03:15 and can run ~2.2
-- hours (to ~05:25); description starts 04:10 and can run ~2.2 hours (to
-- ~06:20); 03:20 intake drafts, 03:30 ingest-orchestrate, 03:45 recall and
-- 04:30 get-ready are long finished. 08:40 leaves a two-hour cushion past the
-- worst case of the two long sweeps, so neither one sliding late can overlap
-- this, and it is still 04:40 ET / 01:40 PT — hours before any dealer opens.
-- Running last is also what makes it useful: it reads the build sheets and
-- truth snapshots tonight's enrich pass just wrote instead of racing them.
--
-- Four passes because the sweep works a 90-second wall-clock budget per
-- invocation and then returns; consecutive passes drain the backlog instead of
-- carrying it for a night. The function takes the `factory_sticker_sweep`
-- service lock, so a pass that overruns simply causes the next one to skip.
--
-- Honors the same x-cron-secret path as the sibling schedules so a key
-- rotation can never silently 401 the job. No key or JWT is ever written into
-- the schedule body — both come from Vault at schedule time.

CREATE OR REPLACE FUNCTION public.schedule_factory_sticker_sweep(
  _cron_expr TEXT DEFAULT '40,45,50,55 8 * * *',
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

  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'factory-sticker-sweep';
  -- No tenant_id: a service/cron caller sweeps every dealer. The function acks
  -- immediately and finishes the batch in the background, so the http timeout
  -- only has to cover building the worklist.
  SELECT cron.schedule('factory-sticker-sweep', _cron_expr, format(
    $job$
      SELECT net.http_post(
        url := %L,
        headers := %L::jsonb,
        body := '{"action": "orchestrate_sweep", "limit": 500}'::jsonb,
        timeout_milliseconds := 60000
      );
    $job$,
    url || '/functions/v1/factory-sticker-orchestrate',
    hdrs::text
  )) INTO job_id;
  RETURN job_id;
END $$;
GRANT EXECUTE ON FUNCTION public.schedule_factory_sticker_sweep(TEXT, TEXT, TEXT) TO service_role;

-- Activate now (safe to re-run). Wrapped so a missing Vault entry on first
-- deploy doesn't fail the whole migration — the admin can call
-- schedule_factory_sticker_sweep() with explicit args later.
DO $$
BEGIN
  PERFORM public.schedule_factory_sticker_sweep();
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'factory-sticker-sweep not scheduled yet (%); call schedule_factory_sticker_sweep(cron, url, key) once Vault is set', SQLERRM;
END $$;
