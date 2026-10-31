-- Behaviour tests for drizzle/migrations/0016_feed_completeness_hold.sql (after 0014).
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
UPDATE inventory_feed_controls SET ingestion_paused = false, emergency_stop = false WHERE id = 1;
CREATE TEMP TABLE st (k text PRIMARY KEY, id uuid);
INSERT INTO st VALUES
  ('big',   inv_admin_save_store('{"group_id":"00000000-0000-0000-0000-00000000aa01","display_name":"Hold Big","state":"CT"}')),
  ('small', inv_admin_save_store('{"group_id":"00000000-0000-0000-0000-00000000aa01","display_name":"Hold Small","state":"CT"}')),
  ('incr',  inv_admin_save_store('{"group_id":"00000000-0000-0000-0000-00000000aa01","display_name":"Hold Incremental","state":"CT"}'));
SELECT inv_admin_save_store(jsonb_build_object('id', id, 'inventory_feed_enabled', true, 'missing_snapshot_threshold', 2, 'retirement_automation_enabled', true)) FROM st;
INSERT INTO inventory_source_mappings (source_dealer_id, group_id, store_id, status, observed_identity, approved_at)
SELECT 'CH' || k || '_inventory', '00000000-0000-0000-0000-00000000aa01', id, 'approved', '{}'::jsonb, now() FROM st;

SELECT pg_temp.expect((SELECT feed_semantics = 'full_snapshot' AND min_absent_vehicles IS NULL AND max_count_drop_pct IS NULL FROM dealer_stores WHERE id = (SELECT id FROM st WHERE k='big')),
  'new checks start off; feeds default to full snapshots');

-- Baseline: 50 cars.
SELECT inventory_apply_store_snapshot(pg_temp.snap((SELECT id FROM st WHERE k='big'), 'CHbig_inventory', 50, 1, 1));
SELECT pg_temp.expect((SELECT last_trusted_valid_count = 50 FROM inventory_store_state WHERE store_id = (SELECT id FROM st WHERE k='big')), 'a clean full snapshot becomes the trusted baseline');

-- Truncated file: 12 of 50, every price changed.
CREATE TEMP TABLE h1 AS SELECT pg_temp.snap((SELECT id FROM st WHERE k='big'), 'CHbig_inventory', 12, 1, 2, 500) AS id;
CREATE TEMP TABLE r1 AS SELECT inventory_apply_store_snapshot((SELECT id FROM h1)) AS r;
SELECT pg_temp.expect((SELECT NOT (r->>'applied')::boolean AND r->>'reason' = 'held_for_review' AND r->'rules' ? 'absent_vs_live' FROM r1), 'a truncated file is held with its rule');
SELECT pg_temp.expect((SELECT status = 'held' AND report->'hold'->>'absent' = '38' FROM inventory_store_snapshots WHERE id = (SELECT id FROM h1)), 'the held snapshot shows its counts');
SELECT pg_temp.expect((SELECT count(*) FROM store_inventory WHERE store_id = (SELECT id FROM st WHERE k='big') AND feed_price > 20050) = 0, 'a held file reprices nothing');
SELECT pg_temp.expect(pg_temp.present((SELECT id FROM st WHERE k='big')) = 50, 'a held file marks nothing missing');
SELECT pg_temp.expect((SELECT last_applied_snapshot_id <> (SELECT id FROM h1) AND last_trusted_valid_count = 50 FROM inventory_store_state WHERE store_id = (SELECT id FROM st WHERE k='big')), 'a held file does not move the applied or trusted baseline');
SELECT pg_temp.expect((SELECT count(*) FROM inventory_network_audit WHERE action = 'snapshot_held' AND entity_id = (SELECT id FROM h1)::text) = 1, 'the hold is audited');

-- Repeated suspicious file: the newer one waits, the older is superseded.
CREATE TEMP TABLE h2 AS SELECT pg_temp.snap((SELECT id FROM st WHERE k='big'), 'CHbig_inventory', 10, 1, 3) AS id;
SELECT inventory_apply_store_snapshot((SELECT id FROM h2));
SELECT pg_temp.expect((SELECT status = 'superseded' FROM inventory_store_snapshots WHERE id = (SELECT id FROM h1)) AND (SELECT status = 'held' FROM inventory_store_snapshots WHERE id = (SELECT id FROM h2)), 'repeated suspicious files keep only the newest held');
SELECT pg_temp.expect(pg_temp.present((SELECT id FROM st WHERE k='big')) = 50, 'repeated truncated files retire nothing');

