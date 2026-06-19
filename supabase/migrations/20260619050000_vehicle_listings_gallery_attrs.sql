-- Full MarketCheck enrichment for the inventory/vehicle/shopper surfaces:
--   photos        — the dealer's full VDP gallery (ordered URLs) for carousels
--   photo_count   — how many images the feed carried
--   mc_attributes — structured feed attributes we don't have dedicated columns
--                   for yet (colors, engine/transmission/drivetrain, fuel, body,
--                   doors, cylinders, msrp, market pricing) kept as one JSON blob
--                   so we can surface them without a column per field.
-- These are written best-effort by marketcheck-sync (isolated from the core
-- listing write), so a missing column can never break a sync.

ALTER TABLE public.vehicle_listings ADD COLUMN IF NOT EXISTS photos jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE public.vehicle_listings ADD COLUMN IF NOT EXISTS photo_count integer;
ALTER TABLE public.vehicle_listings ADD COLUMN IF NOT EXISTS mc_attributes jsonb NOT NULL DEFAULT '{}'::jsonb;
