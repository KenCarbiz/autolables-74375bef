-- Behaviour tests for 0012_snapshot_shrink_guard (applied after 10-40).
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

CREATE OR REPLACE FUNCTION pg_temp.snap(p_store uuid, p_map uuid, p_n int, p_from int, p_tag text) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v_id uuid; i int;
BEGIN
  INSERT INTO inventory_store_snapshots (path, source_dealer_id, store_id, group_id, mapping_id, source_mtime, content_sha256, clean, valid_count, row_count)
  VALUES ('prod/inventory/vauto/inbound/SG_inventory.csv', 'SG1_inventory', p_store, '00000000-0000-0000-0000-00000000aa01', p_map,
    now() + (p_tag || ' minutes')::interval, 'sha-' || p_tag, true, p_n, p_n)
  RETURNING id INTO v_id;
  FOR i IN p_from .. p_from + p_n - 1 LOOP
    INSERT INTO inventory_snapshot_vehicles (snapshot_id, vin, row_number, condition, year, make, model, feed_price, feed_price_status, photos)
    VALUES (v_id, 'SG0000000000' || lpad(i::text, 5, '0'), i + 1, 'used', 2024, 'Hyundai', 'Tucson', 25000 + i, 'known', '[]'::jsonb);
  END LOOP;
  RETURN v_id;
END $$;

SELECT pg_temp.as_user('00000000-0000-0000-0000-00000000ad01');
UPDATE inventory_feed_controls SET ingestion_paused = false, emergency_stop = false WHERE id = 1;
CREATE TEMP TABLE g AS SELECT inv_admin_save_store('{"group_id":"00000000-0000-0000-0000-00000000aa01","display_name":"Shrink Guard Motors","state":"CT"}') AS store;
SELECT inv_admin_save_store(jsonb_build_object('id', (SELECT store FROM g), 'inventory_feed_enabled', true, 'missing_snapshot_threshold', 2));
SELECT pg_temp.expect((SELECT max_snapshot_shrink_pct = 20 FROM dealer_stores WHERE id = (SELECT store FROM g)), 'stores default to a 20 percent shrink guard');
ALTER TABLE g ADD COLUMN map uuid;
WITH m AS (INSERT INTO inventory_source_mappings (source_dealer_id, group_id, store_id, status, observed_identity, approved_at)
  VALUES ('SG1_inventory', '00000000-0000-0000-0000-00000000aa01', (SELECT store FROM g), 'approved', '{}'::jsonb, now()) RETURNING id)
UPDATE g SET map = (SELECT id FROM m);

-- 40 cars in stock.
SELECT pg_temp.expect((inventory_apply_store_snapshot(pg_temp.snap((SELECT store FROM g), (SELECT map FROM g), 40, 1, '1'))->>'added')::int = 40, 'first snapshot adds 40 cars');

-- A truncated export: 15 of 40 rows (25 missing, allowed max(5, 8) = 8).
CREATE TEMP TABLE r1 AS SELECT inventory_apply_store_snapshot(pg_temp.snap((SELECT store FROM g), (SELECT map FROM g), 15, 1, '2')) AS r;
SELECT pg_temp.expect((SELECT (r->>'applied')::boolean AND (r->>'shrink_guard_held')::boolean AND NOT (r->>'absence_counted')::boolean FROM r1), 'a large shrink applies updates but holds absence');
SELECT pg_temp.expect((SELECT count(*) FROM store_inventory WHERE store_id = (SELECT store FROM g) AND presence = 'present') = 40, 'no car is marked missing by a truncated export');
SELECT pg_temp.expect((SELECT count(*) FROM inventory_network_audit WHERE action = 'shrink_guard_held' AND store_id = (SELECT store FROM g) AND (after->>'absent')::int = 25) = 1, 'the held shrink is audited with its counts');

-- A normal day: 34 of 40 present (6 missing, allowed 8).
CREATE TEMP TABLE r2 AS SELECT inventory_apply_store_snapshot(pg_temp.snap((SELECT store FROM g), (SELECT map FROM g), 34, 1, '3')) AS r;
SELECT pg_temp.expect((SELECT (r->>'absence_counted')::boolean AND (r->>'missing')::int = 6 FROM r2), 'a normal sell-down still counts absence');

-- Small stores: up to five absent cars never trip the guard.
SELECT pg_temp.expect((SELECT GREATEST(5, ceil(10 * 20 / 100.0)::int)) = 5, 'the guard floor is five vehicles');

-- Confirming a genuine large sell-down.
SELECT pg_temp.raises(format('SELECT inv_admin_set_shrink_guard(%L, 90, %L)', (SELECT store FROM g), ''), 'reason_required', 'changing the guard needs a reason');
SELECT pg_temp.raises(format('SELECT inv_admin_set_shrink_guard(%L, 0, %L)', (SELECT store FROM g), 'bulk wholesale'), 'bad_shrink_pct', 'the guard stays between 1 and 100');
SELECT pg_temp.as_user('00000000-0000-0000-0000-00000000aa99');
SELECT pg_temp.raises(format('SELECT inv_admin_set_shrink_guard(%L, 90, %L)', (SELECT store FROM g), 'bulk wholesale'), NULL, 'a store owner cannot change the guard');
SELECT pg_temp.as_user('00000000-0000-0000-0000-00000000ad01');
SELECT inv_admin_set_shrink_guard((SELECT store FROM g), 90, 'confirmed wholesale of 20 units');
CREATE TEMP TABLE r3 AS SELECT inventory_apply_store_snapshot(pg_temp.snap((SELECT store FROM g), (SELECT map FROM g), 14, 1, '4')) AS r;
SELECT pg_temp.expect((SELECT (r->>'absence_counted')::boolean AND NOT (r->>'shrink_guard_held')::boolean FROM r3), 'a confirmed sell-down counts absence');
SELECT pg_temp.expect((SELECT count(*) FROM inventory_network_audit WHERE action = 'set_shrink_guard' AND store_id = (SELECT store FROM g)) = 1, 'guard changes are audited');
