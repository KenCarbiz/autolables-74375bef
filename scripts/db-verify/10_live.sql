-- Cases against the policy set that is live on the hosted project (both
-- Administration V2 migrations applied). Expected access is written from the
-- documented role matrix (ADMIN_V2_SERVER_AUTHORITY.md, the dealer role
-- capability table), not copied from the functions under test.

-- ── 1. Settings authority: every key family, every principal ─────────────
DO $$
DECLARE
  t1 constant text := 'b0000000-0000-4000-8000-000000000001';
  fam record;
  p text;
  v_expect text;
  principals text[] := ARRAY['owner','general_manager','gsm','admin','manager','sales_manager','used_car_manager',
                             'inventory_manager','salesperson','service_manager','finance','office','compliance','readonly',
                             'pending_manager','other_tenant_owner','platform_admin','anon'];
BEGIN
  FOR fam IN SELECT * FROM (VALUES
    ('pricing',    '{"doc_fee_amount": 900}',                    ARRAY['owner','admin','general_manager','gsm','platform_admin']),
    ('routing',    '{"passport_contact_routing": {}}',           ARRAY['owner','admin','general_manager','gsm','manager','sales_manager','used_car_manager','finance','platform_admin']),
    ('publishing', '{"document_rules": {}}',                     ARRAY['owner','admin','general_manager','gsm','manager','platform_admin']),
    ('dealer programs (master list)', '{"dealer_programs": []}', ARRAY['owner','admin','general_manager','gsm','manager','sales_manager','used_car_manager','finance','office','compliance','platform_admin']),
    ('service',    '{"require_safety_inspection": true}',        ARRAY['owner','admin','general_manager','gsm','manager','service_manager','platform_admin']),
    ('workspace',  '{"label_defaults": {"size": "4x6"}}',        ARRAY['owner','general_manager','gsm','admin','manager','sales_manager','used_car_manager','inventory_manager','salesperson','service_manager','finance','office','compliance','readonly','platform_admin']),
    ('identity and brand', '{"dealer_name": "Renamed"}',         ARRAY['owner','admin','general_manager','gsm','manager','platform_admin'])
  ) AS f(name, patch, allowed)
  LOOP
    FOREACH p IN ARRAY principals LOOP
      -- Under policy B a changed fee on a dealership with priced vehicles goes
      -- through the reviewed apply, so even the allowed roles are refused here.
      v_expect := CASE WHEN NOT (p = ANY (fam.allowed)) THEN 'error 42501'
                       WHEN t.stage() = 'policy B' AND fam.name = 'pricing' THEN 'error 55000'
                       ELSE 'ok' END;
      PERFORM t.check(
        'settings authority', fam.name || ' key', p,
        format('SELECT public.merge_dealer_settings(%L::uuid, %L::jsonb)', t1, fam.patch),
        v_expect,
        -- Written when allowed, untouched when refused.
        format('SELECT (settings @> %L::jsonb)::text FROM public.dealer_profiles WHERE tenant_id = %L', fam.patch, t1),
        CASE WHEN v_expect = 'ok' THEN 'true' ELSE NULL END);
    END LOOP;
  END LOOP;
END $$;

-- ── 2. Settings persistence: values, version, audit ─────────────────────
SELECT t.check('settings persistence', 'owner saves the doc fee: value stored, version +1, one pricing audit row with before and after', 'owner',
  $q$SELECT public.merge_dealer_settings('b0000000-0000-4000-8000-000000000001', '{"doc_fee_amount": 900}')$q$, CASE WHEN t.stage() = 'policy B' THEN 'error 55000' ELSE 'ok' END,
  $q$SELECT concat_ws('|', dp.settings->>'doc_fee_amount', dp.policy_version,
       (SELECT count(*) FROM public.audit_log a WHERE a.action = 'pricing_policy_changed' AND a.store_id = dp.tenant_id::text
          AND a.details->'prev'->>'doc_fee_amount' = '895' AND a.details->'next'->>'doc_fee_amount' = '900'))
     FROM public.dealer_profiles dp WHERE dp.tenant_id = 'b0000000-0000-4000-8000-000000000001'$q$,
  CASE WHEN t.stage() = 'policy B' THEN '895|1|0' ELSE '900|2|1' END);
