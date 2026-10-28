-- Policy B (supabase/proposed/20261031000000_doc_fee_basis_policy_b.sql).
-- Fee-inclusive tenant (b..03): a fee change keeps the advertised total and
-- moves the split; the website observation is preserved. Fee-exclusive tenant
-- (b..01): the before-fee price is kept and the total moves with the fee.
-- Every case is rolled back.

-- ── Basis rule ──────────────────────────────────────────────────────────
SELECT t.expect('fee basis', 'basis rule: includes setting, excludes setting, display-mode fallback, default, contradiction', 'owner',
  $q$SELECT string_agg(b.basis || ':' || b.basis_source, ' ' ORDER BY n) FROM (VALUES
       (1, '{"advertised_includes_doc_fee": true}'::jsonb),
       (2, '{"advertised_includes_doc_fee": "false", "price_display_mode": "website_sale_price"}'),
       (3, '{"advertised_excludes_doc_fee": false}'),
       (4, '{"price_display_mode": "website_sale_price"}'),
       (5, '{}'),
       (6, '{"advertised_includes_doc_fee": true, "advertised_excludes_doc_fee": true}'),
       (7, '{"advertised_includes_doc_fee": "yes", "price_display_mode": "advertised_before_doc"}')) v(n, s),
     LATERAL public.doc_fee_basis(v.s) b$q$,
  'includes_fee:advertised_includes_doc_fee before_fee:advertised_includes_doc_fee includes_fee:advertised_excludes_doc_fee includes_fee:price_display_mode before_fee:price_display_mode conflict:settings_conflict before_fee:price_display_mode');

-- ── Fee-inclusive: the traced vehicle, $895 -> $925 ───────────────────────
SELECT t.expect('fee basis: includes fee', 'dry-run counts (basis|eligible|unchanged|archived excluded|no basis|invalid|split mismatches|source mismatches)', 'fee_owner',
  $q$SELECT concat_ws('|', r->>'basis', r->>'eligible', r->>'unchanged', r->>'excluded_archived', r->>'no_price_basis', r->>'invalid', r->>'split_mismatches', r->>'source_mismatches')
     FROM public.admin_doc_fee_change_preview('b0000000-0000-4000-8000-000000000003', true, 925) r$q$,
  'includes_fee|2|0|1|1|1|1|1');
SELECT t.expect('fee basis: includes fee', 'dry-run sample for the traced vehicle keeps the total and moves the split (selling before>after|fee|total before>after)', 'fee_owner',
  $q$SELECT (s->>'selling_before')::numeric || '>' || (s->>'selling_after')::numeric || '|' || (s->>'fee_before')::numeric || '>' || (s->>'fee_after')::numeric || '|' || (s->>'total_before')::numeric || '>' || (s->>'total_after')::numeric
     FROM public.admin_doc_fee_change_preview('b0000000-0000-4000-8000-000000000003', true, 925) r, jsonb_array_elements(r->'samples') s
     WHERE s->>'vin_suffix' = '040420'$q$,
  '39525.00>39495.00|895>925.00|40420.00>40420.00');
SELECT t.check('fee basis: includes fee', 'the dry-run writes nothing', 'fee_owner',
  $q$SELECT public.admin_doc_fee_change_preview('b0000000-0000-4000-8000-000000000003', true, 925)$q$, 'ok rows=1',
  $q$SELECT concat_ws('|', (SELECT count(*) FROM public.vehicle_listings WHERE doc_fee = 925), (SELECT policy_version FROM public.dealer_profiles WHERE tenant_id = 'b0000000-0000-4000-8000-000000000003'),
       (SELECT count(*) FROM public.audit_log))$q$,
  '0|1|0');
SELECT t.check('fee basis: includes fee', 'apply keeps the advertised total: traced row (price|before-fee|fee|website_sale_price)', 'fee_owner',
  $q$SELECT public.admin_doc_fee_change_apply('b0000000-0000-4000-8000-000000000003', true, 925, 1, 'policy-b-0001')$q$, 'ok',
  $q$SELECT concat_ws('|', price, advertised_price_before_doc, doc_fee, website_sale_price) FROM public.vehicle_listings WHERE id = 'c0000000-0000-4000-8000-000000000301'$q$,
  '40420.00|39495.00|925.00|40420');
