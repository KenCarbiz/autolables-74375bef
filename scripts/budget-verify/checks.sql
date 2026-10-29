-- Checks for the per-dealership provider budgets (proposed migration
-- 20261103000000), run by run.sh on a throwaway copy of the replica. Every
-- tenant, user and number here is synthetic. With -v proposed=false only the
-- platform-parity sequence and the reproduction run, against the hosted gate.
\set ON_ERROR_STOP 1
SET client_min_messages = warning;
\o /dev/null
CREATE SCHEMA IF NOT EXISTS bv;
CREATE TABLE IF NOT EXISTS bv.results (n serial, label text, ok boolean, expected text, actual text);
CREATE OR REPLACE FUNCTION bv.check(label text, expected text, actual text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO bv.results (label, ok, expected, actual) VALUES (label, expected IS NOT DISTINCT FROM actual, expected, actual);
END $$;
-- One admitted or refused call; answers "admitted|reason".
CREATE OR REPLACE FUNCTION bv.call(p_provider text, p_tenant uuid, p_essential boolean DEFAULT false, p_caller text DEFAULT 'bv')
RETURNS text LANGUAGE sql AS $$
  SELECT CASE WHEN admitted THEN 't' ELSE 'f' END || '|' || reason FROM public.provider_call_admit(p_provider, 'p', p_caller, p_essential, p_tenant, NULL, NULL);
$$;
CREATE OR REPLACE FUNCTION bv.calls(p_provider text, p_tenant uuid, p_n integer, p_essential boolean DEFAULT false)
RETURNS text LANGUAGE sql AS $$
  SELECT string_agg(bv.call(p_provider, p_tenant, p_essential), ', ' ORDER BY i) FROM generate_series(1, p_n) i;
$$;

INSERT INTO public.tenants (id, name, slug) VALUES
  ('b0000000-0000-4000-8000-00000000000a', 'Synthetic Enforce Motors', 'bv-a'),
  ('b0000000-0000-4000-8000-00000000000b', 'Synthetic Unbudgeted Motors', 'bv-b'),
  ('b0000000-0000-4000-8000-00000000000c', 'Synthetic Combined Motors', 'bv-c'),
  ('b0000000-0000-4000-8000-00000000000d', 'Synthetic Alert Motors', 'bv-d'),
  ('b0000000-0000-4000-8000-00000000000e', 'Synthetic Dollar Motors', 'bv-e'),
  ('b0000000-0000-4000-8000-00000000000f', 'Synthetic Parity Motors', 'bv-f')
ON CONFLICT (id) DO NOTHING;
INSERT INTO auth.users (id, email) VALUES
  ('b1000000-0000-4000-8000-000000000001', 'platform-admin@example.test'),
  ('b1000000-0000-4000-8000-000000000002', 'dealer-user@example.test')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.user_roles (user_id, role) VALUES ('b1000000-0000-4000-8000-000000000001', 'admin') ON CONFLICT DO NOTHING;
-- Replica alignment: migration 20260626050347 grants this on the hosted
-- project but does not apply on the local stand-ins (it names a function the
-- stand-ins lack), so the grant is made here.
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated;

-- ── Platform rule: identical with and without the migration ─────────────
-- A three-call MarketCheck month with one call reserved for the feed.
BEGIN;
UPDATE public.provider_call_budgets SET monthly_call_cap = 3, reserve_for_essential = 1, enabled = true WHERE provider = 'marketcheck';
DELETE FROM public.provider_call_events WHERE provider = 'marketcheck';
SELECT bv.calls('marketcheck', 'b0000000-0000-4000-8000-00000000000f', 3) AS parity_sweep \gset
SELECT bv.calls('marketcheck', 'b0000000-0000-4000-8000-00000000000f', 2, true) AS parity_feed \gset
ROLLBACK;
SELECT bv.check('platform rule: sweep calls stop at the reserve, the feed at the cap',
  't|admitted, t|admitted, f|reserve_for_essential', :'parity_sweep');
SELECT bv.check('platform rule: the feed takes the reserved call, then everyone stops',
  't|admitted, f|monthly_cap', :'parity_feed');

\if :proposed
\else
SELECT bv.check('reproduction: without the migration a dealership has no limit on Firecrawl renders',
  repeat('t|ungated, ', 24) || 't|ungated',
  bv.calls('firecrawl', 'b0000000-0000-4000-8000-00000000000a', 25));
\endif

\if :proposed
-- ── Budgets, written as the service role would (fixtures) ───────────────
INSERT INTO public.provider_tenant_budgets (tenant_id, provider, mode, monthly_call_cap, monthly_usd_cap, alert_thresholds, block_essential) VALUES
  ('b0000000-0000-4000-8000-00000000000a', 'firecrawl', 'enforce', 3, NULL, '{50,100}', false),
  ('b0000000-0000-4000-8000-00000000000c', '*', 'enforce', 2, NULL, '{100}', false),
  ('b0000000-0000-4000-8000-00000000000d', 'firecrawl', 'alert_only', 1, NULL, '{80,100}', false),
  ('b0000000-0000-4000-8000-00000000000e', 'firecrawl', 'enforce', NULL, 1.00, '{50,100}', false);
INSERT INTO public.provider_unit_prices (provider, product, usd_per_call) VALUES ('firecrawl', '*', 0.5);

SELECT bv.check('enforce: three calls admitted, the fourth and fifth refused for the dealership',
  't|ungated, t|ungated, t|ungated, f|tenant_budget, f|tenant_budget',
  bv.calls('firecrawl', 'b0000000-0000-4000-8000-00000000000a', 5));
SELECT bv.check('enforce: refusals are ledgered as budget_denied and named',
  '2|tenant_budget:firecrawl',
  (SELECT count(*) || '|' || min(note) FROM public.provider_call_events WHERE tenant_id = 'b0000000-0000-4000-8000-00000000000a' AND outcome = 'budget_denied'));
SELECT bv.check('enforce: refusals do not count as use',
  '3', (SELECT calls::text FROM public.provider_tenant_month_usage('b0000000-0000-4000-8000-00000000000a', 'firecrawl')));
SELECT bv.check('enforce: alerts at 50% and 100%, and one "calls refused" alert for two refusals',
  'call_denied:0, threshold:50, threshold:100',
  (SELECT string_agg(kind || ':' || threshold, ', ' ORDER BY kind, threshold) FROM public.provider_budget_alerts WHERE tenant_id = 'b0000000-0000-4000-8000-00000000000a'));
SELECT bv.check('enforce: the 100% alert records the use that reached it',
  '3 of 3', (SELECT calls || ' of ' || monthly_call_cap FROM public.provider_budget_alerts WHERE tenant_id = 'b0000000-0000-4000-8000-00000000000a' AND threshold = 100));
SELECT bv.check('enforce: other providers for the same dealership are not limited',
  't|ungated', bv.call('blackbook', 'b0000000-0000-4000-8000-00000000000a'));

SELECT bv.check('no budget: another dealership is not limited',
  repeat('t|ungated, ', 9) || 't|ungated', bv.calls('firecrawl', 'b0000000-0000-4000-8000-00000000000b', 10));
SELECT bv.check('no budget: no alerts are queued for it',
  '0', (SELECT count(*)::text FROM public.provider_budget_alerts WHERE tenant_id = 'b0000000-0000-4000-8000-00000000000b'));

SELECT bv.check('all providers: two calls across two providers use the combined limit',
  't|ungated, t|ungated, f|tenant_budget',
  bv.call('firecrawl', 'b0000000-0000-4000-8000-00000000000c') || ', ' || bv.call('blackbook', 'b0000000-0000-4000-8000-00000000000c')
    || ', ' || bv.call('vinaudit', 'b0000000-0000-4000-8000-00000000000c'));
SELECT bv.check('all providers: the essential feed still passes an enforced limit',
  't|ungated', bv.call('firecrawl', 'b0000000-0000-4000-8000-00000000000c', true));
UPDATE public.provider_tenant_budgets SET block_essential = true WHERE tenant_id = 'b0000000-0000-4000-8000-00000000000c';
SELECT bv.check('all providers: with "also stop the inventory feed" the essential call is refused too',
  'f|tenant_budget', bv.call('firecrawl', 'b0000000-0000-4000-8000-00000000000c', true));

SELECT bv.check('alert only: calls past the limit are admitted',
  't|ungated, t|ungated, t|ungated', bv.calls('firecrawl', 'b0000000-0000-4000-8000-00000000000d', 3));
SELECT bv.check('alert only: each alert point is queued once for the month',
  'threshold:80, threshold:100',
  (SELECT string_agg(kind || ':' || threshold, ', ' ORDER BY threshold) FROM public.provider_budget_alerts WHERE tenant_id = 'b0000000-0000-4000-8000-00000000000d'));

SELECT bv.check('dollar limit: $0.50 calls admitted up to $1.00 and refused past it',
  't|ungated, t|ungated, f|tenant_budget', bv.calls('firecrawl', 'b0000000-0000-4000-8000-00000000000e', 3));
SELECT bv.check('dollar limit: the price per call is recorded on each event',
  '0.5000,0.5000,0.5000',
  (SELECT string_agg(estimated_cost_usd::text, ',' ORDER BY id) FROM public.provider_call_events WHERE tenant_id = 'b0000000-0000-4000-8000-00000000000e'));
SELECT bv.check('dollar limit: alerts at 50% and 100% by dollars',
  'call_denied:0, threshold:50, threshold:100',
  (SELECT string_agg(kind || ':' || threshold, ', ' ORDER BY kind, threshold) FROM public.provider_budget_alerts WHERE tenant_id = 'b0000000-0000-4000-8000-00000000000e'));

INSERT INTO public.provider_call_events (at, provider, product, caller, tenant_id, outcome)
SELECT date_trunc('month', now()) - interval '1 day', 'firecrawl', 'p', 'bv', 'b0000000-0000-4000-8000-00000000000a', 'admitted' FROM generate_series(1, 50);
SELECT bv.check('month: last month''s calls do not count against this month',
  '3', (SELECT calls::text FROM public.provider_tenant_month_usage('b0000000-0000-4000-8000-00000000000a', 'firecrawl')));

-- A dealership alert is not queued for a call the platform budget refused.
BEGIN;
UPDATE public.provider_call_budgets SET monthly_call_cap = 0, reserve_for_essential = 0, enabled = true WHERE provider = 'marketcheck';
INSERT INTO public.provider_tenant_budgets (tenant_id, provider, mode, monthly_call_cap, alert_thresholds)
VALUES ('b0000000-0000-4000-8000-00000000000f', 'marketcheck', 'alert_only', 1, '{100}');
SELECT bv.call('marketcheck', 'b0000000-0000-4000-8000-00000000000f') AS platform_refusal \gset
SELECT count(*) AS platform_refusal_alerts FROM public.provider_budget_alerts WHERE tenant_id = 'b0000000-0000-4000-8000-00000000000f' \gset
ROLLBACK;
SELECT bv.check('platform refusal: refused by the platform cap, and no dealership alert queued',
  'f|monthly_cap|0', :'platform_refusal' || '|' || :'platform_refusal_alerts');

-- ── Who can read and write ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION bv.as_user(uid text, q text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE r text;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    EXECUTE q INTO r;
  EXCEPTION WHEN OTHERS THEN
    r := 'error ' || SQLSTATE;
  END;
  RESET ROLE;
  RETURN r;
END $$;
GRANT USAGE ON SCHEMA bv TO authenticated, anon;

BEGIN;
SELECT bv.check('read: a dealer user sees no budgets', '0',
  bv.as_user('b1000000-0000-4000-8000-000000000002', 'SELECT count(*)::text FROM public.provider_tenant_budgets'));
SELECT bv.check('read: a dealer user sees no alerts or alert recipients', '0|0',
  bv.as_user('b1000000-0000-4000-8000-000000000002', 'SELECT (SELECT count(*) FROM public.provider_budget_alerts) || ''|'' || (SELECT count(*) FROM public.platform_alert_settings)'));
SELECT bv.check('read: a platform admin sees every budget', '4',
  bv.as_user('b1000000-0000-4000-8000-000000000001', 'SELECT count(*)::text FROM public.provider_tenant_budgets'));
SELECT bv.check('write: even a platform admin cannot write the table directly', 'error 42501',
  bv.as_user('b1000000-0000-4000-8000-000000000001', 'UPDATE public.provider_tenant_budgets SET monthly_call_cap = 999 RETURNING 1'));
SELECT bv.check('write: a dealer user cannot raise a budget through the function', 'error 42501',
  bv.as_user('b1000000-0000-4000-8000-000000000002', $q$SELECT mode FROM public.platform_set_tenant_budget('b0000000-0000-4000-8000-00000000000a', 'firecrawl', 'off')$q$));
SELECT bv.check('read: a dealer user cannot read the overview', 'error 42501',
  bv.as_user('b1000000-0000-4000-8000-000000000002', 'SELECT count(*)::text FROM public.platform_provider_budget_overview()'));
SELECT bv.check('gate: a signed-in user cannot call the gate itself', 'error 42501',
  bv.as_user('b1000000-0000-4000-8000-000000000001', $q$SELECT reason FROM public.provider_call_admit('firecrawl', 'p', 'x', false, NULL, NULL, NULL)$q$));
COMMIT;

SELECT bv.check('write: a platform admin sets a budget; the thresholds are sorted and de-duplicated',
  'enforce|25|40.00|{50,90}',
  bv.as_user('b1000000-0000-4000-8000-000000000001',
    $q$SELECT concat_ws('|', mode, monthly_call_cap, monthly_usd_cap, alert_thresholds) FROM public.platform_set_tenant_budget('b0000000-0000-4000-8000-00000000000b', 'blackbook', 'enforce', 25, 40, '{90,50,90}', false, ' trial ')$q$));
SELECT bv.check('write: the change is audited with who made it and the before/after',
  'provider_budget_changed|b1000000-0000-4000-8000-000000000001|null|enforce',
  (SELECT concat_ws('|', action, user_id, coalesce(details->>'before', 'null'), details->'after'->>'mode') FROM public.audit_log
    WHERE entity_type = 'provider_tenant_budget' ORDER BY created_at DESC LIMIT 1));
SELECT bv.check('write: an enforced budget with no limit is refused', 'error 23514',
  bv.as_user('b1000000-0000-4000-8000-000000000001', $q$SELECT mode FROM public.platform_set_tenant_budget('b0000000-0000-4000-8000-00000000000b', 'vinaudit', 'enforce')$q$));
SELECT bv.check('write: an alert point of 0% is refused', 'error 23514',
  bv.as_user('b1000000-0000-4000-8000-000000000001', $q$SELECT mode FROM public.platform_set_tenant_budget('b0000000-0000-4000-8000-00000000000b', 'vinaudit', 'alert_only', 5, NULL, '{0}')$q$));
SELECT bv.check('write: an unknown provider name is refused', 'error 23514',
  bv.as_user('b1000000-0000-4000-8000-000000000001', $q$SELECT mode FROM public.platform_set_tenant_budget('b0000000-0000-4000-8000-00000000000b', 'Bad Name!', 'alert_only', 5)$q$));
SELECT bv.as_user('b1000000-0000-4000-8000-000000000001', $q$SELECT public.platform_delete_tenant_budget('b0000000-0000-4000-8000-00000000000b', 'blackbook')::text$q$) AS removed \gset
SELECT bv.check('write: removing a budget is audited', 'true|provider_budget_removed|0',
  :'removed' || '|' || (SELECT action FROM public.audit_log WHERE entity_type = 'provider_tenant_budget' ORDER BY created_at DESC, id DESC LIMIT 1)
    || '|' || (SELECT count(*) FROM public.provider_tenant_budgets WHERE tenant_id = 'b0000000-0000-4000-8000-00000000000b'));

SELECT bv.check('alerts: email switched on with no address is refused', 'error 22023',
  bv.as_user('b1000000-0000-4000-8000-000000000001', $q$SELECT email_enabled::text FROM public.platform_set_alert_settings(true, false, '{}', '{}')$q$));
SELECT bv.check('alerts: a phone number not in +15551234567 form is refused', 'error 22023',
  bv.as_user('b1000000-0000-4000-8000-000000000001', $q$SELECT email_enabled::text FROM public.platform_set_alert_settings(false, true, '{}', '{555-0100}')$q$));
SELECT bv.check('alerts: email and text message both on, recipients cleaned',
  't|t|{ops@example.test}|{+15550100000}',
  bv.as_user('b1000000-0000-4000-8000-000000000001', $q$SELECT concat_ws('|', email_enabled, sms_enabled, email_recipients, sms_recipients) FROM public.platform_set_alert_settings(true, true, '{" Ops@Example.test ","ops@example.test"}', '{+15550100000}')$q$));
SELECT bv.check('alerts: a dealer user cannot change the recipients', 'error 42501',
  bv.as_user('b1000000-0000-4000-8000-000000000002', $q$SELECT email_enabled::text FROM public.platform_set_alert_settings(false, false, '{}', '{}')$q$));
SELECT bv.check('alerts: the settings change is audited', 'platform_alert_settings_changed',
  (SELECT action FROM public.audit_log WHERE entity_type = 'platform_alert_settings' ORDER BY created_at DESC LIMIT 1));

SELECT bv.check('overview: use and refusals per dealership and provider',
  'Synthetic Dollar Motors|firecrawl|enforce|2|1.00|1, Synthetic Enforce Motors|firecrawl|enforce|3|1.50|2',
  bv.as_user('b1000000-0000-4000-8000-000000000001',
    $q$SELECT string_agg(concat_ws('|', tenant_name, provider, mode, calls, round(usd, 2), denied), ', ' ORDER BY tenant_name) FROM public.platform_provider_budget_overview()
       WHERE tenant_name IN ('Synthetic Dollar Motors', 'Synthetic Enforce Motors') AND provider = 'firecrawl'$q$));
SELECT bv.check('schedule: the delivery job is defined but not started', '0',
  (SELECT count(*)::text FROM cron.job WHERE jobname = 'provider-budget-alerts'));
\endif

\o
\pset footer off
SELECT n, CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END AS result, label,
       CASE WHEN ok THEN '' ELSE 'expected ' || coalesce(expected, 'NULL') || ' / actual ' || coalesce(actual, 'NULL') END AS detail
FROM bv.results ORDER BY n;
SELECT count(*) FILTER (WHERE ok) || ' of ' || count(*) || ' checks passed' AS summary FROM bv.results;
-- Exits non-zero (division by zero) when any check failed.
\o /dev/null
SELECT 1 / bool_and(ok)::int FROM bv.results;
