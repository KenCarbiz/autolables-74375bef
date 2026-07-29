ALTER TABLE public.vehicle_listings
  ADD COLUMN IF NOT EXISTS group_similar JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.vehicle_listings.group_similar IS
  'Similar vehicles from this dealer''s own stock, for the customer-facing offer. Never contains a competitor listing. comparables remains the market evidence set and is never rendered as a clickable car.';