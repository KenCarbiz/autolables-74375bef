-- Refresh the seeded Ceramic Protection Package copy.
--
-- Per-disposition benefit text: pre-installed (cost in the advertised price,
-- itemized, does not add to it) and customer-elected (voluntary, added only
-- with authorization). Puffery removed: the resale-value claim and the
-- "fewer paint-correction / reconditioning costs" cost-savings claim are
-- dropped in favor of factual, hedged "helps resist" language.

UPDATE public.products
SET
  benefit_justification =
'What this covers:
- This vehicle was treated before sale with a professional-grade ceramic polymer coating bonded to the exterior paint and designated interior surfaces.
- The coating adds a durable, water-repelling layer that helps resist UV fading and oxidation.
- Helps resist road-salt and chemical etching and staining from bird droppings and hard water.
- Makes routine washing easier and helps the finish hold its gloss.
- Backed by a 7-year / unlimited-mile guarantee, subject to the provider''s written terms.

This product was applied prior to sale and helps maintain the vehicle''s appearance. Its cost is included in this vehicle''s advertised price and is itemized here for transparency; it does not increase the advertised selling price.',
  benefit_justification_optional =
'What this covers:
- Applies a professional-grade ceramic polymer coating bonded to the exterior paint and designated interior surfaces.
- The coating adds a durable, water-repelling layer that helps resist UV fading and oxidation.
- Helps resist road-salt and chemical etching and staining from bird droppings and hard water.
- Makes routine washing easier and helps the finish hold its gloss.
- Backed by a 7-year / unlimited-mile guarantee, subject to the provider''s written terms.

This product is optional and is not pre-installed. You are choosing it voluntarily; it is not required to buy, lease, or finance this vehicle. The price shown is added only with your authorization and is itemized separately from the vehicle price.'
WHERE name ILIKE '%ceramic%';
