-- Behaviour tests for drizzle/migrations/0021_held_feed_auto_confirm.sql (after 70).
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

-- p_n vehicles numbered p_from.., priced 20000 + i + p_bump; minute offset orders versions.
CREATE OR REPLACE FUNCTION pg_temp.snap(p_store uuid, p_dealer text, p_n int, p_from int, p_minute int, p_bump int DEFAULT 0, p_clean boolean DEFAULT true) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v_id uuid; i int; v_map uuid;
BEGIN
  SELECT id INTO v_map FROM inventory_source_mappings WHERE source_dealer_id = p_dealer AND status = 'approved';
  INSERT INTO inventory_store_snapshots (path, source_dealer_id, store_id, group_id, mapping_id, source_mtime, content_sha256, clean, valid_count, row_count)
  VALUES ('prod/inventory/vauto/inbound/' || p_dealer || '.csv', p_dealer, p_store, '00000000-0000-0000-0000-00000000aa01', v_map,
    timestamptz '2026-11-01 00:00Z' + make_interval(mins => p_minute), 'sha-' || p_dealer || p_minute, p_clean, p_n, p_n)
  RETURNING id INTO v_id;
  FOR i IN p_from .. p_from + p_n - 1 LOOP
    INSERT INTO inventory_snapshot_vehicles (snapshot_id, vin, row_number, condition, year, make, model, feed_price, feed_price_status, photos)
    VALUES (v_id, 'JN8' || CASE p_dealer WHEN 'CHbig_inventory' THEN 'A' WHEN 'CHsmall_inventory' THEN 'B' ELSE 'C' END || 'CH000' || lpad(i::text, 8, '0'), i + 1, 'used', 2024, 'Infiniti', 'QX60', 20000 + i + p_bump, 'known', '[]'::jsonb);
  END LOOP;
  RETURN v_id;
END $$;
CREATE OR REPLACE FUNCTION pg_temp.present(p_store uuid) RETURNS bigint LANGUAGE sql AS $$
  SELECT count(*) FROM store_inventory WHERE store_id = p_store AND presence = 'present' $$;

SELECT pg_temp.as_user('00000000-0000-0000-0000-00000000ad01');
CREATE TEMP TABLE st2 (k text PRIMARY KEY, id uuid);
INSERT INTO st2 VALUES
  ('agree', inv_admin_save_store('{"group_id":"00000000-0000-0000-0000-00000000aa01","display_name":"Hold Agree","state":"CT"}')),
  ('trunc', inv_admin_save_store('{"group_id":"00000000-0000-0000-0000-00000000aa01","display_name":"Hold Truncated","state":"CT"}')),
  ('drift', inv_admin_save_store('{"group_id":"00000000-0000-0000-0000-00000000aa01","display_name":"Hold Drift","state":"CT"}'));
SELECT inv_admin_save_store(jsonb_build_object('id', id, 'inventory_feed_enabled', true, 'missing_snapshot_threshold', 3, 'retirement_automation_enabled', false)) FROM st2;
SELECT inv_admin_set_feed_completeness(id, '{"min_absent_vehicles":2,"max_count_drop_pct":20}', 'production settings') FROM st2;
INSERT INTO inventory_source_mappings (source_dealer_id, group_id, store_id, status, observed_identity, approved_at)
SELECT 'CH' || k || '_inventory', '00000000-0000-0000-0000-00000000aa01', id, 'approved', '{}'::jsonb, now() FROM st2;
CREATE OR REPLACE FUNCTION pg_temp.sid(p text) RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM st2 WHERE k = p $$;