SELECT t.check('settings persistence', 'a merge keeps every key it does not name', 'owner',
  $q$SELECT public.merge_dealer_settings('b0000000-0000-4000-8000-000000000001', '{"dealer_name": "Renamed"}')$q$, 'ok',
  $q$SELECT concat_ws('|', settings->>'dealer_name', settings->>'doc_fee_amount', settings->>'doc_fee_state', jsonb_array_length(settings->'dealer_programs'))
     FROM public.dealer_profiles WHERE tenant_id = 'b0000000-0000-4000-8000-000000000001'$q$,
  'Renamed|895|CT|1');
SELECT t.check('settings persistence', 'a workspace key saves without a policy audit row', 'salesperson',
  $q$SELECT public.merge_dealer_settings('b0000000-0000-4000-8000-000000000001', '{"label_defaults": {"size": "4x6"}}')$q$, 'ok',
  $q$SELECT concat_ws('|', (SELECT settings->'label_defaults'->>'size' FROM public.dealer_profiles WHERE tenant_id = 'b0000000-0000-4000-8000-000000000001'),
       (SELECT count(*) FROM public.audit_log WHERE action LIKE '%policy%'))$q$,
  '4x6|0');
SELECT t.check('settings persistence', 'a refused save writes nothing and audits nothing', 'salesperson',
  $q$SELECT public.merge_dealer_settings('b0000000-0000-4000-8000-000000000001', '{"doc_fee_amount": 1}')$q$, 'error 42501',
  $q$SELECT concat_ws('|', (SELECT settings->>'doc_fee_amount' FROM public.dealer_profiles WHERE tenant_id = 'b0000000-0000-4000-8000-000000000001'),
       (SELECT policy_version FROM public.dealer_profiles WHERE tenant_id = 'b0000000-0000-4000-8000-000000000001'),
       (SELECT count(*) FROM public.audit_log))$q$,
  '895|1|0');
SELECT t.check('settings persistence', 'routing saves write a routing audit row', 'sales_manager',
  $q$SELECT public.merge_dealer_settings('b0000000-0000-4000-8000-000000000001', '{"passport_contact_routing": {"mode": "rotation"}}')$q$, 'ok',
  $q$SELECT count(*)::text FROM public.audit_log WHERE action = 'routing_policy_changed'$q$, '1');
SELECT t.check('settings persistence', 'a member reads the saved settings back', 'salesperson',
  $q$SELECT settings FROM public.dealer_profiles WHERE tenant_id = 'b0000000-0000-4000-8000-000000000001'$q$, 'ok rows=1');
SELECT t.check('settings persistence', 'another tenant''s owner cannot read this tenant''s settings', 'other_tenant_owner',
  $q$SELECT settings FROM public.dealer_profiles WHERE tenant_id = 'b0000000-0000-4000-8000-000000000001'$q$, 'ok rows=0');

-- ── 3. Direct table writes are closed; the RPC is the only writer ───────
DO $$
DECLARE p text;
BEGIN
  FOREACH p IN ARRAY ARRAY['owner','manager','salesperson'] LOOP
    PERFORM t.check('direct settings writes', 'direct update of dealer_profiles matches no row', p,
      $q$UPDATE public.dealer_profiles SET settings = settings || '{"dealer_name": "Direct"}' WHERE tenant_id = 'b0000000-0000-4000-8000-000000000001'$q$,
      'ok rows=0');
    PERFORM t.check('direct settings writes', 'direct insert of a dealer profile is refused', p,
      $q$INSERT INTO public.dealer_profiles (tenant_id, settings) VALUES ('b0000000-0000-4000-8000-000000000002', '{}')$q$,
      'error 42501');
  END LOOP;
END $$;
SELECT t.check('direct settings writes', 'platform administrator may write directly', 'platform_admin',
  $q$UPDATE public.dealer_profiles SET settings = settings || '{"dealer_name": "Direct"}' WHERE tenant_id = 'b0000000-0000-4000-8000-000000000001'$q$,
  'ok rows=1');
SELECT t.check('direct settings writes', 'anon cannot update dealer profiles', 'anon',
  $q$UPDATE public.dealer_profiles SET settings = '{}' WHERE tenant_id = 'b0000000-0000-4000-8000-000000000001'$q$, 'error 42501');
SELECT t.check('direct settings writes', 'anon cannot call the settings writer', 'anon',
  $q$SELECT public.merge_dealer_settings('b0000000-0000-4000-8000-000000000001', '{"dealer_name": "x"}')$q$, 'error 42501');
