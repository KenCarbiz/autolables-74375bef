-- Behaviour tests for proposed/20261111000000_provider_dealer_mapping (needs 0006, 0018 and the 90 fixtures).
-- Synthetic data only.
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

-- Fixtures from 90: tenant e1 with primary e5a1 (dealer 1013372) and child e5b1;
-- listing e-4 is an unowned MarketCheck row from dealer 1028492, e-5 a manual row.
SELECT pg_temp.as_user(NULL);
INSERT INTO dealer_stores (id, group_id, display_name, subscription_status, inventory_feed_enabled)
  SELECT '00000000-0000-0000-0000-00000000f5a1', g.id, 'Other Account Store', 'subscribed', true FROM dealer_groups g WHERE g.tenant_id = '00000000-0000-0000-0000-0000000000e2';
CREATE TEMP TABLE ev_ok AS SELECT '{"source":"marketcheck_listing_dealer_record","provider_dealer_name":"Synthetic Auto Group","confirmed_destination":"00000000-0000-0000-0000-00000000e5b1"}'::jsonb AS j;
GRANT SELECT ON ev_ok TO PUBLIC;

-- ── Authorization ────────────────────────────────────────────────────────
SELECT pg_temp.as_user('00000000-0000-0000-0000-00000000e0a1');
SELECT pg_temp.raises($$SELECT inv_admin_map_provider_dealer('00000000-0000-0000-0000-00000000e5b1', '1028492', 'map', NULL, (SELECT j FROM ev_ok), 'Verified on the group site')$$,
  'platform_admin_required', 'a dealer member (not a platform admin) cannot map a dealer id');
SELECT pg_temp.as_user(NULL);
SELECT pg_temp.raises($$SELECT inv_admin_map_provider_dealer('00000000-0000-0000-0000-00000000e5b1', '1028492', 'map', NULL, (SELECT j FROM ev_ok), 'Verified on the group site')$$,
  'platform_admin_required', 'an anonymous caller cannot map a dealer id');

SELECT pg_temp.as_user('00000000-0000-0000-0000-00000000ad01');
-- ── Validation ───────────────────────────────────────────────────────────
SELECT pg_temp.raises($$SELECT inv_admin_map_provider_dealer('00000000-0000-0000-0000-00000000e5b1', 'abc', 'map', NULL, (SELECT j FROM ev_ok), 'Verified on the group site')$$, 'provider_dealer_id_invalid', 'a non-numeric dealer id is refused');
SELECT pg_temp.raises($$SELECT inv_admin_map_provider_dealer('00000000-0000-0000-0000-00000000e5b1', '1028492', 'map', NULL, (SELECT j FROM ev_ok), 'short')$$, 'reason_required', 'a reason is required');
SELECT pg_temp.raises($$SELECT inv_admin_map_provider_dealer('00000000-0000-0000-0000-00000000e5b1', '1028492', 'map', NULL, '{"source":"x"}', 'Verified on the group site')$$, 'destination_not_confirmed', 'the evidence must confirm the destination store');
SELECT pg_temp.raises($$SELECT inv_admin_map_provider_dealer('00000000-0000-0000-0000-00000000e5b1', '1028492', 'map', NULL, '{}', 'Verified on the group site')$$, 'evidence_required', 'evidence is required');
SELECT pg_temp.raises($$SELECT inv_admin_map_provider_dealer('00000000-0000-0000-0000-00000000e5b1', '1028492', 'map', '2000-01-01', (SELECT j FROM ev_ok), 'Verified on the group site')$$, 'store_changed_since_loaded', 'a stale page cannot overwrite a newer store row');
SELECT pg_temp.expect((SELECT count(*) FROM store_provider_mapping_events) = 0, 'refused calls record nothing');

-- ── Map ──────────────────────────────────────────────────────────────────
CREATE TEMP TABLE m1 AS SELECT inv_admin_map_provider_dealer('00000000-0000-0000-0000-00000000e5b1', '1028492', 'map',
  (SELECT updated_at FROM dealer_stores WHERE id = '00000000-0000-0000-0000-00000000e5b1'), (SELECT j FROM ev_ok), 'Verified on the group site inventory page') AS j;
SELECT pg_temp.expect((SELECT (j->>'affected_listings')::int = 1 FROM m1), 'mapping reports the one active listing that moves (archived rows excluded)');
SELECT pg_temp.expect((SELECT dealer_store_mc_dealer_ids(provider_ids) = ARRAY['1028492'] FROM dealer_stores WHERE id = '00000000-0000-0000-0000-00000000e5b1'), 'the store now carries the dealer id');
SELECT pg_temp.expect((SELECT actor = '00000000-0000-0000-0000-00000000ad01' AND action = 'map' AND previous_ids = '[]'::jsonb AND next_ids = '["1028492"]'::jsonb
  AND evidence->>'provider_dealer_name' = 'Synthetic Auto Group' AND reason LIKE 'Verified%' FROM store_provider_mapping_events), 'the event records actor, previous and new mapping, evidence and reason');
SELECT pg_temp.expect((SELECT count(*) FROM inventory_network_audit WHERE entity = 'dealer_stores' AND entity_id = '00000000-0000-0000-0000-00000000e5b1' AND action = 'update'
  AND after->'provider_ids' ? 'marketcheck_dealer_id') >= 1, 'the store change is also in the network audit with before and after');

