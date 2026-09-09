-- The crawl queue must order by the staleness of our last OBSERVATION of the
-- dealer's page, and a feed row is not an observation.
--
-- advertised_price_crawl_queue picks the latest advertised_prices row per VIN
-- and orders the lot by that row's captured_at, oldest first. It never looked
-- at source_channel, because until 2026-09-09 every row was labelled
-- 'website' -- including the MarketCheck feed's rows, which is the mislabel
-- migration 20260908280000 corrected. Once those rows became 'feed', they
-- also became the LATEST row for 128 of 132 active VINs, and the queue handed
-- them to the crawler as if they were the last time we looked at the page.
--
-- Two consequences, both wrong. The crawler inherits the row's channel for
-- what it writes back, so a real page observation would land as
-- source_channel='feed' with captured_method='dealer_vdp_observation' -- the
-- exact contradiction the previous migration's self-check exists to catch.
-- And "no screenshot-backed row on this channel" would be true for every one
-- of them, so all 128 would be escalated to an evidence render on the first
-- night.
--
-- The fix is in the queue's definition: only rows that are observations of
-- the page (website, or any channel other than the feed) decide a VIN's
-- staleness. A VIN whose only rows are feed rows has never been observed and
-- must fall through to the crawler's vehicle_listings seed path, which is
-- how a never-crawled vehicle has always entered the rotation.
--
-- Same signature, same return type, same grants; body only.

CREATE OR REPLACE FUNCTION public.advertised_price_crawl_queue(
  _tenant_id uuid DEFAULT NULL::uuid,
  _limit integer DEFAULT 500
)
RETURNS SETOF public.advertised_prices
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT *
  FROM (
    SELECT DISTINCT ON (ap.tenant_id, upper(ap.vin)) ap.*
    FROM public.advertised_prices ap
    WHERE COALESCE(ap.source_url, '') <> ''
      AND (_tenant_id IS NULL OR ap.tenant_id = _tenant_id)
      -- A feed row says what the dealer's inventory system claims; it is not
      -- evidence of what the page showed, and it must not set the clock on
      -- when we last looked.
      AND COALESCE(ap.source_channel, '') <> 'feed'
      AND ap.captured_method IS DISTINCT FROM 'marketcheck_syndication'
    ORDER BY ap.tenant_id, upper(ap.vin), ap.captured_at DESC
  ) latest
  ORDER BY latest.captured_at ASC NULLS FIRST
  LIMIT GREATEST(COALESCE(_limit, 500), 1);
$function$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.advertised_price_crawl_queue(NULL, 100000)
     WHERE source_channel = 'feed' OR captured_method = 'marketcheck_syndication'
  ) THEN
    RAISE EXCEPTION 'advertised_price_crawl_queue still returns feed rows';
  END IF;
END $$;
