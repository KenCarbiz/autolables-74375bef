-- Refresh the seeded VIN Etch product copy.
--
-- Two changes, both FTC-§5 hardening of the benefit framing:
--   1. Populate per-disposition benefit text — benefit_justification is the
--      pre-installed version (cost in the advertised price, itemized for
--      transparency); benefit_justification_optional is the customer-elected
--      version (not pre-installed, voluntary, added only with authorization).
--   2. Soften the "Theft Guarantee Included" label to "Theft Benefit" — the
--      program is a registration/reimbursement benefit governed by written
--      terms, not an unqualified guarantee, so the label must match the body.
--
-- Matched by name so it updates the row seeded in the 2026-04-10 migration
-- whether or not a dealer has renamed it to "Street Smart".

UPDATE public.products
SET
  subtitle = 'VIN etching on all glass surfaces + theft-deterrent registration + theft benefit.',
  warranty = 'Theft Benefit · See Terms',
  benefit_justification =
'What this covers:
- This vehicle''s glass was permanently etched with its VIN before sale through the Street Smart VIN Etch program.
- The etching is set into the glass and is not removable, so marked parts are harder to resell and easier to trace.
- Warning decals are applied to signal the vehicle is marked.
- The mark stays with the vehicle and may help law enforcement identify or recover it if it is stolen.
- Includes the program''s theft-benefit registration; see the provided terms for coverage details, limits, and how to file.

Some insurers may offer a discount for VIN-etched glass; check with your provider. This product was installed prior to sale. Its cost is included in this vehicle''s advertised price and is itemized here for transparency.',
  benefit_justification_optional =
'What this covers:
- Permanently etches this vehicle''s VIN into the glass through the Street Smart VIN Etch program.
- The etching is set into the glass and is not removable, so marked parts are harder to resell and easier to trace.
- Warning decals are applied to signal the vehicle is marked.
- The mark stays with the vehicle and may help law enforcement identify or recover it if it is stolen.
- Includes the program''s theft-benefit registration; see the provided terms for coverage details, limits, and how to file.

Some insurers may offer a discount for VIN-etched glass; check with your provider. This product is optional and is not pre-installed. You are choosing it voluntarily; it is not required to buy, lease, or finance this vehicle. The price shown is added only with your authorization and is itemized separately from the vehicle price.'
WHERE name ILIKE '%etch%';
