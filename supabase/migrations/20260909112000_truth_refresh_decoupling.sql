-- ──────────────────────────────────────────────────────────────────────────
-- TRUTH REFRESH, DECOUPLED FROM STICKER GENERATION AND PUBLICATION
--
-- PURPOSE
-- Vehicle Truth is a property of the VEHICLE. A window sticker is one
-- downstream consumer of it. Today the two are the same event: vehicle_facts
-- and vehicle_snapshots are written only by refreshVehicleTruth, and the only
-- automatic caller is factory-sticker-orchestrate's generation path. The
-- nightly `orchestrate_sweep` is right to leave a settled document alone —
-- SWEEP_NEVER_RERUN_STATUSES = PUBLISHED, APPROVED, SUPERSEDED, ARCHIVED,
-- FAILED_PERMANENT — but because that same run is the only thing that writes
-- facts, filing the sticker also froze the vehicle's truth.
--
-- The function already has the separated path: action `refresh_truth_sweep`
-- resolves truth from saved data only, calls no provider and generates no
-- document. It has never run. No cron job in this database invokes it (22
-- jobs, none mentioning refresh_truth), it refused a caller that named no
-- tenant, and its only mode skipped every vehicle that had ever resolved. So
-- the fix is to make the existing path run, not to write a new one.
--
-- Live evidence, pilot tenant 3f0f97f5-4151-4e32-88ef-e2d6fc5a3142, 130 active
-- listings, 2026-09-09:
--   * 88 PUBLISHED / 35 ARCHIVED / 5 REVIEW_REQUIRED sticker records; 74 of
--     the 88 published vehicles carry facts older than 7 days, the oldest
--     snapshot dating to 2026-07-28.
--   * 5 vehicles hold ZERO facts and ZERO snapshots while a NeoVIN build
--     sheet sits on the listing — JN8AZ3BE9V9730002, JN8AZ3CC4V9640124,
--     JN8AZ3DB9V9450387, JN8AZ3DB9V9450437 (sticker ARCHIVED) and
--     JTMABABA5PA005774 (PENDING_DATA). That is Gate 2's "renders nothing for
--     engine, drivetrain and MSRP".
--   * JN8AZ3BEXV9730011 resolves total_msrp 111,240 (facts written
--     2026-07-28 from a NeoVIN decode of the same date). The listing's own
--     mc_attributes, redecoded 2026-09-06, holds base 94,590 + destination
--     2,245 = total 98,205. The newer answer has been saved for three days and
--     truth cannot see it, because the sticker is settled.
--
-- FORWARD SQL
--   1. truth_refresh_candidates(uuid, int) — one row per non-archived listing
--      with its last resolution time (max vehicle_facts.updated_at), whether a
--      snapshot exists, and its sticker status, ordered oldest-truth-first.
--      The sticker status is RETURNED FOR REPORTING ONLY; no rule in this
--      function or in its caller filters on it. That is the invariant this
--      migration exists to establish.
--   2. schedule_truth_refresh_sweep(...) + activation — the nightly job,
--      07:30 / 07:40 / 07:50 UTC, cross-tenant, mode "due".
--
-- DATA IMPACT
-- This migration writes no rows. It schedules a job whose runs append truth:
-- new vehicle_snapshots versions when a material field moved (the table is
-- append-only and guarded by trg_vehicle_snapshots_immutable), upserted
-- vehicle_facts, and stale_document_flags on documents built from a
-- superseded snapshot. It regenerates NO sticker, changes NO document_status
-- and republishes NOTHING: a stale flag is a queue entry a human acts on. On
-- the first run expect roughly 100 pilot-tenant vehicles to gain or correct
-- facts and a comparable number of price/mileage stale flags to be raised for
-- review, because that backlog is real and has been invisible.
--
-- RLS IMPACT
-- None. No policy is added, dropped or altered. Both functions are
-- SECURITY DEFINER and executable by service_role only; EXECUTE is revoked
-- from PUBLIC, anon and authenticated, so no interactive caller reaches
-- either. The sweep itself runs as service role, as it already did.
--
-- INDEX IMPACT
-- None, deliberately. EXPLAIN ANALYZE of the candidate query on live data:
-- 131 rows, 184 ms, Sort over a Nested Loop that already uses
-- idx_vehicle_facts_vehicle (Bitmap Index Scan, 18 rows/vehicle) and
-- idx_fk_factory_sticker_records_vehicle_id. The cost is two sequential scans
-- of small tables (vehicle_listings 285 rows, vehicle_snapshots 313). Adding
-- an index for a nightly worklist build at that size would be speculative.
--
-- EXPECTED ROW COUNTS
--   truth_refresh_candidates(NULL, 2000) -> 131 rows today (285 listings, 154
--   archived). One additional cron.job row: 'truth-refresh-nightly'.
--
-- BACKFILL PLAN
-- The sweep is the backfill. Ordered oldest-truth-first, three passes a night
-- at a 90-second budget each, it drains the never-resolved vehicles first
-- (last_resolved_at NULL sorts first), then the oldest. No separate one-shot
-- backfill and no bulk relabelling: every fact is re-derived through the
-- normal path from the source data already saved.
--
-- VERIFICATION QUERY
--   SELECT count(*) FILTER (WHERE last_resolved_at IS NULL) AS never_resolved,
--          count(*) FILTER (WHERE last_resolved_at < now() - interval '7 days') AS stale_7d,
--          count(*) AS candidates
--     FROM public.truth_refresh_candidates(NULL, 2000);
--   SELECT jobname, schedule, active FROM cron.job WHERE jobname = 'truth-refresh-nightly';
--   SELECT details FROM public.audit_log
--    WHERE action = 'vehicle_truth_refresh_sweep' ORDER BY created_at DESC LIMIT 5;
--
-- ROLLBACK
--   SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'truth-refresh-nightly';
--   DROP FUNCTION IF EXISTS public.schedule_truth_refresh_sweep(text, text, text);
--   DROP FUNCTION IF EXISTS public.truth_refresh_candidates(uuid, integer);
-- Nothing written by a run is rolled back by that: appended snapshots are
-- history and stay.
-- ──────────────────────────────────────────────────────────────────────────


