-- Vehicle enrichment storage — everything pulled at ingest from MarketCheck's
-- Market Search / predict APIs and from Black Book, so the Passport reads it
-- straight off the row (no on-demand client calls). All nullable / additive;
-- existing columns (mc_attributes, mc_raw, market_payload, market_value,
-- market_position, market_checked_at) are unchanged.

ALTER TABLE public.vehicle_listings
  ADD COLUMN IF NOT EXISTS market_meta    jsonb,        -- percentile, radius, similar_count, avg_dom, days_supply, inventory_count, trend
  ADD COLUMN IF NOT EXISTS comparables    jsonb,        -- [{ vin, ymm, trim, miles, price, dist, dealer, dom, image }]
  ADD COLUMN IF NOT EXISTS blackbook      jsonb,        -- normalized Black Book values + adjustments + residuals + raw
  ADD COLUMN IF NOT EXISTS recall_payload jsonb,        -- normalized recall campaigns (NHTSA / MarketCheck)
  ADD COLUMN IF NOT EXISTS enriched_at    timestamptz;  -- last successful enrichment run

COMMENT ON COLUMN public.vehicle_listings.market_meta IS
  'MarketCheck market context: price_percentile, search_radius, similar_count, avg_dom, market_days_supply, inventory_count, inventory_change_pct, checked_at.';
COMMENT ON COLUMN public.vehicle_listings.comparables IS
  'MarketCheck comparable active listings captured at ingest.';
COMMENT ON COLUMN public.vehicle_listings.blackbook IS
  'Black Book UsedCar values (trade-in/retail/wholesale by condition) + adjustments + residuals.';
