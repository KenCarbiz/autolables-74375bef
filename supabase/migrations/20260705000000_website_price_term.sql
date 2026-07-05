-- ──────────────────────────────────────────────────────────────────────
-- Website price TERM — the terminology the dealer's own VDP uses next to its
-- price (e.g. "Sale Price", "Internet Price"), captured by the advertised-price
-- crawl from the label adjacent to the extracted price. Powers the customer
-- passport's "Match my website" price-label option. Display text only — it never
-- affects the price value or the doc-fee model.
-- Idempotent: ADD COLUMN IF NOT EXISTS. get_vehicle_listing_by_slug returns
-- SETOF vehicle_listings (SELECT *), so this flows to the public passport with
-- no RPC change.
-- ──────────────────────────────────────────────────────────────────────

ALTER TABLE public.vehicle_listings
  ADD COLUMN IF NOT EXISTS website_price_term text;

COMMENT ON COLUMN public.vehicle_listings.website_price_term IS
  'Cleaned label the dealer VDP shows next to its price (e.g. "Sale Price"). Set by crawl-advertised-prices on a clean parse; used by the passport "Match my website" price label.';
