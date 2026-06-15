-- Per-disposition descriptions for products.
--
-- A product can be sold two ways and each carries a different legal
-- disclosure and benefit framing:
--   * Pre-installed (already on the car, in the advertised price) — the
--     existing `disclosure` / `benefit_justification` columns.
--   * Optional (the customer elects it at time of sale) — these new
--     columns.
--
-- At addendum build time the line picks the set matching how the item is
-- actually being sold; when the optional set is blank it falls back to the
-- pre-installed text so existing products keep working.

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS disclosure_optional text,
  ADD COLUMN IF NOT EXISTS benefit_justification_optional text;