-- ══ 1. The worklist ═══════════════════════════════════════════════════════
--
-- last_resolved_at is vehicle_facts.updated_at rather than the newest
-- snapshot date on purpose: facts are rewritten on every refresh, snapshots
-- only when something material moved. Ordering by snapshot date would park a
-- vehicle whose data legitimately never changes permanently at the head of
-- the list and starve the tail.
CREATE OR REPLACE FUNCTION public.truth_refresh_candidates(
  _tenant_id uuid DEFAULT NULL,
  _limit integer DEFAULT 500
)
RETURNS TABLE (
  vehicle_id uuid,
  tenant_id uuid,
  listing_status text,
  sticker_status text,
  last_resolved_at timestamptz,
  has_snapshot boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT q.vehicle_id, q.tenant_id, q.listing_status,
         q.sticker_status, q.last_resolved_at, q.has_snapshot
  FROM (
    SELECT vl.id AS vehicle_id,
           vl.tenant_id AS tenant_id,
           vl.status AS listing_status,
           fsr.generation_status AS sticker_status,
           f.last_resolved_at AS last_resolved_at,
           EXISTS (SELECT 1 FROM public.vehicle_snapshots vs WHERE vs.vehicle_id = vl.id) AS has_snapshot
      FROM public.vehicle_listings vl
      LEFT JOIN public.factory_sticker_records fsr
        ON fsr.vehicle_id = vl.id AND fsr.tenant_id = vl.tenant_id
      LEFT JOIN LATERAL (
        SELECT max(vf.updated_at) AS last_resolved_at
          FROM public.vehicle_facts vf
         WHERE vf.vehicle_id = vl.id
      ) f ON TRUE
     WHERE vl.tenant_id IS NOT NULL
       AND coalesce(vl.status, '') <> 'archived'
       AND (_tenant_id IS NULL OR vl.tenant_id = _tenant_id)
  ) q
  ORDER BY q.last_resolved_at ASC NULLS FIRST, q.vehicle_id
  LIMIT greatest(coalesce(_limit, 500), 1);
$$;

REVOKE ALL ON FUNCTION public.truth_refresh_candidates(uuid, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.truth_refresh_candidates(uuid, integer) TO service_role;


-- ══ 2. The nightly job ════════════════════════════════════════════════════
--
-- 07:30 / 07:40 / 07:50 UTC. Placed after everything that WRITES the source
-- data it reads — enrich 03:15 (worst case ~05:25), specs-backfill 03:45,
-- description 06:00, advertised-price crawl 07:20 — and 50 minutes before the
-- 08:40 factory-sticker sweep, so tonight's sticker run reads truth resolved
-- tonight rather than racing it. Three passes because each invocation works a
-- 90-second wall-clock budget and then returns; the worklist is ordered
-- oldest-truth-first, so consecutive passes drain rather than repeat.
--
-- No tenant_id: a service/cron caller sweeps every dealer. No key or secret is
-- written into the schedule body — both come from Vault, and fall back to the
-- headers of an already-scheduled sibling job when Vault is not populated on
-- this database (the same recovery 20260728114827 used).
CREATE OR REPLACE FUNCTION public.schedule_truth_refresh_sweep(
  _cron_expr TEXT DEFAULT '30,40,50 7 * * *',
  _supabase_url TEXT DEFAULT NULL,
  _service_key TEXT DEFAULT NULL
)
RETURNS BIGINT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, vault, cron AS $$
DECLARE url TEXT; key TEXT; secret TEXT; hdrs JSONB; sibling TEXT; job_id BIGINT;
BEGIN
  IF _supabase_url IS NULL THEN
    SELECT decrypted_secret INTO url FROM vault.decrypted_secrets WHERE name = 'supabase_url' LIMIT 1;
  ELSE url := _supabase_url; END IF;
  IF _service_key IS NULL THEN
    SELECT decrypted_secret INTO key FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1;
  ELSE key := _service_key; END IF;
  SELECT decrypted_secret INTO secret FROM vault.decrypted_secrets WHERE name = 'marketcheck_cron_secret' LIMIT 1;

  IF url IS NULL OR key IS NULL THEN
    SELECT command INTO sibling FROM cron.job
     WHERE jobname IN ('factory-sticker-sweep', 'marketcheck-sync')
     ORDER BY jobname LIMIT 1;
    IF sibling IS NOT NULL THEN
      url := coalesce(url, (regexp_match(sibling, 'https://[a-z0-9]+\.supabase\.co'))[1]);
      key := coalesce(key, (regexp_match(sibling, 'Bearer ([A-Za-z0-9._\-]+)'))[1]);
      secret := coalesce(secret, (regexp_match(sibling, '"x-cron-secret"\s*:\s*"([^"]+)"'))[1]);
    END IF;
  END IF;
  IF url IS NULL OR key IS NULL THEN
    RAISE EXCEPTION 'supabase_url and service_role_key required (via args, Vault, or an existing sibling job)';
  END IF;

  hdrs := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || key);
  IF secret IS NOT NULL AND secret <> '' THEN
    hdrs := hdrs || jsonb_build_object('x-cron-secret', secret);
  END IF;

  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'truth-refresh-nightly';
  SELECT cron.schedule('truth-refresh-nightly', _cron_expr, format(
    $job$
      SELECT net.http_post(
        url := %L,
        headers := %L::jsonb,
        body := '{"action": "refresh_truth_sweep", "mode": "due", "limit": 500}'::jsonb,
        timeout_milliseconds := 60000
      );
    $job$,
    url || '/functions/v1/factory-sticker-orchestrate',
    hdrs::text
  )) INTO job_id;
  RETURN job_id;
END $$;

REVOKE ALL ON FUNCTION public.schedule_truth_refresh_sweep(TEXT, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.schedule_truth_refresh_sweep(TEXT, TEXT, TEXT) TO service_role;

DO $$
BEGIN
  PERFORM public.schedule_truth_refresh_sweep();
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'truth-refresh-nightly not scheduled yet (%); call schedule_truth_refresh_sweep(cron, url, key) once Vault is set', SQLERRM;
END $$;


-- ══ Self-verification ═════════════════════════════════════════════════════
-- Refuse to report success on a database where this change would be a no-op
-- or where the append-only guarantee it now writes against is absent.
-- Read-only.
DO $$
DECLARE
  v_candidates integer;
  v_never integer;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'truth_refresh_candidates'
  ) THEN
    RAISE EXCEPTION 'truth_refresh_candidates() was not created';
  END IF;

  IF has_function_privilege('anon', 'public.truth_refresh_candidates(uuid,integer)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.truth_refresh_candidates(uuid,integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'hardening failed: truth_refresh_candidates is reachable by an interactive role';
  END IF;

  -- The refresh appends snapshot versions. If the immutability guard is gone,
  -- a bug upstream could silently rewrite history instead, so do not turn a
  -- nightly writer on against an unguarded table.
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
     WHERE NOT t.tgisinternal AND c.relname = 'vehicle_snapshots'
       AND t.tgname = 'trg_vehicle_snapshots_immutable'
  ) THEN
    RAISE EXCEPTION 'vehicle_snapshots append-only trigger is missing; refusing to schedule a truth refresh';
  END IF;

  SELECT count(*), count(*) FILTER (WHERE last_resolved_at IS NULL)
    INTO v_candidates, v_never
    FROM public.truth_refresh_candidates(NULL, 2000);
  RAISE NOTICE 'truth refresh worklist: % candidates, % never resolved', v_candidates, v_never;

  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'truth-refresh-nightly') THEN
    RAISE NOTICE 'truth-refresh-nightly is not scheduled; run schedule_truth_refresh_sweep(cron, url, key)';
  END IF;
END $$;
