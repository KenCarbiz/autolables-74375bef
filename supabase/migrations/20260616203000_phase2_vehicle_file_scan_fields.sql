-- Phase 2.1 (additive) — data model for the customer scan experience.
--
-- The public QR scan should show, beyond specs and accessories already on the
-- file: the vehicle's service history, its remaining warranty, and the
-- accessories still AVAILABLE for it (upsell discovery). These hang off the
-- canonical vehicle_files hub as loose JSONB so new shapes don't need DDL,
-- mirroring the existing factory_equipment / aftermarket_installs pattern.
--
-- Additive + reversible: three nullable JSONB columns with safe defaults.
-- Nothing is read or written yet — the data-entry and public-listing surfaces
-- come next; this lands the schema so that work is pure application code.

ALTER TABLE public.vehicle_files
  ADD COLUMN IF NOT EXISTS service_records      JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS warranty_info        JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS available_accessories JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.vehicle_files.service_records IS
  'Phase 2 scan experience: array of {date, mileage, type, notes} recon/service entries.';
COMMENT ON COLUMN public.vehicle_files.warranty_info IS
  'Phase 2 scan experience: {factory:{months,miles,start_date}, powertrain:{...}, cpo:{...}} remaining-coverage data.';
COMMENT ON COLUMN public.vehicle_files.available_accessories IS
  'Phase 2 scan experience: array of catalog product ids/snippets still available to add to this vehicle.';
