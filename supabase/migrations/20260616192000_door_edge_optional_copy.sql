-- Align the Door Edge Guard optional-disposition copy with the dealer's
-- finance-office wording for the after-delivery install.
--
-- This is the customer-elected version (available_preinstalled is false for
-- the after-delivery path): installed after delivery, selected voluntarily,
-- added only with approval. Puffery removed: the "long-term resale value" and
-- "reduce the likelihood of costly cosmetic repairs" claims are dropped.

UPDATE public.products
SET
  benefit_justification_optional =
'What this covers:
- You chose to add Elite Guard door edge protection film and handle cup protectors, professionally installed after delivery.
- The door edge film helps guard against chips, scratches, and scuffs when the doors contact adjacent vehicles, garage walls, curbs, or other objects.
- Handle cup protectors help reduce scratching around the door handles from fingernails, jewelry, and keys.
- Eligible vehicles receive up to 5 years of limited warranty on the film and 1 year of chip coverage for covered door-edge damage, subject to the manufacturer''s written terms.

This product is optional and is not pre-installed; it is installed after delivery. You selected it voluntarily; it is not required to buy, lease, or finance this vehicle. The price was added only with your approval and is itemized separately from the vehicle price.'
WHERE name ILIKE '%door edge%';
