-- ── next_enrich_batch: once per vehicle per day, active inventory only ─────
--
-- Measured on 2026-10-27: 328 vehicle_value_history rows a day from
-- vehicle_enrich, every day for twelve days — 164 VINs visited twice a day,
-- 74 of them archived. The lot has 131 active vehicles.
--
-- Three clauses in the cursor made every vehicle permanently "incomplete":
--
--   market_value IS NULL      market_value is now written only by
--                             market-valuation-write, under a tenant flag
--                             that is OFF. 37 active rows are null and will
--                             stay null however many times enrich runs.
--   recall_status IS NULL     91 active rows have never had a VIN-level
--                             answer, because the AutoRecalls product is not
--                             entitled. Enrichment cannot change that either.
--   (no archived filter)      an archived car is out of inventory and still
--                             bought comparables, history, MDS and sold
--                             statistics every pass.
--
-- And nothing bounded the frequency: the cursor only asked "enriched before
-- this sweep started", so the nightly cron at 03:15 and the sync kick at
-- 08:00 each walked the whole lot.
--
-- This replaces the cursor with the same reachability rules plus two floors:
--   * only unarchived listings are offered;
--   * a vehicle enriched within p_min_age_hours (default 20, the same floor
--     the truth refresh uses) is never offered again, whatever it is missing.
-- market_value is dropped as a trigger: it belongs to the valuation writer.
-- recall_status stays, under the 20-hour floor, so a VIN whose answer is
-- missing is asked about at most once a day and starts answering the moment
-- the product is entitled.
--
-- The existing callers pass (p_sweep_start, p_limit) by name; the third
-- parameter defaults, so no caller changes. The two-argument signature is
-- dropped first so PostgREST cannot find two candidates.
-- ──────────────────────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS public.next_enrich_batch(timestamp with time zone, integer);

CREATE OR REPLACE FUNCTION public.next_enrich_batch(
  p_sweep_start timestamp with time zone,
  p_limit integer,
  p_min_age_hours integer DEFAULT 20
)
RETURNS TABLE(tenant_id uuid, vin text)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT vl.tenant_id, vl.vin
  FROM public.vehicle_listings vl
  WHERE vl.archived_at IS NULL
    AND (vl.enriched_at IS NULL OR vl.enriched_at < p_sweep_start)
    AND (vl.enriched_at IS NULL
         OR vl.enriched_at < now() - make_interval(hours => greatest(coalesce(p_min_age_hours, 20), 1)))
    AND (
      vl.recall_status IS NULL
      OR vl.comparables IS NULL
      OR jsonb_array_length(coalesce(vl.comparables, '[]'::jsonb)) = 0
      OR (
        NOT (coalesce(vl.mc_attributes, '{}'::jsonb) ? 'build_sheet')
        AND coalesce((vl.mc_attributes->>'specs_attempts')::int, 0) < 3
        AND coalesce((vl.mc_attributes->>'specs_no_build_sheet')::boolean, false) = false
      )
      OR (
        coalesce((vl.mc_attributes->'build_sheet'->>'generic')::boolean, false) = true
        AND coalesce((vl.mc_attributes->>'specs_strict_attempted')::boolean, false) = false
        AND coalesce((vl.mc_attributes->>'specs_attempts')::int, 0) < 3
      )
    )
  ORDER BY vl.enriched_at ASC NULLS FIRST
  LIMIT greatest(1, least(p_limit, 50));
$function$;

REVOKE ALL ON FUNCTION public.next_enrich_batch(timestamptz, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.next_enrich_batch(timestamptz, integer, integer) TO service_role;

COMMENT ON FUNCTION public.next_enrich_batch(timestamptz, integer, integer) IS
  'Vehicles the enrich sweep should visit: unarchived listings missing a recall answer, a comparable set or a factory build-sheet decode, each offered at most once per p_min_age_hours (default 20). market_value is deliberately not a trigger: it is owned by market-valuation-write under its own flag and budget. The build-sheet clauses must stay in step with shouldDecodeVin in _shared/factorySticker/lib/sourceData.ts.';
