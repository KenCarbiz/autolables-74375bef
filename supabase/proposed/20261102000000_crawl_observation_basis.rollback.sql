-- Rollback for the PROPOSED 20261102000000_crawl_observation_basis.sql.
-- Roll the crawler back to its previous revision FIRST: the new crawler
-- writes these columns. Export observation, listing_promotion and
-- listing_promotion_detail first if they must be kept; dropping them deletes
-- the fee basis records. advertised_price and every other column are untouched.
DROP INDEX IF EXISTS public.ux_advertised_prices_tenant_idempotency;
ALTER TABLE public.advertised_prices DROP CONSTRAINT IF EXISTS advertised_prices_listing_promotion_check;
ALTER TABLE public.advertised_prices
  DROP COLUMN IF EXISTS listing_promotion_detail,
  DROP COLUMN IF EXISTS listing_promotion,
  DROP COLUMN IF EXISTS idempotency_key,
  DROP COLUMN IF EXISTS observation;
