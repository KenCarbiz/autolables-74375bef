-- ─────────────────────────────────────────────────────────────────────────
-- next_enrich_batch: the cursor for the nightly self-chaining enrich sweep.
--
-- Returns incomplete vehicles (missing market value, recall, or comparables)
-- that haven't been touched yet THIS sweep (enriched_at < sweep_start, or null).
-- Each vehicle-enrich stamps enriched_at = now(), so processed cars drop out of
-- the next call — which guarantees the sweep terminates. A genuinely data-less
-- car (e.g. no comps anywhere) is simply re-attempted on the next nightly sweep,
-- never in a tight loop. Global (all tenants) and ordered oldest-first so the
-- single shared MarketCheck key is used one VIN at a time.
-- ─────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.next_enrich_batch(p_sweep_start timestamptz, p_limit int)
 RETURNS TABLE(tenant_id uuid, vin text)
 LANGUAGE sql SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT vl.tenant_id, vl.vin
  FROM public.vehicle_listings vl
  WHERE (vl.enriched_at IS NULL OR vl.enriched_at < p_sweep_start)
    AND (
      vl.market_value IS NULL
      OR vl.recall_status IS NULL
      OR vl.comparables IS NULL
      OR jsonb_array_length(coalesce(vl.comparables, '[]'::jsonb)) = 0
    )
  ORDER BY vl.enriched_at ASC NULLS FIRST
  LIMIT greatest(1, least(p_limit, 50));
$function$;

REVOKE EXECUTE ON FUNCTION public.next_enrich_batch(timestamptz, int) FROM public;
GRANT EXECUTE ON FUNCTION public.next_enrich_batch(timestamptz, int) TO service_role;