SELECT t.check('fee basis: includes fee', 'apply result (status|affected|basis|skipped invalid|skipped split mismatch|source mismatches)', 'fee_owner',
  $q$CREATE TEMP TABLE r ON COMMIT DROP AS SELECT public.admin_doc_fee_change_apply('b0000000-0000-4000-8000-000000000003', true, 925, 1, 'policy-b-0002') AS j$q$, 'ok',
  $q$SELECT concat_ws('|', j->>'status', j->>'affected', j->>'basis', j->>'skipped_invalid', j->>'skipped_split_mismatch', j->>'source_mismatches') FROM r$q$,
  'partial|2|includes_fee|1|1|1');
SELECT t.check('fee basis: includes fee', 'apply after reload: Label (price) = Passport total; Passport selling = price - fee = stored before-fee, for every changed row', 'fee_owner',
  $q$SELECT public.admin_doc_fee_change_apply('b0000000-0000-4000-8000-000000000003', true, 925, 1, 'policy-b-0003')$q$, 'ok',
  $q$SELECT count(*) FILTER (WHERE price - doc_fee = advertised_price_before_doc)::text || '/' || count(*)::text
     FROM public.vehicle_listings WHERE tenant_id = 'b0000000-0000-4000-8000-000000000003' AND archived_at IS NULL AND doc_fee = 925$q$,
  '2/2');
SELECT t.check('fee basis: includes fee', 'a genuine source mismatch is preserved: website $30,500 kept, total $30,000 kept, split moved', 'fee_owner',
  $q$SELECT public.admin_doc_fee_change_apply('b0000000-0000-4000-8000-000000000003', true, 925, 1, 'policy-b-0004')$q$, 'ok',
  $q$SELECT concat_ws('|', price, advertised_price_before_doc, doc_fee, website_sale_price) FROM public.vehicle_listings WHERE id = 'c0000000-0000-4000-8000-000000000302'$q$,
  '30000.00|29075.00|925.00|30500');
SELECT t.check('fee basis: includes fee', 'a split that already disagrees with the total is skipped and left exactly as stored (no observation overwritten)', 'fee_owner',
  $q$SELECT public.admin_doc_fee_change_apply('b0000000-0000-4000-8000-000000000003', true, 925, 1, 'policy-b-0005')$q$, 'ok',
  $q$SELECT concat_ws('|', price, advertised_price_before_doc, doc_fee, website_sale_price) FROM public.vehicle_listings WHERE id = 'c0000000-0000-4000-8000-000000000303'$q$,
  '20000.00|20000|895|20000');
SELECT t.check('fee basis: includes fee', 'a fee larger than the total is skipped, not written (price|before-fee|fee|website)', 'fee_owner',
  $q$SELECT public.admin_doc_fee_change_apply('b0000000-0000-4000-8000-000000000003', true, 925, 1, 'policy-b-0006')$q$, 'ok',
  $q$SELECT concat_ws('|', price, advertised_price_before_doc, doc_fee, website_sale_price) FROM public.vehicle_listings WHERE id = 'c0000000-0000-4000-8000-000000000304'$q$,
  '900.00|5|895|900');
SELECT t.check('fee basis: includes fee', 'archived and unbased rows untouched; verification stamps and parse status kept; audit names the basis', 'fee_owner',
  $q$SELECT public.admin_doc_fee_change_apply('b0000000-0000-4000-8000-000000000003', true, 925, 1, 'policy-b-0007')$q$, 'ok',
  $q$SELECT concat_ws('|',
       (SELECT doc_fee FROM public.vehicle_listings WHERE id = 'c0000000-0000-4000-8000-000000000306'),
       (SELECT count(*) FROM public.vehicle_listings WHERE id = 'c0000000-0000-4000-8000-000000000305' AND doc_fee IS NULL),
       (SELECT count(*) FROM public.vehicle_listings WHERE tenant_id = 'b0000000-0000-4000-8000-000000000003' AND price_last_verified_at::date BETWEEN '2026-10-05' AND '2026-10-08'),
       (SELECT count(*) FROM public.vehicle_listings WHERE tenant_id = 'b0000000-0000-4000-8000-000000000003' AND price_parse_status = 'ok'),
       (SELECT details->>'basis' || ':' || (details->>'source_mismatches_preserved') FROM public.audit_log WHERE action = 'doc_fee_policy_applied'))$q$,
  '895|1|4|5|includes_fee:1');