SELECT t.check('direct settings writes', 'anon reads no dealer profile', 'anon',
  $q$SELECT settings FROM public.dealer_profiles$q$, 'ok rows=0');

-- ── 4. Products and product rules ────────────────────────────────────────
DO $$
DECLARE
  p text; v_expect text;
  addon text[] := ARRAY['owner','admin','general_manager','gsm','manager','sales_manager','used_car_manager','finance','office','compliance'];
BEGIN
  FOREACH p IN ARRAY ARRAY['owner','general_manager','gsm','manager','sales_manager','used_car_manager','finance','office','compliance',
                           'inventory_manager','salesperson','service_manager','readonly','other_tenant_owner'] LOOP
    v_expect := CASE WHEN p = ANY (addon) THEN 'ok rows=1' ELSE 'error 42501' END;
    PERFORM t.check('products and rules', 'create a product', p,
      $q$INSERT INTO public.products (name, price, tenant_id) VALUES ('New package', 99, 'b0000000-0000-4000-8000-000000000001')$q$, v_expect);
    v_expect := CASE WHEN p = ANY (addon) THEN 'ok rows=1' ELSE 'ok rows=0' END;
    PERFORM t.check('products and rules', 'change a product price', p,
      $q$UPDATE public.products SET price = 595 WHERE id = 'd0000000-0000-4000-8000-000000000001'$q$, v_expect,
      $q$SELECT price::text FROM public.products WHERE id = 'd0000000-0000-4000-8000-000000000001'$q$,
      CASE WHEN p = ANY (addon) THEN '595.00' ELSE '495.00' END);
    PERFORM t.check('products and rules', 'delete a product', p,
      $q$DELETE FROM public.products WHERE id = 'd0000000-0000-4000-8000-000000000001'$q$, v_expect);
    v_expect := CASE WHEN p = ANY (addon) THEN 'ok rows=1' ELSE 'error 42501' END;
    PERFORM t.check('products and rules', 'create an applicability rule', p,
      $q$INSERT INTO public.product_rules (tenant_id, product_id, condition) VALUES ('b0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000001', 'new')$q$, v_expect);
    v_expect := CASE WHEN p = ANY (addon) THEN 'ok rows=1' ELSE 'ok rows=0' END;
    PERFORM t.check('products and rules', 'change an applicability rule', p,
      $q$UPDATE public.product_rules SET mileage_max = 60000 WHERE id = 'e0000000-0000-4000-8000-000000000001'$q$, v_expect);
  END LOOP;
END $$;
-- A platform administrator who is not a member of the dealership cannot see
-- its products, rules or vehicles, so the app cannot change them either. This
-- predates Administration V2 (the read policies were not changed).
SELECT t.check('products and rules', 'platform administrator (not a member) can create a product for a dealership', 'platform_admin',
  $q$INSERT INTO public.products (name, price, tenant_id) VALUES ('New package', 99, 'b0000000-0000-4000-8000-000000000001')$q$, 'ok rows=1');
SELECT t.check('products and rules', 'platform administrator (not a member) cannot see, so cannot change, a dealership product', 'platform_admin',
  $q$UPDATE public.products SET price = 595 WHERE id = 'd0000000-0000-4000-8000-000000000001'$q$, 'ok rows=0');
SELECT t.check('products and rules', 'platform administrator (not a member) cannot create an applicability rule', 'platform_admin',
  $q$INSERT INTO public.product_rules (tenant_id, product_id, condition) VALUES ('b0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000001', 'new')$q$, 'error 42501');
SELECT t.check('products and rules', 'a salesperson still reads the catalog', 'salesperson',
  $q$SELECT id FROM public.products WHERE tenant_id = 'b0000000-0000-4000-8000-000000000001'$q$, 'ok rows=1');
SELECT t.check('products and rules', 'a tenantless product cannot be created by a dealer role', 'owner',
  $q$INSERT INTO public.products (name, price, tenant_id) VALUES ('Global package', 99, NULL)$q$, 'error 42501');

-- ── 5. Priced columns on vehicle listings (live rule) ────────────────────
DO $$
DECLARE
  p text; v_expect text;
  pricing_live text[] := ARRAY['owner','admin','general_manager','gsm','manager','inventory_manager','used_car_manager'];
  recall text[] := ARRAY['owner','admin','general_manager','gsm','manager','compliance','office','finance'];
