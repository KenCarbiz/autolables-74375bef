ALTER TABLE public.vehicle_listings ADD COLUMN IF NOT EXISTS market_value numeric(10, 2);
ALTER TABLE public.vehicle_listings ADD COLUMN IF NOT EXISTS market_position text;
ALTER TABLE public.vehicle_listings ADD COLUMN IF NOT EXISTS market_checked_at timestamptz;
ALTER TABLE public.vehicle_listings ADD COLUMN IF NOT EXISTS market_payload jsonb;