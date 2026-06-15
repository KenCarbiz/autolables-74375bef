-- Vehicle-category pricing — products can carry per-size prices keyed by a
-- broad pricing bucket ("car" | "suv" | "truck" | "van"). The addendum
-- resolves the line price from the vehicle's decoded body class, falling
-- back to the base products.price when a bucket is blank.
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS price_tiers jsonb;