BEGIN
  FOREACH p IN ARRAY ARRAY['owner','general_manager','gsm','admin','manager','inventory_manager','used_car_manager',
                           'sales_manager','salesperson','service_manager','finance','office','compliance','readonly'] LOOP
    v_expect := CASE WHEN p = ANY (pricing_live) THEN 'ok rows=1' ELSE 'error 42501' END;
    PERFORM t.check('vehicle prices (live)', 'change a vehicle price', p,
      $q$UPDATE public.vehicle_listings SET price = price + 100 WHERE id = 'c0000000-0000-4000-8000-000000000001'$q$, v_expect,
      $q$SELECT price::text FROM public.vehicle_listings WHERE id = 'c0000000-0000-4000-8000-000000000001'$q$,
      CASE WHEN p = ANY (pricing_live) THEN '20100.00' ELSE '20000.00' END);
    PERFORM t.check('vehicle prices (live)', 'change a vehicle doc fee column', p,
      $q$UPDATE public.vehicle_listings SET doc_fee = 0 WHERE id = 'c0000000-0000-4000-8000-000000000001'$q$, v_expect);
    v_expect := CASE WHEN p = ANY (recall) THEN 'ok rows=1' ELSE 'error 42501' END;
    PERFORM t.check('vehicle prices (live)', 'override a recall hold', p,
      $q$UPDATE public.vehicle_listings SET recall_override_notes = 'Reviewed' WHERE id = 'c0000000-0000-4000-8000-000000000001'$q$, v_expect);
    PERFORM t.check('vehicle prices (live)', 'edit a non-priced field (description)', p,
      $q$UPDATE public.vehicle_listings SET description = 'Updated' WHERE id = 'c0000000-0000-4000-8000-000000000001'$q$, 'ok rows=1');
  END LOOP;
END $$;
SELECT t.check('vehicle prices (live)', 'platform administrator (not a member) cannot see, so cannot change, a dealership vehicle', 'platform_admin',
  $q$UPDATE public.vehicle_listings SET description = 'Updated' WHERE id = 'c0000000-0000-4000-8000-000000000001'$q$, 'ok rows=0');
SELECT t.check('vehicle prices (live)', 'another tenant''s owner matches no listing', 'other_tenant_owner',
  $q$UPDATE public.vehicle_listings SET price = 1 WHERE id = 'c0000000-0000-4000-8000-000000000001'$q$, 'ok rows=0');
SELECT t.check('vehicle prices (live)', 'service jobs (feed, crawl) still write prices', 'service_role',
  $q$UPDATE public.vehicle_listings SET price = 21000, advertised_price_before_doc = 21000, website_sale_price = 21895 WHERE id = 'c0000000-0000-4000-8000-000000000001'$q$, 'ok rows=1');
SELECT t.check('vehicle prices (live)', 'known gap: a salesperson can set a price when creating a listing (the guard covers updates only)', 'salesperson',
  $q$INSERT INTO public.vehicle_listings (store_id, vin, slug, tenant_id, created_by, price) VALUES ('store-1', 'EXAMPLEVIN0000009', 'example-9', 'b0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000009', 1)$q$, 'ok rows=1');

-- ── 6. Dealer programs: master list versus applying ──────────────────────
SELECT t.check('dealer programs', 'salesperson views the approved programs', 'salesperson',
  $q$SELECT p FROM public.dealer_profiles dp, jsonb_array_elements(dp.settings->'dealer_programs') p WHERE dp.tenant_id = 'b0000000-0000-4000-8000-000000000001' AND (p->>'enabled')::boolean$q$, 'ok rows=1');
SELECT t.check('dealer programs', 'salesperson cannot add a program to the master list', 'salesperson',
  $q$SELECT public.merge_dealer_settings('b0000000-0000-4000-8000-000000000001', '{"dealer_programs": [{"id": "program-1"}, {"id": "program-2", "title": "New"}]}')$q$, 'error 42501',
  $q$SELECT jsonb_array_length(settings->'dealer_programs')::text FROM public.dealer_profiles WHERE tenant_id = 'b0000000-0000-4000-8000-000000000001'$q$, '1');
SELECT t.check('dealer programs', 'salesperson cannot edit a program in the master list', 'salesperson',
  $q$SELECT public.merge_dealer_settings('b0000000-0000-4000-8000-000000000001', '{"dealer_programs": [{"id": "program-1", "title": "Changed"}]}')$q$, 'error 42501');
SELECT t.check('dealer programs', 'salesperson cannot delete programs from the master list', 'salesperson',
  $q$SELECT public.merge_dealer_settings('b0000000-0000-4000-8000-000000000001', '{"dealer_programs": []}')$q$, 'error 42501');
