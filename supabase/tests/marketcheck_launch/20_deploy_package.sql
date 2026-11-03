-- The deployment package: the scheduler secret, the Files.com worker schedule
-- and the dispatcher transport (migration 0019), on a pg_net stand-in. No
-- Vault anywhere. Synthetic.
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

CREATE SCHEMA IF NOT EXISTS net;
CREATE TABLE net.requests (id bigserial PRIMARY KEY, url text, body jsonb, headers jsonb, timeout_milliseconds integer);
CREATE TABLE net._http_response (id bigint PRIMARY KEY, status_code integer, content text, timed_out boolean, error_msg text);
CREATE FUNCTION net.http_post(url text, body jsonb DEFAULT '{}', params jsonb DEFAULT '{}', headers jsonb DEFAULT '{}', timeout_milliseconds integer DEFAULT 5000)
RETURNS bigint LANGUAGE sql AS $$ INSERT INTO net.requests (url, body, headers, timeout_milliseconds) VALUES (url, body, headers, timeout_milliseconds) RETURNING id $$;

-- 10_launch.sql swapped in a scratch transport; re-applying 0019 restores the
-- real one and proves the migration is re-runnable.
\i drizzle/migrations/0019_scheduler_invocation_secret.sql
\i drizzle/migrations/0019_scheduler_invocation_secret.sql

-- ── Scheduler secret ─────────────────────────────────────────────────────
SELECT pg_temp.expect((SELECT count(*) FROM scheduler_config) = 1, 're-applying 0019 keeps exactly one scheduler row');
CREATE TEMP TABLE sec AS SELECT invocation_secret s, rotated_at r FROM scheduler_config;
SELECT pg_temp.expect((SELECT s ~ '^[0-9a-f]{64}$' FROM sec), 'the invocation secret is 64 random hex characters generated in the database');
SELECT pg_temp.expect(scheduler_secret_matches((SELECT s FROM sec)), 'the generated secret verifies');
SELECT pg_temp.expect(NOT scheduler_secret_matches(repeat('0', 64)) AND NOT scheduler_secret_matches(NULL) AND NOT scheduler_secret_matches(''),
  'a wrong, null or empty secret does not verify');
SELECT pg_temp.expect(NOT has_table_privilege('anon', 'scheduler_config', 'SELECT') AND NOT has_table_privilege('authenticated', 'scheduler_config', 'SELECT'),
  'browsers cannot read the scheduler secret');
