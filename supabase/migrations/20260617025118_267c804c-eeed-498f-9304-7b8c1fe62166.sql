ALTER TABLE public.vehicle_listings
  ADD COLUMN IF NOT EXISTS service_records       JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS warranty_info         JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS available_accessories JSONB NOT NULL DEFAULT '[]'::jsonb;