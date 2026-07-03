-- Official EPA fuel economy (fueleconomy.gov) per listing. Public-domain
-- federal data: city/highway/combined MPG, annual fuel cost estimate, GHG
-- score, and EV range — the same figures on the Monroney fuel-economy panel.
ALTER TABLE public.vehicle_listings
  ADD COLUMN IF NOT EXISTS epa_economy jsonb,
  ADD COLUMN IF NOT EXISTS epa_checked_at timestamptz;
COMMENT ON COLUMN public.vehicle_listings.epa_economy IS
  'Normalized fueleconomy.gov vehicle record (city/highway/combined MPG, annual fuel cost, GHG score, range, fuel type) matched by year/make/model.';