SELECT t.check('dealer programs', 'inventory manager cannot change the master list', 'inventory_manager',
  $q$SELECT public.merge_dealer_settings('b0000000-0000-4000-8000-000000000001', '{"dealer_programs": []}')$q$, 'error 42501');
SELECT t.check('dealer programs', 'sales manager (add-on role) edits the master list and it is audited', 'sales_manager',
  $q$SELECT public.merge_dealer_settings('b0000000-0000-4000-8000-000000000001', '{"dealer_programs": [{"id": "program-1", "title": "Changed", "enabled": true}]}')$q$, 'ok',
  $q$SELECT count(*)::text FROM public.audit_log WHERE action = 'addon_policy_changed'$q$, '1');
SELECT t.check('dealer programs', 'salesperson applies or withholds a program on one vehicle', 'salesperson',
  $q$UPDATE public.vehicle_listings SET suppressed_programs = '["program-1"]' WHERE id = 'c0000000-0000-4000-8000-000000000001'$q$, 'ok rows=1',
  $q$SELECT suppressed_programs::text FROM public.vehicle_listings WHERE id = 'c0000000-0000-4000-8000-000000000001'$q$, '["program-1"]');

-- ── 7. Fee review: preview and apply ─────────────────────────────────────
SELECT t.check('fee review', 'owner previews a fee change: 3 active vehicles change, 1 archived excluded, 1 without basis, nothing written', 'owner',
  $q$SELECT public.admin_doc_fee_change_preview('b0000000-0000-4000-8000-000000000001', true, 900)$q$, 'ok rows=1',
  $q$SELECT concat_ws('|', (SELECT count(*) FROM public.audit_log), (SELECT policy_version FROM public.dealer_profiles WHERE tenant_id = 'b0000000-0000-4000-8000-000000000001'),
       (SELECT count(*) FROM public.vehicle_listings WHERE doc_fee = 900))$q$, '0|1|0');
SELECT t.expect('fee review', 'preview counts (eligible|unchanged|archived excluded|no basis|samples|version)', 'owner',
  $q$SELECT concat_ws('|', r->>'eligible', r->>'unchanged', r->>'excluded_archived', r->>'no_price_basis', jsonb_array_length(r->'samples'), r->>'version')
     FROM public.admin_doc_fee_change_preview('b0000000-0000-4000-8000-000000000001', true, 900) r$q$,
  '3|0|1|1|3|1');
SELECT t.expect('fee review', 'preview warnings name the vehicles without a basis, the parse warning, and that verification dates are kept', 'owner',
  $q$SELECT r->'warnings' FROM public.admin_doc_fee_change_preview('b0000000-0000-4000-8000-000000000001', true, 900) r$q$,
  CASE WHEN t.stage() = 'policy B' THEN '["Advertised prices exclude the fee: each vehicle price is kept and the fee is added on top.", ' ELSE '[' END
  || '"1 active vehicle(s) have no advertised price basis and are not affected.", "1 active vehicle(s) carry a price parse warning; it is preserved.", "Source verification dates and mismatch flags are preserved; recalculation is not a fresh observation."]');
SELECT t.expect('fee review', 'preview with archived stock included counts the archived row as eligible', 'owner',
  $q$SELECT concat_ws('|', r->>'eligible', r->>'excluded_archived') FROM public.admin_doc_fee_change_preview('b0000000-0000-4000-8000-000000000001', true, 900, true) r$q$,
  '4|0');
SELECT t.expect('fee review', 'preview at the current fee changes nothing (eligible|unchanged)', 'owner',
  $q$SELECT concat_ws('|', r->>'eligible', r->>'unchanged') FROM public.admin_doc_fee_change_preview('b0000000-0000-4000-8000-000000000001', true, 895) r$q$,
  '0|3');
SELECT t.expect('fee review', 'preview samples show the selling price, the fee before and after, and the totals', 'gsm',
  $q$SELECT s->>'vin_suffix' || ' ' || (s->>'selling_price')::numeric || ' ' || (s->>'fee_before')::numeric || '>' || (s->>'fee_after')::numeric || ' ' || (s->>'total_before')::numeric || '>' || (s->>'total_after')::numeric
     FROM public.admin_doc_fee_change_preview('b0000000-0000-4000-8000-000000000001', true, 900) r, jsonb_array_elements(r->'samples') s
     WHERE s->>'vin_suffix' = '000001'$q$,
  '000001 20000 895>900.00 20895>20900.00');