-- Weekend sales: 100 cars, then 22 sold (guard allows 20). The first file is held.
SELECT inventory_apply_store_snapshot(pg_temp.snap(pg_temp.sid('agree'), 'CHagree_inventory', 100, 5001, 1));
CREATE TEMP TABLE a1 AS SELECT pg_temp.snap(pg_temp.sid('agree'), 'CHagree_inventory', 78, 5023, 2) AS id;
SELECT pg_temp.expect(inventory_apply_store_snapshot((SELECT id FROM a1))->>'reason' = 'held_for_review', 'a first file past the guard is still held');
SELECT pg_temp.expect(pg_temp.present(pg_temp.sid('agree')) = 100, 'the first held file changes nothing');
-- The next file agrees with it (same 78 plus 2 arrivals): applied on its own.
CREATE TEMP TABLE a2 AS SELECT pg_temp.snap(pg_temp.sid('agree'), 'CHagree_inventory', 80, 5023, 3) AS id;
CREATE TEMP TABLE ra AS SELECT inventory_apply_store_snapshot((SELECT id FROM a2)) AS r;
SELECT pg_temp.expect((SELECT (r->>'applied')::boolean AND (r->>'trusted')::boolean AND (r->>'absence_counted')::boolean AND (r->>'missing')::int = 22 AND (r->>'added')::int = 2 FROM ra), 'an agreeing second file applies and counts the sold cars');
SELECT pg_temp.expect((SELECT report->'apply'->>'auto_confirmed_by' = (SELECT id FROM a1)::text FROM inventory_store_snapshots WHERE id = (SELECT id FROM a2)), 'the report names the file that confirmed it');
SELECT pg_temp.expect((SELECT status = 'superseded' FROM inventory_store_snapshots WHERE id = (SELECT id FROM a1)), 'the earlier held file is superseded');
SELECT pg_temp.expect((SELECT last_applied_snapshot_id = (SELECT id FROM a2) AND last_trusted_valid_count = 80 FROM inventory_store_state WHERE store_id = pg_temp.sid('agree')), 'the store catches up: applied and trusted baseline move');
SELECT pg_temp.expect((SELECT count(*) FROM inventory_network_audit WHERE action = 'snapshot_auto_confirmed' AND entity_id = (SELECT id FROM a2)::text
  AND after->>'confirmed_by_snapshot_id' = (SELECT id FROM a1)::text) = 1, 'the automatic release is audited');
SELECT pg_temp.expect(pg_temp.present(pg_temp.sid('agree')) = 80 AND (SELECT count(*) FROM store_inventory WHERE store_id = pg_temp.sid('agree') AND presence = 'missing') = 22, 'sold cars are marked missing, not removed');

-- A cut-off export that repeats (30 of 100) still waits for a person.
SELECT inventory_apply_store_snapshot(pg_temp.snap(pg_temp.sid('trunc'), 'CHtrunc_inventory', 100, 6001, 1));
SELECT inventory_apply_store_snapshot(pg_temp.snap(pg_temp.sid('trunc'), 'CHtrunc_inventory', 30, 6001, 2));
CREATE TEMP TABLE rt AS SELECT inventory_apply_store_snapshot(pg_temp.snap(pg_temp.sid('trunc'), 'CHtrunc_inventory', 30, 6001, 3)) AS r;
SELECT pg_temp.expect((SELECT r->>'reason' = 'held_for_review' FROM rt), 'a repeated large truncation stays held');
SELECT pg_temp.expect(pg_temp.present(pg_temp.sid('trunc')) = 100, 'a repeated truncation marks nothing missing');
-- Just past twice the guard (41 of 100) also stays held.
CREATE TEMP TABLE rt2 AS SELECT inventory_apply_store_snapshot(pg_temp.snap(pg_temp.sid('trunc'), 'CHtrunc_inventory', 59, 6001, 4)) AS r;
CREATE TEMP TABLE rt3 AS SELECT inventory_apply_store_snapshot(pg_temp.snap(pg_temp.sid('trunc'), 'CHtrunc_inventory', 59, 6001, 5)) AS r;
SELECT pg_temp.expect((SELECT r->>'reason' = 'held_for_review' FROM rt3), 'two agreeing files past twice the guard stay held');

-- Two files that disagree with each other stay held.
SELECT inventory_apply_store_snapshot(pg_temp.snap(pg_temp.sid('drift'), 'CHdrift_inventory', 100, 7001, 1));
SELECT inventory_apply_store_snapshot(pg_temp.snap(pg_temp.sid('drift'), 'CHdrift_inventory', 78, 7001, 2));
CREATE TEMP TABLE rd AS SELECT inventory_apply_store_snapshot(pg_temp.snap(pg_temp.sid('drift'), 'CHdrift_inventory', 78, 7023, 3)) AS r;
SELECT pg_temp.expect((SELECT r->>'reason' = 'held_for_review' FROM rd), 'files that lose different cars do not confirm each other');
-- A file with row errors never confirms or is confirmed.
CREATE TEMP TABLE rd2 AS SELECT inventory_apply_store_snapshot(pg_temp.snap(pg_temp.sid('drift'), 'CHdrift_inventory', 78, 7023, 4, 0, false)) AS r;
SELECT pg_temp.expect((SELECT r->>'reason' = 'held_for_review' FROM rd2), 'an unclean file is not released automatically');
SELECT pg_temp.expect(pg_temp.present(pg_temp.sid('drift')) = 100, 'disagreeing files change nothing');
SELECT pg_temp.expect((SELECT count(*) FROM inventory_network_audit WHERE action = 'snapshot_auto_confirmed') = 1, 'only the agreeing pair was released');
