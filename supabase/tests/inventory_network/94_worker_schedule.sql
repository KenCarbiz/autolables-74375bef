-- Secure worker scheduling (supabase/manual/files_inventory_worker_schedule.sql).
-- Stubs stand in for Vault, pg_net and pg_cron. Synthetic secrets only.
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
CREATE TABLE IF NOT EXISTS vault.decrypted_secrets (name text PRIMARY KEY, decrypted_secret text);
CREATE SCHEMA IF NOT EXISTS net;
CREATE TABLE IF NOT EXISTS net.calls (id bigserial PRIMARY KEY, url text, headers jsonb, body jsonb);
CREATE OR REPLACE FUNCTION net.http_post(url text, headers jsonb, body jsonb, timeout_milliseconds integer) RETURNS bigint LANGUAGE sql AS $$
  INSERT INTO net.calls (url, headers, body) VALUES (url, headers, body) RETURNING id $$;
CREATE SCHEMA IF NOT EXISTS cron;
CREATE TABLE IF NOT EXISTS cron.job (jobid bigserial PRIMARY KEY, jobname text, schedule text, command text);
CREATE OR REPLACE FUNCTION cron.schedule(n text, s text, c text) RETURNS bigint LANGUAGE sql AS $$ INSERT INTO cron.job (jobname, schedule, command) VALUES (n, s, c) RETURNING jobid $$;
CREATE OR REPLACE FUNCTION cron.unschedule(j bigint) RETURNS boolean LANGUAGE sql AS $$ DELETE FROM cron.job WHERE jobid = j RETURNING true $$;

-- An old-style job carrying a bearer credential is removed when the file is applied.
INSERT INTO cron.job (jobname, schedule, command) VALUES ('files-inventory-worker', '*/10 * * * *', 'select net.http_post(... ''Bearer eyJsecret'' ...)');
\i supabase/manual/files_inventory_worker_schedule.sql
SELECT pg_temp.expect(NOT EXISTS (SELECT 1 FROM cron.job WHERE command ILIKE '%bearer%'), 'a cron job holding a bearer credential is removed');

SELECT pg_temp.raises($$SELECT schedule_files_inventory_worker('*/10 * * * *')$$, 'Vault entries required', 'scheduling refuses to start without the Vault entries');
SELECT pg_temp.expect(files_inventory_worker_tick() IS NULL AND NOT EXISTS (SELECT 1 FROM net.calls), 'a tick without the worker key makes no call');

INSERT INTO vault.decrypted_secrets VALUES ('supabase_url', 'https://example.supabase.co/'), ('files_inventory_worker_key', repeat('k', 40));
SELECT pg_temp.raises($$SELECT schedule_files_inventory_worker('*/10 * * * *; DROP TABLE x')$$, 'cron_expression_invalid', 'a malformed schedule is refused');
SELECT schedule_files_inventory_worker('*/10 * * * *');
SELECT pg_temp.expect((SELECT command = 'SELECT public.files_inventory_worker_tick();' FROM cron.job WHERE jobname = 'files-inventory-worker'), 'the cron command holds no credential, only the tick call');
SELECT pg_temp.expect((SELECT count(*) FROM cron.job WHERE jobname = 'files-inventory-worker') = 1, 'rescheduling keeps one job');
SELECT pg_temp.expect(NOT EXISTS (SELECT 1 FROM cron.job WHERE command LIKE '%' || repeat('k', 40) || '%'), 'the worker key is not in any cron job');

UPDATE inventory_feed_controls SET ingestion_paused = true WHERE id = 1;
SELECT pg_temp.expect(files_inventory_worker_tick() IS NULL AND NOT EXISTS (SELECT 1 FROM net.calls), 'paused ingestion: the tick does not wake the worker');
UPDATE inventory_feed_controls SET ingestion_paused = false, emergency_stop = true WHERE id = 1;
SELECT pg_temp.expect(files_inventory_worker_tick() IS NULL AND NOT EXISTS (SELECT 1 FROM net.calls), 'emergency stop: the tick does not wake the worker');
UPDATE inventory_feed_controls SET emergency_stop = false WHERE id = 1;
SELECT files_inventory_worker_tick();
SELECT pg_temp.expect((SELECT url = 'https://example.supabase.co/functions/v1/files-inventory-worker' AND headers->>'x-files-inventory-worker-key' = repeat('k', 40)
  AND NOT headers ? 'Authorization' FROM net.calls ORDER BY id DESC LIMIT 1), 'a live tick sends the dedicated key, read at run time, and no service-role bearer');

SELECT pg_temp.expect(NOT has_function_privilege('authenticated', 'public.files_inventory_worker_tick()', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.files_inventory_worker_tick()', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.schedule_files_inventory_worker(text)', 'EXECUTE'), 'dealers and the public cannot tick or schedule the worker');
SELECT unschedule_files_inventory_worker();
SELECT pg_temp.expect(NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'files-inventory-worker'), 'unschedule removes the job');
DROP SCHEMA cron CASCADE; DROP SCHEMA net CASCADE; DROP SCHEMA vault CASCADE;
