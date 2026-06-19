ALTER TABLE public.vehicle_listings ADD COLUMN IF NOT EXISTS recall_status text;
ALTER TABLE public.vehicle_listings ADD COLUMN IF NOT EXISTS recall_checked_at timestamptz;
ALTER TABLE public.vehicle_listings ADD COLUMN IF NOT EXISTS open_recall_count integer;
ALTER TABLE public.vehicle_listings ADD COLUMN IF NOT EXISTS closed_recall_count integer;
ALTER TABLE public.vehicle_listings ADD COLUMN IF NOT EXISTS recall_payload jsonb;