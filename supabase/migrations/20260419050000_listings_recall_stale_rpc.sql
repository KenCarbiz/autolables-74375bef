-- ──────────────────────────────────────────────────────────────────────
-- Wave 6.1: RPC for admins to fetch published listings whose
-- recall_check is stale or missing.
--
-- The publish-trigger enforces freshness on new publishes (30-day
-- window), but existing rows that were published before the trigger
-- went live, or rows whose recall_check has aged past 30 days, need
-- a manual refresh pass. This RPC returns the worklist so the
-- client (admin batch job or cron) can iterate and invoke the
-- nhtsa-recall edge function VIN-by-VIN.
--
-- Read-only, tenant-scoped via RLS on the source table.
-- ──────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.listings_with_stale_recalls(
  p_limit INTEGER DEFAULT 100
) RETURNS TABLE (
  id                UUID,
  tenant_id         UUID,
  -- vehicle_listings.store_id is TEXT in this project (legacy
  -- shape — predates the move to UUID stores). RETURNS column
  -- type must match or the function fails at CREATE time.
  -- The frontend caller (RecallRefreshTool.tsx) already types
  -- it as `string | null`.
  store_id          TEXT,
  vin               TEXT,
  ymm               TEXT,
  slug              TEXT,
  published_at      TIMESTAMPTZ,
  recall_checked_at TIMESTAMPTZ,
  status            TEXT   -- 'missing' | 'stale'
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT
    vl.id,
    vl.tenant_id,
    vl.store_id,
    vl.vin,
    vl.ymm,
    vl.slug,
    vl.published_at,
    (vl.recall_check ->> 'checked_at')::TIMESTAMPTZ AS recall_checked_at,
    CASE
      WHEN vl.recall_check IS NULL
        OR (vl.recall_check ->> 'checked_at') IS NULL
        THEN 'missing'
      WHEN (vl.recall_check ->> 'checked_at')::TIMESTAMPTZ < now() - INTERVAL '30 days'
        THEN 'stale'
      ELSE 'fresh'
    END AS status
    FROM public.vehicle_listings vl
   WHERE vl.status = 'published'
     AND (
       vl.recall_check IS NULL
       OR (vl.recall_check ->> 'checked_at') IS NULL
       OR (vl.recall_check ->> 'checked_at')::TIMESTAMPTZ < now() - INTERVAL '30 days'
     )
   ORDER BY vl.published_at DESC NULLS LAST
   LIMIT GREATEST(p_limit, 0);
$$;

GRANT EXECUTE ON FUNCTION public.listings_with_stale_recalls(INTEGER)
  TO authenticated, service_role;
