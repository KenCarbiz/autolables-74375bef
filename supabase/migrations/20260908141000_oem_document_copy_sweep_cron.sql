-- ─────────────────────────────────────────────────────────────────────
-- Nightly reconciliation of the dealer's own copies of their own brand's
-- manufacturer documents.
--
-- WHY A SWEEP AT ALL. The copy step runs at ingest, and correctly: every
-- intake path calls ensureOemDocCopies, which invokes oem-document-store for
-- each vehicle. But that call READS the manufacturer link cache, and on the
-- first car of a model the link harvest is still in flight, so there is
-- nothing to copy yet and the run skips. For a car that arrived by CSV
-- import, DMS webhook or manual add there was no second pass, so the copy was
-- never taken at all — the packet fell back to the manufacturer link, which
-- works today and is exactly the promise this feature exists to stop relying
-- on.
--
-- ── Cadence: 10:20 UTC, one pass a night ────────────────────────────
--
-- AFTER packet-backfill (09:40), and that order is required, not tidy:
-- packet-backfill is what harvests the manufacturer LINK, and this sweep can
-- only copy a document it has a link for. Running it first would mean a night
-- of link_missing rows for models whose link lands forty minutes later.
--
-- 10:20 UTC is 06:20 ET / 03:20 PT — before any dealer opens.
--
-- ── What one pass can cost ──────────────────────────────────────────
--
-- No provider spend at all: this function calls no metered API. Its cost is
-- bandwidth and storage, bounded by store_limit (8 documents a night, at
-- roughly 23 MB each) and by a four-minute wall clock inside the worker.
--
-- The lifetime ceiling is the real one. A copy is taken once per (tenant,
-- brand, model, model-year, kind) and never re-downloaded; a failure is
-- recorded in oem_document_copy_attempts and re-opened at most five times,
-- days apart. So the work is bounded by the size of the fleet, not by the
-- number of nights, and a franchised store with 120 cars is fully copied in
-- a couple of weeks and then costs nothing.
--
-- Set store_limit to 0 in the body to disable the downloads while leaving the
-- reconciliation (and its ledger rows) running.
-- ─────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.schedule_oem_document_copy_sweep(
  _cron_expr TEXT DEFAULT '20 10 * * *',
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

  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'oem-document-copy-sweep';
  -- No tenant_id: a cron caller sweeps every dealer, and the worklist is
  -- round-robined across tenants so one dealer's backlog cannot consume the
  -- whole run. The function acks immediately and finishes in the background,
  -- so the http timeout only has to cover building the worklist.
  SELECT cron.schedule('oem-document-copy-sweep', _cron_expr, format(
    $job$
      SELECT net.http_post(
        url := %L,
        headers := %L::jsonb,
        body := '{"mode": "sweep", "limit": 500, "store_limit": 8}'::jsonb,
        timeout_milliseconds := 60000
      );
    $job$,
    url || '/functions/v1/oem-document-store',
    hdrs::text
  )) INTO job_id;
  RETURN job_id;
END $$;

GRANT EXECUTE ON FUNCTION public.schedule_oem_document_copy_sweep(TEXT, TEXT, TEXT) TO service_role;

-- Activate now (safe to re-run). Wrapped so a missing Vault entry does not
-- fail the migration -- call schedule_oem_document_copy_sweep(cron, url, key)
-- once Vault is set.
DO $$
BEGIN
  PERFORM public.schedule_oem_document_copy_sweep();
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'oem-document-copy-sweep not scheduled yet (%); call schedule_oem_document_copy_sweep(cron, url, key) once Vault is set', SQLERRM;
END $$;