-- ── One dealer id, one rooftop ───────────────────────────────────────────
SELECT pg_temp.raises($$SELECT inv_admin_map_provider_dealer('00000000-0000-0000-0000-00000000e5a1', '1028492', 'map', NULL, '{"source":"x","confirmed_destination":"00000000-0000-0000-0000-00000000e5a1"}', 'Trying to double map it')$$,
  'provider_dealer_id_mapped_to_other_store', 'the same dealer id cannot be mapped to a second store of the group');
SELECT pg_temp.raises($$SELECT inv_admin_map_provider_dealer('00000000-0000-0000-0000-00000000f5a1', '1013372', 'map', NULL, '{"source":"x","confirmed_destination":"00000000-0000-0000-0000-00000000f5a1"}', 'Trying another account')$$,
  'provider_dealer_id_mapped_to_other_store', 'nor to a store of another account');
SELECT pg_temp.raises($$SELECT inv_admin_save_store('{"id":"00000000-0000-0000-0000-00000000f5a1","provider_ids":{"marketcheck_dealer_id":["1013372"]}}'::jsonb)$$,
  'provider_dealer_id_mapped_to_other_store', 'the generic store editor cannot bypass the one-rooftop rule');
SELECT pg_temp.raises($$SELECT inv_admin_map_provider_dealer('00000000-0000-0000-0000-00000000e5b1', '1028492', 'map', NULL, (SELECT j FROM ev_ok), 'Verified on the group site again')$$, 'already_mapped', 'mapping twice is refused');
SELECT pg_temp.raises($$UPDATE store_provider_mapping_events SET reason = 'rewritten history'$$, 'append_only', 'mapping history cannot be rewritten');
SELECT pg_temp.raises($$DELETE FROM store_provider_mapping_events$$, 'append_only', 'mapping history cannot be deleted');

-- ── Scope report after mapping ───────────────────────────────────────────
SELECT pg_temp.as_user('00000000-0000-0000-0000-00000000e0a1');
CREATE TEMP TABLE r2 AS SELECT inventory_scope_report('00000000-0000-0000-0000-0000000000e1') AS j;
SELECT pg_temp.expect((SELECT (j->'stores'->0->'listings'->>'total')::int = 2 FROM r2), 'primary = own feed car + mapped MarketCheck car; the manual row is no longer assumed primary');
SELECT pg_temp.expect((SELECT (j->'stores'->1->'listings'->>'total')::int = 2 FROM r2), 'the child store now holds its own feed car and the mapped group-site car');
SELECT pg_temp.expect((SELECT (j->'rooftop_review'->>'total')::int = 1 AND (j->'rooftop_review'->'by_dealer'->>'no_verified_rooftop')::int = 1 FROM r2), 'the manual row with no rooftop evidence is held for review');
SELECT pg_temp.expect((SELECT count(*) FROM vehicle_listings WHERE tenant_id = '00000000-0000-0000-0000-0000000000e1') = 6, 'no listing was deleted, archived or moved by mapping');

-- ── Rollback: unmap ──────────────────────────────────────────────────────
SELECT pg_temp.as_user('00000000-0000-0000-0000-00000000ad01');
SELECT inv_admin_map_provider_dealer('00000000-0000-0000-0000-00000000e5b1', '1028492', 'unmap', NULL, (SELECT j FROM ev_ok), 'Rolled back for re-verification');
SELECT pg_temp.expect((SELECT dealer_store_mc_dealer_ids(provider_ids) = '{}'::text[] FROM dealer_stores WHERE id = '00000000-0000-0000-0000-00000000e5b1'), 'unmap removes the dealer id');
SELECT pg_temp.expect((SELECT count(*) = 2 AND bool_or(action = 'unmap' AND previous_ids = '["1028492"]'::jsonb AND next_ids = '[]'::jsonb) FROM store_provider_mapping_events), 'the rollback is recorded as its own event');
SELECT pg_temp.raises($$SELECT inv_admin_map_provider_dealer('00000000-0000-0000-0000-00000000e5b1', '1028492', 'unmap', NULL, (SELECT j FROM ev_ok), 'Rolled back for re-verification')$$, 'not_mapped', 'unmapping what is not mapped is refused');
SELECT pg_temp.as_user('00000000-0000-0000-0000-00000000e0a1');
SELECT pg_temp.expect((SELECT (inventory_scope_report('00000000-0000-0000-0000-0000000000e1')->'rooftop_review'->'by_dealer'->>'1028492')::int = 1), 'after rollback the group-site car is back in review');

-- ── Single-rooftop accounts are unchanged ────────────────────────────────
SELECT pg_temp.as_user('00000000-0000-0000-0000-00000000e0b1');
INSERT INTO vehicle_listings (store_id, tenant_id, vin, slug, condition, status) VALUES ('x', '00000000-0000-0000-0000-0000000000e2', '1HGCM82633A000099', 'f-1', 'used', 'published');
SELECT pg_temp.expect((SELECT (inventory_scope_report('00000000-0000-0000-0000-0000000000e2')->'stores'->0->'listings'->>'total')::int = 1), 'a one-store account keeps its manual listings');
SELECT pg_temp.as_user(NULL);
