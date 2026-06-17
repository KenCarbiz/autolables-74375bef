-- Phase 2.2 (additive) — scan-experience fields on vehicle_listings.
--
-- The vehicle-file management page AND the public /v/:slug scan both read
-- vehicle_listings (the public RPC get_vehicle_listing_by_slug RETURNS SETOF
-- public.vehicle_listings, so new columns surface to shoppers automatically).
-- Add the three customer-scan fields here so staff can edit them and shoppers
-- can see them with no edge-function change. Additive + reversible.

ALTER TABLE public.vehicle_listings
  ADD COLUMN IF NOT EXISTS service_records       JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS warranty_info         JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS available_accessories JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.vehicle_listings.service_records IS
  'Phase 2 scan: array of {date, mileage, type, notes} service/recon entries shown on /v/:slug.';
COMMENT ON COLUMN public.vehicle_listings.warranty_info IS
  'Phase 2 scan: {factory_months, factory_miles, powertrain_months, powertrain_miles, in_service_date, notes} remaining coverage.';
COMMENT ON COLUMN public.vehicle_listings.available_accessories IS
  'Phase 2 scan: array of {name, price, note} accessories still available to add to this vehicle.';
