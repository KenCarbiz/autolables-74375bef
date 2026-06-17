ALTER TABLE public.vehicle_listings
  ADD COLUMN IF NOT EXISTS service_records       JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS warranty_info         JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS available_accessories JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.vehicle_listings.service_records IS
  'Scan: array of {date, mileage, type, notes} service/recon entries shown on /v/:slug.';

COMMENT ON COLUMN public.vehicle_listings.warranty_info IS
  'Scan: {factory_months, factory_miles, powertrain_months, powertrain_miles, in_service_date, notes} remaining coverage.';

COMMENT ON COLUMN public.vehicle_listings.available_accessories IS
  'Scan: array of {name, price, note} accessories still available to add to this vehicle.';