SELECT t.check('fee basis: includes fee', 'reload: a second dry-run at the saved fee finds nothing to change (eligible|unchanged)', 'fee_owner',
  $q$SELECT public.admin_doc_fee_change_apply('b0000000-0000-4000-8000-000000000003', true, 925, 1, 'policy-b-0008');;
     CREATE TEMP TABLE r ON COMMIT DROP AS SELECT public.admin_doc_fee_change_preview('b0000000-0000-4000-8000-000000000003', true, 925) AS j$q$, 'ok',
  $q$SELECT concat_ws('|', j->>'eligible', j->>'unchanged') FROM r$q$,
  '0|2');
SELECT t.check('fee basis: includes fee', 'changing back to $895 restores the original split exactly', 'fee_owner',
  $q$SELECT public.admin_doc_fee_change_apply('b0000000-0000-4000-8000-000000000003', true, 925, 1, 'policy-b-0009');;
     SELECT public.admin_doc_fee_change_apply('b0000000-0000-4000-8000-000000000003', true, 895, 2, 'policy-b-0010')$q$, 'ok',
  $q$SELECT concat_ws('|', price, advertised_price_before_doc, doc_fee, website_sale_price) FROM public.vehicle_listings WHERE id = 'c0000000-0000-4000-8000-000000000301'$q$,
  '40420.00|39525.00|895.00|40420');

-- ── Rounding and invalid values ──────────────────────────────────────────
SELECT t.check('fee basis: values', 'a fee of 925.555 is rounded to cents once: 925.56, before-fee 39,494.44, total 40,420', 'fee_owner',
  $q$SELECT public.admin_doc_fee_change_apply('b0000000-0000-4000-8000-000000000003', true, 925.555, 1, 'policy-b-0011')$q$, 'ok',
  $q$SELECT concat_ws('|', price, advertised_price_before_doc, doc_fee, website_sale_price) FROM public.vehicle_listings WHERE id = 'c0000000-0000-4000-8000-000000000301'$q$,
  '40420.00|39494.44|925.56|40420');
SELECT t.expect('fee basis: values', 'a fee of 925.554 rounds down (fee|selling)', 'fee_owner',
  $q$SELECT (s->>'fee_after')::numeric || '|' || (s->>'selling_after')::numeric
     FROM public.admin_doc_fee_change_preview('b0000000-0000-4000-8000-000000000003', true, 925.554) r, jsonb_array_elements(r->'samples') s
     WHERE s->>'vin_suffix' = '040420'$q$,
  '925.55|39494.45');
SELECT t.check('fee basis: values', 'a negative fee is refused and nothing is written', 'fee_owner',
  $q$SELECT public.admin_doc_fee_change_apply('b0000000-0000-4000-8000-000000000003', true, -1, 1, 'policy-b-0012')$q$, 'error P0001',
  $q$SELECT count(*)::text FROM public.vehicle_listings WHERE tenant_id = 'b0000000-0000-4000-8000-000000000003' AND doc_fee <> 895$q$, '0');
SELECT t.check('fee basis: values', 'a missing fee is refused', 'fee_owner',
  $q$SELECT public.admin_doc_fee_change_preview('b0000000-0000-4000-8000-000000000003', true, NULL)$q$, 'error P0001');
SELECT t.check('fee basis: values', 'disabling the fee on an inclusive tenant keeps the total and makes the whole total the vehicle price', 'fee_owner',
  $q$SELECT public.admin_doc_fee_change_apply('b0000000-0000-4000-8000-000000000003', false, 925, 1, 'policy-b-0013')$q$, 'ok',
  $q$SELECT concat_ws('|', price, advertised_price_before_doc, doc_fee, website_sale_price) FROM public.vehicle_listings WHERE id = 'c0000000-0000-4000-8000-000000000301'$q$,
  '40420.00|40420.00|0|40420');
SELECT t.check('fee basis: values', 'contradicting basis settings: apply refused before any write (status|fee setting|version|rows at 925)', 'fee_owner',
  $q$RESET ROLE;;
     UPDATE public.dealer_profiles SET settings = settings || '{"advertised_excludes_doc_fee": true}' WHERE tenant_id = 'b0000000-0000-4000-8000-000000000003';;
     SELECT t.become('fee_owner');;
     CREATE TEMP TABLE r ON COMMIT DROP AS SELECT public.admin_doc_fee_change_apply('b0000000-0000-4000-8000-000000000003', true, 925, (SELECT policy_version FROM public.dealer_profiles WHERE tenant_id = 'b0000000-0000-4000-8000-000000000003'), 'policy-b-0014') AS j$q$, 'ok',
  $q$SELECT concat_ws('|', (SELECT j->>'status' FROM r), (SELECT settings->>'doc_fee_amount' FROM public.dealer_profiles WHERE tenant_id = 'b0000000-0000-4000-8000-000000000003'),
       (SELECT policy_version FROM public.dealer_profiles WHERE tenant_id = 'b0000000-0000-4000-8000-000000000003'),
       (SELECT count(*) FROM public.vehicle_listings WHERE doc_fee = 925))$q$,
  'failed|895|2|0');