DO $$
DECLARE p text;
BEGIN
  FOREACH p IN ARRAY ARRAY['manager','used_car_manager','inventory_manager','sales_manager','salesperson','other_tenant_owner'] LOOP
    PERFORM t.check('fee review', 'preview refused', p,
      $q$SELECT public.admin_doc_fee_change_preview('b0000000-0000-4000-8000-000000000001', true, 900)$q$, 'error 42501');
    PERFORM t.check('fee review', 'apply refused, nothing written', p,
      $q$SELECT public.admin_doc_fee_change_apply('b0000000-0000-4000-8000-000000000001', true, 900, 1, 'review-key-0001')$q$, 'error 42501',
      $q$SELECT concat_ws('|', (SELECT count(*) FROM public.vehicle_listings WHERE doc_fee = 900), (SELECT count(*) FROM public.admin_policy_applications))$q$, '0|0');
  END LOOP;
END $$;
SELECT t.check('fee review', 'anon cannot preview', 'anon',
  $q$SELECT public.admin_doc_fee_change_preview('b0000000-0000-4000-8000-000000000001', true, 900)$q$, 'error 42501');
SELECT t.check('fee review', 'owner applies: active rows only, archived and unbased untouched, verification stamps kept, recalculation stamped, one audit row, one ledger row, version +1', 'owner',
  $q$SELECT public.admin_doc_fee_change_apply('b0000000-0000-4000-8000-000000000001', true, 900, 1, 'review-key-0001')$q$, 'ok',
  $q$SELECT concat_ws('|',
       (SELECT count(*) FROM public.vehicle_listings WHERE archived_at IS NULL AND doc_fee = 900 AND website_sale_price = advertised_price_before_doc + 900),
       (SELECT doc_fee FROM public.vehicle_listings WHERE id = 'c0000000-0000-4000-8000-000000000004'),
       (SELECT count(*) FROM public.vehicle_listings WHERE id = 'c0000000-0000-4000-8000-000000000005' AND doc_fee IS NULL),
       (SELECT count(*) FROM public.vehicle_listings WHERE price_last_verified_at IN ('2026-10-01 12:00+00','2026-10-02 12:00+00','2026-10-03 12:00+00')),
       (SELECT count(*) FROM public.vehicle_listings WHERE price_recalculated_at IS NOT NULL),
       (SELECT count(*) FROM public.vehicle_listings WHERE price_parse_status = 'warning' AND tenant_id = 'b0000000-0000-4000-8000-000000000001'),
       (SELECT count(*) FROM public.audit_log WHERE action = 'doc_fee_policy_applied' AND (details->>'affected')::int = 3),
       (SELECT count(*) FROM public.admin_policy_applications),
       (SELECT policy_version FROM public.dealer_profiles WHERE tenant_id = 'b0000000-0000-4000-8000-000000000001'),
       (SELECT settings->>'doc_fee_amount' FROM public.dealer_profiles WHERE tenant_id = 'b0000000-0000-4000-8000-000000000001'))$q$,
  '3|895|1|3|3|1|1|1|2|900');
SELECT t.check('fee review', 'the same idempotency key twice changes nothing more (duplicate returned)', 'owner',
  $q$SELECT public.admin_doc_fee_change_apply('b0000000-0000-4000-8000-000000000001', true, 900, 1, 'review-key-0001');;
     SELECT public.admin_doc_fee_change_apply('b0000000-0000-4000-8000-000000000001', true, 950, 1, 'review-key-0001')$q$, 'ok',
  $q$SELECT concat_ws('|', (SELECT count(*) FROM public.vehicle_listings WHERE doc_fee = 950), (SELECT count(*) FROM public.audit_log WHERE action = 'doc_fee_policy_applied'),
       (SELECT count(*) FROM public.admin_policy_applications), (SELECT policy_version FROM public.dealer_profiles WHERE tenant_id = 'b0000000-0000-4000-8000-000000000001'))$q$,
  '0|1|1|2');
SELECT t.check('fee review', 'a review against an old version is a conflict and writes nothing', 'owner',
  $q$SELECT public.admin_doc_fee_change_apply('b0000000-0000-4000-8000-000000000001', true, 900, 7, 'review-key-0002')$q$, 'ok',
  $q$SELECT concat_ws('|', (SELECT count(*) FROM public.vehicle_listings WHERE doc_fee = 900), (SELECT count(*) FROM public.admin_policy_applications), (SELECT count(*) FROM public.audit_log))$q$,
  '0|0|0');
