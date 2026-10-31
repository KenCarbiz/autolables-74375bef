-- Behaviour tests for 0008_marketcheck_bulk_feeds.
\set ON_ERROR_STOP 1
CREATE OR REPLACE FUNCTION pg_temp.expect(cond boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF cond IS NOT TRUE THEN RAISE EXCEPTION 'FAILED: %', label; END IF; RAISE NOTICE 'ok  %', label; END $$;
CREATE OR REPLACE FUNCTION pg_temp.raises(sql text, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN EXECUTE sql; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'ok  % (%)', label, SQLERRM; RETURN; END;
  RAISE EXCEPTION 'FAILED: % (did not raise)', label;
END $$;
CREATE OR REPLACE FUNCTION pg_temp.as_user(p uuid) RETURNS void LANGUAGE sql AS $$ SELECT set_config('test.uid', COALESCE(p::text, ''), false) $$;

-- Timing
SELECT pg_temp.expect((SELECT enrichment_mode = 'off' AND import_mode = 'on_completion' FROM integration_timing WHERE integration_key = 'filescom_inventory'), 'Files.com imports on completion with no paid enrichment');
SELECT pg_temp.raises($$UPDATE integration_timing SET enrichment_mode = 'after_import' WHERE integration_key = 'filescom_inventory'$$, 'a Files.com import can never trigger paid enrichment');
UPDATE provider_product_catalog SET rate_status = 'list_price_estimate', verified_at = NULL, repeat_charge_policy = 'unknown' WHERE product_key IN ('vin_history','neovin');
SELECT pg_temp.raises($$UPDATE integration_timing SET enrichment_mode = 'scheduled', enrichment_cron = '0 3 * * *' WHERE integration_key = 'marketcheck_api'$$, 'scheduled paid enrichment needs a verified catalog');
SELECT pg_temp.raises($$INSERT INTO integration_timing (integration_key, integration, expected_delivery_cron) VALUES ('marketcheck_bulk:x', 'marketcheck_bulk', '0 6 * * *')$$, 'a delivery schedule must state its time zone');

-- Contracts
SELECT pg_temp.as_user('00000000-0000-0000-0000-00000000ad01');
SELECT inv_admin_save_bulk_contract('{"feed_key":"us_used_active","label":"US used active inventory","format":"jsonl","compression":"gzip","delivery_method":"s3"}');
SELECT pg_temp.expect((SELECT NOT contracted AND NOT enabled AND storage_rights = 'unknown' AND replay_rights = 'unknown' FROM bulk_feed_contracts WHERE feed_key = 'us_used_active'), 'a feed starts uncontracted, disabled, with every right unknown');
SELECT pg_temp.raises($$SELECT inv_admin_save_bulk_contract('{"feed_key":"us_used_active","enabled":true}')$$, 'an uncontracted feed cannot be enabled');
SELECT pg_temp.raises($$SELECT inv_admin_save_bulk_contract('{"feed_key":"us_used_active","mark_contracted":true}')$$, 'marking a contract needs evidence');
SELECT pg_temp.raises($$SELECT bulk_feed_record_part('us_used_active', 'production', 'd1', 'full', 2, 1, 'a/1.jsonl.gz', 10, 'abc')$$, 'deliveries for an uncontracted feed are refused');
SELECT inv_admin_save_bulk_contract('{"feed_key":"us_used_active","mark_contracted":true,"contract_evidence":"Order form 2026-11 (test)","storage_rights":"limited","retention_days":30}');
SELECT inv_admin_save_bulk_contract('{"feed_key":"us_used_active","enabled":true}');
SELECT pg_temp.as_user(NULL);
INSERT INTO bulk_feed_schema_versions (feed_key, version, status, release_kind) VALUES ('us_used_active', '2026Q4', 'current', 'initial');
INSERT INTO bulk_feed_schema_versions (feed_key, version, status, validation_deadline) VALUES ('us_used_active', '2027Q1', 'upcoming', current_date + 7);

-- Multipart completion
CREATE TEMP TABLE d AS SELECT bulk_feed_record_part('us_used_active', 'production', 'd1', 'full', 3, 1, 'a/1.jsonl.gz', 10, 'abc', '2026Q4') AS id;
SELECT bulk_feed_record_part('us_used_active', 'production', 'd1', 'full', 3, 2, 'a/2.jsonl.gz', 10, 'def', '2026Q4');
SELECT pg_temp.expect((SELECT bulk_feed_record_part('us_used_active', 'production', 'd1', 'full', 3, 2, 'a/2.jsonl.gz', 10, 'def', '2026Q4')) = (SELECT id FROM d), 'a repeated part notice is idempotent');
SELECT pg_temp.raises($$SELECT bulk_feed_mark_complete((SELECT id FROM d), 'none', NULL)$$, 'completion needs real evidence');
SELECT pg_temp.expect((SELECT bulk_feed_mark_complete((SELECT id FROM d), 'notification', 'evt-1')->>'reason') = 'missing_parts', 'a delivery missing a part is not complete');
SELECT pg_temp.expect((SELECT (bulk_feed_commit_decision((SELECT id FROM d))->>'can_commit')::boolean) = false, 'an incomplete delivery cannot commit a snapshot');
SELECT pg_temp.expect((SELECT (bulk_feed_commit_decision((SELECT id FROM d))->>'can_infer_removals')::boolean) = false, 'no removals are inferred from an incomplete delivery');
SELECT bulk_feed_record_part('us_used_active', 'production', 'd1', 'full', 3, 3, 'a/3.jsonl.gz', 10, 'ghi', '2026Q4');
UPDATE bulk_feed_delivery_parts SET integrity = 'mismatch' WHERE part_no = 3;
SELECT pg_temp.expect((SELECT bulk_feed_mark_complete((SELECT id FROM d), 'notification', 'evt-1')->>'reason') = 'integrity', 'a checksum mismatch blocks completion');
UPDATE bulk_feed_delivery_parts SET integrity = 'ok';
SELECT pg_temp.expect((SELECT (bulk_feed_mark_complete((SELECT id FROM d), 'notification', 'evt-1')->>'complete')::boolean), 'all parts present and intact completes the delivery');
SELECT pg_temp.expect((SELECT (bulk_feed_commit_decision((SELECT id FROM d))->>'can_infer_removals')::boolean), 'a complete full production delivery may infer removals');
UPDATE bulk_feed_deliveries SET status = 'imported', imported_at = now(), row_count = 1000 WHERE id = (SELECT id FROM d);

-- Row drop, delta and release-test files
CREATE TEMP TABLE d2 AS SELECT bulk_feed_record_part('us_used_active', 'production', 'd2', 'full', 1, 1, 'b/1.jsonl.gz', 10, 'x', '2026Q4') AS id;
SELECT bulk_feed_mark_complete((SELECT id FROM d2), 'success_metadata', '_SUCCESS');
UPDATE bulk_feed_deliveries SET row_count = 400 WHERE id = (SELECT id FROM d2);
SELECT pg_temp.expect((SELECT (r->>'can_commit')::boolean AND NOT (r->>'can_infer_removals')::boolean FROM (SELECT bulk_feed_commit_decision((SELECT id FROM d2)) r) x), 'a large row drop commits but never infers removals');
CREATE TEMP TABLE d3 AS SELECT bulk_feed_record_part('us_used_active', 'release_test', 'd3', 'full', 1, 1, 'rt/1.jsonl.gz', 10, 'x', '2027Q1') AS id;
SELECT bulk_feed_mark_complete((SELECT id FROM d3), 'manifest', 'manifest.json');
SELECT pg_temp.expect((SELECT (bulk_feed_commit_decision((SELECT id FROM d3))->'reasons') ? 'release_test_file'), 'a release-test file never commits');
SELECT pg_temp.raises($$UPDATE bulk_feed_deliveries SET status = 'imported' WHERE id = (SELECT id FROM d3)$$, 'a release-test file can never be imported');
SELECT pg_temp.expect((SELECT count(*) FROM bulk_feed_exceptions WHERE kind = 'release_test_file' AND resolved_at IS NULL) = 1, 'release-test arrivals are visible in the exception queue');

-- Schema deadlines and replay rights
SELECT bulk_feed_check_schedule();
SELECT pg_temp.expect((SELECT count(*) FROM bulk_feed_exceptions WHERE kind = 'validation_deadline' AND resolved_at IS NULL) = 1, 'an upcoming schema release near its deadline is flagged');
SELECT pg_temp.as_user('00000000-0000-0000-0000-00000000ad01');
SELECT pg_temp.raises($$SELECT bulk_feed_request_replay((SELECT id FROM d), 'reprocess')$$, 'replay is refused while replay rights are unknown');
SELECT inv_admin_save_bulk_contract('{"feed_key":"us_used_active","replay_rights":"permitted"}');
SELECT pg_temp.expect((SELECT bulk_feed_request_replay((SELECT id FROM d), 'reprocess after parser fix') IS NOT NULL), 'replay within retention and rights reuses the downloaded parts');
SELECT pg_temp.expect((SELECT count(*) FROM bulk_feed_delivery_parts p JOIN bulk_feed_deliveries x ON x.id = p.delivery_id WHERE x.replay_of = (SELECT id FROM d)) = 3, 'the replay carries every part, with no new download');
SELECT pg_temp.expect((SELECT jsonb_array_length(t->'exceptions') >= 2 AND jsonb_array_length(t->'bulk_deliveries') >= 3 AND t ? 'filescom_runs' FROM (SELECT inv_admin_delivery_timeline() t) x), 'the timeline shows deliveries, Files.com runs and open exceptions');
SELECT inv_admin_resolve_bulk_exception((SELECT id FROM bulk_feed_exceptions WHERE kind = 'release_test_file'), 'expected provider test drop');
SELECT pg_temp.expect((SELECT resolved_at IS NOT NULL FROM bulk_feed_exceptions WHERE kind = 'release_test_file'), 'an admin resolves an exception with a reason');
SELECT pg_temp.as_user('00000000-0000-0000-0000-00000000aa99');
SELECT pg_temp.raises($$SELECT inv_admin_delivery_timeline()$$, 'store users cannot read the delivery timeline');
SELECT pg_temp.as_user(NULL);
SET ROLE authenticated;
SELECT pg_temp.raises($$SELECT bulk_feed_record_part('us_used_active', 'production', 'z', 'full', 1, 1, 'z', 1, 'z')$$, 'signed-in users cannot register deliveries');
RESET ROLE;

SELECT 'ALL BULK FEED SQL TESTS PASSED' AS result;
