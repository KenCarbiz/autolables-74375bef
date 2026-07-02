ALTER TABLE public.vehicle_listings ADD COLUMN IF NOT EXISTS history_report_url text;
COMMENT ON COLUMN public.vehicle_listings.history_report_url IS
  'Dealer-paid CARFAX/AutoCheck consumer report link for this VIN (dealer-provided or harvested from the dealer''s own VDP).';