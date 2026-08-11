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