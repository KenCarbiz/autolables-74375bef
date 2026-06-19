-- Packet curation — per-vehicle control over which customer-facing modules
-- appear on the public scan page (/v/:slug). A JSON map of moduleId -> boolean;
-- a module is shown unless explicitly set to false, so existing listings
-- default to everything visible. Compliance modules (recall, price, verified
-- installs) are never gated by this and are not represented here.
ALTER TABLE public.vehicle_listings
  ADD COLUMN IF NOT EXISTS packet_modules jsonb NOT NULL DEFAULT '{}'::jsonb;
