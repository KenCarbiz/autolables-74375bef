-- Behaviour tests for 0007_marketcheck_pilot_coordinator. Runs after
-- 10_behaviour.sql in the same scratch database.
\set ON_ERROR_STOP 1

CREATE OR REPLACE FUNCTION pg_temp.expect(cond boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF cond IS NOT TRUE THEN RAISE EXCEPTION 'FAILED: %', label; END IF; RAISE NOTICE 'ok  %', label; END $$;
CREATE OR REPLACE FUNCTION pg_temp.raises(sql text, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN EXECUTE sql; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'ok  % (%)', label, SQLERRM; RETURN; END;
  RAISE EXCEPTION 'FAILED: % (did not raise)', label;
END $$;
CREATE OR REPLACE FUNCTION pg_temp.as_user(p uuid) RETURNS void LANGUAGE sql AS $$ SELECT set_config('test.uid', COALESCE(p::text, ''), false) $$;
CREATE OR REPLACE FUNCTION pg_temp.res(p_product text, p_priority int, p_vin text DEFAULT NULL, p_free boolean DEFAULT false, p_ctx jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE sql AS $$
  SELECT provider_reserve('marketcheck_primary', p_product, 'test', 'unit', p_priority, NULL, (SELECT id FROM dealer_stores WHERE display_name = 'Harte Nissan'), p_vin, NULL, NULL, p_free, NULL, 300, p_ctx)
$$;

-- Seed defaults
SELECT pg_temp.expect((SELECT monthly_call_quota = 5000 AND protected_reserve = 1000 AND pilot_mode FROM provider_accounts WHERE account_ref = 'marketcheck_primary'), 'pilot account seeded at 5,000 calls with a 1,000 reserve');
SELECT pg_temp.expect((SELECT bool_and(repeat_charge_policy = 'unknown' AND retention_policy = 'unknown' AND cross_store_reuse = 'unknown' AND customer_display = 'unknown' AND rate_status <> 'verified') FROM provider_product_catalog), 'catalog seeded with every right unknown and no verified rate');
SELECT pg_temp.expect((SELECT 'build_identity' = ANY(bundled_fields) AND 'comparables' = ANY(bundled_fields) FROM provider_product_catalog WHERE product_key = 'price_premium_plus'), 'Premium Plus bundles valuation, comparables and the NeoVIN build');
SELECT pg_temp.expect((SELECT period_source FROM (SELECT source AS period_source FROM provider_period('marketcheck_primary')) x) = 'assumed_utc_month', 'without provider reset the period is labelled an assumption');
SELECT pg_temp.raises($$UPDATE provider_product_catalog SET repeat_charge_policy = 'free_within_window' WHERE product_key = 'neovin'$$, 'a free repeat cannot be recorded without evidence and a window');

-- Small quota for the tests: 12 calls, 4 protected, floors 0/0/2/4.
UPDATE provider_accounts SET monthly_call_quota = 12, protected_reserve = 4, priority_floors = '{"1":0,"2":0,"3":2,"4":4}', rate_limit_per_minute = 1000 WHERE account_ref = 'marketcheck_primary';

-- Priorities and the protected reserve
SELECT pg_temp.expect((pg_temp.res('neovin', 4, 'VINP4000000000001')->>'reserved')::boolean, 'optional work admitted while plenty remains');
SELECT pg_temp.expect((pg_temp.res('neovin', 4, 'VINP4000000000001')->>'reason') = 'duplicate_in_flight', 'concurrent duplicate joins the live reservation, no second call');
SELECT pg_temp.expect((SELECT count(*) FROM provider_requests WHERE status = 'joined') = 1, 'the duplicate is recorded as joined at zero quota');
DO $$ DECLARE i int; BEGIN FOR i IN 2..4 LOOP PERFORM pg_temp.res('neovin', 4, 'VINP400000000000' || i); END LOOP; END $$;
-- used 4 of 12: available 8; priority 4 needs 4 reserve + 4 floor left after the call
SELECT pg_temp.expect((pg_temp.res('neovin', 4, 'VINP4000000000005')->>'reason') = 'priority_floor', 'optional enrichment stops at its floor above the reserve');
SELECT pg_temp.expect((pg_temp.res('neovin', 3, 'VINP3000000000001')->>'reserved')::boolean, 'approved refresh still admitted');
SELECT pg_temp.expect((pg_temp.res('neovin', 3, 'VINP3000000000002')->>'reserved')::boolean, 'approved refresh admitted down to its floor');
SELECT pg_temp.expect((pg_temp.res('neovin', 3, 'VINP3000000000003')->>'reason') = 'priority_floor', 'approved refresh stops at its floor');
SELECT pg_temp.expect((pg_temp.res('neovin', 2, 'VINP2000000000001')->>'reserved')::boolean, 'missing high-value info admitted');
SELECT pg_temp.expect((pg_temp.res('neovin', 2, 'VINP2000000000002')->>'reserved')::boolean, 'missing high-value info admitted down to the reserve');
SELECT pg_temp.expect((pg_temp.res('neovin', 2, 'VINP2000000000003')->>'reason') = 'protected_reserve', 'the protected reserve refuses priority 2');
SELECT pg_temp.expect((pg_temp.res('neovin', 1, 'VINP1000000000001')->>'reserved')::boolean, 'required primary-store work may use the reserve');
SELECT pg_temp.expect((SELECT state FROM vehicle_provider_states WHERE vin = 'VINP2000000000003') = 'budget_blocked', 'a refused VIN is marked budget blocked');

-- Settlement, billing uncertainty and retry suppression
SELECT provider_settle((SELECT id FROM provider_requests WHERE vin = 'VINP4000000000001' AND status = 'reserved'), 'billing_uncertain', NULL, NULL, NULL, 'billing_uncertain');
SELECT pg_temp.expect((pg_temp.res('neovin', 1, 'VINP4000000000001')->>'reason') IN ('billing_uncertain_hold','vehicle_state_cooldown'), 'a timed-out request is not retried automatically');
SELECT pg_temp.expect((SELECT uncertain FROM provider_local_usage('marketcheck_primary')) = 1, 'billing-uncertain requests still count against the quota');
SELECT provider_settle((SELECT id FROM provider_requests WHERE vin = 'VINP4000000000002' AND status = 'reserved'), 'no_charge', 404, NULL, NULL, 'unavailable');
SELECT pg_temp.expect((SELECT next_eligible_at > now() + interval '6 days' FROM vehicle_provider_states WHERE vin = 'VINP4000000000002'), 'an unavailable answer waits out its cooldown');
SELECT provider_settle((SELECT id FROM provider_requests WHERE vin = 'VINP4000000000003' AND status = 'reserved'), 'consumed', 200, NULL, NULL, 'invalid_vin');
UPDATE vehicle_provider_states SET next_eligible_at = NULL WHERE vin = 'VINP4000000000003';
SELECT pg_temp.expect((pg_temp.res('neovin', 1, 'VINP4000000000003')->>'reason') = 'vehicle_state_invalid_vin', 'an invalid VIN is never asked again');
SELECT provider_settle((SELECT id FROM provider_requests WHERE vin = 'VINP3000000000001' AND status = 'reserved'), 'consumed', 200, NULL, NULL, 'partial', ARRAY['build_identity']);
SELECT provider_settle((SELECT id FROM provider_requests WHERE vin = 'VINP3000000000002' AND status = 'reserved'), 'consumed', 200, NULL, NULL, 'complete');
-- no_charge returns quota: 12 - (consumed 3 + uncertain 1 + reserved 3) = 5 available
SELECT pg_temp.expect((SELECT consumed FROM provider_local_usage('marketcheck_primary')) = 3, 'consumed counted once per settled call');

-- A failure after a partial answer keeps the useful fields.
UPDATE vehicle_provider_states SET next_eligible_at = NULL WHERE vin = 'VINP3000000000001';
SELECT provider_settle((pg_temp.res('neovin', 1, 'VINP3000000000001')->>'request_id')::uuid, 'no_charge', 503, NULL, NULL, 'temporarily_failed');
SELECT pg_temp.expect((SELECT state = 'temporarily_failed' AND partial_fields = ARRAY['build_identity'] FROM vehicle_provider_states WHERE vin = 'VINP3000000000001'), 'a later failure keeps the partial fields');

-- Free refresh needs proof
SELECT pg_temp.expect((pg_temp.res('neovin', 1, 'VINP3000000000002', true)->>'reason') = 'free_refresh_not_verified', 'an unverified free refresh is refused, not treated as free');
UPDATE provider_product_catalog SET repeat_charge_policy = 'free_within_window', repeat_window_days = 30, repeat_charge_usd = 0, repeat_consumes_quota = 'unknown', verified_at = now(), evidence = 'Account agreement section 4.2 (test)' WHERE product_key = 'neovin';
CREATE TEMP TABLE fr AS SELECT pg_temp.res('neovin', 1, 'VINP3000000000002', true) AS r;
SELECT pg_temp.expect((SELECT (fr.r->>'free_refresh')::boolean AND q.quota_units = 1 FROM fr JOIN provider_requests q ON q.id = (fr.r->>'request_id')::uuid), 'a verified free refresh is still counted against quota while that is unknown');
UPDATE provider_requests SET status = 'released', quota_units = 0 WHERE status = 'reserved';

-- External usage reported by the provider
SELECT pg_temp.expect((provider_reconcile_account('marketcheck_primary', 12, 11, NULL, now() + interval '10 days')->>'unattributed')::int = 7, 'provider-reported usage beyond ours is reported as unattributed');
SELECT pg_temp.expect((SELECT source FROM provider_period('marketcheck_primary')) = 'provider_reset', 'the provider reset defines the period once reported');
SELECT pg_temp.expect((pg_temp.res('neovin', 1, 'VINPX000000000001')->>'reserved')::boolean, 'required work can still use what the provider says remains');
SELECT pg_temp.expect((pg_temp.res('neovin', 1, 'VINPX000000000002')->>'reason') = 'quota_exhausted', 'external usage reduces what this app may spend');
UPDATE provider_accounts SET provider_reported_used = NULL, provider_reported_remaining = NULL, provider_reported_at = NULL, provider_reset_at = NULL WHERE account_ref = 'marketcheck_primary';
UPDATE provider_requests SET status = 'released', quota_units = 0 WHERE status = 'reserved';

-- Dollar cap
UPDATE provider_accounts SET monthly_call_quota = 5000, protected_reserve = 1000, priority_floors = '{"1":0,"2":0,"3":250,"4":750}', monthly_usd_cap = (SELECT usd_spent + usd_committed FROM provider_local_usage('marketcheck_primary')) + 0.01 WHERE account_ref = 'marketcheck_primary';
SELECT pg_temp.expect((pg_temp.res('vin_history', 1, 'VINUSD00000000001')->>'reserved')::boolean, 'a priced call within the dollar cap is admitted');
SELECT pg_temp.expect((pg_temp.res('autorecalls', 1, 'VINUSD00000000002')->>'reason') = 'usd_cap', 'the dollar cap applies independently of the call count');
UPDATE provider_accounts SET monthly_usd_cap = NULL WHERE account_ref = 'marketcheck_primary';

-- Staff AI and MCP
SELECT pg_temp.expect((pg_temp.res('neovin', 1, 'VINAI000000000001', false, '{"channel":"staff_ai","tool_name":"decode_vin_neovin"}')->>'reason') = 'ai_attribution_required', 'AI research must name the person and purpose');
SELECT pg_temp.expect((pg_temp.res('neovin', 1, 'VINAI000000000001', false, '{"channel":"staff_ai","tool_name":"decode_vin_neovin","initiated_by":"00000000-0000-0000-0000-00000000aa99","purpose":"customer question","invocation_id":"00000000-0000-0000-0000-0000000a1001"}')->>'reason') = 'ai_tool_not_authorized', 'staff AI tools are disabled by default');
UPDATE provider_ai_tools SET staff_enabled = true WHERE tool_name = 'decode_vin_neovin';
SELECT pg_temp.expect((pg_temp.res('vin_history', 1, 'VINAI000000000001', false, '{"channel":"staff_ai","tool_name":"decode_vin_neovin","initiated_by":"00000000-0000-0000-0000-00000000aa99","purpose":"customer question","invocation_id":"00000000-0000-0000-0000-0000000a1001"}')->>'reason') = 'ai_tool_product_mismatch', 'a tool may only call its own products');
SELECT pg_temp.expect((pg_temp.res('neovin', 1, 'VINAI000000000001', false, '{"channel":"staff_ai","tool_name":"decode_vin_neovin","initiated_by":"00000000-0000-0000-0000-00000000aa99","purpose":"customer question","invocation_id":"00000000-0000-0000-0000-0000000a1001"}')->>'reserved')::boolean, 'an authorised, attributed AI request is admitted');
SELECT pg_temp.expect((SELECT priority = 3 AND channel = 'staff_ai' AND initiated_by IS NOT NULL AND tool_name = 'decode_vin_neovin' FROM provider_requests WHERE vin = 'VINAI000000000001' AND status = 'reserved'), 'AI requests are recorded with person, tool and invocation, never above priority 3');
SELECT pg_temp.expect((pg_temp.res('neovin', 1, 'VINAI000000000002', false, '{"channel":"staff_ai","tool_name":"decode_vin_neovin","initiated_by":"00000000-0000-0000-0000-00000000aa99","purpose":"customer question","invocation_id":"00000000-0000-0000-0000-0000000a1001"}')->>'reason') = 'ai_invocation_request_limit', 'one invocation cannot fan out beyond its request limit');
SELECT pg_temp.raises($$UPDATE provider_ai_tools SET allowed_for_automation = true$$, 'AI tools can never drive automated enrichment');

-- Paid bulk work stays locked until the catalog is verified
SELECT pg_temp.raises($$INSERT INTO store_enrichment_policies (store_id, allowed_products, backfill_limit) VALUES ((SELECT id FROM dealer_stores WHERE display_name = 'Harte Hyundai of Old Saybrook'), ARRAY['vin_history'], 10)
  ON CONFLICT (store_id) DO UPDATE SET allowed_products = EXCLUDED.allowed_products, backfill_limit = EXCLUDED.backfill_limit$$, 'a backfill needs a verified catalog entry');

-- Admin surface
SELECT pg_temp.as_user('00000000-0000-0000-0000-00000000aa99');
SELECT pg_temp.raises($$SELECT inv_admin_provider_dashboard('marketcheck_primary')$$, 'store users cannot read the provider dashboard');
SELECT pg_temp.as_user('00000000-0000-0000-0000-00000000ad01');
SELECT pg_temp.expect((SELECT (d->'calls'->>'protected')::int = 1000 AND d ? 'projection' AND d ? 'catalog_review' AND d ? 'by_channel' FROM (SELECT inv_admin_provider_dashboard('marketcheck_primary') d) x), 'dashboard reports calls, reserve, projection, channels and catalog review');
SELECT pg_temp.expect((SELECT jsonb_array_length(h->'requests') >= 2 FROM (SELECT inv_admin_vehicle_provider_history('VINP4000000000001') h) x), 'per-vehicle request history is available');
SELECT pg_temp.raises($$SELECT inv_admin_save_catalog_product('{"account_ref":"marketcheck_primary","product_key":"vin_history","rate_status":"verified","rate_usd":0.006,"mark_verified":true}')$$, 'verification needs written evidence');
SELECT inv_admin_save_catalog_product('{"account_ref":"marketcheck_primary","product_key":"vin_history","rate_status":"verified","rate_usd":0.006,"mark_verified":true,"evidence":"Invoice 2026-10 line 3 (test)"}');
SELECT pg_temp.expect((SELECT rate_status = 'verified' AND verified_by IS NOT NULL FROM provider_product_catalog WHERE product_key = 'vin_history'), 'an admin can verify a rate with evidence');
SELECT inv_admin_save_provider_account('{"account_ref":"marketcheck_primary","monthly_call_quota":10000}');
SELECT pg_temp.expect((SELECT monthly_call_quota FROM provider_accounts WHERE account_ref = 'marketcheck_primary') = 10000, 'the plan limit is configurable');
SELECT pg_temp.as_user(NULL);
SET ROLE anon;
SELECT pg_temp.raises($$SELECT provider_reserve('marketcheck_primary', 'neovin', 'x', 'x', 1)$$, 'anon cannot reserve provider quota');
RESET ROLE;
SET ROLE authenticated;
SELECT pg_temp.raises($$SELECT provider_reserve('marketcheck_primary', 'neovin', 'x', 'x', 1)$$, 'signed-in users cannot reserve provider quota directly');
RESET ROLE;

SELECT 'ALL PILOT COORDINATOR SQL TESTS PASSED' AS result;
