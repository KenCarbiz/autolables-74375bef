ALTER TABLE public.vehicle_listings ADD COLUMN IF NOT EXISTS photos jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE public.vehicle_listings ADD COLUMN IF NOT EXISTS photo_count integer;
ALTER TABLE public.vehicle_listings ADD COLUMN IF NOT EXISTS mc_attributes jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.vehicle_listings ADD COLUMN IF NOT EXISTS recall_status text;
ALTER TABLE public.vehicle_listings ADD COLUMN IF NOT EXISTS recall_checked_at timestamptz;
ALTER TABLE public.vehicle_listings ADD COLUMN IF NOT EXISTS open_recall_count integer;
ALTER TABLE public.vehicle_listings ADD COLUMN IF NOT EXISTS closed_recall_count integer;
ALTER TABLE public.vehicle_listings ADD COLUMN IF NOT EXISTS recall_payload jsonb;

ALTER TABLE public.vehicle_listings ADD COLUMN IF NOT EXISTS market_value numeric(10, 2);
ALTER TABLE public.vehicle_listings ADD COLUMN IF NOT EXISTS market_position text;
ALTER TABLE public.vehicle_listings ADD COLUMN IF NOT EXISTS market_checked_at timestamptz;
ALTER TABLE public.vehicle_listings ADD COLUMN IF NOT EXISTS market_payload jsonb;

ALTER TABLE public.vehicle_listings ADD COLUMN IF NOT EXISTS packet_modules jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.vehicle_listings
  ADD COLUMN IF NOT EXISTS oem_sticker_url text,
  ADD COLUMN IF NOT EXISTS oem_sticker_checked_at timestamptz;