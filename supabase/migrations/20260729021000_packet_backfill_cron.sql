-- ─────────────────────────────────────────────────────────────────────
-- Nightly backfill for the OEM half of the customer packet.
--
-- The OEM Monroney pull and the OEM brochure / owner's-manual harvests are
-- wired at ingest and nowhere else. intake-autoprovision fires
-- oem-window-sticker once for a genuinely new VIN and says so in its own
-- comment -- "fired once at ingest and retried by nothing" -- and the two link
-- harvests run only when someone presses a button on the Vehicle File. Every
-- car that was already live when those hooks landed, and every car that
-- arrived by CSV import, DMS webhook or manual add, therefore has nothing and
-- will go on having nothing until it happens to re-ingest.
--
-- ── Cadence: 09:40 UTC, ONE pass a night ────────────────────────────
--
-- Last in the nightly chain, after everything that writes the data it reads
-- and clear of every sweep that fans sibling invocations at the same per-
-- function platform limit:
--
--   03:00 marketcheck-sync   03:15 enrich (chains, worst case ~05:25)
--   03:20 intake drafts      03:30 ingest-orchestrate   03:45 recall
--   04:30 get-ready          06:00 description-reconcile (worst case ~08:10)
--   08:40-08:55 factory-sticker-sweep
--   09:10-09:25 compliance-forms-sweep (90s budget per pass, so ~09:27)
--
-- 09:40 leaves a cushion past the last of those and is still 05:40 ET /
-- 02:40 PT, hours before any dealer opens.
--
-- ONE pass, not the four the sibling sweeps use. Those are bounded by a
-- wall clock, so consecutive passes drain a backlog that would otherwise be
-- carried a night. This one is bounded by MONEY, and a second pass would
-- simply spend the budget twice. A single nightly pass makes the ceiling
-- exactly one budget a night, which is the number that can be reasoned about.
--
-- ── What one pass can cost ──────────────────────────────────────────
--
--   sticker_limit 20  -> at most 20 VinAudit/Monroney window-sticker pulls
--   link_limit     8  -> at most 8 harvests that reach Firecrawl (a harvest
--                        issues up to 2 searches for a brochure, up to 4 for
--                        an owner's manual, so <= 32 searches worst case)
--
-- Both are hard: a cache hit, an unsupported make and a platform throttle all
-- return before any provider is touched and are refunded, and a separate
-- dispatch cap bounds invocation count so the refund cannot loop.
--
-- The nightly rate is not the real ceiling, though — the lifetime one is.
-- Every VIN is stamped after one answer and never re-purchased; every
-- (make, model, year) triple is recorded after its verdict and asked at most
-- three times ever. So the total spend is bounded by the size of the fleet,
-- not by the number of nights, and the bill trends to zero once the backlog
-- clears. A dealer with 120 cars is fully swept in about six nights.
--
-- Set sticker_limit or link_limit to 0 in the body to disable either half; the
-- other still runs, and the cache-only work costs nothing at all.
--
-- No key or JWT is written into the schedule body -- both come from Vault at
-- schedule time, and an admin can pass them explicitly if Vault is empty.
-- ─────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.schedule_packet_backfill(
  _cron_expr TEXT DEFAULT '40 9 * * *',
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

  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'packet-backfill';
  -- No tenant_id: a service/cron caller sweeps every dealer, and the worklist
  -- is round-robined across tenants so one dealer's backlog cannot consume the
  -- whole budget. The function acks immediately and finishes in the
  -- background, so the http timeout only has to cover building the worklist.
  SELECT cron.schedule('packet-backfill', _cron_expr, format(
    $job$
      SELECT net.http_post(
        url := %L,
        headers := %L::jsonb,
        body := '{"limit": 500, "sticker_limit": 20, "link_limit": 8}'::jsonb,
        timeout_milliseconds := 60000
      );
    $job$,
    url || '/functions/v1/packet-backfill',
    hdrs::text
  )) INTO job_id;
  RETURN job_id;
END $$;
GRANT EXECUTE ON FUNCTION public.schedule_packet_backfill(TEXT, TEXT, TEXT) TO service_role;

-- Activate now (safe to re-run). Wrapped so a missing Vault entry does not fail
-- the migration -- call schedule_packet_backfill(cron, url, key) instead.
DO $$
BEGIN
  PERFORM public.schedule_packet_backfill();
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'packet-backfill not scheduled yet (%); call schedule_packet_backfill(cron, url, key) once Vault is set', SQLERRM;
END $$;
