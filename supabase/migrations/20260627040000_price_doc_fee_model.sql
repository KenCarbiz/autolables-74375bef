-- ──────────────────────────────────────────────────────────────────────
-- Price / doc-fee normalization model.
--
-- Store the advertised price (before doc fee), the doc/conveyance fee, and the
-- computed website sale price as SEPARATE fields so we never conflate them.
--   website_sale_price = advertised_price_before_doc + doc_fee
--
-- `vehicle_listings.price` remains the advertised price before doc (what the
-- MarketCheck feed and the market comparison use); these columns add the doc
-- fee and the final sale price alongside it, plus parse provenance/status.
--
-- Tenant setting `price_display_mode` (advertised_before_doc | website_sale_price)
-- lives in dealer_profiles.settings (JSONB) — no column needed; default is
-- advertised_before_doc. msrp continues to live in mc_attributes.
-- Idempotent: ADD COLUMN IF NOT EXISTS.
-- ──────────────────────────────────────────────────────────────────────

ALTER TABLE public.vehicle_listings
  ADD COLUMN IF NOT EXISTS advertised_price_before_doc numeric,
  ADD COLUMN IF NOT EXISTS doc_fee                     numeric,
  ADD COLUMN IF NOT EXISTS website_sale_price          numeric,
  ADD COLUMN IF NOT EXISTS dealer_discount             numeric,
  ADD COLUMN IF NOT EXISTS retail_cash                 numeric,
  ADD COLUMN IF NOT EXISTS price_source_url            text,
  ADD COLUMN IF NOT EXISTS price_last_verified_at      timestamptz,
  ADD COLUMN IF NOT EXISTS price_parse_status          text,
  ADD COLUMN IF NOT EXISTS price_parse_notes           text;

-- Backfill: the existing `price` IS the advertised price before doc. Seed the
-- new column from it where we have not parsed a breakdown yet. doc_fee and
-- website_sale_price are populated by the sync/crawl using the tenant's
-- configured fee, so leave them null here rather than guess a fee.
UPDATE public.vehicle_listings
SET advertised_price_before_doc = price
WHERE advertised_price_before_doc IS NULL
  AND price IS NOT NULL;

UPDATE public.vehicle_listings
SET price_source_url = source_url
WHERE price_source_url IS NULL
  AND source_url IS NOT NULL
  AND source_url <> '';

COMMENT ON COLUMN public.vehicle_listings.advertised_price_before_doc IS
  'Advertised vehicle price BEFORE the doc/conveyance fee. Mirrors price; used for market comparison.';
COMMENT ON COLUMN public.vehicle_listings.doc_fee IS
  'Doc/conveyance fee added on top of the advertised price (e.g. $895 at Harte INFINITI).';
COMMENT ON COLUMN public.vehicle_listings.website_sale_price IS
  'advertised_price_before_doc + doc_fee. The dealer site final Sale Price.';
COMMENT ON COLUMN public.vehicle_listings.price_parse_status IS
  'ok | warning | pending | error. warning = displayed sale price != advertised + doc fee.';
