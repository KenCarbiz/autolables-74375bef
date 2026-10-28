-- Fee 895 -> 925 on one coherent fee-inclusive vehicle, through the deployed preview and apply functions.
\pset format aligned
\pset footer off
BEGIN;
INSERT INTO public.vehicle_listings
  (id, store_id, vin, slug, condition, status, tenant_id, created_by, price, advertised_price_before_doc, doc_fee, website_sale_price, price_last_verified_at, price_parse_status, archived_at)
VALUES ('c0000000-0000-4000-8000-000000000099', 'store-1', 'EXAMPLEVIN0040420', 'example-trace', 'used', 'published',
        'b0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 40420, 39525, 895, 40420, now(), 'ok', NULL);
UPDATE public.dealer_profiles SET settings = settings || '{"doc_fee_enabled": true, "doc_fee_amount": 895, "price_display_mode": "website_sale_price"}'::jsonb
 WHERE tenant_id = 'b0000000-0000-4000-8000-000000000001';
UPDATE public.vehicle_listings SET doc_fee = 895, website_sale_price = advertised_price_before_doc + 895
 WHERE tenant_id = 'b0000000-0000-4000-8000-000000000001' AND id <> 'c0000000-0000-4000-8000-000000000099' AND advertised_price_before_doc IS NOT NULL;

\echo '== 0. Stored row before (vehicle_listings)'
SELECT price, advertised_price_before_doc, doc_fee, website_sale_price FROM public.vehicle_listings WHERE id = 'c0000000-0000-4000-8000-000000000099';
\echo '== 0b. Tenant policy (dealer_profiles.settings)'
SELECT settings->>'doc_fee_amount' AS doc_fee_amount, settings->>'price_display_mode' AS price_display_mode, policy_version FROM public.dealer_profiles WHERE tenant_id = 'b0000000-0000-4000-8000-000000000001';

SELECT t.become('owner');
\echo '== 2. Server dry-run: admin_doc_fee_change_preview(tenant, true, 925) sample for this vehicle'
SELECT s->>'vin_suffix' AS vin_suffix, s->>'selling_price' AS selling_price, s->>'fee_before' AS fee_before, s->>'fee_after' AS fee_after,
       s->>'total_before' AS total_before, s->>'total_after' AS total_after
  FROM jsonb_array_elements((SELECT public.admin_doc_fee_change_preview('b0000000-0000-4000-8000-000000000001', true, 925, false))->'samples') s
 WHERE s->>'vin_suffix' = '040420';
\echo '== 2b. If the sample list does not include it, the computation the function performs for every row:'
SELECT advertised_price_before_doc AS selling_price, doc_fee AS fee_before, 925 AS fee_after, website_sale_price AS total_before, advertised_price_before_doc + 925 AS total_after
  FROM public.vehicle_listings WHERE id = 'c0000000-0000-4000-8000-000000000099';

\echo '== 3. Save: admin_doc_fee_change_apply(tenant, true, 925, expected_version, key)'
SELECT public.admin_doc_fee_change_apply('b0000000-0000-4000-8000-000000000001', true, 925,
  (SELECT policy_version FROM public.dealer_profiles WHERE tenant_id = 'b0000000-0000-4000-8000-000000000001'), 'fee-trace-0001') AS apply_result;
RESET ROLE;
\echo '== 3b. Stored row after the save (reloaded)'
SELECT price, advertised_price_before_doc, doc_fee, website_sale_price FROM public.vehicle_listings WHERE id = 'c0000000-0000-4000-8000-000000000099';
\echo '== 3c. Tenant policy after'
SELECT settings->>'doc_fee_amount' AS doc_fee_amount, settings->>'price_display_mode' AS price_display_mode, policy_version FROM public.dealer_profiles WHERE tenant_id = 'b0000000-0000-4000-8000-000000000001';
\copy (SELECT row_to_json(v) FROM (SELECT price, advertised_price_before_doc, doc_fee, website_sale_price, condition FROM public.vehicle_listings WHERE id = 'c0000000-0000-4000-8000-000000000099') v) TO '/tmp/claude-0/-home-user-autolables-74375bef/4bd5b04c-fe84-5e26-8567-dd019c94e8b0/scratchpad/fee-trace/after-row.json'
ROLLBACK;
