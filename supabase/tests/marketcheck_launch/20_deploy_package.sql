-- The deployment package: the Files.com worker schedule and the dispatcher
-- transport (supabase/manual), on stand-ins for Vault and pg_net. Synthetic.
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

CREATE SCHEMA IF NOT EXISTS vault;
CREATE TABLE vault.decrypted_secrets (name text PRIMARY KEY, decrypted_secret text);
CREATE SCHEMA IF NOT EXISTS net;
CREATE TABLE net.requests (id bigserial PRIMARY KEY, url text, body jsonb, headers jsonb, timeout_milliseconds integer);
CREATE TABLE net._http_response (id bigint PRIMARY KEY, status_code integer, content text, timed_out boolean, error_msg text);
CREATE FUNCTION net.http_post(url text, body jsonb DEFAULT '{}', params jsonb DEFAULT '{}', headers jsonb DEFAULT '{}', timeout_milliseconds integer DEFAULT 5000)
RETURNS bigint LANGUAGE sql AS $$ INSERT INTO net.requests (url, body, headers, timeout_milliseconds) VALUES (url, body, headers, timeout_milliseconds) RETURNING id $$;

\i supabase/manual/files_inventory_worker_schedule.sql
\i supabase/manual/marketcheck_launch_transport.sql

-- ── Files.com worker ─────────────────────────────────────────────────────
DELETE FROM cron.job WHERE command ~ '(files-inventory-worker|files_inventory_worker_tick)';
-- An old-style job that carried the key in its command.
INSERT INTO cron.job (jobname, schedule, command) VALUES ('files-inventory-worker', '*/10 * * * *',
  $c$SELECT net.http_post(url := 'https://x.supabase.co/functions/v1/files-inventory-worker', headers := '{"Authorization":"Bearer eyJsecret"}')$c$);
CREATE TEMP TABLE paused_before AS SELECT id, feed_import_paused FROM dealer_stores;
SELECT pg_temp.expect(NOT (files_inventory_worker_prerequisites()->>'vault_service_role_key')::boolean, 'prerequisites report the missing Vault secrets');
SELECT pg_temp.raises($$SELECT schedule_files_inventory_worker()$$, 'Vault entries required', 'scheduling refuses without the Vault secrets');
INSERT INTO vault.decrypted_secrets VALUES ('supabase_url', 'https://abcdefghijklmnop.supabase.co'), ('service_role_key', 'eyJ' || repeat('x', 60));
SELECT pg_temp.expect((SELECT bool_and(v::boolean) FROM jsonb_each_text(files_inventory_worker_prerequisites()) e(k, v) WHERE k IN ('pg_net','pg_cron','vault','vault_supabase_url','vault_service_role_key')),
  'prerequisites pass once Vault holds both secrets');
SELECT pg_temp.raises($$SELECT schedule_files_inventory_worker('every 15 minutes')$$, 'invalid_cron_expression', 'a malformed schedule is refused');
SELECT schedule_files_inventory_worker();
SELECT schedule_files_inventory_worker();
SELECT pg_temp.expect((SELECT count(*) FROM cron.job WHERE command ~ '(files-inventory-worker|files_inventory_worker_tick)') = 1, 'scheduling twice leaves exactly one worker job (the old key-carrying one is replaced)');
SELECT pg_temp.expect((SELECT schedule = '*/15 * * * *' AND command = 'SELECT public.files_inventory_worker_tick()' AND active FROM cron.job WHERE jobname = 'files-inventory-worker'),
  'default cadence every 15 minutes, inside vAuto''s 4-hour delivery');
SELECT pg_temp.expect(NOT EXISTS (SELECT 1 FROM cron.job WHERE command ~ 'eyJ|Bearer'), 'no cron command carries a key');
SELECT pg_temp.expect((SELECT bool_and(d.feed_import_paused = b.feed_import_paused) FROM dealer_stores d JOIN paused_before b USING (id)), 'scheduling unpauses no store');
SELECT files_inventory_worker_tick();
SELECT pg_temp.expect((SELECT url = 'https://abcdefghijklmnop.supabase.co/functions/v1/files-inventory-worker' AND body = '{"reconcile":true}'
    AND headers->>'Authorization' LIKE 'Bearer eyJ%' FROM net.requests ORDER BY id DESC LIMIT 1),
  'a tick reads Vault at run time and calls the worker with reconcile');
SELECT unschedule_files_inventory_worker();
SELECT pg_temp.expect(NOT EXISTS (SELECT 1 FROM cron.job WHERE command ~ 'files_inventory_worker_tick'), 'unschedule removes it');

-- ── Dispatcher transport ─────────────────────────────────────────────────
SELECT pg_temp.expect((marketcheck_launch_transport_ready()->>'ready')::boolean AND marketcheck_launch_transport_ready()->>'host' = 'abcdefghijklmnop.supabase.co',
  'the transport is ready with pg_net and both Vault secrets');
SELECT pg_temp.raises($$SELECT marketcheck_launch_transport('marketcheck-sync', '{}')$$, 'transport_function_not_in_plan', 'the transport calls only the plan''s workload function');
CREATE TEMP TABLE tr AS SELECT marketcheck_launch_transport('marketcheck-specs', '{"vin":"5N1AL1FWXTC358105"}') id;
SELECT pg_temp.expect((SELECT url = 'https://abcdefghijklmnop.supabase.co/functions/v1/marketcheck-specs' AND body->>'vin' = '5N1AL1FWXTC358105'
    FROM net.requests WHERE id = (SELECT id FROM tr)), 'the dispatcher request goes to marketcheck-specs with the VIN');
SELECT pg_temp.expect(marketcheck_launch_transport_result((SELECT id FROM tr)) IS NULL, 'no response yet reads as pending');
INSERT INTO net._http_response VALUES ((SELECT id FROM tr), 200, '{"ok":true,"endpoint":"neovin"}', false, NULL);
SELECT pg_temp.expect((SELECT (r->>'status_code')::int = 200 AND r->'body'->>'ok' = 'true' FROM (SELECT marketcheck_launch_transport_result((SELECT id FROM tr)) r) q),
  'the response is read back for settlement');
DELETE FROM vault.decrypted_secrets WHERE name = 'service_role_key';
SELECT pg_temp.expect(marketcheck_launch_transport_ready()->>'reason' = 'vault_service_role_key_missing', 'a missing key makes the transport not ready (readiness fails, START is refused)');
