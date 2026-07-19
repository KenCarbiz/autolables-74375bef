ALTER TABLE public.vehicle_listings
  ADD COLUMN IF NOT EXISTS passport_version text NOT NULL DEFAULT 'current'
  CHECK (passport_version IN ('current', 'v3', 'experiment'));