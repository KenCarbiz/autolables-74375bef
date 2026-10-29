-- Checks for the crawl controls (proposed migration 20261104000000) on a
-- throwaway copy of the replica, synthetic data only. run.sh adds the two
-- concurrency checks, which need two sessions.
\set ON_ERROR_STOP 1
SET client_min_messages = warning;
\o /dev/null
CREATE SCHEMA IF NOT EXISTS cv;
CREATE TABLE IF NOT EXISTS cv.results (n serial, label text, ok boolean, expected text, actual text);
CREATE OR REPLACE FUNCTION cv.check(label text, expected text, actual text) RETURNS void LANGUAGE sql AS
  $$ INSERT INTO cv.results (label, ok, expected, actual) VALUES (label, expected IS NOT DISTINCT FROM actual, expected, actual) $$;
CREATE OR REPLACE FUNCTION cv.as_role(r text, uid text, q text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE out text;
BEGIN
  PERFORM set_config('request.jwt.claims', CASE WHEN uid IS NULL THEN '' ELSE json_build_object('sub', uid, 'role', r)::text END, true);
  EXECUTE format('SET LOCAL ROLE %I', r);
  BEGIN EXECUTE q INTO out; EXCEPTION WHEN OTHERS THEN out := 'error ' || SQLSTATE; END;
  RESET ROLE;
  RETURN out;
END $$;
GRANT USAGE ON SCHEMA cv TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated;  -- replica alignment (hosted 20260626050347)

INSERT INTO auth.users (id, email) VALUES
  ('c1000000-0000-4000-8000-000000000001', 'platform-admin@example.test'),
  ('c1000000-0000-4000-8000-000000000002', 'dealer-user@example.test') ON CONFLICT DO NOTHING;
INSERT INTO public.user_roles (user_id, role) VALUES ('c1000000-0000-4000-8000-000000000001', 'admin') ON CONFLICT DO NOTHING;
INSERT INTO public.tenants (id, name, slug) VALUES ('c2000000-0000-4000-8000-000000000001', 'Synthetic Control Motors', 'cv-a') ON CONFLICT DO NOTHING;
INSERT INTO public.vehicle_listings (id, tenant_id, store_id, vin, slug, advertised_price_before_doc, doc_fee, website_sale_price)
VALUES ('c3000000-0000-4000-8000-000000000001', 'c2000000-0000-4000-8000-000000000001', 'c2000000-0000-4000-8000-000000000001',
        '1HGCM82633A004352', 'cv-synthetic-1', 20000, 500, 20500)
ON CONFLICT (id) DO NOTHING;

CREATE OR REPLACE FUNCTION cv.pricing() RETURNS text LANGUAGE sql AS
  $$ SELECT concat_ws('|', advertised_price_before_doc::int, doc_fee::int, website_sale_price::int) FROM public.vehicle_listings WHERE id = 'c3000000-0000-4000-8000-000000000001' $$;
CREATE OR REPLACE FUNCTION cv.promote(p_before int) RETURNS text LANGUAGE sql AS $$
  SELECT public.crawl_promote_listing('c3000000-0000-4000-8000-000000000001',
    jsonb_build_object('advertised_price_before_doc', 20000, 'doc_fee', 500, 'website_sale_price', 20500),
    jsonb_build_object('advertised_price_before_doc', p_before, 'doc_fee', 500, 'website_sale_price', p_before + 500, 'price_parse_status', 'ok'), NULL)
$$;
GRANT EXECUTE ON FUNCTION cv.promote(int) TO service_role;
GRANT EXECUTE ON FUNCTION cv.check(text, text, text) TO service_role;

SELECT cv.check('default: both switches off, version 1', 'f|f|1',
  (SELECT concat_ws('|', CASE WHEN execution_enabled THEN 't' ELSE 'f' END, CASE WHEN promotion_enabled THEN 't' ELSE 'f' END, version) FROM public.crawl_control_state()));
SELECT cv.check('default: the crawler''s promotion is held and the listing is unchanged', 'held_promotion_off|20000|500|20500',
  cv.as_role('service_role', NULL, 'SELECT cv.promote(19000)') || '|' || cv.pricing());

SELECT cv.check('auth: a dealer user cannot enable promotion', 'error 42501',
  cv.as_role('authenticated', 'c1000000-0000-4000-8000-000000000002', $q$SELECT version::text FROM public.platform_set_crawl_control(true, true, 'try', 1)$q$));
SELECT cv.check('auth: the anonymous role cannot call the setter', 'error 42501',
  cv.as_role('anon', NULL, $q$SELECT version::text FROM public.platform_set_crawl_control(true, true, 'try', 1)$q$));
SELECT cv.check('auth: the service role (the crawler) cannot enable promotion through the setter', 'error 42501',
  cv.as_role('service_role', NULL, $q$SELECT version::text FROM public.platform_set_crawl_control(true, true, 'try', 1)$q$));
SELECT cv.check('auth: the service role cannot write the table directly', 'error 42501',
  cv.as_role('service_role', NULL, $q$UPDATE public.crawl_control SET promotion_enabled = true RETURNING 'x'$q$));
SELECT cv.check('auth: a platform admin cannot write the table directly either', 'error 42501',
  cv.as_role('authenticated', 'c1000000-0000-4000-8000-000000000001', $q$UPDATE public.crawl_control SET promotion_enabled = true RETURNING 'x'$q$));
SELECT cv.check('auth: a signed-in user cannot call the promotion function', 'error 42501',
  cv.as_role('authenticated', 'c1000000-0000-4000-8000-000000000001', $q$SELECT public.crawl_promote_listing('c3000000-0000-4000-8000-000000000001', '{}'::jsonb, '{"website_sale_price": 1}'::jsonb, NULL)$q$));
SELECT cv.check('read: a dealer user cannot see the switches; an admin can', '0|1',
  cv.as_role('authenticated', 'c1000000-0000-4000-8000-000000000002', 'SELECT count(*)::text FROM public.crawl_control') || '|' ||
  cv.as_role('authenticated', 'c1000000-0000-4000-8000-000000000001', 'SELECT count(*)::text FROM public.crawl_control'));
SELECT cv.check('after refused attempts: still off, still version 1, nothing audited', 'f|f|1|0',
  (SELECT concat_ws('|', CASE WHEN execution_enabled THEN 't' ELSE 'f' END, CASE WHEN promotion_enabled THEN 't' ELSE 'f' END, version) FROM public.crawl_control)
  || '|' || (SELECT count(*) FROM public.audit_log WHERE action = 'crawl_control_changed'));

SELECT cv.check('admin: a change needs a reason', 'error 22023',
  cv.as_role('authenticated', 'c1000000-0000-4000-8000-000000000001', $q$SELECT version::text FROM public.platform_set_crawl_control(true, false, '  ', 1)$q$));
SELECT cv.check('admin: a stale version is refused', 'error 40001',
  cv.as_role('authenticated', 'c1000000-0000-4000-8000-000000000001', $q$SELECT version::text FROM public.platform_set_crawl_control(true, false, 'observe only', 7)$q$));
SELECT cv.check('admin: execution on, promotion still off (observation-only)', '2',
  cv.as_role('authenticated', 'c1000000-0000-4000-8000-000000000001', $q$SELECT version::text FROM public.platform_set_crawl_control(true, false, 'observe only', 1)$q$));
SELECT cv.check('observation-only: promotion still held', 'held_promotion_off|20000|500|20500',
  cv.as_role('service_role', NULL, 'SELECT cv.promote(19000)') || '|' || cv.pricing());
SELECT cv.check('admin: promotion on', '3',
  cv.as_role('authenticated', 'c1000000-0000-4000-8000-000000000001', $q$SELECT version::text FROM public.platform_set_crawl_control(true, true, 'supervised run approved', 2)$q$));
SELECT cv.check('record: who, when and why are on the row', 'c1000000-0000-4000-8000-000000000001|supervised run approved|t',
  (SELECT concat_ws('|', updated_by, reason, (updated_at > now() - interval '1 minute')) FROM public.crawl_control));
SELECT cv.check('record: each change is audited with the admin and the before/after switches', '2|c1000000-0000-4000-8000-000000000001|false->true',
  (SELECT count(*) || '|' || min(user_id::text) FROM public.audit_log WHERE action = 'crawl_control_changed') || '|' ||
  (SELECT (details->'before'->>'promotion_enabled') || '->' || (details->'after'->>'promotion_enabled') FROM public.audit_log
    WHERE action = 'crawl_control_changed' ORDER BY (details->'after'->>'version')::int DESC LIMIT 1));

SELECT cv.check('promotion on: the guarded write applies', 'promoted|19000|500|19500',
  cv.as_role('service_role', NULL, 'SELECT cv.promote(19000)') || '|' || cv.pricing());
SELECT cv.check('promotion on: a listing that moved is not overwritten', 'conflict|19000|500|19500',
  cv.as_role('service_role', NULL, 'SELECT cv.promote(18000)') || '|' || cv.pricing());
SELECT cv.check('promotion on: a field outside the price fields is refused', 'error 22023',
  cv.as_role('service_role', NULL, $q$SELECT public.crawl_promote_listing('c3000000-0000-4000-8000-000000000001', '{}'::jsonb, '{"price": 1}'::jsonb, NULL)$q$));

UPDATE public.vehicle_listings SET advertised_price_before_doc = 20000, doc_fee = 500, website_sale_price = 20500 WHERE id = 'c3000000-0000-4000-8000-000000000001';
BEGIN;
DELETE FROM public.crawl_control;
SELECT concat_ws('|', CASE WHEN execution_enabled THEN 't' ELSE 'f' END, CASE WHEN promotion_enabled THEN 't' ELSE 'f' END) AS missing_state FROM public.crawl_control_state() \gset
SELECT cv.promote(19000) || '|' || cv.pricing() AS missing_promote \gset
ROLLBACK;
SELECT cv.check('missing row: both switches read off', 'f|f', :'missing_state');
SELECT cv.check('missing row: promotion held, listing unchanged', 'held_promotion_off|20000|500|20500', :'missing_promote');

\o
\pset footer off
SELECT n, CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END AS result, label,
       CASE WHEN ok THEN '' ELSE 'expected ' || coalesce(expected, 'NULL') || ' / actual ' || coalesce(actual, 'NULL') END AS detail
FROM cv.results ORDER BY n;
SELECT count(*) FILTER (WHERE ok) || ' of ' || count(*) || ' checks passed' AS summary FROM cv.results;
\o /dev/null
SELECT 1 / bool_and(ok)::int FROM cv.results;
