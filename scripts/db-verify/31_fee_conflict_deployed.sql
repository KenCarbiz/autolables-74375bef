-- The conflict reproduced on the deployed preview and apply: on a tenant whose
-- advertised prices include the fee, a $895 -> $925 change keeps `price` at
-- $40,420 but writes website_sale_price = before-fee + fee = $40,450, so the
-- stored total and the Label no longer agree. These cases pin that behaviour
-- of the hosted functions; the policy B stage (30_fee_basis.sql) pins the fix.

SELECT t.expect('fee conflict (deployed)', 'dry-run sample for the traced vehicle (selling|fee|total before>after)', 'fee_owner',
  $q$SELECT (s->>'selling_price')::numeric || '|' || (s->>'fee_before')::numeric || '>' || (s->>'fee_after')::numeric || '|' || (s->>'total_before')::numeric || '>' || (s->>'total_after')::numeric
     FROM public.admin_doc_fee_change_preview('b0000000-0000-4000-8000-000000000003', true, 925) r, jsonb_array_elements(r->'samples') s
     WHERE s->>'vin_suffix' = '040420'$q$,
  '39525|895>925.00|40420>40450.00');
SELECT t.check('fee conflict (deployed)', 'apply splits the total: price kept, website_sale_price moved by the fee (price|before-fee|fee|website_sale_price)', 'fee_owner',
  $q$SELECT public.admin_doc_fee_change_apply('b0000000-0000-4000-8000-000000000003', true, 925, 1, 'fee-conflict-0001')$q$, 'ok',
  $q$SELECT concat_ws('|', price, advertised_price_before_doc, doc_fee, website_sale_price) FROM public.vehicle_listings WHERE id = 'c0000000-0000-4000-8000-000000000301'$q$,
  '40420.00|39525|925.00|40450.00');
