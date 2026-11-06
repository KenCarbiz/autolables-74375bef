-- Child-store canary import (Nov 6 2026 diagnosis). Synthetic data shaped like
-- production: a primary store with listing sync, price updates, adoption and
-- retirement on, and a child store with the production child settings
-- (unsubscribed, listing sync, sharing, adoption, price updates and
-- retirement off, feed import paused). Proves a child import writes only the
-- child's store_inventory: no listing created, adopted, repriced or
-- published, no provider call, and a VIN the primary already holds stays
-- with the primary as a conflict.
\set ON_ERROR_STOP 1
CREATE OR REPLACE FUNCTION pg_temp.expect(cond boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF cond IS NOT TRUE THEN RAISE EXCEPTION 'FAILED: %', label; END IF; RAISE NOTICE 'ok  %', label; END $$;
CREATE OR REPLACE FUNCTION pg_temp.as_user(p uuid) RETURNS void LANGUAGE sql AS $$ SELECT set_config('test.uid', COALESCE(p::text, ''), false) $$;

CREATE OR REPLACE FUNCTION pg_temp.snap(p_store uuid, p_group uuid, p_map uuid, p_dealer text, p_tag text, p_vins text[]) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v_id uuid; i int;
BEGIN
  INSERT INTO inventory_store_snapshots (path, source_dealer_id, store_id, group_id, mapping_id, source_mtime, content_sha256, clean, valid_count, row_count)
  VALUES ('prod/inventory/vauto/inbound/' || p_dealer || '.csv', p_dealer, p_store, p_group, p_map,
    now() + (p_tag || ' minutes')::interval, 'sha-canary-' || p_tag, true, cardinality(p_vins), cardinality(p_vins))
  RETURNING id INTO v_id;
  FOR i IN 1 .. cardinality(p_vins) LOOP
    INSERT INTO inventory_snapshot_vehicles (snapshot_id, vin, row_number, condition, year, make, model, feed_price, feed_price_status, photos)
    VALUES (v_id, p_vins[i], i + 1, CASE WHEN i % 3 = 0 THEN 'used' ELSE 'new' END, 2026, 'Hyundai', 'Santa Fe', 41000 + i, 'known', '[]'::jsonb);
  END LOOP;
  RETURN v_id;
END $$;

SELECT pg_temp.as_user('00000000-0000-0000-0000-00000000ad01');
INSERT INTO tenants (id, name) VALUES ('00000000-0000-0000-0000-00000000c9a1', 'Canary Group');
INSERT INTO dealer_groups (tenant_id, name) VALUES ('00000000-0000-0000-0000-00000000c9a1', 'Canary Group') ON CONFLICT (tenant_id) DO NOTHING;
CREATE TEMP TABLE cg AS SELECT id AS grp FROM dealer_groups WHERE tenant_id = '00000000-0000-0000-0000-00000000c9a1';
GRANT SELECT ON cg TO PUBLIC;
ALTER TABLE cg ADD COLUMN prim uuid, ADD COLUMN child uuid, ADD COLUMN pmap uuid, ADD COLUMN cmap uuid;
UPDATE cg SET prim = (inv_admin_save_store(jsonb_build_object('group_id', grp, 'display_name', 'Canary INFINITI', 'state', 'CT')))::uuid;
UPDATE cg SET child = (inv_admin_save_store(jsonb_build_object('group_id', grp, 'display_name', 'Canary Hyundai', 'state', 'CT')))::uuid;
UPDATE dealer_stores SET is_primary_inventory_store = true, subscription_status = 'subscribed', inventory_feed_enabled = true, listing_sync_enabled = true,
  feed_price_updates_listing = true, adopt_legacy_matches = true, retirement_automation_enabled = true, inventory_sharing_enabled = true
 WHERE id = (SELECT prim FROM cg);
UPDATE dealer_stores SET subscription_status = 'unsubscribed', inventory_feed_enabled = true, feed_import_paused = true, listing_sync_enabled = false,
  feed_price_updates_listing = false, adopt_legacy_matches = false, retirement_automation_enabled = false, inventory_sharing_enabled = false, customer_browser_enabled = false
 WHERE id = (SELECT child FROM cg);
WITH m AS (INSERT INTO inventory_source_mappings (source_dealer_id, group_id, store_id, status, observed_identity, approved_at)
  VALUES ('CP1_inventory', (SELECT grp FROM cg), (SELECT prim FROM cg), 'approved', '{}'::jsonb, now()) RETURNING id)
UPDATE cg SET pmap = (SELECT id FROM m);
WITH m AS (INSERT INTO inventory_source_mappings (source_dealer_id, group_id, store_id, status, observed_identity, approved_at)
  VALUES ('CC1_inventory', (SELECT grp FROM cg), (SELECT child FROM cg), 'approved', '{}'::jsonb, now()) RETURNING id)
UPDATE cg SET cmap = (SELECT id FROM m);

-- Primary already holds its feed (one VIN it shares with the child file), and
-- the account has an unowned published MarketCheck listing for a child VIN
-- (the production Santa Fe shape) plus the primary's own published listing.
SELECT pg_temp.expect((inventory_apply_store_snapshot(pg_temp.snap((SELECT prim FROM cg), (SELECT grp FROM cg), (SELECT pmap FROM cg), 'CP1_inventory', '1',
  ARRAY['CANARYP0000000001','CANARYP0000000002','CANARYSHARED00001']))->>'added')::int = 3, 'primary fixture: three feed cars');
INSERT INTO vehicle_listings (store_id, tenant_id, vin, slug, condition, status, price)
VALUES ('x', '00000000-0000-0000-0000-00000000c9a1', 'CANARYC0000000002', 'canary-santa-fe', 'new', 'published', 43995);
CREATE TEMP TABLE before_l AS
  SELECT id, vin, status, price, owning_store_id, inventory_record_id FROM vehicle_listings WHERE tenant_id = '00000000-0000-0000-0000-00000000c9a1';
GRANT SELECT ON before_l TO PUBLIC;
CREATE TEMP TABLE before_p AS SELECT id, vin, store_id, feed_price, presence FROM store_inventory WHERE store_id = (SELECT prim FROM cg);
GRANT SELECT ON before_p TO PUBLIC;

-- 1. While the child store's feed import is paused, nothing is written.
CREATE TEMP TABLE r0 AS SELECT inventory_apply_store_snapshot(pg_temp.snap((SELECT child FROM cg), (SELECT grp FROM cg), (SELECT cmap FROM cg), 'CC1_inventory', '2',
  ARRAY['CANARYC0000000001','CANARYC0000000002','CANARYC0000000003','CANARYSHARED00001'])) AS r;
SELECT pg_temp.expect((SELECT r->>'reason' = 'store_feed_not_enabled' FROM r0), 'a paused child store rejects its snapshot');
SELECT pg_temp.expect((SELECT count(*) FROM store_inventory WHERE store_id = (SELECT child FROM cg)) = 0, 'and writes no inventory');

-- 2. The canary: unpause only the child's feed import. Every other child setting stays off.
UPDATE dealer_stores SET feed_import_paused = false WHERE id = (SELECT child FROM cg);
CREATE TEMP TABLE r1 AS SELECT inventory_apply_store_snapshot(pg_temp.snap((SELECT child FROM cg), (SELECT grp FROM cg), (SELECT cmap FROM cg), 'CC1_inventory', '3',
  ARRAY['CANARYC0000000001','CANARYC0000000002','CANARYC0000000003','CANARYSHARED00001'])) AS r;
SELECT pg_temp.expect((SELECT (r->>'applied')::boolean FROM r1), 'the child snapshot applies');
SELECT pg_temp.expect((SELECT count(*) FROM store_inventory WHERE store_id = (SELECT child FROM cg) AND presence = 'present') = 3, 'the child store holds its own three cars');
SELECT pg_temp.expect((SELECT count(*) FILTER (WHERE condition = 'new') = 2 AND count(*) FILTER (WHERE condition = 'used') = 1 FROM store_inventory WHERE store_id = (SELECT child FROM cg)), 'with new and used counts from the feed');
SELECT pg_temp.expect((SELECT count(*) FROM inventory_vin_conflicts WHERE vin = 'CANARYSHARED00001' AND kind = 'other_store' AND claiming_store_id = (SELECT child FROM cg) AND existing_store_id = (SELECT prim FROM cg) AND status = 'open') = 1,
  'a VIN the primary already holds is a conflict for review, not a transfer');
SELECT pg_temp.expect((SELECT count(*) FROM store_inventory WHERE vin = 'CANARYSHARED00001') = 1 AND (SELECT store_id FROM store_inventory WHERE vin = 'CANARYSHARED00001') = (SELECT prim FROM cg), 'the shared VIN stays with the primary store');
SELECT pg_temp.expect(NOT EXISTS (SELECT 1 FROM before_p b JOIN store_inventory si ON si.id = b.id WHERE si.store_id <> b.store_id OR si.feed_price IS DISTINCT FROM b.feed_price OR si.presence <> b.presence)
  AND (SELECT count(*) FROM store_inventory WHERE store_id = (SELECT prim FROM cg)) = 3, 'primary inventory is untouched');

-- 3. No listing created, adopted, repriced, unpublished or published.
SELECT pg_temp.expect((SELECT (r->>'listings_created')::int = 0 AND (r->>'listings_updated')::int = 0 FROM r1), 'the apply report shows no listing work');
SELECT pg_temp.expect((SELECT count(*) FROM vehicle_listings WHERE tenant_id = '00000000-0000-0000-0000-00000000c9a1') = (SELECT count(*) FROM before_l), 'no listing is created');
SELECT pg_temp.expect(NOT EXISTS (SELECT 1 FROM before_l b JOIN vehicle_listings l ON l.id = b.id
  WHERE l.status IS DISTINCT FROM b.status OR l.price IS DISTINCT FROM b.price OR l.owning_store_id IS DISTINCT FROM b.owning_store_id OR l.inventory_record_id IS DISTINCT FROM b.inventory_record_id),
  'the unowned Santa Fe listing keeps its status, price and (empty) owner');
SELECT pg_temp.expect((SELECT listing_id IS NULL FROM store_inventory WHERE vin = 'CANARYC0000000002'), 'the child feed car is not linked to the public listing');
SELECT pg_temp.expect((SELECT (r->>'provider_calls')::int = 0 FROM r1) OR (SELECT (report->'apply'->>'provider_calls')::int = 0 FROM inventory_store_snapshots WHERE id = (SELECT max(id::text)::uuid FROM inventory_store_snapshots WHERE store_id = (SELECT child FROM cg) AND status = 'applied')),
  'no provider call is made');

-- 4. Re-delivery of the same file is idempotent: no duplicate VINs.
SELECT inventory_apply_store_snapshot(pg_temp.snap((SELECT child FROM cg), (SELECT grp FROM cg), (SELECT cmap FROM cg), 'CC1_inventory', '4',
  ARRAY['CANARYC0000000001','CANARYC0000000002','CANARYC0000000003','CANARYSHARED00001']));
SELECT pg_temp.expect((SELECT count(*) = count(DISTINCT vin) AND count(*) = 3 FROM store_inventory WHERE store_id = (SELECT child FROM cg)), 'a second delivery adds no duplicates');

-- 5. A partition mapped to another group's store is not applied to it.
CREATE TEMP TABLE r2 AS SELECT inventory_apply_store_snapshot(pg_temp.snap((SELECT child FROM cg), (SELECT grp FROM cg), (SELECT pmap FROM cg), 'CP1_inventory', '5', ARRAY['CANARYX0000000001'])) AS r;
SELECT pg_temp.expect((SELECT r->>'reason' = 'mapping_not_approved' FROM r2), 'a snapshot whose mapping points at another store is quarantined');
SELECT pg_temp.expect(NOT EXISTS (SELECT 1 FROM store_inventory WHERE vin = 'CANARYX0000000001'), 'and writes nothing');
SELECT pg_temp.as_user(NULL);