SELECT t.check('fee basis: values', 'contradicting basis settings: the dry-run reports the conflict and counts nothing as eligible', 'fee_owner',
  $q$RESET ROLE;;
     UPDATE public.dealer_profiles SET settings = settings || '{"advertised_excludes_doc_fee": true}' WHERE tenant_id = 'b0000000-0000-4000-8000-000000000003';;
     SELECT t.become('fee_owner');;
     CREATE TEMP TABLE r ON COMMIT DROP AS SELECT public.admin_doc_fee_change_preview('b0000000-0000-4000-8000-000000000003', true, 925) AS j$q$, 'ok',
  $q$SELECT concat_ws('|', j->>'basis', j->>'eligible') FROM r$q$,
  'conflict|0');

-- ── Fee-exclusive: the same vehicle priced before the fee ────────────────
SELECT t.check('fee basis: before fee', 'traced vehicle on a before-fee tenant: before-fee 39,525 kept, total 40,420 -> 40,450 (price|before-fee|fee|website_sale_price)', 'owner',
  $q$RESET ROLE;;
     INSERT INTO public.vehicle_listings (id, store_id, vin, slug, condition, status, tenant_id, created_by, price, advertised_price_before_doc, doc_fee, website_sale_price, price_parse_status)
     VALUES ('c0000000-0000-4000-8000-000000000199', 'store-1', 'EXAMPLEVIN0039525', 'example-trace', 'used', 'published', 'b0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 39525, 39525, 895, 40420, 'ok');;
     UPDATE public.dealer_profiles SET settings = settings || '{"advertised_includes_doc_fee": false}' WHERE tenant_id = 'b0000000-0000-4000-8000-000000000001';;
     SELECT t.become('owner');;
     SELECT public.admin_doc_fee_change_apply('b0000000-0000-4000-8000-000000000001', true, 925, (SELECT policy_version FROM public.dealer_profiles WHERE tenant_id = 'b0000000-0000-4000-8000-000000000001'), 'policy-b-0101')$q$, 'ok',
  $q$SELECT concat_ws('|', price, advertised_price_before_doc, doc_fee, website_sale_price) FROM public.vehicle_listings WHERE id = 'c0000000-0000-4000-8000-000000000199'$q$,
  '39525.00|39525|925.00|40450.00');
SELECT t.expect('fee basis: before fee', 'before-fee dry-run sample (basis|selling before>after|total before>after)', 'owner',
  $q$SELECT s->>'basis' || '|' || (s->>'selling_before')::numeric || '>' || (s->>'selling_after')::numeric || '|' || (s->>'total_before')::numeric || '>' || (s->>'total_after')::numeric
     FROM public.admin_doc_fee_change_preview('b0000000-0000-4000-8000-000000000001', true, 925) r, jsonb_array_elements(r->'samples') s
     WHERE s->>'vin_suffix' = '000001'$q$,
  'before_fee|20000>20000|20895>20925.00');

-- ── Legacy recalculation follows the same plan ───────────────────────────
SELECT t.check('fee basis: legacy recalc', 'recalc_tenant_doc_fee on an inclusive tenant keeps the total and the website observation', 'fee_owner',
  $q$RESET ROLE;;
     UPDATE public.dealer_profiles SET settings = settings || '{"doc_fee_amount": 925}' WHERE tenant_id = 'b0000000-0000-4000-8000-000000000003';;
     SELECT t.become('fee_owner');;
     SELECT public.recalc_tenant_doc_fee('b0000000-0000-4000-8000-000000000003')$q$, 'ok',
  $q$SELECT string_agg(concat_ws('|', right(vin, 6), price, advertised_price_before_doc, doc_fee, website_sale_price), ' ' ORDER BY vin)
     FROM public.vehicle_listings WHERE id IN ('c0000000-0000-4000-8000-000000000301', 'c0000000-0000-4000-8000-000000000302')$q$,
  '030000|30000.00|29075.00|925.00|30500 040420|40420.00|39495.00|925.00|40420');
