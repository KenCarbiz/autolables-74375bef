-- Behaviour tests for proposed/20261110000000_store_scope_primary_precedence (needs 0006, 0007).
-- Synthetic data only. Shapes mirror the Nov 6 2026 production audit: one
-- primary store, sister stores, MarketCheck rows from a mapped dealer id and
-- from an unmapped group-site dealer id.
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

SELECT pg_temp.as_user(NULL);
INSERT INTO auth.users (id) VALUES ('00000000-0000-0000-0000-00000000e0a1'), ('00000000-0000-0000-0000-00000000e0b1') ON CONFLICT DO NOTHING;
INSERT INTO tenants (id, name) VALUES ('00000000-0000-0000-0000-0000000000e1', 'Synthetic Group E'), ('00000000-0000-0000-0000-0000000000e2', 'Synthetic Group F');
INSERT INTO tenant_members (tenant_id, user_id, role) VALUES
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000e0a1', 'owner'),
  ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-00000000e0b1', 'owner');
INSERT INTO dealer_groups (tenant_id, name) SELECT id, name FROM tenants WHERE id IN ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000e2') ON CONFLICT (tenant_id) DO NOTHING;
INSERT INTO dealer_stores (id, group_id, display_name, is_primary_inventory_store, subscription_status, inventory_feed_enabled, provider_ids)
  SELECT '00000000-0000-0000-0000-00000000e5a1', g.id, 'Synthetic Infiniti', true, 'subscribed', true, '{"marketcheck_dealer_id":"1013372"}'::jsonb FROM dealer_groups g WHERE g.tenant_id = '00000000-0000-0000-0000-0000000000e1';
INSERT INTO dealer_stores (id, group_id, display_name, subscription_status, inventory_feed_enabled)
  SELECT '00000000-0000-0000-0000-00000000e5b1', g.id, 'Synthetic Hyundai', 'subscribed', true FROM dealer_groups g WHERE g.tenant_id = '00000000-0000-0000-0000-0000000000e1';

-- Feed rows: the primary store has a new and a used car, the child a new car
-- and one absent from its last feed (kept, not removed).
INSERT INTO store_inventory (store_id, group_id, vin, source_dealer_id, condition, feed_price_status, presence, stock_number)
SELECT s.id, s.group_id, v.vin, 'MP1', v.cond, 'known', v.presence, v.stock
  FROM (VALUES
    ('00000000-0000-0000-0000-00000000e5a1'::uuid, 'JN8AZ3CC0T9000001', 'new', 'present', 'I100'),
    ('00000000-0000-0000-0000-00000000e5a1'::uuid, 'JN8AZ3CC0T9000002', 'used', 'present', 'I101'),
    ('00000000-0000-0000-0000-00000000e5b1'::uuid, 'KMHL64JA0TA000001', 'new', 'present', 'I100'),
    ('00000000-0000-0000-0000-00000000e5b1'::uuid, 'KMHL64JA0TA000002', 'used', 'missing', 'H200')
  ) AS v(store, vin, cond, presence, stock)
  JOIN dealer_stores s ON s.id = v.store;

INSERT INTO vehicle_listings (store_id, tenant_id, vin, slug, condition, status, owning_store_id, feed_source, mc_raw) VALUES
  ('x', '00000000-0000-0000-0000-0000000000e1', 'JN8AZ3CC0T9000001', 'e-1', 'new', 'published', '00000000-0000-0000-0000-00000000e5a1', 'filescom', NULL),
  ('x', '00000000-0000-0000-0000-0000000000e1', 'KMHL64JA0TA000001', 'e-2', 'new', 'draft', '00000000-0000-0000-0000-00000000e5b1', 'filescom', NULL),
  ('x', '00000000-0000-0000-0000-0000000000e1', 'JN8AZ3CC0T9000009', 'e-3', 'used', 'published', NULL, 'marketcheck', '{"dealer":{"id":"1013372"}}'),
  ('x', '00000000-0000-0000-0000-0000000000e1', '5NMP54G10TH000001', 'e-4', 'new', 'published', NULL, 'marketcheck', '{"dealer":{"id":"1028492"}}'),
  ('x', '00000000-0000-0000-0000-0000000000e1', '1HGCM82633A000001', 'e-5', 'used', 'published', NULL, NULL, NULL),
  ('x', '00000000-0000-0000-0000-0000000000e1', '1HGCM82633A000002', 'e-6', 'used', 'archived', NULL, 'marketcheck', '{"dealer":{"id":"1028492"}}');

