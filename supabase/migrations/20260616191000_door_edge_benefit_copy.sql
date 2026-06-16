-- Refresh the seeded Door Edge Guard product copy.
--
-- Populate per-disposition benefit text. This product is normally
-- pre-installed (cost included in the advertised price, itemized for
-- transparency), but the optional version is set too so the Sale Method
-- toggle never falls back to pre-installed wording when a dealer sells it
-- as a customer-elected add-on.
--
-- Puffery removed: the resale-value claim and any unqualified "protects"
-- language are dropped in favor of "helps guard against" with the warranty
-- terms hedged to the manufacturer's written agreement.

UPDATE public.products
SET
  benefit_justification =
'What this covers:
- This vehicle was fitted before sale with Elite Guard door edge protection film and handle cup protectors on high-contact exterior surfaces.
- The door edge film helps guard against chips, scratches, and scuffs when the doors contact adjacent vehicles, garage walls, curbs, or other objects.
- Handle cup protectors help reduce scratching around the door handles from fingernails, jewelry, and keys.
- Eligible vehicles receive up to 5 years of limited warranty on the film and 1 year of chip coverage for covered door-edge damage, subject to the manufacturer''s written terms.

This product was installed prior to sale and helps maintain the vehicle''s appearance. Its cost is included in this vehicle''s advertised online selling price and is itemized here for transparency; it does not increase the advertised selling price.',
  benefit_justification_optional =
'What this covers:
- Applies Elite Guard door edge protection film and handle cup protectors to high-contact exterior surfaces.
- The door edge film helps guard against chips, scratches, and scuffs when the doors contact adjacent vehicles, garage walls, curbs, or other objects.
- Handle cup protectors help reduce scratching around the door handles from fingernails, jewelry, and keys.
- Eligible vehicles receive up to 5 years of limited warranty on the film and 1 year of chip coverage for covered door-edge damage, subject to the manufacturer''s written terms.

This product is optional and is not pre-installed. You are choosing it voluntarily; it is not required to buy, lease, or finance this vehicle. The price shown is added only with your authorization and is itemized separately from the vehicle price.'
WHERE name ILIKE '%door edge%';