SELECT t.check('fee review', 'a settings save after the review moves the version, so the reviewed apply conflicts', 'owner',
  $q$SELECT public.merge_dealer_settings('b0000000-0000-4000-8000-000000000001', '{"label_defaults": {"size": "2x3"}}');;
     SELECT public.admin_doc_fee_change_apply('b0000000-0000-4000-8000-000000000001', true, 900, 1, 'review-key-0003')$q$, 'ok',
  $q$SELECT concat_ws('|', (SELECT count(*) FROM public.vehicle_listings WHERE doc_fee = 900), (SELECT settings->>'doc_fee_amount' FROM public.dealer_profiles WHERE tenant_id = 'b0000000-0000-4000-8000-000000000001'))$q$,
  '0|895');
SELECT t.check('fee review', 'GSM applies', 'gsm',
  $q$SELECT public.admin_doc_fee_change_apply('b0000000-0000-4000-8000-000000000001', true, 900, 1, 'review-key-0004')$q$, 'ok',
  $q$SELECT count(*)::text FROM public.vehicle_listings WHERE doc_fee = 900$q$, '3');
SELECT t.check('fee review', 'including archived stock is explicit and reaches the archived row', 'owner',
  $q$SELECT public.admin_doc_fee_change_apply('b0000000-0000-4000-8000-000000000001', true, 900, 1, 'review-key-0005', true)$q$, 'ok',
  $q$SELECT count(*)::text FROM public.vehicle_listings WHERE doc_fee = 900$q$, '4');
SELECT t.check('fee review', 'disabling the fee sets it to zero and the total to the selling price', 'owner',
  $q$SELECT public.admin_doc_fee_change_apply('b0000000-0000-4000-8000-000000000001', false, 895, 1, 'review-key-0006')$q$, 'ok',
  $q$SELECT count(*)::text FROM public.vehicle_listings WHERE archived_at IS NULL AND doc_fee = 0 AND website_sale_price = advertised_price_before_doc$q$, '3');
SELECT t.check('fee review', 'a short idempotency key is refused', 'owner',
  $q$SELECT public.admin_doc_fee_change_apply('b0000000-0000-4000-8000-000000000001', true, 900, 1, 'short')$q$, 'error P0001');
SELECT t.check('fee review', 'a negative amount is refused', 'owner',
  $q$SELECT public.admin_doc_fee_change_apply('b0000000-0000-4000-8000-000000000001', true, -1, 1, 'review-key-0007')$q$, 'error P0001');
SELECT t.check('fee review', 'the apply passes the price guard (definer context), so an owner''s reviewed change is not blocked by it', 'owner',
  $q$SELECT public.admin_doc_fee_change_apply('b0000000-0000-4000-8000-000000000001', true, 910, 1, 'review-key-0008')$q$, 'ok',
  $q$SELECT count(*)::text FROM public.vehicle_listings WHERE doc_fee = 910$q$, '3');

-- ── 8. Policy version, feed and job reads ────────────────────────────────
SELECT t.check('health reads', 'a member reads the policy version', 'salesperson',
  $q$SELECT public.admin_policy_version('b0000000-0000-4000-8000-000000000001')$q$, 'ok rows=1');
SELECT t.check('health reads', 'another tenant''s owner cannot read the policy version', 'other_tenant_owner',
  $q$SELECT public.admin_policy_version('b0000000-0000-4000-8000-000000000001')$q$, 'error 42501');
SELECT t.check('health reads', 'a pending invitation cannot read the policy version', 'pending_manager',
  $q$SELECT public.admin_policy_version('b0000000-0000-4000-8000-000000000001')$q$, 'error 42501');
