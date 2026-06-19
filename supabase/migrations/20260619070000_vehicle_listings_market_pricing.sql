-- MarketCheck market-pricing / price-position per VIN, written best-effort by
-- the marketcheck-market-pricing edge function.
--   market_value      — MarketCheck predicted/typical market price
--   market_position   — 'great_deal' | 'good_deal' | 'fair_deal' | 'above_market' | 'unknown'
--   market_checked_at — last successful lookup
--   market_payload    — full normalized provider response (range, delta, etc.)

ALTER TABLE public.vehicle_listings ADD COLUMN IF NOT EXISTS market_value numeric(10, 2);
ALTER TABLE public.vehicle_listings ADD COLUMN IF NOT EXISTS market_position text;
ALTER TABLE public.vehicle_listings ADD COLUMN IF NOT EXISTS market_checked_at timestamptz;
ALTER TABLE public.vehicle_listings ADD COLUMN IF NOT EXISTS market_payload jsonb;
