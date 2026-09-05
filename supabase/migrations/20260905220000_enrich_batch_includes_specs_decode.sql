-- ──────────────────────────────────────────────────────────────────────
-- Let the nightly sweep reach a VIN that only needs its build sheet.
--
-- enrich-sweep decodes the factory build sheet as a piggyback inside its
-- per-VIN loop, but next_enrich_batch only ever handed it a vehicle that was
-- missing market_value, recall_status or comparables. Once a car had all
-- three — which every car on Harte's lot does, 130/130/129 — it stopped being
-- selected, and the specs decode inside the loop could never run for it again.
--
-- The effect: 23 INFINITI VINs were attempted once on 2026-07-28, failed
-- before recording why (specs_attempted_at set, specs_attempts still null),
-- and were never retried in the six weeks since. They are Harte's primary
-- franchise, and with no build sheet they have no factory options, no base
-- MSRP, and nothing for a walkaround to describe.
--
-- shouldDecodeVin already owns the "may this VIN be decoded" rule. This adds
-- the matching reachability clause so a vehicle that qualifies under it is
-- actually offered to the sweep. The two must agree: a row selected here and
-- refused there is a wasted hop, and a row refused here can never be decoded
-- at all — which is the bug being fixed.
-- ──────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.next_enrich_batch(
  p_sweep_start timestamp with time zone,
  p_limit integer
)
RETURNS TABLE(tenant_id uuid, vin text)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT vl.tenant_id, vl.vin
  FROM public.vehicle_listings vl
  WHERE (vl.enriched_at IS NULL OR vl.enriched_at < p_sweep_start)
    AND (
      -- What the sweep has always looked for: the enrichment fields.
      vl.market_value IS NULL OR vl.recall_status IS NULL OR vl.comparables IS NULL
      OR jsonb_array_length(coalesce(vl.comparables, '[]'::jsonb)) = 0
      -- New: a VIN whose only outstanding work is the build sheet. Mirrors
      -- shouldDecodeVin — no sheet, under the attempt cap, and not one the
      -- provider has already said it cannot decode.
      OR (
        NOT (coalesce(vl.mc_attributes, '{}'::jsonb) ? 'build_sheet')
        AND coalesce((vl.mc_attributes->>'specs_attempts')::int, 0) < 3
        AND coalesce((vl.mc_attributes->>'specs_no_build_sheet')::boolean, false) = false
      )
      -- And a sheet that is generic — a typical-for-trim substitute carrying
      -- no real base MSRP and no per-vehicle options — that has never been
      -- asked for strictly. shouldDecodeVin allows exactly one such attempt.
      OR (
        coalesce((vl.mc_attributes->'build_sheet'->>'generic')::boolean, false) = true
        AND coalesce((vl.mc_attributes->>'specs_strict_attempted')::boolean, false) = false
        AND coalesce((vl.mc_attributes->>'specs_attempts')::int, 0) < 3
      )
    )
  ORDER BY vl.enriched_at ASC NULLS FIRST
  LIMIT greatest(1, least(p_limit, 50));
$function$;

COMMENT ON FUNCTION public.next_enrich_batch(timestamptz, integer) IS
  'Vehicles the nightly enrich sweep should visit: those missing market/recall/comparables, AND those whose only outstanding work is a factory build-sheet decode. The second clause must stay in step with shouldDecodeVin in _shared/factorySticker/lib/sourceData.ts — a row selected here and refused there wastes a hop; a row refused here can never be decoded at all.';
