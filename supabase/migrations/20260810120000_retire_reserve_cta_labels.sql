-- Retire the "Reserve" wording from stored sticky-button labels.
--
-- "Reserve This Vehicle" told a shopper the car WAS held. The dealership still
-- has to confirm availability, so the copy now reads "Request Vehicle Hold".
--
-- The code change alone could not fix this. A dealer's saved config stores the
-- LABEL alongside the key, and resolveStickyButtons() lets a stored label win
-- over the catalog — so any store that had enabled this button kept showing the
-- old copy indefinitely. The renderer now also treats retired wording as
-- "not customized" and falls back to the catalog, which heals the display
-- immediately; this migration cleans the data so the stored row stops
-- contradicting what the shopper sees.
--
-- Only exact matches for wording we retired are touched. A dealer who wrote
-- their own label keeps it. Idempotent: re-running changes nothing.

UPDATE public.dealer_profiles dp
   SET settings = jsonb_set(
         dp.settings,
         '{sticky_bottom_buttons,buttons}',
         (
           SELECT jsonb_agg(
                    CASE
                      WHEN lower(btrim(coalesce(b->>'label', ''))) IN (
                             'reserve this vehicle', 'reserve vehicle',
                             'request hold', 'request a hold')
                        THEN jsonb_set(b, '{label}', '"Request Vehicle Hold"'::jsonb)
                      ELSE b
                    END
                    ORDER BY ord
                  )
             FROM jsonb_array_elements(dp.settings #> '{sticky_bottom_buttons,buttons}')
                  WITH ORDINALITY AS t(b, ord)
         )
       )
 WHERE jsonb_typeof(dp.settings #> '{sticky_bottom_buttons,buttons}') = 'array'
   AND EXISTS (
         SELECT 1
           FROM jsonb_array_elements(dp.settings #> '{sticky_bottom_buttons,buttons}') AS b
          WHERE lower(btrim(coalesce(b->>'label', ''))) IN (
                  'reserve this vehicle', 'reserve vehicle',
                  'request hold', 'request a hold')
       );
