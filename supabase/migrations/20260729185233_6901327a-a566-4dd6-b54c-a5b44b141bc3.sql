-- The cars we invite a shopper to look at, kept apart from the cars we cite
-- as price evidence.
--
-- vehicle_listings.comparables was doing both jobs. It is built from a market
-- search that deliberately EXCLUDES the dealer's own rooftop, because a
-- dealer's own cars are not independent evidence of the market -- which is
-- correct for the price bar and exactly wrong for a "Similar Vehicles" module,
-- since the only cars left to show were competitors'. A shopper on a Harte
-- passport was being offered a car 91 miles away at another store.
--
-- group_similar holds the offer: this dealer's own stock only. Competitors
-- stay in comparables, where they are counted and never linked.
ALTER TABLE public.vehicle_listings
  ADD COLUMN IF NOT EXISTS group_similar JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.vehicle_listings.group_similar IS
  'Similar vehicles from this dealer''s own stock, for the customer-facing offer. Never contains a competitor listing. comparables remains the market evidence set and is never rendered as a clickable car.';