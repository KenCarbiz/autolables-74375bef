-- Behaviour tests for proposed/20261108000000_canonical_store_registry (needs 0006, 0009).
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

INSERT INTO auth.users (id) VALUES ('00000000-0000-0000-0000-00000000c0a1'), ('00000000-0000-0000-0000-00000000c0b1') ON CONFLICT DO NOTHING;
INSERT INTO tenants (id, name) VALUES ('00000000-0000-0000-0000-0000000000c1', 'Synthetic Group C'), ('00000000-0000-0000-0000-0000000000c2', 'Synthetic Group D');
INSERT INTO tenant_members (tenant_id, user_id, role) VALUES
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-00000000c0a1', 'owner'),
  ('00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-00000000c0b1', 'owner');
INSERT INTO dealer_groups (tenant_id, name) SELECT id, name FROM tenants WHERE id IN ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000c2') ON CONFLICT (tenant_id) DO NOTHING;
INSERT INTO dealer_stores (group_id, display_name, city, state, is_primary_inventory_store)
  SELECT g.id, 'Synthetic North', 'Hartford', 'CT', true FROM dealer_groups g WHERE g.tenant_id = '00000000-0000-0000-0000-0000000000c1';
INSERT INTO dealer_stores (group_id, display_name, city, state)
  SELECT g.id, 'Synthetic South', 'Meriden', 'CT' FROM dealer_groups g WHERE g.tenant_id = '00000000-0000-0000-0000-0000000000c1';
INSERT INTO dealer_stores (group_id, display_name)
  SELECT g.id, 'Other Account Store' FROM dealer_groups g WHERE g.tenant_id = '00000000-0000-0000-0000-0000000000c2';

SELECT pg_temp.as_user('00000000-0000-0000-0000-00000000c0a1');
SELECT pg_temp.expect((SELECT count(*) FROM tenant_store_registry('00000000-0000-0000-0000-0000000000c1')) = 2, 'members read their own account''s stores');
SELECT pg_temp.expect((SELECT display_name FROM tenant_store_registry('00000000-0000-0000-0000-0000000000c1') LIMIT 1) = 'Synthetic North', 'primary store is listed first');
SELECT pg_temp.raises($$SELECT * FROM tenant_store_registry('00000000-0000-0000-0000-0000000000c2')$$, 'not authorized', 'another account''s stores are refused');

CREATE TEMP TABLE ids AS SELECT
  (SELECT id FROM dealer_stores WHERE display_name = 'Synthetic South') AS own_store,
  (SELECT id FROM dealer_stores WHERE display_name = 'Other Account Store') AS foreign_store;
GRANT SELECT ON ids TO PUBLIC;

SELECT pg_temp.expect((SELECT (apply_payment_estimator_settings('00000000-0000-0000-0000-0000000000c1', (SELECT own_store::text FROM ids), 0, '{"enabled": false, "downPayment": {"mode": "amount", "amount": 0}, "rules": []}'::jsonb, gen_random_uuid()) ->> 'version')::int) = 1, 'a dealer store of this account can hold its own estimator settings');
SELECT pg_temp.expect((SELECT (apply_payment_estimator_settings('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000c1', 0, '{"enabled": false, "downPayment": {"mode": "amount", "amount": 0}, "rules": []}'::jsonb, gen_random_uuid()) ->> 'version')::int) = 1, 'account-wide settings (store id = tenant id) still apply');
SELECT pg_temp.raises(format($$SELECT apply_payment_estimator_settings('00000000-0000-0000-0000-0000000000c1', %L, 0, '{"enabled": false, "downPayment": {"mode": "amount", "amount": 0}, "rules": []}'::jsonb, gen_random_uuid())$$, (SELECT foreign_store::text FROM ids)), 'store_not_in_tenant', 'another account''s store is refused');
SELECT pg_temp.expect((SELECT count(*) FROM passport_payment_estimator_settings WHERE tenant_id = '00000000-0000-0000-0000-0000000000c1') = 2, 'the refused apply wrote nothing');
SELECT pg_temp.as_user(NULL);