-- ── Scope report ─────────────────────────────────────────────────────────
SELECT pg_temp.as_user('00000000-0000-0000-0000-00000000e0a1');
CREATE TEMP TABLE r AS SELECT inventory_scope_report('00000000-0000-0000-0000-0000000000e1') AS j;
SELECT pg_temp.expect((SELECT j->>'primary_store_id' FROM r) = '00000000-0000-0000-0000-00000000e5a1', 'the tenant has one identified primary store');
SELECT pg_temp.expect((SELECT (j->'stores'->0->>'primary')::boolean AND j->'stores'->0->>'name' = 'Synthetic Infiniti' FROM r), 'primary store is listed first');
SELECT pg_temp.expect((SELECT (j->'stores'->0->'feed'->>'present')::int = 2 AND (j->'stores'->0->'feed'->>'new')::int = 1 AND (j->'stores'->0->'feed'->>'used')::int = 1 FROM r), 'primary feed counts are the primary store''s vehicles only');
SELECT pg_temp.expect((SELECT (j->'stores'->1->'feed'->>'present')::int = 1 AND (j->'stores'->1->'feed'->>'absent_not_removed')::int = 1 FROM r), 'child counts are separate and an absent car is kept, not removed');
SELECT pg_temp.expect((SELECT (j->'stores'->0->'listings'->>'total')::int = 3 FROM r), 'primary listings = own feed car + mapped MarketCheck dealer + manual row');
SELECT pg_temp.expect((SELECT (j->'stores'->1->'listings'->>'total')::int = 1 FROM r), 'the child store''s listing never counts toward the primary');
SELECT pg_temp.expect((SELECT (j->'rooftop_review'->>'total')::int = 1 AND (j->'rooftop_review'->'by_dealer'->>'1028492')::int = 1 FROM r), 'an unmapped provider dealer id is held for review, archived rows ignored');
SELECT pg_temp.expect((SELECT count(*) FROM store_inventory WHERE vin = 'KMHL64JA0TA000002') = 1, 'the report deletes nothing');
SELECT pg_temp.raises($$SELECT inventory_scope_report('00000000-0000-0000-0000-0000000000e2')$$, 'not authorized', 'another account''s report is refused (tenant isolation)');
SELECT pg_temp.as_user('00000000-0000-0000-0000-00000000e0b1');
SELECT pg_temp.raises($$SELECT inventory_scope_report('00000000-0000-0000-0000-0000000000e1')$$, 'not authorized', 'a member of a different tenant cannot read this tenant');
SELECT pg_temp.as_user(NULL);

-- A dealer id mapped to two stores is ambiguous: review, never a guess.
UPDATE dealer_stores SET provider_ids = '{"marketcheck_dealer_id":["1013372"]}' WHERE id = '00000000-0000-0000-0000-00000000e5b1';
SELECT pg_temp.as_user('00000000-0000-0000-0000-00000000e0a1');
SELECT pg_temp.expect((inventory_scope_report('00000000-0000-0000-0000-0000000000e1')->'rooftop_review'->>'total')::int = 2, 'an ambiguous dealer mapping goes to review');
SELECT pg_temp.as_user(NULL);
UPDATE dealer_stores SET provider_ids = '{}' WHERE id = '00000000-0000-0000-0000-00000000e5b1';

