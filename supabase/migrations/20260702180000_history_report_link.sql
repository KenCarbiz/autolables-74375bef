-- Dealer-paid vehicle history report link (CARFAX / AutoCheck) per listing.
--
-- Stores the dealer's own consumer report URL — harvested from the dealer's
-- VDP by the nightly crawl or entered manually — never constructed by the
-- platform. public-listing-view attaches it (used/CPO only, dealer toggle,
-- URL allowlist) so the passport can hand shoppers the dealer's free report.
ALTER TABLE public.vehicle_listings ADD COLUMN IF NOT EXISTS history_report_url text;
COMMENT ON COLUMN public.vehicle_listings.history_report_url IS
  'Dealer-paid CARFAX/AutoCheck consumer report link for this VIN (dealer-provided or harvested from the dealer''s own VDP).';
