-- MarketCheck's syndication feed sometimes returns a car with NO price (the
-- dealer publishes the price on their own VDP instead). We still want the
-- advertised selling price for the integrity gate, so the sync now keeps each
-- listing's VDP url here. The advertised-prices crawler reads it to seed a
-- first price snapshot (scraping the dealer's own "Your Price / <Dealer> Deal"
-- label) for cars that arrived without a feed price.

ALTER TABLE public.vehicle_listings ADD COLUMN IF NOT EXISTS source_url text;