SELECT t.expect('health reads', 'last feed success is the newest success or partial over the whole ledger, not the newest run', 'salesperson',
  $q$SELECT to_char(public.admin_feed_last_success('b0000000-0000-4000-8000-000000000001') AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI')$q$,
  '2026-10-22 07:00');
SELECT t.expect('health reads', 'job status lists the scheduled jobs and never returns a URL or bearer key from their commands', 'salesperson',
  $q$SELECT concat('feed=', j LIKE '%marketcheck-sync%', ' crawl=', j LIKE '%crawl%', ' url=', j LIKE '%://%', ' bearer=', j ILIKE '%bearer%', ' secret=', j ILIKE '%example-secret-key%')
     FROM (SELECT string_agg(x::text, ' ') AS j FROM public.admin_job_status('b0000000-0000-4000-8000-000000000001') x) q$q$,
  'feed=t crawl=t url=f bearer=f secret=f');
SELECT t.check('health reads', 'another tenant''s owner cannot read feed health', 'other_tenant_owner',
  $q$SELECT public.admin_feed_last_success('b0000000-0000-4000-8000-000000000001')$q$, 'error 42501');
SELECT t.check('health reads', 'another tenant''s owner cannot read job status', 'other_tenant_owner',
  $q$SELECT * FROM public.admin_job_status('b0000000-0000-4000-8000-000000000001')$q$, 'error 42501');
SELECT t.check('health reads', 'anon cannot read job status', 'anon',
  $q$SELECT * FROM public.admin_job_status('b0000000-0000-4000-8000-000000000001')$q$, 'error 42501');
SELECT t.check('health reads', 'the apply ledger is readable by members only', 'other_tenant_owner',
  $q$SELECT * FROM public.admin_policy_applications$q$, 'ok rows=0');

SELECT t.stage() = 'policy B' AS policy_b \gset
\if :policy_b
-- Retired under policy B; scripts/db-verify/30_fee_basis.sql checks the refusal.
\else
-- ── 9. The fee recalculation behind the Review & Apply fallback ──────────
SELECT t.check('fee recalculation', 'owner recalculates from the stored fee', 'owner',
  $q$RESET ROLE;;
     UPDATE public.dealer_profiles SET settings = settings || '{"doc_fee_amount": 900}' WHERE tenant_id = 'b0000000-0000-4000-8000-000000000001';;
     SELECT t.become('owner');;
     SELECT public.recalc_tenant_doc_fee('b0000000-0000-4000-8000-000000000001')$q$, 'ok',
  $q$SELECT count(*)::text FROM public.vehicle_listings WHERE doc_fee = 900$q$, '4');
DO $$
DECLARE p text;
BEGIN
  FOREACH p IN ARRAY ARRAY['manager','used_car_manager','inventory_manager','sales_manager','salesperson','finance','readonly','other_tenant_owner'] LOOP
    PERFORM t.check('fee recalculation', 'recalculation refused', p,
      $q$SELECT public.recalc_tenant_doc_fee('b0000000-0000-4000-8000-000000000001')$q$, 'error P0001');
  END LOOP;
END $$;
SELECT t.check('fee recalculation', 'anon cannot call it', 'anon',
  $q$SELECT public.recalc_tenant_doc_fee('b0000000-0000-4000-8000-000000000001')$q$, 'error 42501');
SELECT t.check('fee recalculation', 'known gap: an invitation not yet accepted, for a general manager, can recalculate', 'pending_manager',
  $q$RESET ROLE;;
     UPDATE public.tenant_members SET role = 'general_manager' WHERE user_id = t.u('pending_manager');;
     UPDATE public.dealer_profiles SET settings = settings || '{"doc_fee_amount": 900}' WHERE tenant_id = 'b0000000-0000-4000-8000-000000000001';;
     SELECT t.become('pending_manager');;
     SELECT public.recalc_tenant_doc_fee('b0000000-0000-4000-8000-000000000001')$q$, 'ok',
  $q$SELECT count(*)::text FROM public.vehicle_listings WHERE doc_fee = 900$q$, '4');
SELECT t.check('fee recalculation', 'it reaches archived stock and restamps verification, unlike the reviewed apply', 'owner',
  $q$RESET ROLE;;
     UPDATE public.dealer_profiles SET settings = settings || '{"doc_fee_amount": 900}' WHERE tenant_id = 'b0000000-0000-4000-8000-000000000001';;
     SELECT t.become('owner');;
     SELECT public.recalc_tenant_doc_fee('b0000000-0000-4000-8000-000000000001')$q$, 'ok',
  $q$SELECT concat_ws('|', (SELECT doc_fee::numeric(12,2) FROM public.vehicle_listings WHERE id = 'c0000000-0000-4000-8000-000000000004'),
       (SELECT count(*) FROM public.vehicle_listings WHERE price_last_verified_at > now() - interval '1 minute'),
       (SELECT count(*) FROM public.vehicle_listings WHERE price_parse_status = 'warning'))$q$, '900.00|4|0');
\endif