-- ── Primary precedence for MarketCheck credits ───────────────────────────
DELETE FROM provider_requests;
UPDATE provider_accounts SET monthly_call_quota = 20, protected_reserve = 5, primary_store_holdback = 10 WHERE account_ref = 'marketcheck_primary';
INSERT INTO store_enrichment_policies (store_id, mode, credential_ref, mc_rooftop_id, mc_rooftop_verified_at, allowed_products, daily_request_limit, monthly_request_cap)
VALUES ('00000000-0000-0000-0000-00000000e5a1', 'enrichment', 'MARKETCHECK_API_KEY', 'r1', now(), ARRAY['neovin'], 100, 100),
       ('00000000-0000-0000-0000-00000000e5b1', 'enrichment', 'MARKETCHECK_API_KEY', 'r2', now(), ARRAY['neovin'], 100, 100);
SELECT pg_temp.expect((SELECT condition_priority FROM store_enrichment_policies WHERE store_id = '00000000-0000-0000-0000-00000000e5b1') = 'used_first', 'new-versus-used priority defaults to used first');

SELECT pg_temp.expect((store_enrichment_admit('00000000-0000-0000-0000-0000000000e1', 'KMHL64JA0TA000001', 'neovin', 'test', 'manual_refresh', 0.08)->>'admitted')::boolean, 'a child store may spend while calls remain above reserve + holdback');
INSERT INTO provider_requests (account_ref, product_key, caller, reason, priority, status, quota_units)
SELECT 'marketcheck_primary', 'neovin', 'test', 'test', 1, 'consumed', 1 FROM generate_series(1, 5);
SELECT pg_temp.expect(store_enrichment_admit('00000000-0000-0000-0000-0000000000e1', 'KMHL64JA0TA000001', 'neovin', 'test', 'manual_refresh', 0.08)->>'reason' = 'primary_precedence', 'a child store stops when only the reserve and primary holdback remain');
SELECT pg_temp.expect((store_enrichment_admit('00000000-0000-0000-0000-0000000000e1', 'JN8AZ3CC0T9000001', 'neovin', 'test', 'manual_refresh', 0.08)->>'admitted')::boolean, 'the primary store is still admitted at the same moment');
SELECT pg_temp.expect((SELECT count(*) FROM store_provider_usage WHERE store_id = '00000000-0000-0000-0000-00000000e5b1' AND deny_reason = 'primary_precedence') = 1, 'the refusal is logged against the child store');
SELECT pg_temp.expect((SELECT count(*) FROM provider_requests) = 5, 'the gate itself never creates a provider request');

-- Fails closed: no account row means no child-store spend.
UPDATE provider_accounts SET primary_store_holdback = 0 WHERE account_ref = 'marketcheck_primary';
DELETE FROM provider_requests;
ALTER TABLE provider_accounts DISABLE TRIGGER ALL;
UPDATE provider_accounts SET account_ref = 'marketcheck_renamed' WHERE account_ref = 'marketcheck_primary';
SELECT pg_temp.expect(store_enrichment_admit('00000000-0000-0000-0000-0000000000e1', 'KMHL64JA0TA000001', 'neovin', 'test', 'manual_refresh', 0.08)->>'reason' = 'account_missing', 'missing account state refuses child-store calls');
UPDATE provider_accounts SET account_ref = 'marketcheck_primary' WHERE account_ref = 'marketcheck_renamed';
ALTER TABLE provider_accounts ENABLE TRIGGER ALL;

-- Visibility does not depend on paid enrichment: a feed-only child still shows its vehicles.
UPDATE store_enrichment_policies SET mode = 'feed_only' WHERE store_id = '00000000-0000-0000-0000-00000000e5b1';
SELECT pg_temp.as_user('00000000-0000-0000-0000-00000000e0a1');
SELECT pg_temp.expect((inventory_scope_report('00000000-0000-0000-0000-0000000000e1')->'stores'->1->'feed'->>'present')::int = 1, 'turning enrichment off does not hide valid child-store inventory');
SELECT pg_temp.as_user(NULL);
