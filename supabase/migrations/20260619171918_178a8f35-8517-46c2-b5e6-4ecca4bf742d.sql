ALTER TABLE public.vehicle_listings ADD COLUMN IF NOT EXISTS source_url text;
ALTER TABLE public.vehicle_listings ADD COLUMN IF NOT EXISTS hero_image_url text;