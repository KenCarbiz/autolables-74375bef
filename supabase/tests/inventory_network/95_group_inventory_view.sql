-- Behaviour tests for proposed/20261112000000_group_inventory_view (needs 0006 and the
-- store scope migration). Synthetic data only. Shapes mirror the Harte group: one
-- primary store, child stores, absent cars and one open cross-store VIN conflict.
\set ON_ERROR_STOP 1
CREATE OR REPLACE FUNCTION pg_temp.expect(cond boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF cond IS NOT TRUE THEN RAISE EXCEPTION 'FAILED: %', label; END IF; RAISE NOTICE 'ok  %', label; END $$;
CREATE OR REPLACE FUNCTION pg_temp.raises(sql text, expected text, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN EXECUTE sql; EXCEPTION WHEN OTHERS THEN
    IF expected IS NOT NULL AND position(expected IN SQLERRM) = 0 AND expected <> SQLSTATE THEN RAISE EXCEPTION 'FAILED: % (raised % / %, expected %)', label, SQLSTATE, SQLERRM, expected; END IF;
    RAISE NOTICE 'ok  % (% %)', label, SQLSTATE, SQLERRM; RETURN; END;
  RAISE EXCEPTION 'FAILED: % (did not raise)', label;
END $$;
CREATE OR REPLACE FUNCTION pg_temp.as_user(p uuid) RETURNS void LANGUAGE sql AS $$ SELECT set_config('test.uid', COALESCE(p::text, ''), false) $$;

SELECT pg_temp.as_user(NULL);
-- users: f0a1 platform admin, f0a2 tenant owner, f0a3 plain member, f0a4 granted member,
--        f0a5 owner of the other tenant, f0a6 granted but not yet accepted
INSERT INTO auth.users (id) VALUES
  ('00000000-0000-0000-0000-0000000090a1'), ('00000000-0000-0000-0000-0000000090a2'), ('00000000-0000-0000-0000-0000000090a3'),
  ('00000000-0000-0000-0000-0000000090a4'), ('00000000-0000-0000-0000-0000000090a5'), ('00000000-0000-0000-0000-0000000090a6') ON CONFLICT DO NOTHING;
INSERT INTO user_roles (user_id, role) VALUES ('00000000-0000-0000-0000-0000000090a1', 'admin');
INSERT INTO tenants (id, name) VALUES ('00000000-0000-0000-0000-0000000090f1', 'Synthetic Group G'), ('00000000-0000-0000-0000-0000000090f2', 'Synthetic Group H');
INSERT INTO tenant_members (tenant_id, user_id, role, accepted_at) VALUES
  ('00000000-0000-0000-0000-0000000090f1', '00000000-0000-0000-0000-0000000090a2', 'owner', now()),
  ('00000000-0000-0000-0000-0000000090f1', '00000000-0000-0000-0000-0000000090a3', 'member', now()),
  ('00000000-0000-0000-0000-0000000090f1', '00000000-0000-0000-0000-0000000090a4', 'member', now()),
  ('00000000-0000-0000-0000-0000000090f1', '00000000-0000-0000-0000-0000000090a6', 'member', NULL),
  ('00000000-0000-0000-0000-0000000090f2', '00000000-0000-0000-0000-0000000090a5', 'owner', now());
INSERT INTO dealer_groups (tenant_id, name) SELECT id, name FROM tenants WHERE id IN ('00000000-0000-0000-0000-0000000090f1', '00000000-0000-0000-0000-0000000090f2') ON CONFLICT (tenant_id) DO NOTHING;

INSERT INTO dealer_stores (id, group_id, display_name, is_primary_inventory_store, subscription_status, inventory_feed_enabled)
  SELECT v.id, g.id, v.name, v.prim, 'subscribed', true
    FROM (VALUES
      ('00000000-0000-0000-0000-0000000095a1'::uuid, '00000000-0000-0000-0000-0000000090f1'::uuid, 'Synthetic Infiniti', true),
      ('00000000-0000-0000-0000-0000000095b1'::uuid, '00000000-0000-0000-0000-0000000090f1'::uuid, 'Synthetic Nissan', false),
      ('00000000-0000-0000-0000-0000000095c1'::uuid, '00000000-0000-0000-0000-0000000090f1'::uuid, 'Synthetic Hyundai', false),
      ('00000000-0000-0000-0000-0000000095d1'::uuid, '00000000-0000-0000-0000-0000000090f2'::uuid, 'Other Group Store', true)
    ) v(id, tid, name, prim) JOIN dealer_groups g ON g.tenant_id = v.tid;

INSERT INTO store_inventory (store_id, group_id, vin, source_dealer_id, condition, feed_price_status, feed_price, presence, stock_number, photos, photo_count)
SELECT s.id, s.group_id, v.vin, 'MP1', v.cond, v.pst, v.price, v.presence, v.stock, v.photos, jsonb_array_length(v.photos)
  FROM (VALUES
    ('00000000-0000-0000-0000-0000000095a1'::uuid, 'JN8AZ3CC0T9000001', 'new',  'present', 'known',   45000::numeric, 'I100', '["https://x/1.jpg"]'::jsonb),
    ('00000000-0000-0000-0000-0000000095a1'::uuid, 'JN8AZ3CC0T9000002', 'used', 'present', 'unknown', NULL,           'I101', '[]'::jsonb),
    ('00000000-0000-0000-0000-0000000095b1'::uuid, 'KMHL64JA0TA000001', 'new',  'present', 'known',   30000,          'N200', '[]'::jsonb),
    ('00000000-0000-0000-0000-0000000095b1'::uuid, 'KMHL64JA0TA000002', 'used', 'missing', 'zero',    NULL,           'N201', '[]'::jsonb),
    ('00000000-0000-0000-0000-0000000095b1'::uuid, 'KMHL64JA0TA000003', 'cpo',  'retired', 'known',   20000,          'N202', '[]'::jsonb),
    ('00000000-0000-0000-0000-0000000095c1'::uuid, 'KMHL64JA0TA000004', 'new',  'present', 'known',   31000,          'H300', '[]'::jsonb),
    ('00000000-0000-0000-0000-0000000095d1'::uuid, '5NMP54G10TH000001', 'new',  'present', 'known',   40000,          'X1',   '[]'::jsonb)
  ) AS v(store, vin, cond, presence, pst, price, stock, photos)
  JOIN dealer_stores s ON s.id = v.store;
INSERT INTO inventory_vin_conflicts (group_id, vin, kind, claiming_store_id, existing_store_id, status)
  SELECT g.id, 'KMHL64JA0TA000001', 'other_store', '00000000-0000-0000-0000-0000000095c1', '00000000-0000-0000-0000-0000000095b1', 'open'
    FROM dealer_groups g WHERE g.tenant_id = '00000000-0000-0000-0000-0000000090f1';
INSERT INTO inventory_group_view_grants (tenant_id, user_id) VALUES
  ('00000000-0000-0000-0000-0000000090f1', '00000000-0000-0000-0000-0000000090a4'),
  ('00000000-0000-0000-0000-0000000090f1', '00000000-0000-0000-0000-0000000090a6');

-- Access: who is allowed ----------------------------------------------------
SELECT pg_temp.as_user('00000000-0000-0000-0000-0000000090a2');
SELECT pg_temp.expect(inventory_group_view_access('00000000-0000-0000-0000-0000000090f1')->>'reason' = 'tenant_owner', 'a tenant owner is allowed');
SELECT pg_temp.as_user('00000000-0000-0000-0000-0000000090a1');
SELECT pg_temp.expect(inventory_group_view_access('00000000-0000-0000-0000-0000000090f1')->>'reason' = 'platform_admin', 'a platform admin is allowed');
SELECT pg_temp.as_user('00000000-0000-0000-0000-0000000090a4');
SELECT pg_temp.expect(inventory_group_view_access('00000000-0000-0000-0000-0000000090f1')->>'reason' = 'granted', 'an accepted member with a grant is allowed');
SELECT pg_temp.as_user('00000000-0000-0000-0000-0000000090a3');
SELECT pg_temp.expect(NOT (inventory_group_view_access('00000000-0000-0000-0000-0000000090f1')->>'allowed')::boolean, 'a plain member is denied');
SELECT pg_temp.expect(jsonb_array_length(inventory_group_view_access('00000000-0000-0000-0000-0000000090f1')->'stores') = 0, 'a denied caller gets no store data');
SELECT pg_temp.as_user('00000000-0000-0000-0000-0000000090a6');
SELECT pg_temp.expect(NOT (inventory_group_view_access('00000000-0000-0000-0000-0000000090f1')->>'allowed')::boolean, 'a grant without accepted membership is denied');
SELECT pg_temp.as_user('00000000-0000-0000-0000-0000000090a5');
SELECT pg_temp.expect(NOT (inventory_group_view_access('00000000-0000-0000-0000-0000000090f1')->>'allowed')::boolean, 'an owner of another tenant is denied');
SELECT pg_temp.as_user(NULL);
SELECT pg_temp.expect(NOT (inventory_group_view_access('00000000-0000-0000-0000-0000000090f1')->>'allowed')::boolean, 'no signed-in user is denied');

-- Access: authoritative per-store counts -------------------------------------
SELECT pg_temp.as_user('00000000-0000-0000-0000-0000000090a2');
CREATE TEMP TABLE a AS SELECT inventory_group_view_access('00000000-0000-0000-0000-0000000090f1') AS j;
SELECT pg_temp.expect((SELECT jsonb_array_length(j->'stores') = 3 FROM a), 'all three stores of the tenant are listed and no other tenant''s store');
SELECT pg_temp.expect((SELECT (j->'stores'->0->>'primary')::boolean AND j->'stores'->0->>'name' = 'Synthetic Infiniti' FROM a), 'the primary store is listed first');
SELECT pg_temp.expect((SELECT (j->'stores'->0->>'feed_present')::int = 2 AND (j->'stores'->0->>'new')::int = 1 AND (j->'stores'->0->>'used')::int = 1 AND (j->'stores'->0->>'cpo')::int = 0 FROM a), 'primary feed counts by condition');
SELECT pg_temp.expect((SELECT x->>'name' = 'Synthetic Nissan' AND (x->>'feed_present')::int = 1 AND (x->>'absent')::int = 1 FROM a, jsonb_array_elements(j->'stores') x WHERE x->>'name' = 'Synthetic Nissan'), 'an absent car is counted as absent and a retired car is not counted at all');
SELECT pg_temp.expect((SELECT (x->>'listings_total')::int = 0 FROM a, jsonb_array_elements(j->'stores') x WHERE x->>'name' = 'Synthetic Hyundai'), 'a store with no listings reports zero listings');

-- Rows ---------------------------------------------------------------------
CREATE TEMP TABLE r1 AS SELECT inventory_group_view_rows('00000000-0000-0000-0000-0000000090f1',
  ARRAY['00000000-0000-0000-0000-0000000095a1','00000000-0000-0000-0000-0000000095b1','00000000-0000-0000-0000-0000000095c1']::uuid[], 0, 500) AS j;
SELECT pg_temp.expect((SELECT (j->>'total')::int = 5 AND jsonb_array_length(j->'rows') = 5 FROM r1), 'rows cover present and absent cars of the requested stores, not retired ones');
SELECT pg_temp.expect((SELECT bool_and(x->>'tenant_id' = '00000000-0000-0000-0000-0000000090f1') FROM r1, jsonb_array_elements(j->'rows') x), 'every row carries this tenant');
SELECT pg_temp.expect((SELECT count(*) = 1 AND bool_and(x->>'store_id' = '00000000-0000-0000-0000-0000000095b1' AND x->>'vin' = 'KMHL64JA0TA000001') FROM r1, jsonb_array_elements(j->'rows') x WHERE (x->>'has_open_conflict')::boolean), 'the VIN with an open cross-store conflict is flagged on the store that holds it');
SELECT pg_temp.expect((SELECT x->>'feed_price_status' = 'unknown' AND x->'feed_price' = 'null'::jsonb FROM r1, jsonb_array_elements(j->'rows') x WHERE x->>'stock_number' = 'I101'), 'an unknown feed price stays null, never 0');
SELECT pg_temp.expect((SELECT NOT EXISTS (SELECT 1 FROM r1, jsonb_array_elements(j->'rows') x WHERE x->>'vin' = '5NMP54G10TH000001')), 'another tenant''s vehicle is never returned');

CREATE TEMP TABLE r2 AS SELECT inventory_group_view_rows('00000000-0000-0000-0000-0000000090f1', ARRAY['00000000-0000-0000-0000-0000000095a1','00000000-0000-0000-0000-0000000095b1','00000000-0000-0000-0000-0000000095c1']::uuid[], 2, 2) AS j;
SELECT pg_temp.expect((SELECT (j->>'total')::int = 5 AND jsonb_array_length(j->'rows') = 2 FROM r2), 'paging returns the same total with a window of rows');
SELECT pg_temp.expect((SELECT (SELECT array_agg(x->>'id' ORDER BY ord) FROM r1, jsonb_array_elements(j->'rows') WITH ORDINALITY t(x, ord) WHERE ord IN (3, 4))
                              = (SELECT array_agg(x->>'id' ORDER BY ord) FROM r2, jsonb_array_elements(j->'rows') WITH ORDINALITY t(x, ord)) ), 'paging is deterministic');

SELECT pg_temp.raises($$SELECT inventory_group_view_rows('00000000-0000-0000-0000-0000000090f1', ARRAY['00000000-0000-0000-0000-0000000095d1']::uuid[], 0, 10)$$, '42501', 'a store of another tenant is rejected');
SELECT pg_temp.raises($$SELECT inventory_group_view_rows('00000000-0000-0000-0000-0000000090f1', ARRAY['00000000-0000-0000-0000-0000000095a1','00000000-0000-0000-0000-0000000095d1']::uuid[], 0, 10)$$, '42501', 'one foreign store in the list rejects the whole request');
SELECT pg_temp.raises($$SELECT inventory_group_view_rows('00000000-0000-0000-0000-0000000090f1', ARRAY['00000000-0000-0000-0000-0000000090aa']::uuid[], 0, 10)$$, '42501', 'an unknown store id is rejected');
SELECT pg_temp.raises($$SELECT inventory_group_view_rows('00000000-0000-0000-0000-0000000090f1', ARRAY[]::uuid[], 0, 10)$$, '22023', 'an empty store list is rejected');
SELECT pg_temp.raises($$SELECT inventory_group_view_rows('00000000-0000-0000-0000-0000000090f2', ARRAY['00000000-0000-0000-0000-0000000095d1']::uuid[], 0, 10)$$, '42501', 'the owner of tenant G cannot read tenant H');

SELECT pg_temp.as_user('00000000-0000-0000-0000-0000000090a3');
SELECT pg_temp.raises($$SELECT inventory_group_view_rows('00000000-0000-0000-0000-0000000090f1', ARRAY['00000000-0000-0000-0000-0000000095b1']::uuid[], 0, 10)$$, '42501', 'a plain member is refused with 42501');
SELECT pg_temp.as_user('00000000-0000-0000-0000-0000000090a4');
SELECT pg_temp.expect((inventory_group_view_rows('00000000-0000-0000-0000-0000000090f1', ARRAY['00000000-0000-0000-0000-0000000095b1']::uuid[], 0, 10)->>'total')::int = 2, 'a granted member can read the requested store');
SELECT pg_temp.as_user('00000000-0000-0000-0000-0000000090a1');
SELECT pg_temp.expect((inventory_group_view_rows('00000000-0000-0000-0000-0000000090f2', ARRAY['00000000-0000-0000-0000-0000000095d1']::uuid[], 0, 10)->>'total')::int = 1, 'a platform admin can read any tenant');
SELECT pg_temp.as_user(NULL);
SELECT pg_temp.raises($$SELECT inventory_group_view_rows('00000000-0000-0000-0000-0000000090f1', ARRAY['00000000-0000-0000-0000-0000000095b1']::uuid[], 0, 10)$$, '42501', 'no signed-in user is refused');

-- Grants table: admin managed, own row readable ------------------------------
SELECT pg_temp.as_user('00000000-0000-0000-0000-0000000090a3');
SET ROLE authenticated;
SELECT pg_temp.expect((SELECT count(*) FROM inventory_group_view_grants) = 0, 'a member sees no grants but their own (none)');
SELECT pg_temp.raises($$INSERT INTO inventory_group_view_grants (tenant_id, user_id) VALUES ('00000000-0000-0000-0000-0000000090f1', '00000000-0000-0000-0000-0000000090a3')$$, NULL, 'a member cannot grant themselves access');
RESET ROLE;
SELECT pg_temp.as_user('00000000-0000-0000-0000-0000000090a4');
SET ROLE authenticated;
SELECT pg_temp.expect((SELECT count(*) FROM inventory_group_view_grants) = 1, 'a granted user reads only their own grant');
RESET ROLE;
SELECT pg_temp.as_user('00000000-0000-0000-0000-0000000090a1');
SET ROLE authenticated;
SELECT pg_temp.expect((SELECT count(*) FROM inventory_group_view_grants) = 2, 'a platform admin sees every grant');
RESET ROLE;
SET ROLE anon;
SELECT pg_temp.raises($$SELECT inventory_group_view_rows('00000000-0000-0000-0000-0000000090f1', ARRAY['00000000-0000-0000-0000-0000000095b1']::uuid[], 0, 10)$$, NULL, 'anon cannot call the rows function');
RESET ROLE;
SELECT pg_temp.as_user(NULL);

-- Read-only: nothing changed ------------------------------------------------
SELECT pg_temp.expect((SELECT count(*) FROM store_inventory WHERE store_id IN ('00000000-0000-0000-0000-0000000095a1','00000000-0000-0000-0000-0000000095b1','00000000-0000-0000-0000-0000000095c1')) = 6, 'the view deletes and transfers nothing');
SELECT pg_temp.expect((SELECT count(*) FROM inventory_vin_conflicts WHERE status = 'open' AND vin = 'KMHL64JA0TA000001') = 1, 'the open conflict is untouched');
