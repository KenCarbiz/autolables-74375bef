-- Checks for the fail-closed provider budgets (proposed 20261106000000, on top
-- of 20261103000000) on a throwaway copy of the replica. Synthetic data.
\set ON_ERROR_STOP 1
SET client_min_messages = warning;
\o /dev/null
CREATE SCHEMA IF NOT EXISTS fc;
CREATE TABLE IF NOT EXISTS fc.results (n serial, label text, ok boolean, expected text, actual text);
CREATE OR REPLACE FUNCTION fc.check(label text, expected text, actual text) RETURNS void LANGUAGE sql AS
  $$ INSERT INTO fc.results (label, ok, expected, actual) VALUES (label, expected IS NOT DISTINCT FROM actual, expected, actual) $$;
CREATE OR REPLACE FUNCTION fc.call(p_provider text, p_essential boolean, p_tenant uuid DEFAULT NULL, p_cost numeric DEFAULT NULL) RETURNS text LANGUAGE sql AS
  $$ SELECT CASE WHEN admitted THEN 't' ELSE 'f' END || '|' || reason FROM public.provider_call_admit(p_provider, 'p', 'fc', p_essential, p_tenant, NULL, p_cost) $$;
CREATE OR REPLACE FUNCTION fc.calls(p_provider text, p_essential boolean, n int, p_tenant uuid DEFAULT NULL, p_cost numeric DEFAULT NULL) RETURNS text LANGUAGE sql AS
  $$ SELECT string_agg(fc.call(p_provider, p_essential, p_tenant, p_cost), ', ' ORDER BY i) FROM generate_series(1, n) i $$;
