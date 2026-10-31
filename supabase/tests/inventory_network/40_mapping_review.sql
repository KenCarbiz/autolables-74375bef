-- Behaviour tests for 0010_store_mapping_review (applied after 10-30).
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

SELECT pg_temp.as_user('00000000-0000-0000-0000-00000000ad01');
CREATE TEMP TABLE s AS SELECT
  inv_admin_save_store('{"group_id":"00000000-0000-0000-0000-00000000aa01","display_name":"Harte INFINITI","street":"150 Weston Street","city":"Hartford","state":"CT","zip":"06120","subscription_status":"subscribed"}') AS infiniti,
  inv_admin_save_store('{"group_id":"00000000-0000-0000-0000-00000000aa01","display_name":"George Harte INFINITI","street":"1076 South Colony Road","city":"Wallingford","state":"CT","zip":"06492"}') AS george,
  inv_admin_save_store('{"group_id":"00000000-0000-0000-0000-00000000aa01","display_name":"Harte Hyundai","street":"235 Middlesex Turnpike","city":"Old Saybrook","state":"CT"}') AS nozip;

-- A stored partition dry run for two files, as the edge function writes it.
INSERT INTO inventory_feed_files (provider, path, status, last_content_sha256) VALUES
  ('filescom', 'prod/inventory/vauto/inbound/MP15398_inventory.csv', 'quarantined', 'sha-a'),
  ('filescom', 'prod/inventory/vauto/inbound/MP15395_inventory.csv', 'quarantined', 'sha-b'),
  ('filescom', 'prod/inventory/vauto/inbound/MP15395_webhooktest_inventory.csv', 'quarantined', 'sha-t');
CREATE TEMP TABLE r AS
WITH ins AS (
  INSERT INTO inventory_feed_runs (kind, path, status, content_sha256, report) VALUES
  ('dry_run', 'prod/inventory/vauto/inbound/MP15398_inventory.csv', 'passed', 'sha-a', jsonb_build_object('kind','partition_dry_run','partitions', jsonb_build_array(
     jsonb_build_object('sourceDealerId','MP15398_inventory','identityVariants',1,'counts',jsonb_build_object('valid',100),
       'identity', jsonb_build_object('dealerId','MP15398_inventory','dealerName','Harte INFINITI','address','150 WESTON ST','city','Hartford','postal','06120','region','CT'))))),
  ('dry_run', 'prod/inventory/vauto/inbound/MP15395_inventory.csv', 'passed', 'sha-b', jsonb_build_object('kind','partition_dry_run','partitions', jsonb_build_array(
     jsonb_build_object('sourceDealerId','MP15395_inventory','identityVariants',1,
       'identity', jsonb_build_object('dealerId','MP15395_inventory','dealerName','George Harte INFINITI','address','1076 S Colony Rd','city','Wallingford','postal','06492','region','CT'))))),
  ('dry_run', 'prod/inventory/vauto/inbound/MP15395_webhooktest_inventory.csv', 'passed', 'sha-t', jsonb_build_object('kind','partition_dry_run','partitions', jsonb_build_array(
     jsonb_build_object('sourceDealerId','MP15395_inventory','identityVariants',1,'identity', jsonb_build_object('dealerId','MP15395_inventory')))))
  RETURNING id, path)
SELECT (SELECT id FROM ins WHERE path LIKE '%MP15398_inventory.csv') AS r98, (SELECT id FROM ins WHERE path LIKE '%MP15395_inventory.csv') AS r95, (SELECT id FROM ins WHERE path LIKE '%webhooktest%') AS rt;

-- Comparison
SELECT pg_temp.expect((SELECT inv_admin_preview_mapping('MP15398_inventory', infiniti, (SELECT r98 FROM r))->'comparison'->>'verdict' FROM s) = 'match', 'street abbreviations and ZIP text match the reviewed store');
SELECT pg_temp.expect((SELECT inv_admin_preview_mapping('MP15398_inventory', george, (SELECT r98 FROM r))->'comparison'->>'verdict' FROM s) = 'mismatch', 'Harte INFINITI cannot be mapped to George Harte INFINITI');
SELECT pg_temp.expect((SELECT inv_admin_preview_mapping('MP15395_inventory', george, (SELECT r95 FROM r))->'comparison'->>'verdict' FROM s) = 'match', 'S Colony Rd matches South Colony Road');
SELECT pg_temp.expect((SELECT inv_identity_compare('{"dealerName":"Harte Hyundai Old Saybrook","address":"235 MIDDLESEX TPKE","city":"Old Saybrook","postal":"06475","region":"CT"}', nozip)->>'verdict' FROM s) = 'incomplete', 'a store missing its ZIP is never a match');
SELECT pg_temp.raises($$SELECT inv_admin_preview_mapping('MP15395_inventory', (SELECT george FROM s), (SELECT rt FROM r))$$, 'test_file_cannot_be_mapped', 'the webhook test file cannot establish a mapping');
SELECT pg_temp.raises($$SELECT inv_admin_preview_mapping('MP99999_inventory', (SELECT george FROM s), (SELECT r95 FROM r))$$, 'dealer_not_in_dry_run', 'a DealerId absent from the dry run cannot be proposed');

