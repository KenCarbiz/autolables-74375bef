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
  'Picks vehicles for the nightly enrichment sweep: anything missing enrichment data, plus any VIN whose only outstanding work is its factory build sheet (mirrors shouldDecodeVin). Service-role only.';

REVOKE EXECUTE ON FUNCTION public.next_enrich_batch(timestamptz, integer) FROM PUBLIC, anon, authenticated;