CREATE OR REPLACE FUNCTION fc.as_admin(q text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE out text;
BEGIN
  PERFORM set_config('request.jwt.claims', '{"sub":"f1000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
  SET LOCAL ROLE authenticated;
  BEGIN EXECUTE q INTO out; EXCEPTION WHEN OTHERS THEN out := 'error ' || SQLSTATE; END;
  RESET ROLE; RETURN out;
END $$;
CREATE OR REPLACE FUNCTION fc.as_dealer(q text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE out text;
BEGIN
  PERFORM set_config('request.jwt.claims', '{"sub":"f1000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
  SET LOCAL ROLE authenticated;
  BEGIN EXECUTE q INTO out; EXCEPTION WHEN OTHERS THEN out := 'error ' || SQLSTATE; END;
  RESET ROLE; RETURN out;
END $$;
GRANT USAGE ON SCHEMA fc TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated;  -- replica alignment (hosted 20260626050347)
INSERT INTO auth.users (id, email) VALUES ('f1000000-0000-4000-8000-000000000001', 'platform-admin@example.test'),
  ('f1000000-0000-4000-8000-000000000002', 'dealer-user@example.test') ON CONFLICT DO NOTHING;
INSERT INTO public.user_roles (user_id, role) VALUES ('f1000000-0000-4000-8000-000000000001', 'admin') ON CONFLICT DO NOTHING;
INSERT INTO public.tenants (id, name, slug) VALUES ('f2000000-0000-4000-8000-000000000001', 'Synthetic Feed Motors', 'fc-a') ON CONFLICT DO NOTHING;
DELETE FROM public.provider_call_events;
UPDATE public.provider_call_budgets SET enabled = false;

-- Fresh: everything disabled
SELECT fc.check('fresh: the inventory feed is refused (lane disabled)', 'f|disabled', fc.call('marketcheck', true));
SELECT fc.check('fresh: MarketCheck enrichment is refused (lane disabled)', 'f|disabled', fc.call('marketcheck', false));
SELECT fc.check('fresh: Firecrawl is refused (lane disabled)', 'f|disabled', fc.call('firecrawl', false));
SELECT fc.check('fresh: a provider with no lane at all is refused', 'f|unconfigured', fc.call('example_unlisted', false));
SELECT fc.check('fresh: Google Places is seeded and refused (lane disabled)', 'f|disabled', fc.call('google_places', false));
SELECT fc.check('fresh: the feed lane exists only for MarketCheck', 'error 23514',
  fc.as_admin($q$SELECT enabled::text FROM public.platform_set_provider_lane_budget('firecrawl', 'essential_sync', true, 5, NULL, 'call', NULL, 'try')$q$));
SELECT fc.check('fresh: every refusal is in the ledger as budget_denied with its reason and lane', '5|disabled:enrichment,disabled:essential_sync,unconfigured:enrichment',
  (SELECT count(*) || '|' || string_agg(DISTINCT note, ',' ORDER BY note) FROM public.provider_call_events WHERE outcome = 'budget_denied'));

-- Admin: enabling needs a limit and a reason; dealers cannot
SELECT fc.check('admin: a lane cannot be enabled without a limit', 'error 23514',
  fc.as_admin($q$SELECT enabled::text FROM public.platform_set_provider_lane_budget('marketcheck', 'essential_sync', true, NULL, NULL, 'call', NULL, 'try')$q$));
SELECT fc.check('admin: a change needs a reason', 'error 22023',
  fc.as_admin($q$SELECT enabled::text FROM public.platform_set_provider_lane_budget('marketcheck', 'essential_sync', true, 3, NULL, 'call', NULL, ' ')$q$));
SELECT fc.check('admin: a dealer user cannot set a lane', 'error 42501',
  fc.as_dealer($q$SELECT enabled::text FROM public.platform_set_provider_lane_budget('marketcheck', 'essential_sync', true, 3, NULL, 'call', NULL, 'try')$q$));
SELECT fc.check('admin: a dealer user cannot read the lanes', '0', fc.as_dealer('SELECT count(*)::text FROM public.provider_lane_budgets'));
SELECT fc.as_admin($q$SELECT enabled || '|' || monthly_call_cap FROM public.platform_set_provider_lane_budget('marketcheck', 'essential_sync', true, 3, NULL, 'call', NULL, 'test feed lane')$q$) AS set_feed \gset
SELECT fc.check('admin: the feed lane enabled at 3 calls, audited with who and the reason, notes kept',
  'true|3|provider_lane_budget_changed|f1000000-0000-4000-8000-000000000001|test feed lane|t',
  :'set_feed' || '|' || (SELECT action || '|' || user_id || '|' || (details->>'reason') FROM public.audit_log WHERE entity_type = 'provider_lane_budget' ORDER BY created_at DESC LIMIT 1)
  || '|' || (SELECT CASE WHEN notes IS NOT NULL THEN 't' ELSE 'f' END FROM public.provider_lane_budgets WHERE provider = 'marketcheck' AND lane = 'essential_sync'));

-- Separate lanes
SELECT fc.check('lanes: the feed gets its 3 calls, then stops', 't|admitted, t|admitted, t|admitted, f|lane_cap', fc.calls('marketcheck', true, 4));
SELECT fc.check('lanes: enrichment is still disabled while the feed lane is open', 'f|disabled', fc.call('marketcheck', false));
SELECT fc.as_admin($q$SELECT enabled::text FROM public.platform_set_provider_lane_budget('marketcheck', 'enrichment', true, 2, NULL, 'call', NULL, 'test enrichment lane')$q$);
SELECT fc.check('lanes: enrichment has its own 2 calls; the exhausted feed lane does not take them', 't|admitted, t|admitted, f|lane_cap', fc.calls('marketcheck', false, 3));
SELECT fc.check('lanes: enrichment spending did not reopen or consume the feed lane', 'f|lane_cap', fc.call('marketcheck', true));

-- Platform plan ceiling across both lanes
SELECT fc.as_admin($q$SELECT enabled::text FROM public.platform_set_provider_lane_budget('marketcheck', 'enrichment', true, 100, NULL, 'call', NULL, 'raise')$q$);
UPDATE public.provider_call_budgets SET enabled = true, monthly_call_cap = 6 WHERE provider = 'marketcheck';
SELECT fc.check('ceiling: the plan cap counts both lanes (5 used, 1 left)', 't|admitted, f|monthly_cap', fc.calls('marketcheck', false, 2));
UPDATE public.provider_call_budgets SET enabled = false WHERE provider = 'marketcheck';

-- Dollar limits
SELECT fc.as_admin($q$SELECT enabled::text FROM public.platform_set_provider_lane_budget('firecrawl', 'enrichment', true, NULL, 1.00, 'request', NULL, 'test usd lane')$q$);
SELECT fc.check('dollars: a dollar-limited lane refuses a call it cannot price', 'f|unpriced', fc.call('firecrawl', false));
INSERT INTO public.provider_unit_prices (provider, product, usd_per_call) VALUES ('firecrawl', '*', 0.5);
SELECT fc.check('dollars: priced at $0.50, two calls fit in $1.00, the third is refused', 't|admitted, t|admitted, f|lane_usd_cap', fc.calls('firecrawl', false, 3));

-- Dealership enforce: no inventory exception
INSERT INTO public.provider_tenant_budgets (tenant_id, provider, mode, monthly_call_cap, block_essential)
VALUES ('f2000000-0000-4000-8000-000000000001', '*', 'enforce', 1, false);
SELECT fc.as_admin($q$SELECT enabled::text FROM public.platform_set_provider_lane_budget('marketcheck', 'essential_sync', true, 100, NULL, 'call', NULL, 'raise feed')$q$);
SELECT fc.check('no exception: an enforced dealership budget refuses the feed too', 't|admitted, f|tenant_budget',
  fc.calls('marketcheck', true, 2, 'f2000000-0000-4000-8000-000000000001'));

-- Reconciliation
SELECT (SELECT event_id FROM public.provider_call_admit('marketcheck', 'p', 'fc', false, NULL, NULL, NULL)) AS ev \gset
SELECT public.provider_call_record(:ev, 200, 'ok', NULL);
SELECT fc.check('reconcile: the reservation takes the answer and a time', 'ok|200|true',
  (SELECT outcome || '|' || http_status || '|' || (reconciled_at IS NOT NULL) FROM public.provider_call_events WHERE id = :ev));
SELECT (SELECT event_id FROM public.provider_call_admit('marketcheck', 'p', 'fc-lost-worker', false, NULL, NULL, NULL)) AS lost \gset
UPDATE public.provider_call_events SET at = now() - interval '1 hour' WHERE id = :lost;
SELECT fc.check('reconcile: a reservation that never came back is listed, and still counted', 'fc-lost-worker|admitted',
  (SELECT caller FROM public.provider_call_unreconciled() WHERE id = :lost) || '|' || (SELECT outcome FROM public.provider_call_events WHERE id = :lost));
SELECT fc.check('reconcile: a second answer cannot overwrite a reconciled event', 'ok',
  (SELECT outcome FROM (SELECT public.provider_call_record(:ev, 500, 'provider_error', NULL)) x, public.provider_call_events WHERE id = :ev));

-- No secrets in the ledger
SELECT fc.check('ledger: no column for a URL, key or token', '0',
  (SELECT count(*)::text FROM information_schema.columns WHERE table_schema = 'public' AND table_name IN ('provider_call_events', 'provider_lane_budgets')
     AND column_name ~* '(url|key|token|secret|header)'));

\o
\pset footer off
SELECT n, CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END AS result, label,
       CASE WHEN ok THEN '' ELSE 'expected ' || coalesce(expected, 'NULL') || ' / actual ' || coalesce(actual, 'NULL') END AS detail
FROM fc.results ORDER BY n;
SELECT count(*) FILTER (WHERE ok) || ' of ' || count(*) || ' checks passed' AS summary FROM fc.results;
\o /dev/null
SELECT 1 / bool_and(ok)::int FROM fc.results;