-- Empty file.
SELECT pg_temp.expect(inventory_apply_store_snapshot(pg_temp.snap((SELECT id FROM st WHERE k='big'), 'CHbig_inventory', 0, 1, 4))->>'reason' = 'empty_snapshot', 'an empty file is rejected');
SELECT pg_temp.expect((SELECT last_trusted_valid_count = 50 FROM inventory_store_state WHERE store_id = (SELECT id FROM st WHERE k='big')), 'an empty file leaves the baseline');

-- Recovery: a full file applies and supersedes the held one.
CREATE TEMP TABLE r2 AS SELECT inventory_apply_store_snapshot(pg_temp.snap((SELECT id FROM st WHERE k='big'), 'CHbig_inventory', 50, 1, 5)) AS r;
SELECT pg_temp.expect((SELECT (r->>'applied')::boolean AND (r->>'trusted')::boolean FROM r2), 'a complete file after holds applies normally');
SELECT pg_temp.expect((SELECT status = 'superseded' AND reason = 'newer_snapshot_applied' FROM inventory_store_snapshots WHERE id = (SELECT id FROM h2)), 'the held file is superseded by the newer full file');
SELECT pg_temp.raises(format('SELECT inv_admin_resolve_held_snapshot(%L, %L, %L)', (SELECT id FROM h2), 'apply_full', 'late'), 'snapshot_not_held', 'a superseded hold cannot be applied');

-- Legitimate reduction: 45 of 50 (5 absent, allowed max(5, 10)).
CREATE TEMP TABLE r3 AS SELECT inventory_apply_store_snapshot(pg_temp.snap((SELECT id FROM st WHERE k='big'), 'CHbig_inventory', 45, 1, 6)) AS r;
SELECT pg_temp.expect((SELECT (r->>'applied')::boolean AND (r->>'missing')::int = 5 FROM r3), 'a normal sell-down counts absence');

-- Count drop against the trusted snapshot (proposed 20 percent, min 2).
SELECT inv_admin_set_feed_completeness((SELECT id FROM st WHERE k='big'), '{"min_absent_vehicles":2,"max_count_drop_pct":20}', 'owner approved proposal');
UPDATE store_inventory SET presence = 'retired' WHERE store_id = (SELECT id FROM st WHERE k='big') AND vin IN
  (SELECT vin FROM store_inventory WHERE store_id = (SELECT id FROM st WHERE k='big') AND presence = 'present' ORDER BY vin LIMIT 10);
CREATE TEMP TABLE r4 AS SELECT inventory_apply_store_snapshot(pg_temp.snap((SELECT id FROM st WHERE k='big'), 'CHbig_inventory', 35, 1, 7)) AS r;
SELECT pg_temp.expect((SELECT r->>'reason' = 'held_for_review' AND r->'rules' ? 'count_drop_vs_trusted' FROM r4), 'a drop against the trusted count holds even when live stock already drifted');

-- Admin decisions.
SELECT pg_temp.as_user('00000000-0000-0000-0000-00000000aa99');
SELECT pg_temp.raises(format('SELECT inv_admin_resolve_held_snapshot(%L, %L, %L)', (SELECT id FROM inventory_store_snapshots WHERE store_id = (SELECT id FROM st WHERE k='big') AND status = 'held'), 'apply_full', 'store user'), 'platform_admin_required', 'store users cannot release a hold');
SELECT pg_temp.as_user('00000000-0000-0000-0000-00000000ad01');
SELECT pg_temp.raises(format('SELECT inv_admin_resolve_held_snapshot(%L, %L, %L)', (SELECT id FROM inventory_store_snapshots WHERE store_id = (SELECT id FROM st WHERE k='big') AND status = 'held'), 'apply_full', ''), 'reason_required', 'releasing a hold needs a reason');
CREATE TEMP TABLE r5 AS SELECT inv_admin_resolve_held_snapshot((SELECT id FROM inventory_store_snapshots WHERE store_id = (SELECT id FROM st WHERE k='big') AND status = 'held'), 'apply_without_absence', 'prices only') AS r;
SELECT pg_temp.expect((SELECT (r->>'applied')::boolean AND NOT (r->>'absence_counted')::boolean AND NOT (r->>'trusted')::boolean FROM r5), 'apply without absence updates but is not trusted');
SELECT pg_temp.expect((SELECT last_trusted_valid_count = 45 FROM inventory_store_state WHERE store_id = (SELECT id FROM st WHERE k='big')), 'the trusted baseline stays at the last confirmed full file');
CREATE TEMP TABLE h3 AS SELECT pg_temp.snap((SELECT id FROM st WHERE k='big'), 'CHbig_inventory', 20, 1, 8) AS id;
SELECT inventory_apply_store_snapshot((SELECT id FROM h3));
CREATE TEMP TABLE r6 AS SELECT inv_admin_resolve_held_snapshot((SELECT id FROM h3), 'apply_full', 'confirmed wholesale') AS r;
SELECT pg_temp.expect((SELECT (r->>'applied')::boolean AND (r->>'absence_counted')::boolean AND (r->>'trusted')::boolean FROM r6), 'a confirmed full file counts absence and becomes trusted');
CREATE TEMP TABLE h4 AS SELECT pg_temp.snap((SELECT id FROM st WHERE k='big'), 'CHbig_inventory', 3, 1, 9) AS id;
SELECT inventory_apply_store_snapshot((SELECT id FROM h4));
SELECT pg_temp.expect((inv_admin_resolve_held_snapshot((SELECT id FROM h4), 'reject', 'bad export'))->>'reason' = 'rejected_after_hold', 'a hold can be rejected');
SELECT pg_temp.expect((SELECT count(*) FROM inventory_network_audit WHERE action = 'resolve_held_snapshot') = 3, 'hold decisions are audited');

