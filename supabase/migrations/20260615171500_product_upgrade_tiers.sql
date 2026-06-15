-- Product upgrade tiers + pre-install availability.
--
-- available_preinstalled = false marks a product that can ONLY be sold as
-- a customer-elected option (never pre-installed) — e.g. a desk-only
-- add-on. The addendum forces such a line to the optional disposition.
--
-- upgrade holds an optional higher tier for products with multiple levels
-- (e.g. Door Edge Guard Standard -> Platinum). When the dealer applies the
-- upgrade on an addendum line, the line swaps to the upgrade's package
-- price, disclosure, and benefit (per disposition). Shape:
--   {
--     "name": "Platinum Protection",
--     "price": 699.99,
--     "disclosure": "...",                       -- pre-installed
--     "benefit_justification": "...",            -- pre-installed
--     "disclosure_optional": "...",              -- customer-elected
--     "benefit_justification_optional": "..."    -- customer-elected
--   }

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS available_preinstalled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS upgrade jsonb;
