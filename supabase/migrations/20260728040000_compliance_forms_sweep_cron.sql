-- Nightly self-heal for the FTC Buyers Guide + CT K-208 PDFs.
--
-- ensureComplianceDrafts re-renders a draft that exists with no file behind it,
-- but its only caller passing a render target is marketcheck-sync's update
-- branch. A vehicle therefore got repaired only if it appeared in tonight's
-- MarketCheck payload for a tenant with a configured feed; everything arriving
-- from autocurb-sync, the DMS webhook, a CSV import or a manual add had no path
-- back at all. The draft row existed, so nothing considered the work
-- outstanding, and the Buyers Guide stayed unopenable indefinitely.
--
-- Runs at 09:10, 09:15, 09:20 and 09:25 UTC — after the 08:40-08:55 factory
-- sticker sweep so the two never contend for the same isolate, and well clear
-- of enrich (03:15, worst case ~05:25) and description-reconcile (06:00, worst
-- case ~08:10). Still 05:10 ET / 02:10 PT, hours before any dealer opens.
--
-- Four passes because the sweep works a 90-second wall-clock budget and then
-- returns; consecutive passes drain the backlog instead of carrying it a night.
-- The function takes the `compliance_forms_sweep` service lock, so a pass that
-- overruns simply causes the next one to skip.
--
-- No key or JWT is written into the schedule body — both come from Vault at
-- schedule time, and an admin can pass them explicitly if Vault is empty.

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
  -- No tenant_id: a service/cron caller sweeps every dealer. The function acks
  -- immediately and finishes the batch in the background, so the http timeout
  -- only has to cover building the worklist.
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

-- Activate now (safe to re-run). Wrapped so a missing Vault entry does not fail
-- the migration — call schedule_compliance_forms_sweep(cron, url, key) instead.
DO $$
BEGIN
  PERFORM public.schedule_compliance_forms_sweep();
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'compliance-forms-sweep not scheduled yet (%); call schedule_compliance_forms_sweep(cron, url, key) once Vault is set', SQLERRM;
END $$;
