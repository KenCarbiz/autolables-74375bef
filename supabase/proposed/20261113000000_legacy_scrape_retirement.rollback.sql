-- Rollback for 20261113000000_legacy_scrape_retirement.sql.
-- Run legacy_listing_restore(<batch_id>, '<approval>') first for any applied
-- batch; this file only removes the guards and functions. The audit table is
-- kept (it is the record of what happened) unless it is empty.
DROP TRIGGER IF EXISTS vehicle_listings_owner_assignment_guard ON public.vehicle_listings;
DROP FUNCTION IF EXISTS public.vehicle_listings_owner_assignment_guard();
DROP TRIGGER IF EXISTS vehicle_listings_legacy_retired_guard ON public.vehicle_listings;
DROP FUNCTION IF EXISTS public.vehicle_listings_legacy_retired_guard();
DROP FUNCTION IF EXISTS public.legacy_listing_retire(uuid, uuid[], text[], text[], text[], text, text, boolean);
DROP FUNCTION IF EXISTS public.legacy_listing_restore(uuid, text);
DROP FUNCTION IF EXISTS public.legacy_listing_check(uuid, uuid, text[], text[]);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.legacy_listing_retirements) THEN
    DROP TABLE public.legacy_listing_retirements;
    DROP FUNCTION IF EXISTS public.legacy_listing_retirements_append_only();
  END IF;
END $$;
