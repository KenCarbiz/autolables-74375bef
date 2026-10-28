-- ── next_enrich_batch: the recall retry window counts from the last visit ──
--
-- 20261027203000 re-asked an unanswered VIN recall only after
-- p_recall_retry_days, measured from recall_check.attempted_at. That stamp is
-- written by the recall call itself. The provider policy engine (deployed
-- after it) skips that call on every visit while the AutoRecalls product is
-- entitlement-blocked, so the stamp stops moving, and thirty days after the
-- last real attempt every unanswered vehicle would be offered to the sweep
-- again every day, the pattern the cursor exists to stop.
--
-- The retry clock is now the vehicle's last visit, enriched_at, which the
-- sweep stamps on every visit whatever the outcome. A visit that was allowed
-- to ask about the recall did so; one that was not will ask when the product
-- is entitled and the window has passed. The never-attempted branch
-- (recall_check IS NULL) goes for the same reason: a skipped call leaves no
-- attempt record, so that branch would offer every newly synced vehicle to
-- the sweep daily until the product is entitled. Signature unchanged.
-- ──────────────────────────────────────────────────────────────────────────

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
          vl.enriched_at IS NULL
          OR vl.enriched_at < now() - make_interval(days => greatest(coalesce(p_recall_retry_days, 30), 1))
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
  'Vehicles the enrich sweep should visit: unarchived listings missing a comparable set or a factory build-sheet decode, or missing a VIN recall answer and not visited for p_recall_retry_days (default 30). Each vehicle is offered at most once per p_min_age_hours (default 20). market_value is deliberately not a trigger: it is owned by market-valuation-write under its own flag and budget. The build-sheet clauses must stay in step with shouldDecodeVin in _shared/factorySticker/lib/sourceData.ts.';