-- Proposal ignores browser verdicts
SELECT pg_temp.raises($$SELECT inv_admin_propose_mapping('MP15398_inventory', (SELECT george FROM s), '{}'::jsonb, '{"verdict":"match"}'::jsonb)$$, 'dry_run_required', 'a client-supplied verdict without a dry run is refused');
CREATE TEMP TABLE m AS SELECT inv_admin_propose_mapping('MP15398_inventory', george, '{}'::jsonb, jsonb_build_object('verdict','match','run_id',(SELECT r98 FROM r))) AS wrong FROM s;
SELECT pg_temp.expect((SELECT evidence->>'verdict' = 'mismatch' AND evidence->>'computed_by' = 'server' FROM inventory_source_mappings WHERE id = (SELECT wrong FROM m)), 'the server records its own verdict, not the browser''s');
SELECT pg_temp.raises($$SELECT inv_admin_decide_mapping((SELECT wrong FROM m), 'approve', true)$$, 'identity_mismatch', 'a substantive address mismatch cannot be acknowledged away');
SELECT pg_temp.raises($$SELECT inv_admin_propose_mapping('MP15398_inventory', (SELECT infiniti FROM s), '{}'::jsonb, jsonb_build_object('run_id',(SELECT r98 FROM r)))$$, 'mapping_already_open', 'one open destination per DealerId');
SELECT inv_admin_decide_mapping((SELECT wrong FROM m), 'reject', false, 'wrong rooftop');

-- Approval re-checks store and file versions
CREATE TEMP TABLE m2 AS SELECT inv_admin_propose_mapping('MP15398_inventory', infiniti, '{}'::jsonb, jsonb_build_object('run_id',(SELECT r98 FROM r))) AS ok FROM s;
UPDATE inventory_feed_files SET last_content_sha256 = 'sha-a2' WHERE path LIKE '%MP15398_inventory.csv';
SELECT pg_temp.raises($$SELECT inv_admin_decide_mapping((SELECT ok FROM m2), 'approve')$$, 'file_changed_since_review', 'a newer file version needs a new dry run');
UPDATE inventory_feed_files SET last_content_sha256 = 'sha-a' WHERE path LIKE '%MP15398_inventory.csv';
SELECT inv_admin_save_store(jsonb_build_object('id', (SELECT infiniti FROM s), 'phone', '860-555-0100'));
SELECT pg_temp.raises($$SELECT inv_admin_decide_mapping((SELECT ok FROM m2), 'approve')$$, 'store_identity_changed_since_review', 'a store edited after review needs a new proposal');
SELECT inv_admin_decide_mapping((SELECT ok FROM m2), 'reject', false, 'store edited');
CREATE TEMP TABLE m3 AS SELECT inv_admin_propose_mapping('MP15398_inventory', infiniti, '{}'::jsonb, jsonb_build_object('run_id',(SELECT r98 FROM r))) AS ok FROM s;
SELECT inv_admin_decide_mapping((SELECT ok FROM m3), 'approve');
SELECT pg_temp.expect((SELECT status = 'approved' AND NOT identity_acknowledged AND evidence ? 'approved_comparison' FROM inventory_source_mappings WHERE id = (SELECT ok FROM m3)), 'a matching, current review approves');
SELECT pg_temp.expect((SELECT count(*) FROM store_inventory WHERE store_id = (SELECT infiniti FROM s)) = 0, 'mapping and approval write no inventory');

-- Name alias needs an explicit acknowledgement
SELECT inv_admin_save_store(jsonb_build_object('id', (SELECT george FROM s), 'display_name', 'George Harte Infiniti of Wallingford'));
CREATE TEMP TABLE m4 AS SELECT inv_admin_propose_mapping('MP15395_inventory', george, '{}'::jsonb, jsonb_build_object('run_id',(SELECT r95 FROM r))) AS ok FROM s;
SELECT pg_temp.raises($$SELECT inv_admin_decide_mapping((SELECT ok FROM m4), 'approve')$$, 'identity_not_confirmed', 'a name alias needs acknowledgement');
SELECT inv_admin_decide_mapping((SELECT ok FROM m4), 'approve', true, 'display name alias');
SELECT pg_temp.expect((SELECT identity_acknowledged FROM inventory_source_mappings WHERE id = (SELECT ok FROM m4)), 'the acknowledgement is recorded');

SELECT pg_temp.as_user('00000000-0000-0000-0000-00000000aa99');
SELECT pg_temp.raises($$SELECT inv_admin_preview_mapping('MP15398_inventory', (SELECT infiniti FROM s), (SELECT r98 FROM r))$$, NULL, 'store users cannot preview or propose mappings');
SELECT pg_temp.as_user(NULL);
SET ROLE authenticated;
SELECT pg_temp.raises($$SELECT inv_identity_compare('{}'::jsonb, NULL)$$, NULL, 'the comparison helper is not callable by clients');
RESET ROLE;

SELECT 'ALL MAPPING REVIEW SQL TESTS PASSED' AS result;