SELECT pg_temp.expect(NOT has_function_privilege('anon', 'scheduler_secret_matches(text)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'scheduler_secret_matches(text)', 'EXECUTE')
    AND has_function_privilege('service_role', 'scheduler_secret_matches(text)', 'EXECUTE'),
  'only the service role (the edge functions) can verify a secret');
SELECT pg_temp.expect(NOT has_function_privilege('anon', 'scheduler_post(text,jsonb,integer)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'scheduler_post(text,jsonb,integer)', 'EXECUTE')
    AND NOT has_function_privilege('service_role', 'scheduler_post(text,jsonb,integer)', 'EXECUTE'),
  'nobody can call scheduler_post directly');
SELECT scheduler_rotate_secret();
SELECT pg_temp.expect(NOT scheduler_secret_matches((SELECT s FROM sec)) AND (SELECT invocation_secret <> (SELECT s FROM sec) FROM scheduler_config),
  'rotation retires the old secret');
SELECT pg_temp.raises($$SELECT scheduler_post('../etc', '{}', 1000)$$, 'invalid_function_name', 'scheduler_post refuses a malformed function name');

-- ── Files.com worker ─────────────────────────────────────────────────────
DELETE FROM cron.job WHERE command ~ '(files-inventory-worker|files_inventory_worker_tick)';
-- An old-style job that carried the key in its command.
INSERT INTO cron.job (jobname, schedule, command) VALUES ('files-inventory-worker', '*/10 * * * *',
  $c$SELECT net.http_post(url := 'https://x.supabase.co/functions/v1/files-inventory-worker', headers := '{"Authorization":"Bearer eyJsecret"}')$c$);
CREATE TEMP TABLE paused_before AS SELECT id, feed_import_paused FROM dealer_stores;
CREATE TEMP TABLE cfg_saved AS SELECT * FROM scheduler_config;
DELETE FROM scheduler_config;
SELECT pg_temp.expect(NOT (files_inventory_worker_prerequisites()->>'scheduler_config')::boolean, 'prerequisites report a missing scheduler configuration');
SELECT pg_temp.raises($$SELECT schedule_files_inventory_worker()$$, 'scheduler_not_configured', 'scheduling refuses without the scheduler configuration');
INSERT INTO scheduler_config SELECT * FROM cfg_saved;
SELECT pg_temp.expect((SELECT bool_and(v::boolean) FROM jsonb_each_text(files_inventory_worker_prerequisites()) e(k, v) WHERE k IN ('pg_net','pg_cron','scheduler_config')),
  'prerequisites pass with pg_net, pg_cron and the scheduler configuration, and no manual secret');
SELECT pg_temp.raises($$SELECT schedule_files_inventory_worker('every 15 minutes')$$, 'invalid_cron_expression', 'a malformed schedule is refused');
SELECT schedule_files_inventory_worker();
SELECT schedule_files_inventory_worker();
SELECT pg_temp.expect((SELECT count(*) FROM cron.job WHERE command ~ '(files-inventory-worker|files_inventory_worker_tick)') = 1, 'scheduling twice leaves exactly one worker job (the old key-carrying one is replaced)');
SELECT pg_temp.expect((SELECT schedule = '*/15 * * * *' AND command = 'SELECT public.files_inventory_worker_tick()' AND active FROM cron.job WHERE jobname = 'files-inventory-worker'),
  'default cadence every 15 minutes, inside vAuto''s 4-hour delivery');
SELECT pg_temp.expect(NOT EXISTS (SELECT 1 FROM cron.job WHERE command ~ 'eyJ|Bearer|[0-9a-f]{64}'), 'no cron command carries a key or the secret');
SELECT pg_temp.expect((SELECT bool_and(d.feed_import_paused = b.feed_import_paused) FROM dealer_stores d JOIN paused_before b USING (id)), 'scheduling unpauses no store');
SELECT files_inventory_worker_tick();
SELECT pg_temp.expect((SELECT url = 'https://onnbmmdbrsgytfozfozn.supabase.co/functions/v1/files-inventory-worker' AND body = '{"reconcile":true}'
    AND headers->>'x-scheduler-secret' = (SELECT invocation_secret FROM scheduler_config)
    AND headers->>'Authorization' = 'Bearer ' || (SELECT gateway_key FROM scheduler_config)
    AND (SELECT gateway_key FROM scheduler_config) LIKE '%.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9ubmJtbWRicnNneXRmb3pmb3puIiwicm9sZSI6ImFub24i%'
    FROM net.requests ORDER BY id DESC LIMIT 1),
  'a tick reads the scheduler secret at run time and calls the worker with reconcile, past the gateway on the public anon key only');
SELECT unschedule_files_inventory_worker();
SELECT pg_temp.expect(NOT EXISTS (SELECT 1 FROM cron.job WHERE command ~ 'files_inventory_worker_tick'), 'unschedule removes it');

-- ── Dispatcher transport ─────────────────────────────────────────────────
SELECT pg_temp.expect((marketcheck_launch_transport_ready()->>'ready')::boolean AND marketcheck_launch_transport_ready()->>'host' = 'onnbmmdbrsgytfozfozn.supabase.co',
  'the transport is ready with pg_net and the scheduler configuration alone');
SELECT pg_temp.raises($$SELECT marketcheck_launch_transport('marketcheck-sync', '{}')$$, 'transport_function_not_in_plan', 'the transport calls only the plan''s workload function');
CREATE TEMP TABLE tr AS SELECT marketcheck_launch_transport('marketcheck-specs', '{"vin":"5N1AL1FWXTC358105"}') id;
SELECT pg_temp.expect((SELECT url = 'https://onnbmmdbrsgytfozfozn.supabase.co/functions/v1/marketcheck-specs' AND body->>'vin' = '5N1AL1FWXTC358105'
    AND headers->>'x-scheduler-secret' = (SELECT invocation_secret FROM scheduler_config)
    FROM net.requests WHERE id = (SELECT id FROM tr)), 'the dispatcher request goes to marketcheck-specs with the VIN and the scheduler secret');
SELECT pg_temp.expect(marketcheck_launch_transport_result((SELECT id FROM tr)) IS NULL, 'no response yet reads as pending');
INSERT INTO net._http_response VALUES ((SELECT id FROM tr), 200, '{"ok":true,"endpoint":"neovin"}', false, NULL);
SELECT pg_temp.expect((SELECT (r->>'status_code')::int = 200 AND r->'body'->>'ok' = 'true' FROM (SELECT marketcheck_launch_transport_result((SELECT id FROM tr)) r) q),
  'the response is read back for settlement');
DELETE FROM scheduler_config;
SELECT pg_temp.expect(marketcheck_launch_transport_ready()->>'reason' = 'scheduler_not_configured', 'a missing scheduler configuration makes the transport not ready (readiness fails, START is refused)');
SELECT pg_temp.raises($$SELECT marketcheck_launch_transport('marketcheck-specs', '{}')$$, 'scheduler_not_configured', 'and the transport refuses to send');
