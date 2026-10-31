-- Behaviour tests for 20261031130000_passport_payment_estimator. Run by
-- scripts/test-payment-estimator-sql.sh against a scratch database. Synthetic
-- rates only. Any failed expectation raises and stops the run.
\set ON_ERROR_STOP 1

CREATE OR REPLACE FUNCTION pg_temp.expect(cond boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF cond IS NOT TRUE THEN RAISE EXCEPTION 'FAILED: %', label; END IF; RAISE NOTICE 'ok  %', label; END $$;

CREATE OR REPLACE FUNCTION pg_temp.raises(sql text, expected text, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN EXECUTE sql; EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%' || expected || '%' THEN RAISE EXCEPTION 'FAILED: % (raised "%" not "%")', label, SQLERRM, expected; END IF;
    RAISE NOTICE 'ok  % (%)', label, SQLERRM; RETURN;
  END;
  RAISE EXCEPTION 'FAILED: % (did not raise)', label;
END $$;

-- ── Fixtures ───────────────────────────────────────────────────────────────
-- Tenant A has two rooftops (a-store-1, a-store-2); tenant B has its default store.
INSERT INTO auth.users (id) VALUES ('00000000-0000-0000-0000-00000000aa01'), ('00000000-0000-0000-0000-00000000aa02'),
  ('00000000-0000-0000-0000-00000000bb01'), ('00000000-0000-0000-0000-00000000ad01');
INSERT INTO tenants (id, name) VALUES ('00000000-0000-0000-0000-0000000000a1', 'Group A'), ('00000000-0000-0000-0000-0000000000b1', 'Group B');
INSERT INTO onboarding_profiles (tenant_id, stores) VALUES
  ('00000000-0000-0000-0000-0000000000a1', '[{"id":"a-store-1","name":"A One"},{"id":"a-store-2","name":"A Two"}]'),
  ('00000000-0000-0000-0000-0000000000b1', '[]');
INSERT INTO tenant_members (tenant_id, user_id, role) VALUES
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000aa01', 'gsm'),
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000aa02', 'sales'),
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-00000000bb01', 'owner');
INSERT INTO user_roles (user_id, role) VALUES ('00000000-0000-0000-0000-00000000ad01', 'admin');

CREATE TEMP TABLE cfg (name text PRIMARY KEY, body jsonb);
GRANT SELECT ON cfg TO authenticated;
INSERT INTO cfg VALUES
 ('a1', '{"enabled":true,"downPayment":{"mode":"percent","percent":10,"amount":null},"shopperControls":{"downPayment":true,"term":true,"aprOverride":true},
          "rules":[{"id":"r1","enabled":true,"startYear":2022,"endYear":2025,"defaultTermMonths":60,"terms":[{"months":48,"enabled":true,"aprPercent":7.75},{"months":60,"enabled":true,"aprPercent":8},{"months":72,"enabled":false,"aprPercent":null}]}]}'),
 ('a1b', '{"enabled":true,"downPayment":{"mode":"percent","percent":10,"amount":null},"shopperControls":{"downPayment":true,"term":true,"aprOverride":true},
          "rules":[{"id":"r1","enabled":true,"startYear":2022,"endYear":2025,"defaultTermMonths":60,"terms":[{"months":60,"enabled":true,"aprPercent":0}]}]}'),
 ('a2', '{"enabled":true,"downPayment":{"mode":"amount","percent":null,"amount":1500},"shopperControls":{"downPayment":true,"term":false,"aprOverride":false},
          "rules":[{"id":"x","enabled":true,"startYear":2018,"endYear":2021,"defaultTermMonths":48,"terms":[{"months":48,"enabled":true,"aprPercent":9.5}]}]}'),
 ('off', '{"enabled":false,"downPayment":{"mode":"percent","percent":10,"amount":null},"shopperControls":{"downPayment":true,"term":true,"aprOverride":true},
          "rules":[{"id":"r1","enabled":true,"startYear":2022,"endYear":2025,"defaultTermMonths":60,"terms":[{"months":48,"enabled":true,"aprPercent":7.75},{"months":60,"enabled":true,"aprPercent":8},{"months":72,"enabled":false,"aprPercent":null}]}]}');

CREATE OR REPLACE FUNCTION pg_temp.apply_as(p_user uuid, p_tenant uuid, p_store text, p_base int, p_cfg text, p_req uuid) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE v jsonb;
BEGIN
  PERFORM set_config('test.uid', COALESCE(p_user::text, ''), false);
  SELECT public.apply_payment_estimator_settings(p_tenant, p_store, p_base, (SELECT body FROM cfg WHERE name = p_cfg), p_req) INTO v;
  RETURN v;
END $$;

-- ── Validation ─────────────────────────────────────────────────────────────
SELECT pg_temp.expect(array_length(payment_estimator_config_errors((SELECT body FROM cfg WHERE name = 'a1')), 1) IS NULL, 'valid config has no errors');
SELECT pg_temp.expect(array_length(payment_estimator_config_errors((SELECT body FROM cfg WHERE name = 'a1b')), 1) IS NULL, '0% APR is valid');
SELECT pg_temp.expect(array_length(payment_estimator_config_errors(jsonb_set((SELECT body FROM cfg WHERE name = 'a1'), '{rules,1}',
  '{"id":"r2","enabled":true,"startYear":2025,"endYear":2026,"defaultTermMonths":60,"terms":[{"months":60,"enabled":true,"aprPercent":8}]}', true)), 1) = 1, 'overlapping boundary year rejected');
SELECT pg_temp.expect(array_length(payment_estimator_config_errors(jsonb_set((SELECT body FROM cfg WHERE name = 'a1'), '{rules,1}',
  '{"id":"r2","enabled":true,"startYear":2018,"endYear":2021,"defaultTermMonths":48,"terms":[{"months":48,"enabled":true,"aprPercent":8}]}', true)), 1) IS NULL, 'adjacent range accepted');
SELECT pg_temp.expect(array_length(payment_estimator_config_errors(jsonb_set((SELECT body FROM cfg WHERE name = 'a1'), '{rules,0,startYear}', '2026')), 1) >= 1, 'start after end rejected');
SELECT pg_temp.expect(array_length(payment_estimator_config_errors(jsonb_set((SELECT body FROM cfg WHERE name = 'a1'), '{rules,0,defaultTermMonths}', '72')), 1) = 1, 'disabled default term rejected');
SELECT pg_temp.expect(array_length(payment_estimator_config_errors(jsonb_set((SELECT body FROM cfg WHERE name = 'a1'), '{rules,0,terms,1,aprPercent}', 'null')), 1) >= 1, 'missing APR on enabled term rejected');
SELECT pg_temp.expect(array_length(payment_estimator_config_errors(jsonb_set((SELECT body FROM cfg WHERE name = 'a1'), '{rules,0,terms,1,aprPercent}', '-1')), 1) >= 1, 'negative APR rejected');
SELECT pg_temp.expect(array_length(payment_estimator_config_errors(jsonb_set((SELECT body FROM cfg WHERE name = 'a1'), '{rules,0,terms,1,aprPercent}', '"8"')), 1) >= 1, 'string APR rejected');
SELECT pg_temp.expect(array_length(payment_estimator_config_errors(jsonb_set((SELECT body FROM cfg WHERE name = 'a1'), '{rules,0,terms,0,months}', '60')), 1) >= 1, 'duplicate term rejected');
SELECT pg_temp.expect(array_length(payment_estimator_config_errors(jsonb_set((SELECT body FROM cfg WHERE name = 'a1'), '{rules,0,terms,0,months}', '47.5')), 1) >= 1, 'fractional term rejected');
SELECT pg_temp.expect(array_length(payment_estimator_config_errors(jsonb_set((SELECT body FROM cfg WHERE name = 'a1'), '{downPayment,percent}', '100.5')), 1) = 1, 'percent over 100 rejected');
SELECT pg_temp.expect(array_length(payment_estimator_config_errors(jsonb_set((SELECT body FROM cfg WHERE name = 'a2'), '{downPayment,amount}', '-1')), 1) = 1, 'negative dollar down rejected');
SELECT pg_temp.expect(array_length(payment_estimator_config_errors(jsonb_set((SELECT body FROM cfg WHERE name = 'a1'), '{rules}', '[]')), 1) = 1, 'enabled with no ranges rejected');
SELECT pg_temp.expect(array_length(payment_estimator_config_errors(jsonb_set((SELECT body FROM cfg WHERE name = 'off'), '{rules}', '[]')), 1) IS NULL, 'disabled with no ranges accepted');

-- ── Authorization and tenant isolation ─────────────────────────────────────
SET ROLE authenticated;
SELECT pg_temp.raises($$SELECT pg_temp.apply_as(NULL, '00000000-0000-0000-0000-0000000000a1', 'a-store-1', 0, 'a1', gen_random_uuid())$$, 'not authorized', 'anonymous write refused');
SELECT pg_temp.raises($$SELECT pg_temp.apply_as('00000000-0000-0000-0000-00000000aa02', '00000000-0000-0000-0000-0000000000a1', 'a-store-1', 0, 'a1', gen_random_uuid())$$, 'not_authorized_for_payment_settings', 'non-pricing role refused');
SELECT pg_temp.raises($$SELECT pg_temp.apply_as('00000000-0000-0000-0000-00000000bb01', '00000000-0000-0000-0000-0000000000a1', 'a-store-1', 0, 'a1', gen_random_uuid())$$, 'not_authorized_for_payment_settings', 'other tenant owner refused');
SELECT pg_temp.raises($$SELECT pg_temp.apply_as('00000000-0000-0000-0000-00000000aa01', '00000000-0000-0000-0000-0000000000a1', 'b-forged', 0, 'a1', gen_random_uuid())$$, 'store_not_in_tenant', 'forged store id refused');
SELECT pg_temp.raises($$SELECT pg_temp.apply_as('00000000-0000-0000-0000-00000000aa01', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b1', 0, 'a1', gen_random_uuid())$$, 'store_not_in_tenant', 'another tenant''s default store refused');
SELECT pg_temp.raises($$INSERT INTO passport_payment_estimator_settings (tenant_id, store_id, config) VALUES ('00000000-0000-0000-0000-0000000000a1', 'a-store-1', '{}')$$, 'permission denied', 'direct insert refused');

-- ── Apply, versions, two stores ────────────────────────────────────────────
SELECT pg_temp.expect((pg_temp.apply_as('00000000-0000-0000-0000-00000000aa01', '00000000-0000-0000-0000-0000000000a1', 'a-store-1', 0, 'a1', '11111111-1111-1111-1111-111111111111') ->> 'version')::int = 1, 'store 1 first apply is version 1');
SELECT pg_temp.expect((pg_temp.apply_as('00000000-0000-0000-0000-00000000aa01', '00000000-0000-0000-0000-0000000000a1', 'a-store-2', 0, 'a2', gen_random_uuid()) ->> 'version')::int = 1, 'store 2 applies independently');
SELECT pg_temp.expect((pg_temp.apply_as('00000000-0000-0000-0000-00000000bb01', '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000b1', 0, 'a2', gen_random_uuid()) ->> 'version')::int = 1, 'tenant B default store applies');
SELECT set_config('test.uid', '00000000-0000-0000-0000-00000000aa01', false);
SELECT pg_temp.expect((SELECT config #>> '{rules,0,startYear}' FROM passport_payment_estimator_settings WHERE store_id = 'a-store-1') = '2022', 'store 1 keeps its own rule');
SELECT pg_temp.expect((SELECT config #>> '{rules,0,startYear}' FROM passport_payment_estimator_settings WHERE store_id = 'a-store-2') = '2018', 'store 2 keeps its own rule');

-- Replay of the same request returns the committed answer, writes nothing.
SELECT pg_temp.expect((pg_temp.apply_as('00000000-0000-0000-0000-00000000aa01', '00000000-0000-0000-0000-0000000000a1', 'a-store-1', 0, 'a1', '11111111-1111-1111-1111-111111111111') ->> 'replayed')::boolean, 'retry with same request id replays');
-- Unchanged config is refused.
SELECT pg_temp.raises($$SELECT pg_temp.apply_as('00000000-0000-0000-0000-00000000aa01', '00000000-0000-0000-0000-0000000000a1', 'a-store-1', 1, 'a1', gen_random_uuid())$$, 'no_change', 'unchanged config refused');
-- Concurrent edits: two drafts from version 1; the second is stale.
SELECT pg_temp.expect((pg_temp.apply_as('00000000-0000-0000-0000-00000000aa01', '00000000-0000-0000-0000-0000000000a1', 'a-store-1', 1, 'a1b', gen_random_uuid()) ->> 'version')::int = 2, 'first draft from v1 applies as v2');
SELECT pg_temp.raises($$SELECT pg_temp.apply_as('00000000-0000-0000-0000-00000000ad01', '00000000-0000-0000-0000-0000000000a1', 'a-store-1', 1, 'off', gen_random_uuid())$$, 'stale_version', 'second draft from v1 refused as stale');
SELECT set_config('test.uid', '00000000-0000-0000-0000-00000000aa01', false);
SELECT pg_temp.expect((SELECT config #>> '{rules,0,terms,0,aprPercent}' FROM passport_payment_estimator_settings WHERE store_id = 'a-store-1') = '0', 'newer settings were not overwritten');
-- Invalid config refused at the server even from an authorized user.
SELECT pg_temp.raises($$SELECT pg_temp.apply_as('00000000-0000-0000-0000-00000000aa01', '00000000-0000-0000-0000-0000000000a1', 'a-store-1', 2, NULL, gen_random_uuid())$$, 'invalid_config', 'null config refused');
-- Turning off preserves the rules.
SELECT pg_temp.expect((pg_temp.apply_as('00000000-0000-0000-0000-00000000ad01', '00000000-0000-0000-0000-0000000000a1', 'a-store-1', 2, 'off', gen_random_uuid()) ->> 'version')::int = 3, 'platform admin turns store 1 off');
SELECT set_config('test.uid', '00000000-0000-0000-0000-00000000aa01', false);
SELECT pg_temp.expect((SELECT NOT enabled AND jsonb_array_length(config -> 'rules') = 1 FROM passport_payment_estimator_settings WHERE store_id = 'a-store-1'), 'off keeps the saved ranges');
SELECT pg_temp.expect((pg_temp.apply_as('00000000-0000-0000-0000-00000000aa01', '00000000-0000-0000-0000-0000000000a1', 'a-store-1', 3, 'a1', gen_random_uuid()) ->> 'version')::int = 4, 'turned back on from the saved ranges');

-- ── Audit and history ──────────────────────────────────────────────────────
RESET ROLE;
SELECT pg_temp.expect((SELECT count(*) FROM passport_payment_estimator_versions WHERE store_id = 'a-store-1') = 4, 'one history row per applied version');
SELECT pg_temp.expect((SELECT prev_config #>> '{rules,0,terms,0,aprPercent}' = '0' AND actor = '00000000-0000-0000-0000-00000000ad01'
  FROM passport_payment_estimator_versions WHERE store_id = 'a-store-1' AND version = 3), 'history records actor and before value');
SELECT pg_temp.expect((SELECT count(*) FROM audit_log WHERE action = 'payment_estimator_applied' AND store_id = 'a-store-1') = 4, 'audit row per apply, none for replay or refusal');
SELECT pg_temp.expect((SELECT details ? 'prev' AND details ? 'next' FROM audit_log WHERE action = 'payment_estimator_applied' ORDER BY created_at LIMIT 1), 'audit carries before and after');

-- ── Reads are tenant-scoped ────────────────────────────────────────────────
SET ROLE authenticated;
SELECT set_config('test.uid', '00000000-0000-0000-0000-00000000bb01', false);
SELECT pg_temp.expect((SELECT count(*) FROM passport_payment_estimator_settings) = 1, 'tenant B member sees only its own row');
SELECT pg_temp.expect((SELECT count(*) FROM passport_payment_estimator_versions WHERE tenant_id = '00000000-0000-0000-0000-0000000000a1') = 0, 'tenant B member cannot read A history');
SELECT set_config('test.uid', '00000000-0000-0000-0000-00000000aa02', false);
SELECT pg_temp.expect((SELECT count(*) FROM passport_payment_estimator_settings) = 2, 'tenant A member reads both A rooftops');
SELECT set_config('test.uid', '', false);
SELECT pg_temp.expect((SELECT count(*) FROM passport_payment_estimator_settings) = 0, 'no session reads nothing');
RESET ROLE;
SET ROLE anon;
SELECT pg_temp.raises($$SELECT count(*) FROM passport_payment_estimator_settings$$, 'permission denied', 'anon cannot read the table');
RESET ROLE;
