-- Per-accessory "is this price already in the advertised price?" flag.
--
-- An installed accessory is usually baked into the online/advertised
-- price (the lot price already reflects it), so it must NOT be charged
-- again on top at signing. A minority of dealer-installed accessories
-- are genuine upcharges above the advertised price; those are additive
-- and must be disclosed and confirmed at point of sale.
--
-- price_in_advertised = true  -> included in the advertised price
--                               (shown as a breakdown, never additive).
-- price_in_advertised = false -> added above the advertised price
--                               (itemized, additive, customer-confirmed).
--
-- Default true so every existing accessory is treated as already
-- included — the safe, FTC-aligned default (never silently charge
-- above advertised). Carried per-vehicle into products_snapshot at
-- addendum build time.

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS price_in_advertised boolean NOT NULL DEFAULT true;