-- Small store: 6 cars down to 1 is held once min_absent_vehicles is set.
SELECT inventory_apply_store_snapshot(pg_temp.snap((SELECT id FROM st WHERE k='small'), 'CHsmall_inventory', 6, 1, 1));
SELECT pg_temp.expect(inventory_apply_store_snapshot(pg_temp.snap((SELECT id FROM st WHERE k='small'), 'CHsmall_inventory', 1, 1, 2))->>'reason' IS NULL, 'with checks off, the 0012 floor still lets a small store drop five');
SELECT inv_admin_set_feed_completeness((SELECT id FROM st WHERE k='small'), '{"min_absent_vehicles":2}', 'owner approved proposal');
UPDATE store_inventory SET presence = 'present', missing_snapshots = 0, retired_at = NULL, retire_reason = NULL WHERE store_id = (SELECT id FROM st WHERE k='small');
SELECT pg_temp.expect(inventory_apply_store_snapshot(pg_temp.snap((SELECT id FROM st WHERE k='small'), 'CHsmall_inventory', 1, 1, 3))->>'reason' = 'held_for_review', 'a small store dropping 6 to 1 is held');
SELECT pg_temp.expect(inventory_apply_store_snapshot(pg_temp.snap((SELECT id FROM st WHERE k='small'), 'CHsmall_inventory', 5, 1, 4))->>'applied' = 'true', 'a small store selling one car is not held');

-- Incremental feed: never held, never counts absence, never trusted.
SELECT inv_admin_set_feed_completeness((SELECT id FROM st WHERE k='incr'), '{"feed_semantics":"incremental"}', 'partial deltas');
SELECT inventory_apply_store_snapshot(pg_temp.snap((SELECT id FROM st WHERE k='incr'), 'CHincr_inventory', 30, 1, 1));
CREATE TEMP TABLE r7 AS SELECT inventory_apply_store_snapshot(pg_temp.snap((SELECT id FROM st WHERE k='incr'), 'CHincr_inventory', 2, 1, 2, 100)) AS r;
SELECT pg_temp.expect((SELECT (r->>'applied')::boolean AND NOT (r->>'absence_counted')::boolean FROM r7), 'an incremental file applies its rows without absence');
SELECT pg_temp.expect(pg_temp.present((SELECT id FROM st WHERE k='incr')) = 30, 'an incremental file never marks cars missing');
SELECT pg_temp.expect((SELECT last_trusted_snapshot_id IS NULL FROM inventory_store_state WHERE store_id = (SELECT id FROM st WHERE k='incr')), 'an incremental file never becomes the trusted baseline');

SELECT pg_temp.raises($$SELECT inv_admin_set_feed_completeness((SELECT id FROM st WHERE k='big'), '{"feed_semantics":"sometimes"}', 'bad')$$, 'feed_semantics', 'feed semantics are a closed set');
SELECT pg_temp.expect(NOT has_function_privilege('authenticated', 'public.inventory_apply_store_snapshot_mode(uuid, text)', 'execute')
  AND has_function_privilege('authenticated', 'public.inv_admin_resolve_held_snapshot(uuid, text, text)', 'execute'), 'clients cannot call the apply directly; admins resolve through the RPC');
