-- Behaviour tests for 0013_inventory_duplicate_reconciliation, on synthetic
-- data only. Phase A keeps the production unique index (one listing per tenant
-- + VIN); phase B drops it to exercise the listing-archive path.
\set ON_ERROR_STOP 1
CREATE OR REPLACE FUNCTION pg_temp.expect(cond boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF cond IS NOT TRUE THEN RAISE EXCEPTION 'FAILED: %', label; END IF; RAISE NOTICE 'ok  %', label; END $$;
CREATE OR REPLACE FUNCTION pg_temp.raises(sql text, expected text, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN EXECUTE sql; EXCEPTION WHEN OTHERS THEN
    IF expected IS NOT NULL AND position(expected IN SQLERRM) = 0 THEN RAISE EXCEPTION 'FAILED: % (raised %, expected %)', label, SQLERRM, expected; END IF;
    RAISE NOTICE 'ok  % (%)', label, SQLERRM; RETURN; END;
  RAISE EXCEPTION 'FAILED: % (did not raise)', label;
END $$;
CREATE OR REPLACE FUNCTION pg_temp.as_user(p uuid) RETURNS void LANGUAGE sql AS $$ SELECT set_config('test.uid', COALESCE(p::text, ''), false) $$;

-- Fixtures: tenant T1 with stores S1 (feed) and S2, tenant T2 elsewhere.
INSERT INTO tenants (id, name) VALUES ('00000000-0000-0000-0000-0000000000d1', 'Dedupe Auto Group'), ('00000000-0000-0000-0000-0000000000d2', 'Unrelated Group');
INSERT INTO dealer_groups (id, tenant_id, name) VALUES ('00000000-0000-0000-0000-00000000dd01', '00000000-0000-0000-0000-0000000000d1', 'Dedupe Auto Group'),
  ('00000000-0000-0000-0000-00000000dd02', '00000000-0000-0000-0000-0000000000d2', 'Unrelated Group');
INSERT INTO dealer_stores (id, group_id, tenant_id, display_name, state, status, subscription_status, inventory_feed_enabled, listing_sync_enabled, feed_price_updates_listing)
VALUES ('00000000-0000-0000-0000-0000000005a1', '00000000-0000-0000-0000-00000000dd01', '00000000-0000-0000-0000-0000000000d1', 'Dedupe INFINITI', 'CT', 'active', 'subscribed', true, true, false),
       ('00000000-0000-0000-0000-0000000005a2', '00000000-0000-0000-0000-00000000dd01', '00000000-0000-0000-0000-0000000000d1', 'Dedupe Nissan', 'CT', 'active', 'subscribed', true, true, false);
INSERT INTO inventory_source_mappings (id, source_dealer_id, group_id, store_id, status, observed_identity, approved_at)
VALUES ('00000000-0000-0000-0000-0000000006a1', 'DD1_inventory', '00000000-0000-0000-0000-00000000dd01', '00000000-0000-0000-0000-0000000005a1', 'approved', '{}'::jsonb, now()),
       ('00000000-0000-0000-0000-0000000006a2', 'DD2_inventory', '00000000-0000-0000-0000-00000000dd01', '00000000-0000-0000-0000-0000000005a2', 'approved', '{}'::jsonb, now());

CREATE TEMP TABLE k (name text PRIMARY KEY, id uuid, j jsonb);
CREATE OR REPLACE FUNCTION pg_temp.v(n int) RETURNS text LANGUAGE sql AS $$ SELECT 'DDV' || lpad(n::text, 14, '0') $$;
CREATE OR REPLACE FUNCTION pg_temp.id(n text) RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM k WHERE name = n $$;
CREATE OR REPLACE FUNCTION pg_temp.listing(p_name text, p_tenant uuid, p_vin text, p_status text, p_owner uuid, p_extra jsonb DEFAULT '{}'::jsonb) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v uuid;
BEGIN
  INSERT INTO vehicle_listings (tenant_id, store_id, vin, slug, ymm, trim, condition, price, status, owning_store_id, feed_source, created_at, published_at, deal_processed_at, archived_at, archive_reason, market_value, market_checked_at)
  VALUES (p_tenant, p_tenant::text, p_vin, lower(p_name) || '-' || lower(right(p_vin, 6)), COALESCE(p_extra->>'ymm', '2025 INFINITI QX60'), COALESCE(p_extra->>'trim', 'LUXE'), 'used',
    (p_extra->>'price')::numeric, p_status, p_owner, COALESCE(p_extra->>'feed_source', 'marketcheck'), COALESCE((p_extra->>'created_at')::timestamptz, now() - interval '30 days'),
    CASE WHEN p_status = 'published' THEN now() - interval '20 days' END, (p_extra->>'deal_processed_at')::timestamptz,
    CASE WHEN p_status = 'archived' THEN now() - interval '10 days' END, CASE WHEN p_status = 'archived' THEN 'left_feed' END,
    (p_extra->>'market_value')::numeric, (p_extra->>'market_checked_at')::timestamptz)
  RETURNING id INTO v;
  INSERT INTO k VALUES (p_name, v, NULL) ON CONFLICT (name) DO UPDATE SET id = EXCLUDED.id;
  RETURN v;
END $$;
CREATE OR REPLACE FUNCTION pg_temp.inv(p_name text, p_store uuid, p_vin text, p_listing uuid, p_price_status text DEFAULT 'known') RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v uuid;
BEGIN
  INSERT INTO store_inventory (store_id, group_id, vin, source_dealer_id, stock_number, condition, year, make, model, mileage, feed_price, feed_price_status, listing_id, first_seen_at)
  VALUES (p_store, (SELECT group_id FROM dealer_stores WHERE id = p_store), p_vin, 'DD1_inventory', 'S' || right(p_vin, 5), 'used', 2025, 'INFINITI', 'QX60', 12000,
    CASE WHEN p_price_status = 'known' THEN 41000 END, p_price_status, p_listing, now() - interval '1 day')
  RETURNING id INTO v;
  PERFORM set_config('app.inventory_writer', 'filescom_apply', true);
  IF p_listing IS NOT NULL THEN UPDATE vehicle_listings SET inventory_record_id = v WHERE id = p_listing; END IF;
  PERFORM set_config('app.inventory_writer', '', true);
  INSERT INTO k VALUES (p_name, v, NULL) ON CONFLICT (name) DO UPDATE SET id = EXCLUDED.id;
  RETURN v;
END $$;
CREATE OR REPLACE FUNCTION pg_temp.snap(p_store uuid, p_map uuid, p_dealer text, p_vins text[], p_tag int) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v_id uuid; i int;
BEGIN
  INSERT INTO inventory_store_snapshots (path, source_dealer_id, store_id, group_id, mapping_id, source_mtime, content_sha256, clean, valid_count, row_count)
  VALUES ('prod/inventory/vauto/inbound/' || p_dealer || '.csv', p_dealer, p_store, '00000000-0000-0000-0000-00000000dd01', p_map, now() + make_interval(mins => p_tag), 'sha-dd-' || p_tag, false,
    cardinality(p_vins), cardinality(p_vins))
  RETURNING id INTO v_id;
  FOR i IN 1 .. cardinality(p_vins) LOOP
    INSERT INTO inventory_snapshot_vehicles (snapshot_id, vin, row_number, stock_number, condition, year, make, model, mileage, feed_price, feed_price_status, photos)
    VALUES (v_id, p_vins[i], i + 1, 'S' || right(p_vins[i], 5), 'used', 2025, 'INFINITI', 'QX60', 12000, 41000 + i, 'known', '[]'::jsonb);
  END LOOP;
  RETURN v_id;
END $$;
CREATE OR REPLACE FUNCTION pg_temp.cand(p_vin text, p_kind text) RETURNS uuid LANGUAGE sql AS $$
  SELECT id FROM inventory_dedupe_candidates WHERE vin = p_vin AND kind = p_kind AND status = 'open' $$;
CREATE OR REPLACE FUNCTION pg_temp.preview(p_vin text, p_kind text) RETURNS jsonb LANGUAGE sql AS $$
  SELECT inv_dedupe_create_preview(pg_temp.cand(p_vin, p_kind)) $$;
CREATE OR REPLACE FUNCTION pg_temp.approved(p_vin text, p_kind text) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE p jsonb; a jsonb;
BEGIN
  p := pg_temp.preview(p_vin, p_kind);
  a := inv_dedupe_approve((p->>'preview_id')::uuid, p->>'plan_sha256');
  IF NOT (a->>'approved')::boolean THEN RAISE EXCEPTION 'approve failed: %', a; END IF;
  RETURN p;
END $$;

SELECT pg_temp.as_user('00000000-0000-0000-0000-00000000ad01');
UPDATE inventory_feed_controls SET ingestion_paused = false, emergency_stop = false WHERE id = 1;
CREATE TEMP TABLE baseline AS SELECT (SELECT count(*) FROM provider_requests) AS provider_requests, (SELECT count(*) FROM store_provider_usage) AS usage,
  (SELECT count(*) FROM provider_call_events) AS call_events;

-- ===================== Phase A: production index present =====================
SELECT pg_temp.expect(EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'uq_vehicle_listings_tenant_vin'), 'phase A runs with the tenant + VIN unique index');
SELECT pg_temp.listing('legacy2', '00000000-0000-0000-0000-0000000000d1', pg_temp.v(2), 'published', NULL);
SELECT pg_temp.listing('sold3', '00000000-0000-0000-0000-0000000000d1', pg_temp.v(3), 'archived', '00000000-0000-0000-0000-0000000005a1', '{"price": 39999}');
INSERT INTO k VALUES ('snapA', pg_temp.snap('00000000-0000-0000-0000-0000000005a1', '00000000-0000-0000-0000-0000000006a1', 'DD1_inventory', ARRAY[pg_temp.v(1), pg_temp.v(2), pg_temp.v(3), pg_temp.v(4)], 1), NULL);
UPDATE k SET j = inventory_apply_store_snapshot(id) WHERE name = 'snapA';
SELECT pg_temp.expect((SELECT (j->>'listings_created')::int = 2 AND (j->>'conflicts')::int = 2 FROM k WHERE name = 'snapA'), 'import creates drafts for new VINs and holds the legacy and archived matches as conflicts');
SELECT pg_temp.expect((SELECT status = 'archived' AND price = 39999 AND inventory_record_id IS NULL FROM vehicle_listings WHERE id = pg_temp.id('sold3')), 'an archived listing is not adopted, updated or linked by the import');
SELECT pg_temp.expect(EXISTS (SELECT 1 FROM inventory_vin_conflicts WHERE vin = pg_temp.v(3) AND kind = 'archived_listing' AND status = 'open'), 'the archived match is recorded as an archived_listing conflict');
SELECT pg_temp.expect((SELECT listing_id IS NULL FROM store_inventory WHERE vin = pg_temp.v(3)), 'the returning car keeps its own inventory episode, unlinked');

-- Link candidate: an unlinked feed row and a listing owned by the same store.
SELECT pg_temp.listing('own5', '00000000-0000-0000-0000-0000000000d1', pg_temp.v(5), 'published', '00000000-0000-0000-0000-0000000005a1');
SELECT pg_temp.inv('inv5', '00000000-0000-0000-0000-0000000005a1', pg_temp.v(5), NULL);
-- Cross-tenant: VIN 4 is also live in another tenant.
SELECT pg_temp.listing('other4', '00000000-0000-0000-0000-0000000000d2', pg_temp.v(4), 'published', NULL);

SELECT pg_temp.as_user('00000000-0000-0000-0000-00000000aa99');
SELECT pg_temp.raises($$SELECT inv_dedupe_scan('00000000-0000-0000-0000-00000000dd01')$$, 'platform_admin_required', 'a store owner cannot run detection');
SELECT pg_temp.as_user('00000000-0000-0000-0000-00000000ad01');
SELECT inv_dedupe_scan('00000000-0000-0000-0000-00000000dd01');
SELECT pg_temp.expect((SELECT count(*) FROM inventory_dedupe_candidates WHERE group_id = '00000000-0000-0000-0000-00000000dd01' AND kind = 'duplicate_listings') = 0, 'with the index present there are no duplicate listing sets');
SELECT pg_temp.expect((SELECT disposition = 'needs_review' AND 'legacy_listing_ownership_unverified' = ANY (reasons) FROM inventory_dedupe_candidates WHERE id = pg_temp.cand(pg_temp.v(2), 'unlinked_inventory')), 'a legacy listing is never linked automatically');
SELECT pg_temp.expect((SELECT disposition = 'needs_review' FROM inventory_dedupe_candidates WHERE id = pg_temp.cand(pg_temp.v(3), 'archived_episode')), 'an archived listing for live stock is held for review');
SELECT pg_temp.expect((SELECT disposition = 'blocked' FROM inventory_dedupe_candidates WHERE id = pg_temp.cand(pg_temp.v(4), 'cross_tenant')), 'the same VIN in another tenant is blocked');
SELECT pg_temp.expect((SELECT disposition = 'eligible' FROM inventory_dedupe_candidates WHERE id = pg_temp.cand(pg_temp.v(5), 'unlinked_inventory')), 'an unlinked feed row with a same-store listing is eligible to link');

-- Blocked candidates can be previewed but not approved.
INSERT INTO k VALUES ('p4', NULL, pg_temp.preview(pg_temp.v(4), 'cross_tenant'));
SELECT pg_temp.raises(format('SELECT inv_dedupe_approve(%L, %L)', (SELECT j->>'preview_id' FROM k WHERE name = 'p4'), (SELECT j->>'plan_sha256' FROM k WHERE name = 'p4')), 'preview_not_eligible', 'a cross-tenant preview cannot be approved');
SELECT pg_temp.raises(format('SELECT inv_dedupe_approve(%L, %L)', (SELECT j->>'preview_id' FROM k WHERE name = 'p4'), 'deadbeef'), 'preview_hash_mismatch', 'approval names the exact preview hash');
SELECT pg_temp.raises(format('UPDATE inventory_dedupe_previews SET plan = %L WHERE id = %L', '{}', (SELECT j->>'preview_id' FROM k WHERE name = 'p4')), 'preview_immutable', 'a preview cannot be edited');

-- Link apply and version-aware undo.
INSERT INTO k VALUES ('p5', NULL, pg_temp.approved(pg_temp.v(5), 'unlinked_inventory'));
SELECT pg_temp.expect((SELECT (j->'plan'->>'provider_calls')::int = 0 AND (j->'plan'->'expected_counts'->>'rows_deleted')::int = 0 FROM k WHERE name = 'p5'), 'the preview promises no provider calls and no deletions');
UPDATE k SET j = j || jsonb_build_object('apply', inv_dedupe_apply((j->>'preview_id')::uuid, 'test-link-0005')) WHERE name = 'p5';
SELECT pg_temp.expect((SELECT (j->'apply'->>'applied')::boolean FROM k WHERE name = 'p5'), 'the link applies');
SELECT pg_temp.expect((SELECT si.listing_id = l.id AND l.inventory_record_id = si.id FROM store_inventory si JOIN vehicle_listings l ON l.id = pg_temp.id('own5') WHERE si.id = pg_temp.id('inv5')), 'inventory and listing link in both directions');
INSERT INTO k VALUES ('u5', NULL, inv_dedupe_recovery_plan((SELECT (j->'apply'->>'operation_id')::uuid FROM k WHERE name = 'p5')));
SELECT pg_temp.expect((SELECT (j->>'reversible')::boolean FROM k WHERE name = 'u5'), 'an unchanged link is reversible');
SELECT inv_dedupe_undo((SELECT (j->'apply'->>'operation_id')::uuid FROM k WHERE name = 'p5'), (SELECT j->>'plan_sha256' FROM k WHERE name = 'u5'), 'test-undo-0005');
SELECT pg_temp.expect((SELECT si.listing_id IS NULL AND l.inventory_record_id IS NULL FROM store_inventory si, vehicle_listings l WHERE si.id = pg_temp.id('inv5') AND l.id = pg_temp.id('own5')), 'undo restores the prior links');
SELECT pg_temp.expect((SELECT (inv_dedupe_undo((SELECT (j->'apply'->>'operation_id')::uuid FROM k WHERE name = 'p5'), (SELECT j->>'plan_sha256' FROM k WHERE name = 'u5'), 'test-undo-0005')->>'replayed')::boolean), 'repeating an undo with the same key replays its result');

-- ===================== Phase B: index absent =====================
DROP INDEX uq_vehicle_listings_tenant_vin;

-- B1: enriched established listing plus an import-created duplicate.
SELECT pg_temp.listing('est6', '00000000-0000-0000-0000-0000000000d1', pg_temp.v(6), 'published', '00000000-0000-0000-0000-0000000005a1', '{"price": 0, "market_value": 40500, "market_checked_at": "2026-09-01T00:00:00Z"}');
SELECT pg_temp.listing('imp6', '00000000-0000-0000-0000-0000000000d1', pg_temp.v(6), 'draft', '00000000-0000-0000-0000-0000000005a1', jsonb_build_object('feed_source', 'filescom', 'created_at', now()));
SELECT pg_temp.inv('inv6', '00000000-0000-0000-0000-0000000005a1', pg_temp.v(6), pg_temp.id('imp6'), 'zero');
INSERT INTO vehicle_facts (tenant_id, vin, vehicle_id) SELECT '00000000-0000-0000-0000-0000000000d1', pg_temp.v(6), pg_temp.id('est6') FROM generate_series(1, 5);
INSERT INTO vehicle_source_records (tenant_id, vin, vehicle_id) VALUES ('00000000-0000-0000-0000-0000000000d1', pg_temp.v(6), pg_temp.id('est6'));
INSERT INTO neovin_snapshots (tenant_id, vin, vehicle_id) VALUES ('00000000-0000-0000-0000-0000000000d1', pg_temp.v(6), pg_temp.id('est6'));
INSERT INTO qr_codes (tenant_id, vehicle_id) VALUES ('00000000-0000-0000-0000-0000000000d1', pg_temp.id('est6'));
INSERT INTO addendum_signings (tenant_id, vin, vehicle_listing_id) VALUES ('00000000-0000-0000-0000-0000000000d1', pg_temp.v(6), pg_temp.id('est6'));
INSERT INTO vehicle_documents (tenant_id, vin, vehicle_listing_id) VALUES ('00000000-0000-0000-0000-0000000000d1', pg_temp.v(6), pg_temp.id('est6'));
INSERT INTO passport_engagement (tenant_id, vin, slug, seconds) SELECT '00000000-0000-0000-0000-0000000000d1', pg_temp.v(6), slug, 40 FROM vehicle_listings WHERE id = pg_temp.id('est6');
INSERT INTO signed_document_archive (tenant_id, vin, storage_path, content_hash) VALUES ('00000000-0000-0000-0000-0000000000d1', pg_temp.v(6), 'signed/abc.pdf', 'h1');
INSERT INTO leads (tenant_id, vehicle_vin, source, status, name) VALUES ('00000000-0000-0000-0000-0000000000d1', pg_temp.v(6), 'website', 'new', 'Test Shopper');
CREATE TEMP TABLE before6 AS SELECT (SELECT count(*) FROM vehicle_facts WHERE vehicle_id = pg_temp.id('est6')) facts, (SELECT count(*) FROM qr_codes WHERE vehicle_id = pg_temp.id('est6')) qr,
  (SELECT count(*) FROM signed_document_archive) sda, (SELECT count(*) FROM leads WHERE vehicle_vin = pg_temp.v(6)) leads,
  (SELECT slug FROM vehicle_listings WHERE id = pg_temp.id('est6')) slug, (SELECT price FROM vehicle_listings WHERE id = pg_temp.id('est6')) price;

SELECT inv_dedupe_scan('00000000-0000-0000-0000-00000000dd01');
SELECT pg_temp.expect((SELECT disposition = 'eligible' FROM inventory_dedupe_candidates WHERE id = pg_temp.cand(pg_temp.v(6), 'duplicate_listings')), 'an enriched listing plus an empty import duplicate is eligible');
INSERT INTO k VALUES ('p6', NULL, pg_temp.approved(pg_temp.v(6), 'duplicate_listings'));
SELECT pg_temp.expect((SELECT (j->'plan'->>'canonical_listing_id')::uuid = pg_temp.id('est6') FROM k WHERE name = 'p6'), 'the established listing with public identity is kept, though the import row is newer and linked');
SELECT pg_temp.expect((SELECT EXISTS (SELECT 1 FROM jsonb_array_elements(j->'plan'->'decisions') d WHERE d->>'verb' = 'ARCHIVE' AND (d->>'id')::uuid = pg_temp.id('imp6'))
   AND EXISTS (SELECT 1 FROM jsonb_array_elements(j->'plan'->'decisions') d WHERE d->>'verb' = 'LINK') FROM k WHERE name = 'p6'), 'the preview names KEEP, LINK and ARCHIVE per record');
SELECT pg_temp.expect((SELECT d->>'feed_price' = 'zero in feed' FROM k, jsonb_array_elements(j->'plan'->'domains') d WHERE name = 'p6' AND d->>'domain' = 'feed_fields'), 'a zero feed price is reported as zero, not missing');
SELECT pg_temp.expect((SELECT d->>'freshness' = 'stale' FROM k, jsonb_array_elements(j->'plan'->'domains') d WHERE name = 'p6' AND d->>'domain' = 'market_value'), 'an old market value keeps its date and is labelled stale');
UPDATE k SET j = j || jsonb_build_object('apply', inv_dedupe_apply((j->>'preview_id')::uuid, 'test-dup-0006')) WHERE name = 'p6';
SELECT pg_temp.expect((SELECT (j->'apply'->>'applied')::boolean AND (j->'apply'->>'rows_deleted')::int = 0 FROM k WHERE name = 'p6'), 'the duplicate set is reconciled with no deletions');
SELECT pg_temp.expect((SELECT status = 'archived' AND archive_reason = 'duplicate_reconciled' AND reconciled_into_listing_id = pg_temp.id('est6') AND reconciliation_operation_id IS NOT NULL AND archived_at IS NOT NULL
   FROM vehicle_listings WHERE id = pg_temp.id('imp6')), 'the redundant listing is archived with its replacement, operation and time');
SELECT pg_temp.expect((SELECT si.listing_id = pg_temp.id('est6') AND l.inventory_record_id = si.id FROM store_inventory si JOIN vehicle_listings l ON l.id = pg_temp.id('est6') WHERE si.id = pg_temp.id('inv6')), 'the feed row now links to the kept listing in both directions');
SELECT pg_temp.expect(EXISTS (SELECT 1 FROM vehicle_listing_aliases WHERE alias_listing_id = pg_temp.id('imp6') AND canonical_listing_id = pg_temp.id('est6') AND retired_at IS NULL), 'a durable alias records the reconciled id');
SELECT pg_temp.expect((SELECT b.facts = (SELECT count(*) FROM vehicle_facts WHERE vehicle_id = pg_temp.id('est6')) AND b.qr = (SELECT count(*) FROM qr_codes WHERE vehicle_id = pg_temp.id('est6'))
   AND b.sda = (SELECT count(*) FROM signed_document_archive) AND b.leads = (SELECT count(*) FROM leads WHERE vehicle_vin = pg_temp.v(6)) FROM before6 b), 'facts, QR codes, signed documents and leads are untouched');
SELECT pg_temp.expect((SELECT b.slug = l.slug AND l.status = 'published' AND l.price = b.price FROM before6 b, vehicle_listings l WHERE l.id = pg_temp.id('est6')), 'the kept listing keeps its slug, status and price (zero stays zero)');
SELECT pg_temp.expect((SELECT (customer_origin_context(b.slug)->>'listing_id')::uuid = pg_temp.id('est6') FROM before6 b), 'the Passport read path still resolves the original slug to the kept listing');
SELECT pg_temp.expect((SELECT count(*) FROM vehicle_documents WHERE vehicle_listing_id = pg_temp.id('est6')) = 1 AND (SELECT count(*) FROM addendum_signings WHERE vehicle_listing_id = pg_temp.id('est6')) = 1, 'documents and signings still read from the kept listing');
SELECT pg_temp.expect((SELECT count(*) FROM vehicle_listings WHERE tenant_id = '00000000-0000-0000-0000-0000000000d1' AND vin = pg_temp.v(6) AND status <> 'archived') = 1, 'one canonical active listing remains');

-- B2: retry after an ambiguous timeout.
SELECT pg_temp.expect((SELECT (inv_dedupe_apply((j->>'preview_id')::uuid, 'test-dup-0006')->>'replayed')::boolean FROM k WHERE name = 'p6'), 'a retry with the same key returns the stored result');
SELECT pg_temp.expect((SELECT inv_dedupe_apply((j->>'preview_id')::uuid, 'test-dup-0006-other')->>'reason' = 'preview_already_applied' FROM k WHERE name = 'p6'), 'a new key cannot apply the same preview twice');
SELECT pg_temp.expect((SELECT count(*) FROM inventory_dedupe_operations WHERE preview_id = (SELECT (j->>'preview_id')::uuid FROM k WHERE name = 'p6') AND status = 'applied') = 1, 'exactly one applied operation exists');

-- B3: an archived duplicate cannot be republished.
SELECT pg_temp.raises(format('UPDATE vehicle_listings SET status = %L WHERE id = %L', 'published', pg_temp.id('imp6')), 'listing_reconciled_archived', 'a reconciled duplicate cannot be republished');

-- B4: a reimport resolves to the canonical listing and recreates nothing.
INSERT INTO k VALUES ('snapB', pg_temp.snap('00000000-0000-0000-0000-0000000005a1', '00000000-0000-0000-0000-0000000006a1', 'DD1_inventory', ARRAY[pg_temp.v(1), pg_temp.v(2), pg_temp.v(3), pg_temp.v(4), pg_temp.v(6)], 2), NULL);
UPDATE k SET j = inventory_apply_store_snapshot(id) WHERE name = 'snapB';
SELECT pg_temp.expect((SELECT (j->>'listings_created')::int = 0 FROM k WHERE name = 'snapB'), 'the reimport creates no listing');
SELECT pg_temp.expect((SELECT status = 'archived' FROM vehicle_listings WHERE id = pg_temp.id('imp6')) AND (SELECT listing_id = pg_temp.id('est6') FROM store_inventory WHERE id = pg_temp.id('inv6')), 'the reimport keeps the duplicate archived and the link canonical');
SELECT pg_temp.expect((SELECT count(*) FROM vehicle_listings WHERE vin = pg_temp.v(6)) = 2, 'no third listing appears for the VIN');

-- B4b: a reconciled listing whose alias chain is broken is held, never recreated.
SELECT pg_temp.listing('brk40', '00000000-0000-0000-0000-0000000000d1', pg_temp.v(40), 'archived', '00000000-0000-0000-0000-0000000005a1');
SELECT set_config('app.inventory_writer', 'inventory_reconcile', false);
UPDATE vehicle_listings SET reconciled_into_listing_id = pg_temp.id('est6'), archive_reason = 'duplicate_reconciled' WHERE id = pg_temp.id('brk40');
SELECT set_config('app.inventory_writer', '', false);
INSERT INTO k VALUES ('snapBrk', pg_temp.snap('00000000-0000-0000-0000-0000000005a1', '00000000-0000-0000-0000-0000000006a1', 'DD1_inventory', ARRAY[pg_temp.v(40)], 3), NULL);
UPDATE k SET j = inventory_apply_store_snapshot(id) WHERE name = 'snapBrk';
SELECT pg_temp.expect((SELECT (j->>'listings_created')::int = 0 AND (j->>'listings_updated')::int = 0 FROM k WHERE name = 'snapBrk'), 'a broken alias chain creates and updates no listing');
SELECT pg_temp.expect(EXISTS (SELECT 1 FROM inventory_vin_conflicts WHERE vin = pg_temp.v(40) AND kind = 'reconciled_listing_unresolved' AND existing_listing_id = pg_temp.id('brk40') AND status = 'open'), 'a broken alias chain is recorded as an unresolved reconciled-listing conflict');
SELECT pg_temp.expect((SELECT count(*) FROM vehicle_listings WHERE vin = pg_temp.v(40)) = 1 AND (SELECT status = 'archived' FROM vehicle_listings WHERE id = pg_temp.id('brk40')), 'the reconciled listing stays archived and no duplicate appears');

-- B5: stale preview.
SELECT pg_temp.listing('est7', '00000000-0000-0000-0000-0000000000d1', pg_temp.v(7), 'published', '00000000-0000-0000-0000-0000000005a1');
SELECT pg_temp.listing('imp7', '00000000-0000-0000-0000-0000000000d1', pg_temp.v(7), 'draft', '00000000-0000-0000-0000-0000000005a1', jsonb_build_object('feed_source', 'filescom', 'created_at', now()));
SELECT pg_temp.inv('inv7', '00000000-0000-0000-0000-0000000005a1', pg_temp.v(7), pg_temp.id('imp7'));
SELECT inv_dedupe_scan('00000000-0000-0000-0000-00000000dd01');
INSERT INTO k VALUES ('p7', NULL, pg_temp.approved(pg_temp.v(7), 'duplicate_listings'));
UPDATE vehicle_listings SET price = 38500 WHERE id = pg_temp.id('est7');
SELECT pg_temp.expect((SELECT inv_dedupe_apply((j->>'preview_id')::uuid, 'test-stale-0007')->>'reason' = 'preview_stale' FROM k WHERE name = 'p7'), 'a pricing change after approval rejects the preview');
SELECT pg_temp.expect((SELECT status = 'invalidated' FROM inventory_dedupe_previews WHERE id = (SELECT (j->>'preview_id')::uuid FROM k WHERE name = 'p7')), 'the stale preview is invalidated');
SELECT pg_temp.expect((SELECT status = 'draft' AND reconciled_into_listing_id IS NULL FROM vehicle_listings WHERE id = pg_temp.id('imp7')), 'nothing changed for the stale preview');
INSERT INTO passport_engagement (tenant_id, vin, slug, seconds) SELECT tenant_id, vin, slug, 5 FROM vehicle_listings WHERE id = pg_temp.id('est7');
SELECT inv_dedupe_scan('00000000-0000-0000-0000-00000000dd01');
INSERT INTO k VALUES ('p7b', NULL, pg_temp.approved(pg_temp.v(7), 'duplicate_listings'));
INSERT INTO passport_engagement (tenant_id, vin, slug, seconds) SELECT tenant_id, vin, slug, 9 FROM vehicle_listings WHERE id = pg_temp.id('est7');
SELECT pg_temp.expect((SELECT inv_dedupe_apply((j->>'preview_id')::uuid, 'test-stale-0007b')->>'reason' = 'preview_stale' FROM k WHERE name = 'p7b'), 'new customer activity after approval rejects the preview');

-- B6: conflicting enrichment and trims are held for review.
SELECT pg_temp.listing('est8', '00000000-0000-0000-0000-0000000000d1', pg_temp.v(8), 'published', '00000000-0000-0000-0000-0000000005a1', '{"trim": "LUXE"}');
SELECT pg_temp.listing('imp8', '00000000-0000-0000-0000-0000000000d1', pg_temp.v(8), 'draft', '00000000-0000-0000-0000-0000000005a1', jsonb_build_object('feed_source', 'filescom', 'created_at', now(), 'trim', 'AUTOGRAPH'));
SELECT pg_temp.inv('inv8', '00000000-0000-0000-0000-0000000005a1', pg_temp.v(8), pg_temp.id('imp8'));
INSERT INTO vehicle_source_records (tenant_id, vin, vehicle_id) VALUES ('00000000-0000-0000-0000-0000000000d1', pg_temp.v(8), pg_temp.id('imp8'));
-- B7: two legacy listings with no verified owner.
SELECT pg_temp.listing('leg9a', '00000000-0000-0000-0000-0000000000d1', pg_temp.v(9), 'published', NULL);
SELECT pg_temp.listing('leg9b', '00000000-0000-0000-0000-0000000000d1', pg_temp.v(9), 'draft', NULL, jsonb_build_object('created_at', now()));
SELECT pg_temp.inv('inv9', '00000000-0000-0000-0000-0000000005a1', pg_temp.v(9), NULL);
-- B8: both records have independent public activity.
SELECT pg_temp.listing('est10', '00000000-0000-0000-0000-0000000000d1', pg_temp.v(10), 'published', '00000000-0000-0000-0000-0000000005a1');
SELECT pg_temp.listing('imp10', '00000000-0000-0000-0000-0000000000d1', pg_temp.v(10), 'draft', '00000000-0000-0000-0000-0000000005a1', jsonb_build_object('feed_source', 'filescom', 'created_at', now()));
SELECT pg_temp.inv('inv10', '00000000-0000-0000-0000-0000000005a1', pg_temp.v(10), pg_temp.id('imp10'));
INSERT INTO qr_codes (tenant_id, vehicle_id) VALUES ('00000000-0000-0000-0000-0000000000d1', pg_temp.id('imp10'));
-- B17: a listing owned by a sibling store.
SELECT pg_temp.listing('est16', '00000000-0000-0000-0000-0000000000d1', pg_temp.v(16), 'published', '00000000-0000-0000-0000-0000000005a2');
SELECT pg_temp.listing('imp16', '00000000-0000-0000-0000-0000000000d1', pg_temp.v(16), 'draft', '00000000-0000-0000-0000-0000000005a1', jsonb_build_object('feed_source', 'filescom', 'created_at', now()));
SELECT pg_temp.inv('inv16', '00000000-0000-0000-0000-0000000005a1', pg_temp.v(16), pg_temp.id('imp16'));
-- B18: one listing went through a deal (earlier episode).
SELECT pg_temp.listing('est17', '00000000-0000-0000-0000-0000000000d1', pg_temp.v(17), 'published', '00000000-0000-0000-0000-0000000005a1', '{"deal_processed_at": "2026-05-01T00:00:00Z"}');
SELECT pg_temp.listing('imp17', '00000000-0000-0000-0000-0000000000d1', pg_temp.v(17), 'draft', '00000000-0000-0000-0000-0000000005a1', jsonb_build_object('feed_source', 'filescom', 'created_at', now()));
SELECT pg_temp.inv('inv17', '00000000-0000-0000-0000-0000000005a1', pg_temp.v(17), pg_temp.id('imp17'));
SELECT inv_dedupe_scan('00000000-0000-0000-0000-00000000dd01');
SELECT pg_temp.expect((SELECT disposition = 'needs_review' AND reasons @> ARRAY['enrichment_only_on_redundant','field_conflict'] FROM inventory_dedupe_candidates WHERE id = pg_temp.cand(pg_temp.v(8), 'duplicate_listings')), 'unique enrichment and a trim conflict are held for review');
SELECT pg_temp.expect((SELECT disposition = 'needs_review' AND 'legacy_listing_ownership_unverified' = ANY (reasons) FROM inventory_dedupe_candidates WHERE id = pg_temp.cand(pg_temp.v(9), 'duplicate_listings')), 'ambiguous legacy ownership is held for review');
SELECT pg_temp.expect((SELECT disposition = 'needs_review' AND 'redundant_has_public_identity' = ANY (reasons) FROM inventory_dedupe_candidates WHERE id = pg_temp.cand(pg_temp.v(10), 'duplicate_listings')), 'independent activity on both records needs manual review');
SELECT pg_temp.expect((SELECT disposition = 'blocked' AND 'listing_owned_by_other_store' = ANY (reasons) FROM inventory_dedupe_candidates WHERE id = pg_temp.cand(pg_temp.v(16), 'duplicate_listings')), 'a listing owned by a sibling store blocks reconciliation (transfer, not duplicate)');
SELECT pg_temp.expect((SELECT disposition = 'needs_review' AND 'prior_episode_deal_recorded' = ANY (reasons) FROM inventory_dedupe_candidates WHERE id = pg_temp.cand(pg_temp.v(17), 'duplicate_listings')), 'a listing with a recorded deal is not merged into current stock');
INSERT INTO k VALUES ('p9', NULL, pg_temp.preview(pg_temp.v(9), 'duplicate_listings'));
SELECT pg_temp.raises(format('SELECT inv_dedupe_approve(%L, %L)', (SELECT j->>'preview_id' FROM k WHERE name = 'p9'), (SELECT j->>'plan_sha256' FROM k WHERE name = 'p9')), 'preview_not_eligible', 'a needs-review preview cannot be approved');
SELECT pg_temp.expect((SELECT bool_and(d->>'verb' <> 'ARCHIVE') AND bool_or(d->>'verb' = 'BLOCKED') FROM k, jsonb_array_elements(j->'plan'->'decisions') d WHERE name = 'p9'), 'a held set shows BLOCKED, never ARCHIVE');

-- B19: an unreadable dependency blocks.
ALTER TABLE qr_codes RENAME TO qr_codes_hidden;
SELECT pg_temp.expect((SELECT inv_dedupe_build_plan('00000000-0000-0000-0000-00000000dd01', pg_temp.v(7), 'duplicate_listings')->>'disposition' = 'blocked'), 'an unchecked dependency blocks automatic reconciliation');
ALTER TABLE qr_codes_hidden RENAME TO qr_codes;

-- B9: mid-batch failure, rollback of that set, and resume.
DO $$ DECLARE i int; BEGIN
  FOR i IN 11..15 LOOP
    PERFORM pg_temp.listing('est' || i, '00000000-0000-0000-0000-0000000000d1', pg_temp.v(i), 'published', '00000000-0000-0000-0000-0000000005a1');
    PERFORM pg_temp.listing('imp' || i, '00000000-0000-0000-0000-0000000000d1', pg_temp.v(i), 'draft', '00000000-0000-0000-0000-0000000005a1', jsonb_build_object('feed_source', 'filescom', 'created_at', now()));
    PERFORM pg_temp.inv('inv' || i, '00000000-0000-0000-0000-0000000005a1', pg_temp.v(i), pg_temp.id('imp' || i));
  END LOOP;
END $$;
SELECT inv_dedupe_scan('00000000-0000-0000-0000-00000000dd01');
INSERT INTO k SELECT 'p' || i, NULL, pg_temp.approved(pg_temp.v(i), 'duplicate_listings') FROM generate_series(11, 15) i;
CREATE OR REPLACE FUNCTION pg_temp.fail_trigger() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN IF NEW.vin = 'DDV00000000000012' AND NEW.status = 'archived' THEN RAISE EXCEPTION 'simulated failure'; END IF; RETURN NEW; END $$;
CREATE TRIGGER zz_fail AFTER UPDATE ON vehicle_listings FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_trigger();
INSERT INTO k VALUES ('b1', inv_dedupe_batch_create('00000000-0000-0000-0000-00000000dd01', ARRAY[(SELECT (j->>'preview_id')::uuid FROM k WHERE name = 'p11'), (SELECT (j->>'preview_id')::uuid FROM k WHERE name = 'p12'), (SELECT (j->>'preview_id')::uuid FROM k WHERE name = 'p13')]), NULL);
SELECT inv_dedupe_batch_step(pg_temp.id('b1'));
SELECT inv_dedupe_batch_step(pg_temp.id('b1'));
SELECT inv_dedupe_batch_step(pg_temp.id('b1'));
UPDATE k SET j = inv_dedupe_batch_step(id) WHERE name = 'b1';
SELECT pg_temp.expect((SELECT j->>'status' = 'completed_with_failures' AND (j->>'applied')::int = 2 AND (j->>'failed')::int = 1 FROM k WHERE name = 'b1'), 'the batch reports two applied and one failed, not a whole-batch rollback');
SELECT pg_temp.expect((SELECT status = 'draft' AND reconciled_into_listing_id IS NULL FROM vehicle_listings WHERE id = pg_temp.id('imp12'))
  AND NOT EXISTS (SELECT 1 FROM vehicle_listing_aliases WHERE alias_listing_id = pg_temp.id('imp12'))
  AND NOT EXISTS (SELECT 1 FROM inventory_dedupe_operations WHERE preview_id = (SELECT (j->>'preview_id')::uuid FROM k WHERE name = 'p12')), 'the failed set rolled back completely');
SELECT pg_temp.expect((SELECT status = 'archived' FROM vehicle_listings WHERE id = pg_temp.id('imp11')) AND (SELECT status = 'archived' FROM vehicle_listings WHERE id = pg_temp.id('imp13')), 'sets committed before and after the failure stay committed');
DROP TRIGGER zz_fail ON vehicle_listings;
SELECT inv_dedupe_batch_resume(pg_temp.id('b1'));
SELECT inv_dedupe_batch_step(pg_temp.id('b1'));
UPDATE k SET j = inv_dedupe_batch_step(id) WHERE name = 'b1';
SELECT pg_temp.expect((SELECT j->>'status' = 'completed' AND (j->>'applied')::int = 3 FROM k WHERE name = 'b1'), 'resume applies the failed set and skips the committed ones');
SELECT pg_temp.expect((SELECT count(*) FROM inventory_dedupe_operations WHERE batch_id = pg_temp.id('b1') AND status = 'applied') = 3, 'each set was applied exactly once');

-- B10: emergency stop between sets.
INSERT INTO k VALUES ('b2', inv_dedupe_batch_create('00000000-0000-0000-0000-00000000dd01', ARRAY[(SELECT (j->>'preview_id')::uuid FROM k WHERE name = 'p14'), (SELECT (j->>'preview_id')::uuid FROM k WHERE name = 'p15')]), NULL);
SELECT inv_dedupe_batch_step(pg_temp.id('b2'));
SELECT inv_dedupe_set_controls('{"emergency_stop": true, "reason": "test stop"}');
UPDATE k SET j = inv_dedupe_batch_step(id) WHERE name = 'b2';
SELECT pg_temp.expect((SELECT j->>'status' = 'stopped' AND j->>'stop_reason' = 'emergency_stop' AND (j->>'applied')::int = 1 AND (j->>'pending')::int = 1 FROM k WHERE name = 'b2'), 'the emergency stop halts the batch before the next set');
SELECT pg_temp.expect((SELECT status = 'draft' FROM vehicle_listings WHERE id = pg_temp.id('imp15')), 'no set runs after the stop');
SELECT pg_temp.expect((SELECT inv_dedupe_apply((j->>'preview_id')::uuid, 'test-direct-0015')->>'reason' = 'emergency_stop' FROM k WHERE name = 'p15'), 'a direct apply is refused during the stop');
SELECT inv_dedupe_set_controls('{"emergency_stop": false, "reason": "test clear"}');
SELECT inv_dedupe_set_store_pause('00000000-0000-0000-0000-0000000005a1', true, 'per-store pause test');
SELECT inv_dedupe_batch_resume(pg_temp.id('b2'));
UPDATE k SET j = inv_dedupe_batch_step(id) WHERE name = 'b2';
SELECT pg_temp.expect((SELECT j->>'stop_reason' = 'store_paused' FROM k WHERE name = 'b2'), 'a per-store pause also stops the batch');
SELECT inv_dedupe_set_store_pause('00000000-0000-0000-0000-0000000005a1', false, 'per-store pause cleared');
SELECT inv_dedupe_batch_resume(pg_temp.id('b2'));
SELECT inv_dedupe_batch_step(pg_temp.id('b2'));
UPDATE k SET j = inv_dedupe_batch_step(id) WHERE name = 'b2';
SELECT pg_temp.expect((SELECT j->>'status' = 'completed' AND (j->>'applied')::int = 2 FROM k WHERE name = 'b2'), 'the batch resumes and completes after the stop is cleared');

-- B11: undo is version-aware.
INSERT INTO k VALUES ('op14', (SELECT applied_operation_id FROM inventory_dedupe_previews WHERE id = (SELECT (j->>'preview_id')::uuid FROM k WHERE name = 'p14')), NULL);
INSERT INTO k VALUES ('op15', (SELECT applied_operation_id FROM inventory_dedupe_previews WHERE id = (SELECT (j->>'preview_id')::uuid FROM k WHERE name = 'p15')), NULL);
UPDATE k SET j = inv_dedupe_recovery_plan(id) WHERE name = 'op14';
SELECT inv_dedupe_undo(pg_temp.id('op14'), (SELECT j->>'plan_sha256' FROM k WHERE name = 'op14'), 'test-undo-0014');
SELECT pg_temp.expect((SELECT status = 'draft' AND reconciled_into_listing_id IS NULL AND inventory_record_id = pg_temp.id('inv14') FROM vehicle_listings WHERE id = pg_temp.id('imp14'))
  AND (SELECT listing_id = pg_temp.id('imp14') FROM store_inventory WHERE id = pg_temp.id('inv14')), 'undo of an unchanged set restores the prior state');
SELECT pg_temp.expect((SELECT retired_at IS NOT NULL FROM vehicle_listing_aliases WHERE alias_listing_id = pg_temp.id('imp14')), 'the alias is retired, not deleted');
UPDATE vehicle_listings SET price = 37000 WHERE id = pg_temp.id('est15');
UPDATE k SET j = inv_dedupe_recovery_plan(id) WHERE name = 'op15';
SELECT pg_temp.expect((SELECT NOT (j->>'reversible')::boolean AND j->'changed_since'->0->'changed_fields' @> '["price"]' FROM k WHERE name = 'op15'), 'a later edit makes undo produce a reviewed recovery plan naming the change');
SELECT pg_temp.expect((SELECT inv_dedupe_undo(pg_temp.id('op15'), (SELECT j->>'plan_sha256' FROM k WHERE name = 'op15'), 'test-undo-0015')->>'undone' = 'false'), 'undo refuses to overwrite the later edit');
SELECT pg_temp.expect((SELECT price = 37000 FROM vehicle_listings WHERE id = pg_temp.id('est15')) AND (SELECT status = 'archived' FROM vehicle_listings WHERE id = pg_temp.id('imp15')), 'the later edit and the archive both stand');

-- B12-14: purge stays off and refuses protected records.
SELECT pg_temp.expect((SELECT NOT (r->>'eligible')::boolean AND r->'reasons' @> '["purge_disabled","no_approved_retention_policy","alias_tombstone_required"]' FROM (SELECT inv_dedupe_purge_check(pg_temp.id('imp6')) r) x), 'a reconciled duplicate is not purge eligible');
SELECT pg_temp.expect((SELECT r->'reasons' @> '["protected_history","source_evidence"]' FROM (SELECT inv_dedupe_purge_check(pg_temp.id('est6')) r) x), 'purge refuses records with protected history and evidence');
SELECT pg_temp.raises($$UPDATE inventory_dedupe_controls SET purge_enabled = true WHERE id = 1$$, 'check constraint', 'permanent purge cannot be switched on');
SELECT pg_temp.raises($$SELECT inv_dedupe_set_controls('{"auto_reconcile_enabled": true, "reason": "try"}')$$, 'inventory_dedupe_auto_needs_limits', 'automatic reconciliation needs owner-approved limits');

-- B15-16: no provider calls, no storage operations, no deletes.
SELECT pg_temp.expect((SELECT b.provider_requests = (SELECT count(*) FROM provider_requests) AND b.usage = (SELECT count(*) FROM store_provider_usage) AND b.call_events = (SELECT count(*) FROM provider_call_events) FROM baseline b), 'reconciliation made no provider calls');
SELECT pg_temp.expect((SELECT count(*) FROM pg_proc WHERE proname LIKE 'inv_dedupe%' AND (prosrc ~* '\mdelete\s+from' OR prosrc ~* 'storage\.')) = 0, 'no reconciliation function deletes rows or touches storage');
SELECT pg_temp.expect((SELECT count(*) FROM signed_document_archive) = (SELECT sda FROM before6), 'stored document records are unchanged');

-- Read model.
SELECT pg_temp.expect((SELECT jsonb_array_length(inv_dedupe_overview('00000000-0000-0000-0000-00000000dd01')->'candidates') > 0), 'the overview lists open candidates');
SELECT pg_temp.expect((SELECT bool_and(length(c->>'vin_suffix') = 6) FROM jsonb_array_elements(inv_dedupe_overview('00000000-0000-0000-0000-00000000dd01')->'candidates') c), 'lists carry only the VIN suffix');
SELECT pg_temp.expect((SELECT (inv_dedupe_get_preview((j->>'preview_id')::uuid)->'plan'->>'vin') IS NULL FROM k WHERE name = 'p6'), 'the preview screen gets no full VIN');
SELECT pg_temp.expect((SELECT inv_dedupe_reveal_vin(pg_temp.cand(pg_temp.v(8), 'duplicate_listings')) = pg_temp.v(8)), 'a platform admin can reveal the full VIN');
SELECT pg_temp.expect(EXISTS (SELECT 1 FROM inventory_network_audit WHERE action = 'reveal_vin'), 'revealing a full VIN is audited');
