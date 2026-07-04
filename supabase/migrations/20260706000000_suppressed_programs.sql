-- Per-vehicle opt-out of dealer programs: a store-wide claim (lifetime
-- powertrain, dealer pre-owned warranty) may not apply to a specific unit
-- (mileage cap, branded title). Holds the ids of programs suppressed on
-- this listing; every customer surface filters against it.

ALTER TABLE public.vehicle_listings
  ADD COLUMN IF NOT EXISTS suppressed_programs JSONB NOT NULL DEFAULT '[]'::jsonb;
