ALTER TABLE public.vehicle_listings ADD COLUMN IF NOT EXISTS photo_count integer;
ALTER TABLE public.vehicle_listings ADD COLUMN IF NOT EXISTS mc_attributes jsonb NOT NULL DEFAULT '{}'::jsonb;
-- photos column already exists from prior migration; ensure default
ALTER TABLE public.vehicle_listings ALTER COLUMN photos SET DEFAULT '[]'::jsonb;