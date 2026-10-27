-- ── next_enrich_batch: an unanswered VIN recall is re-asked monthly, not daily ──
--
-- Measured on 2026-10-27, after 20261027200000 was applied: 92 active
-- vehicles still qualified for the sweep every day, 91 of them on the
-- recall_status IS NULL clause alone. All 91 already hold comparables and a
-- factory build sheet, and all 91 carry a recall_check record with state
-- 'unknown' and an attempted_at stamp: the VIN-scope recall product has been
-- asked and has not answered, because it is not entitled on this account.
-- Each daily visit still bought the full enrichment fan-out (search ladder,
-- days supply, recents, sales, history) for a question the provider cannot
-- answer yet.
--
-- The account's plan quota is 5,000 calls a month (portal usage alerts hit
-- 100% on 2026-07-29, 2026-09-11 and 2026-10-04). At 92 visits a day the
-- sweep alone spends that in about a week, after which the nightly
-- syndication feed, the one call inventory depends on, is refused for the
-- rest of the month.
--
-- Rule: a VIN whose recall question has been attempted and not answered is
-- offered again only after p_recall_retry_days (default 30), the cadence the
-- used-vehicle policy sets for AutoRecalls. A never-attempted VIN is still
-- offered at once. When the product is entitled, every vehicle is answered
-- within one retry window with no operator action; an immediate backfill is
-- the Admin re-pull, as before.
--
-- The three-argument signature is dropped first so PostgREST cannot find two
-- candidates; callers pass p_sweep_start and p_limit by name and the new
-- parameter defaults.
-- ──────────────────────────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS public.next_enrich_batch(timestamp with time zone, integer, integer);

CREATE OR REPLACE FUNCTION public.next_enrich_batch(
  p_sweep_start timestamp with time zone,
  p_limit integer,
  p_min_age_hours integer DEFAULT 20,
  p_recall_retry_days integer DEFAULT 30
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
      (
        vl.recall_status IS NULL
        AND (
          vl.recall_check IS NULL
          OR (vl.recall_check->>'attempted_at') IS NULL
          OR (vl.recall_check->>'attempted_at')::timestamptz
             < now() - make_interval(days => greatest(coalesce(p_recall_retry_days, 30), 1))
        )
      )
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

REVOKE ALL ON FUNCTION public.next_enrich_batch(timestamptz, integer, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.next_enrich_batch(timestamptz, integer, integer, integer) TO service_role;

COMMENT ON FUNCTION public.next_enrich_batch(timestamptz, integer, integer, integer) IS
  'Vehicles the enrich sweep should visit: unarchived listings missing a comparable set or a factory build-sheet decode, or missing a VIN recall answer that has never been attempted or was last attempted more than p_recall_retry_days (default 30) ago. Each vehicle is offered at most once per p_min_age_hours (default 20). market_value is deliberately not a trigger: it is owned by market-valuation-write under its own flag and budget. The build-sheet clauses must stay in step with shouldDecodeVin in _shared/factorySticker/lib/sourceData.ts.';
