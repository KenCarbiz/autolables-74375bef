-- Behaviour tests for 0018_marketcheck_launch_control. Synthetic data only.
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
-- One MarketCheck admission as a deployed caller makes it.
CREATE OR REPLACE FUNCTION pg_temp.admit_reason(p_caller text, p_tenant uuid, p_vin text DEFAULT NULL, p_store uuid DEFAULT NULL,
  p_version text DEFAULT 'launch-2026-11-02', p_catalog text DEFAULT 'neovin', p_billing text DEFAULT 'neovin') RETURNS text LANGUAGE sql AS $$
  SELECT reason FROM provider_call_admit_v2('marketcheck', p_billing, p_caller, p_version, false, p_tenant, p_vin, 0.0, p_store, p_catalog)
$$;
-- The whole REST path: admission, then the reservation bound to it.
CREATE OR REPLACE FUNCTION pg_temp.call(p_caller text, p_tenant uuid, p_vin text, p_store uuid DEFAULT NULL) RETURNS text LANGUAGE plpgsql AS $$
DECLARE r record; j jsonb;
BEGIN
  SELECT * INTO r FROM provider_call_admit_v2('marketcheck', 'neovin', p_caller, 'launch-2026-11-02', false, p_tenant, p_vin, 0.08, p_store, 'neovin');
  IF NOT r.admitted THEN RETURN r.reason; END IF;
  j := provider_reserve('marketcheck_primary', 'neovin', p_caller, 'unit', 2, p_tenant, p_store, p_vin, NULL, NULL, false, r.event_id, 300, '{}'::jsonb);
  IF NOT (j->>'reserved')::boolean THEN RETURN 'reserve_' || (j->>'reason'); END IF;
  RETURN 'admitted';
END $$;
CREATE OR REPLACE FUNCTION pg_temp.state() RETURNS text LANGUAGE sql AS $$ SELECT state FROM marketcheck_launch_control WHERE id = 1 $$;
-- A reservation made without any admission (REST), or as staff AI.
CREATE OR REPLACE FUNCTION pg_temp.reserve(p_channel text DEFAULT 'rest', p_tenant uuid DEFAULT '3f0f97f5-4151-4e32-88ef-e2d6fc5a3142',
  p_vin text DEFAULT '5N1AL1FWXTC358105', p_event bigint DEFAULT NULL, p_caller text DEFAULT 'marketcheck-specs', p_product text DEFAULT 'neovin') RETURNS jsonb LANGUAGE sql AS $$
  SELECT provider_reserve('marketcheck_primary', p_product, p_caller, 'unit', 1, p_tenant, NULL, p_vin, 'k-' || gen_random_uuid(), NULL, false, p_event, 300,
    jsonb_build_object('channel', p_channel, 'initiated_by', '00000000-0000-0000-0000-00000000a001', 'purpose', 'unit test', 'tool_name', 'decode_vin_neovin', 'invocation_id', gen_random_uuid()))
$$;
CREATE OR REPLACE FUNCTION pg_temp.check_status(p_key text) RETURNS text LANGUAGE sql AS $$
  SELECT e->>'status' FROM jsonb_array_elements(marketcheck_launch_readiness(1)->'checks') e WHERE e->>'key' = p_key
$$;

\set harte '''3f0f97f5-4151-4e32-88ef-e2d6fc5a3142'''
\set other '''00000000-0000-0000-0000-0000000000e2'''
\set canary '''45cdc1e0-7e88-4b44-9d07-27369d74ab21'''
\set nissan '''35d5584b-93d4-4419-9a50-6daead08e7a9'''
\set ginf '''e400e636-0909-4b36-822e-caa2b5ae7381'''
\set admin '''00000000-0000-0000-0000-00000000a001'''
\set dealer '''00000000-0000-0000-0000-00000000b001'''
\set vin_canary '''5N1AL1FWXTC358105'''
\set vin_nissan '''1N4BL4CV0RN100001'''
\set vin_amb '''JN1TANY00RW000001'''
\set vin_legacy '''1HGCM82633A004352'''
INSERT INTO user_roles (user_id, role) VALUES (:admin, 'admin');
UPDATE provider_ai_tools SET staff_enabled = true WHERE tool_name = 'decode_vin_neovin';

-- Inventory: one VIN per store, one VIN whose ownership is ambiguous (feed
-- says Harte INFINITI, a listing says Harte Nissan), one legacy VIN.
INSERT INTO store_inventory (store_id, group_id, vin, source_dealer_id, condition, feed_price_status) VALUES
  (:canary, '79feb0ce-0214-48b4-8709-f8d94bdecb5b', :vin_canary, 'MP15398', 'new', 'known'),
  (:nissan, '79feb0ce-0214-48b4-8709-f8d94bdecb5b', :vin_nissan, 'MP15397', 'new', 'known'),
  (:canary, '79feb0ce-0214-48b4-8709-f8d94bdecb5b', :vin_amb, 'MP15398', 'new', 'known');
INSERT INTO vehicle_listings (id, store_id, tenant_id, vin, owning_store_id) VALUES
  ('00000000-0000-0000-0000-00000000c001', 'harte', :harte, :vin_canary, :canary),
  ('00000000-0000-0000-0000-00000000c002', 'harte', :harte, :vin_amb, :nissan),
  ('00000000-0000-0000-0000-00000000c003', 'harte', :harte, :vin_legacy, NULL);

-- ── Applying the migration changes nothing that spends ──────────────────
SELECT pg_temp.expect(pg_temp.state() = 'not_ready' AND NOT (SELECT emergency_stop FROM marketcheck_launch_control), 'switch starts OFF (not ready, no stop)');
SELECT pg_temp.expect((SELECT monthly_call_cap = 0 AND reserve_for_essential = 1000 FROM provider_call_budgets WHERE provider = 'marketcheck'),
  'owner hold cap 0 kept; older 250 reserve reconciled to the coordinator 1,000');
SELECT pg_temp.expect((SELECT status = 'draft' AND canary_store_id = :canary AND jsonb_array_length(rollout) = 5 AND account_usd_cap IS NULL FROM marketcheck_launch_plans WHERE version = 1),
  'draft plan v1 seeded for Harte INFINITI with the five sister rooftops in order, not approved, no dollar cap yet');
SELECT pg_temp.expect((SELECT products = ARRAY['neovin'] AND allowed_callers = ARRAY['marketcheck-specs'] AND cron_jobs = '[]'::jsonb FROM marketcheck_launch_plans WHERE version = 1),
  'plan v1 is consistent: NeoVIN only, through marketcheck-specs only; marketcheck-sync (syndication) is not an approved caller and no cron is enabled');
SELECT pg_temp.expect((SELECT NOT admitted AND reason = 'gate_upgrade_required' FROM provider_call_admit('marketcheck', 'neovin', 'old-deploy', false, :harte, NULL, NULL)),
  'a function deployed before this release cannot admit a MarketCheck call');
SELECT pg_temp.expect((SELECT NOT admitted AND reason = 'gate_upgrade_required' FROM provider_call_admit('marketcheck', 'search', 'marketcheck-sync', true, :harte, NULL, NULL)),
  'even the old essential feed lane is refused');
SELECT pg_temp.expect((SELECT reason FROM provider_call_admit('firecrawl', 'scrape', 'firecrawl-scrape', false, NULL, NULL, NULL)) = 'ungated',
  'other providers keep the original gate behaviour');
SELECT pg_temp.expect(pg_temp.admit_reason('marketcheck-specs', :harte, :vin_canary) = 'launch_inactive', 'the new gate refuses while the switch is OFF');
SELECT pg_temp.expect((SELECT reason FROM provider_call_admit_v2('marketcheck', 'neovin', 'marketcheck-specs', NULL, false, :harte, :vin_canary, NULL, NULL, 'neovin')) = 'gate_version_missing',
  'a caller without a gate version is refused');
SELECT pg_temp.expect(pg_temp.admit_reason('marketcheck-specs', :harte, :vin_canary) = 'launch_inactive', 'a correctly versioned refused admission still records the heartbeat');
SELECT pg_temp.expect((SELECT gate_version FROM provider_gate_heartbeats WHERE caller = 'marketcheck-specs') = 'launch-2026-11-02', 'the gate records the caller''s deployed version, even on refusal');
SELECT pg_temp.raises($$SELECT pg_temp.reserve()$$, 'launch_gate_closed: launch_inactive', 'the account coordinator cannot reserve while OFF');
SELECT pg_temp.raises($$SELECT pg_temp.reserve('staff_ai')$$, 'launch_gate_closed: launch_inactive', 'staff AI/MCP requests cannot reserve while OFF');
SELECT pg_temp.expect((SELECT count(*) FROM provider_call_events WHERE provider = 'marketcheck' AND outcome <> 'budget_denied') = 0, 'no MarketCheck call was admitted');

-- ── Only platform admins may act ────────────────────────────────────────
SELECT pg_temp.as_user(:dealer);
SELECT pg_temp.raises($$SELECT marketcheck_launch_status()$$, 'platform_admin_required', 'a dealer user cannot read launch status');
SELECT pg_temp.raises($$SELECT marketcheck_launch_activate(1, 'START')$$, 'platform_admin_required', 'a dealer user cannot activate');
SELECT pg_temp.raises($$SELECT marketcheck_emergency_stop('x')$$, 'platform_admin_required', 'a dealer user cannot stop');
SELECT pg_temp.raises($$SELECT marketcheck_launch_set_plan_usd_cap(1, 50)$$, 'platform_admin_required', 'a dealer user cannot set the dollar cap');
SELECT pg_temp.raises($$SELECT marketcheck_launch_attest('sticker_templates', 'passed', 'looks good', 'none provided')$$, 'platform_admin_required', 'a dealer user cannot attest');
SELECT pg_temp.as_user(NULL);
SELECT pg_temp.raises($$SELECT marketcheck_launch_attest('sticker_templates', 'passed', 'all seven', 'ref-123456')$$, 'platform_admin_required', 'the service role may attest only credentials');
SELECT pg_temp.raises($$SELECT marketcheck_launch_attest('edge_versions', 'passed', 'deployed', 'ref-123456')$$, 'platform_admin_required', 'nobody can hand-attest the deployed gate version');
SELECT pg_temp.as_user(:admin);
SELECT pg_temp.raises($$SELECT marketcheck_launch_attest('stop_drill', 'passed', 'we tried it', 'ref-123456')$$, 'unknown_check', 'the stop drill cannot be hand-attested');
SELECT pg_temp.raises($$SELECT marketcheck_launch_attest('auto_generation', 'passed', 'it works', 'ref-123456')$$, 'unknown_check', 'sticker generation cannot be hand-attested');

-- ── Readiness fails truthfully against the production-like state ────────
SELECT pg_temp.expect((marketcheck_launch_status()->>'state') = 'not_ready', 'status shows NOT READY');
SELECT pg_temp.expect(NOT (marketcheck_launch_status()->>'activation_allowed')::boolean, 'activation is disabled');
SELECT pg_temp.raises($$SELECT marketcheck_launch_activate(1, 'yes')$$, 'confirmation_required', 'activation needs the typed confirmation');
SELECT pg_temp.expect((marketcheck_launch_activate(1, 'START')->>'reason') = 'plan_not_approved', 'an unapproved plan cannot be activated');
SELECT pg_temp.raises($$SELECT marketcheck_launch_approve_plan(1)$$, 'usd_cap_required', 'a plan without an owner dollar cap cannot be approved');
SELECT pg_temp.raises($$SELECT marketcheck_launch_set_plan_usd_cap(1, 0)$$, 'invalid_usd_cap', 'a zero dollar cap is refused');
SELECT marketcheck_launch_set_plan_usd_cap(1, 25);
SELECT marketcheck_launch_approve_plan(1);
SELECT pg_temp.raises($$SELECT marketcheck_launch_set_plan_usd_cap(1, 500)$$, 'plan_not_draft', 'an approved plan''s cap cannot be raised in place');
SELECT pg_temp.expect((SELECT marketcheck_launch_activate(1, 'START')->>'reason') = 'readiness_failed', 'activation refused while checks fail');
SELECT pg_temp.expect((SELECT result = 'refused' AND detail->>'reason' = 'readiness_failed' FROM marketcheck_launch_events WHERE action = 'activate' ORDER BY id DESC LIMIT 1),
  'the refusal is audited with the failing checks');
SELECT pg_temp.expect(pg_temp.state() = 'not_ready' AND (SELECT monthly_call_cap FROM provider_call_budgets WHERE provider = 'marketcheck') = 0,
  'a refused activation changes nothing');
SELECT pg_temp.expect((SELECT array_agg(e->>'key' ORDER BY e->>'key') FROM jsonb_array_elements(marketcheck_launch_readiness(1)->'checks') e WHERE e->>'status' <> 'passed')
  @> ARRAY['quota_known','entitlements','primary_feed','canary_policy','schedulers','feed_mappings','credentials','sticker_templates','cost_controls','sticker_generation','stop_drill','mcp_boundary'],
  'quota, entitlements, feed, canary policy, scheduler, mappings, dollar caps, sticker generation, stop drill and evidence are reported as not passed');

-- ── Bring every check to green with synthetic evidence ─────────────────
SELECT pg_temp.expect(pg_temp.check_status('migrations') = 'passed', 'migrations check passes');
SELECT pg_temp.expect(pg_temp.check_status('coordinator') = 'passed', 'coordinator check passes after reserve reconciliation');
SELECT pg_temp.expect(pg_temp.check_status('edge_versions') = 'passed', 'the heartbeat from a refused admission proves the deployed gate version');
SELECT pg_temp.raises($$SELECT marketcheck_launch_record_quota(5000, 10, 4990, now() + interval '20 days', 'no')$$, 'evidence_required', 'provider figures need evidence');
SELECT marketcheck_launch_record_quota(5000, 10, 4990, now() + interval '20 days', 'MarketCheck account usage page, Nov 2 screenshot');
INSERT INTO inventory_source_mappings (source_dealer_id, group_id, store_id, status, observed_identity, evidence, approved_at)
SELECT d, '79feb0ce-0214-48b4-8709-f8d94bdecb5b', s::uuid, 'approved', '{}'::jsonb, '{"approved_comparison":{"verdict":"match"}}'::jsonb, now()
FROM (VALUES ('MP15398', '45cdc1e0-7e88-4b44-9d07-27369d74ab21'), ('MP15397', '35d5584b-93d4-4419-9a50-6daead08e7a9'), ('MP15395', 'e400e636-0909-4b36-822e-caa2b5ae7381'),
             ('MP15396', '12e1d831-166d-48e9-87b5-536d7c0980dc'), ('MP19635', '17a9f6f2-29ff-4ff1-bf72-1519df10b7d5'), ('MP25214', '02b4f1ac-e15a-40a7-9c49-811fd043ef53')) v(d, s);
INSERT INTO inventory_store_snapshots (path, source_dealer_id, store_id, group_id, source_mtime, content_sha256, clean, status, applied_at)
VALUES ('prod/inventory/vauto/inbound/MP15398_inventory.csv', 'MP15398', :canary, '79feb0ce-0214-48b4-8709-f8d94bdecb5b', now() - interval '1 hour', 'abc', true, 'applied', now() - interval '1 hour');
UPDATE provider_product_catalog SET verified_at = now() WHERE product_key = 'neovin';
INSERT INTO store_enrichment_policies (store_id, mode, credential_ref, mc_rooftop_id, mc_rooftop_verified_at, allowed_products, daily_request_limit, monthly_request_cap)
VALUES (:canary, 'paused', 'MARKETCHECK_API_KEY', 'harte-infiniti-hartford', now(), ARRAY['neovin'], 30, 600);
UPDATE inventory_feed_controls SET ingestion_paused = false;
INSERT INTO cron.job (jobname, schedule, command) VALUES ('files-inventory-worker', '*/10 * * * *', $c$SELECT net.http_post(url := 'https://x.supabase.co/functions/v1/files-inventory-worker')$c$);
-- Dollar caps: prices unverified and no store cap fail the check.
SELECT pg_temp.expect(pg_temp.check_status('cost_controls') = 'failed', 'list-price estimates and no store dollar cap fail the cost check');
UPDATE provider_product_catalog SET rate_usd = 0.08, rate_status = 'verified', evidence = 'MarketCheck order form (synthetic)' WHERE product_key = 'neovin';
SELECT pg_temp.expect(pg_temp.check_status('cost_controls') = 'failed', 'verified price without a store dollar cap still fails');
UPDATE store_enrichment_policies SET monthly_usd_cap = 50 WHERE store_id = :canary;
SELECT pg_temp.expect(pg_temp.check_status('cost_controls') = 'failed', 'a store cap above the account cap fails');
UPDATE store_enrichment_policies SET monthly_usd_cap = 10 WHERE store_id = :canary;
SELECT pg_temp.expect(pg_temp.check_status('cost_controls') = 'passed', 'account cap, verified price and store cap pass');
-- Real-data sticker generation is read from the orchestrator's own records.
CREATE TABLE factory_sticker_records (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid, current_document_id uuid, reconciliation_status text,
  qr_identity_qa_status text, visual_qa_status text, updated_at timestamptz DEFAULT now());
INSERT INTO factory_sticker_records (vehicle_id, current_document_id, reconciliation_status, qr_identity_qa_status, visual_qa_status)
VALUES ('00000000-0000-0000-0000-00000000c001', gen_random_uuid(), 'MISMATCH', 'PASS', 'PASS');
SELECT pg_temp.expect(pg_temp.check_status('sticker_generation') = 'failed', 'a sticker whose MSRP did not reconcile is not evidence');
UPDATE factory_sticker_records SET reconciliation_status = 'MATCHED';
SELECT pg_temp.expect(pg_temp.check_status('sticker_generation') = 'passed', 'a reconciled, QA-passed canary sticker is');
SELECT marketcheck_launch_attest(k, 'passed', 'synthetic evidence for ' || k, 'scratch-db-test-run') FROM unnest(ARRAY['credentials','mcp_boundary','quota_concurrency','sticker_templates','print_passport_qa']) k;
SELECT pg_temp.expect(pg_temp.check_status('stop_drill') = 'unverified', 'no stop drill yet');

-- ── Stop drill at the real boundaries, while OFF ────────────────────────
CREATE TEMP TABLE drill_before AS SELECT (SELECT count(*) FROM provider_call_events) pce, (SELECT count(*) FROM provider_requests) pr,
  (SELECT jsonb_agg(to_jsonb(j) ORDER BY jobid) FROM cron.job j) cron, (SELECT to_jsonb(c) FROM marketcheck_launch_control c) ctl;
SELECT pg_temp.expect((marketcheck_launch_stop_drill()->>'ok')::boolean, 'the stop drill passes');
SELECT pg_temp.expect((SELECT detail->'admission_v2'->>'marketcheck-specs' = 'emergency_stop' AND detail->>'admission_pre_release' = 'gate_upgrade_required'
    AND detail->>'provider_reserve' = 'launch_gate_closed: emergency_stop' AND detail->>'direct_reservation' = 'launch_gate_closed: emergency_stop'
    FROM marketcheck_launch_checks WHERE check_key = 'stop_drill'),
  'drill evidence: v2 admission, the pre-release entry point, provider_reserve and a direct insert all refused under the stop');
SELECT pg_temp.expect((SELECT NOT EXISTS (SELECT 1 FROM jsonb_array_elements(detail->'cron_during_stop') j WHERE (j->>'active')::boolean)
    AND EXISTS (SELECT 1 FROM jsonb_array_elements(detail->'cron_before') j WHERE j->>'jobname' = 'specs-backfill' AND (j->>'active')::boolean)
    FROM marketcheck_launch_checks WHERE check_key = 'stop_drill'),
  'drill evidence: the active specs-backfill job was parked while the stop held');
SELECT pg_temp.expect((SELECT pce = (SELECT count(*) FROM provider_call_events) AND pr = (SELECT count(*) FROM provider_requests)
    AND cron = (SELECT jsonb_agg(to_jsonb(j) ORDER BY jobid) FROM cron.job j)
    AND (ctl - 'updated_at') = ((SELECT to_jsonb(c) FROM marketcheck_launch_control c) - 'updated_at') FROM drill_before),
  'the drill left no ledger rows, reservations, cron changes or switch changes behind');
SELECT pg_temp.expect(pg_temp.check_status('stop_drill') = 'passed', 'the drill result is the readiness evidence');
SELECT pg_temp.expect((marketcheck_launch_readiness(1)->>'all_mandatory_passed')::boolean, 'every mandatory check passes');
SELECT pg_temp.expect((marketcheck_launch_status()->>'state') = 'ready_to_activate' AND (marketcheck_launch_status()->>'activation_allowed')::boolean, 'status shows READY TO ACTIVATE');
SELECT pg_temp.expect(pg_temp.state() = 'not_ready', 'readiness alone never flips the stored switch');

-- ── Activate ────────────────────────────────────────────────────────────
UPDATE marketcheck_launch_plans SET canary_max_calls = 3 WHERE version = 1;
SELECT pg_temp.expect((marketcheck_launch_activate(1, 'START')->>'ok')::boolean, 'activation succeeds when every check passes');
SELECT pg_temp.expect(pg_temp.state() = 'activating_canary', 'state is ACTIVATING CANARY');
SELECT pg_temp.expect((marketcheck_launch_activate(1, 'START')->>'reason') = 'already_activating_canary', 'a second activation is refused');
SELECT pg_temp.expect((SELECT monthly_call_cap = 5000 AND reserve_for_essential = 1000 FROM provider_call_budgets WHERE provider = 'marketcheck'), 'budget follows the account quota and reserve');
SELECT pg_temp.expect((SELECT monthly_usd_cap = 25 FROM provider_accounts WHERE account_ref = 'marketcheck_primary'), 'the account dollar cap is the plan''s owner-approved cap');
SELECT pg_temp.expect((SELECT mode FROM store_enrichment_policies WHERE store_id = :canary) = 'enrichment', 'canary store policy switched to enrichment');
SELECT pg_temp.expect((SELECT NOT active FROM cron.job WHERE jobname = 'marketcheck-sync') AND (SELECT NOT active FROM cron.job WHERE jobname = 'enrich-sweep-nightly'),
  'no syndication or sweep job is turned on');
SELECT pg_temp.expect((SELECT previous_budget->>'monthly_call_cap' = '0' AND previous_budget ? 'account_usd_cap' FROM marketcheck_launch_control), 'the pre-activation budget and dollar cap are kept for rollback');

-- ── Negative security tests while the canary is live ────────────────────
SELECT pg_temp.expect(pg_temp.admit_reason('marketcheck-sync', :harte, :vin_canary) = 'launch_caller_not_approved', 'unauthorized caller: marketcheck-sync is refused');
SELECT pg_temp.expect(pg_temp.admit_reason('description-orchestrate', :harte, :vin_canary) = 'launch_caller_not_approved', 'unauthorized caller: any caller outside the plan is refused');
SELECT pg_temp.expect(pg_temp.admit_reason('marketcheck-specs', :harte, :vin_canary, NULL, 'launch-2026-10-01') = 'launch_gate_version_mismatch', 'wrong gate version is refused');
SELECT pg_temp.expect(pg_temp.admit_reason('marketcheck-specs', :harte, :vin_canary, NULL, 'launch-2026-11-02x') = 'launch_gate_version_mismatch', 'a near-miss gate version is refused');
SELECT pg_temp.expect(pg_temp.admit_reason('marketcheck-specs', :harte, :vin_canary, NULL, 'launch-2026-11-02', 'price_base', 'price_prediction') = 'launch_product_not_approved', 'wrong product: price prediction is refused');
SELECT pg_temp.expect(pg_temp.admit_reason('marketcheck-specs', :harte, NULL, :canary, 'launch-2026-11-02', 'syndication', 'dealer_inventory_syndication') = 'launch_product_mismatch', 'a product missing from the account catalog is refused');
SELECT pg_temp.expect(pg_temp.admit_reason('marketcheck-specs', :harte, :vin_canary, NULL, 'launch-2026-11-02', 'neovin', 'basic_vin_decode') = 'launch_product_mismatch', 'a billing product that does not match the catalog product is refused');
SELECT pg_temp.expect(pg_temp.admit_reason('marketcheck-specs', :harte, :vin_canary, NULL, 'launch-2026-11-02', NULL, 'neovin') = 'launch_product_mismatch', 'a request without a catalog product is refused');
SELECT pg_temp.expect(pg_temp.admit_reason('marketcheck-specs', :harte, :vin_nissan) = 'launch_store_not_active', 'wrong store, same tenant: a Harte Nissan VIN is refused while only Harte INFINITI is live');
SELECT pg_temp.expect(pg_temp.admit_reason('marketcheck-specs', :harte, :vin_canary, :nissan) = 'launch_store_mismatch', 'a caller claiming another rooftop for a canary VIN is refused');
SELECT pg_temp.expect(pg_temp.admit_reason('marketcheck-specs', :harte, :vin_nissan, :canary) = 'launch_store_mismatch', 'a caller claiming the canary for a sister-store VIN is refused');
SELECT pg_temp.expect(pg_temp.admit_reason('marketcheck-specs', :harte, NULL, NULL) = 'launch_store_required', 'missing store ID on a VIN-less request is refused');
SELECT pg_temp.expect(pg_temp.admit_reason('marketcheck-specs', :harte, NULL, :nissan) = 'launch_store_not_active', 'a VIN-less request for a sister rooftop is refused');
SELECT pg_temp.expect(pg_temp.admit_reason('marketcheck-specs', :other, NULL, :canary) = 'launch_store_tenant_mismatch', 'a VIN-less request naming the canary from another tenant is refused');
SELECT pg_temp.expect(pg_temp.admit_reason('marketcheck-specs', :other, :vin_canary) = 'launch_store_tenant_mismatch', 'another tenant cannot spend on a canary VIN');
SELECT pg_temp.expect(pg_temp.admit_reason('marketcheck-specs', NULL, :vin_canary) = 'launch_tenant_required', 'a call with no tenant is refused');
SELECT pg_temp.expect(pg_temp.admit_reason('marketcheck-specs', :harte, :vin_amb) = 'launch_vin_ownership_ambiguous', 'ambiguous VIN ownership across two rooftops is refused');
SELECT pg_temp.expect(pg_temp.admit_reason('marketcheck-specs', :harte, :vin_legacy) = 'launch_vin_not_store_inventory', 'a VIN no rooftop owns is refused');
UPDATE inventory_source_mappings SET evidence = '{"approved_comparison":{"verdict":"mismatch"}}' WHERE store_id = :canary;
SELECT pg_temp.expect(pg_temp.admit_reason('marketcheck-specs', :harte, :vin_canary) = 'launch_store_identity_unverified', 'unverified store identity (comparison did not match) is refused');
UPDATE inventory_source_mappings SET evidence = '{"approved_comparison":{"verdict":"match"}}' WHERE store_id = :canary;
INSERT INTO inventory_source_mappings (source_dealer_id, group_id, store_id, status, observed_identity, evidence, approved_at)
VALUES ('MP99999', '79feb0ce-0214-48b4-8709-f8d94bdecb5b', :canary, 'approved', '{}'::jsonb, '{"approved_comparison":{"verdict":"match"}}'::jsonb, now());
SELECT pg_temp.expect(pg_temp.admit_reason('marketcheck-specs', :harte, :vin_canary) = 'launch_store_identity_unverified', 'a rooftop with two approved feed identities is refused');
UPDATE inventory_source_mappings SET status = 'revoked' WHERE source_dealer_id = 'MP99999';
UPDATE inventory_source_mappings SET status = 'revoked' WHERE store_id = :canary AND status = 'approved';
SELECT pg_temp.expect(pg_temp.admit_reason('marketcheck-specs', :harte, :vin_canary) = 'launch_store_identity_unverified', 'a rooftop whose mapping was revoked is refused');
INSERT INTO inventory_source_mappings (source_dealer_id, group_id, store_id, status, observed_identity, evidence, approved_at)
VALUES ('MP15398', '79feb0ce-0214-48b4-8709-f8d94bdecb5b', :canary, 'approved', '{}'::jsonb, '{"approved_comparison":{"verdict":"match"}}'::jsonb, now());
SELECT pg_temp.expect((SELECT count(*) FROM provider_call_events WHERE provider = 'marketcheck' AND outcome <> 'budget_denied') = 0, 'every refusal above admitted nothing');
-- Direct reservations.
SELECT pg_temp.raises($$SELECT pg_temp.reserve()$$, 'launch_reservation_unbound', 'unauthorized direct reservation: a REST reservation with no admission is refused');
SELECT pg_temp.raises($$SELECT pg_temp.reserve('rest', '3f0f97f5-4151-4e32-88ef-e2d6fc5a3142', '5N1AL1FWXTC358105', (SELECT max(id) FROM provider_call_events WHERE outcome = 'budget_denied'))$$,
  'launch_reservation_unbound', 'a REST reservation bound to a refused admission is refused');
SELECT pg_temp.raises($$INSERT INTO provider_requests (account_ref, product_key, caller, reason, priority, channel, tenant_id, vin, status)
  VALUES ('marketcheck_primary', 'neovin', 'marketcheck-specs', 'x', 1, 'rest', '3f0f97f5-4151-4e32-88ef-e2d6fc5a3142', '5N1AL1FWXTC358105', 'reserved')$$,
  'launch_reservation_unbound', 'a direct INSERT of a reservation is refused');
SELECT pg_temp.raises($$SELECT pg_temp.reserve('staff_ai')$$, 'launch_staff_ai_not_approved', 'staff AI stays off unless the plan allows it');
SELECT pg_temp.expect((SELECT NOT admitted FROM provider_call_admit('marketcheck', 'neovin', 'marketcheck-specs', true, :harte, :vin_canary, NULL)), 'old deployments stay refused even while active');

-- The canary path itself.
SELECT pg_temp.expect(pg_temp.call('marketcheck-specs', :harte, :vin_canary) = 'admitted', 'the approved caller, product and canary VIN are admitted and reserved');
SELECT pg_temp.expect((SELECT store_id = :canary AND catalog_product = 'neovin' AND gate_version = 'launch-2026-11-02' FROM provider_call_events WHERE outcome = 'admitted' ORDER BY id DESC LIMIT 1),
  'the admission records the server-resolved rooftop, product and gate version');
SELECT pg_temp.expect((SELECT store_id = :canary AND group_id = '79feb0ce-0214-48b4-8709-f8d94bdecb5b' FROM provider_requests WHERE status = 'reserved' ORDER BY reserved_at DESC LIMIT 1),
  'the reservation carries the server-resolved rooftop, though the caller sent none');
SELECT pg_temp.raises($$SELECT pg_temp.reserve('rest', '3f0f97f5-4151-4e32-88ef-e2d6fc5a3142', '5N1AL1FWXTC358105', (SELECT max(id) FROM provider_call_events WHERE outcome = 'admitted'))$$,
  'launch_reservation_reused', 'an admission cannot back a second reservation');
SELECT pg_temp.raises($$SELECT pg_temp.reserve('rest', '3f0f97f5-4151-4e32-88ef-e2d6fc5a3142', '5N1AL1FWXTC358105', (SELECT max(id) FROM provider_call_events WHERE outcome = 'admitted'), 'marketcheck-specs', 'price_base')$$,
  'launch_reservation_unbound', 'an admission for NeoVIN cannot back a price reservation');
INSERT INTO provider_requests (account_ref, product_key, caller, reason, priority, tenant_id, status, refusal_reason)
VALUES ('marketcheck_primary', 'neovin', 'marketcheck-specs', 'x', 1, :harte, 'refused', 'test');
SELECT pg_temp.raises($$UPDATE provider_requests SET status = 'reserved' WHERE status = 'refused'$$,
  'launch_reservation_reopen', 'a refused reservation cannot be flipped to reserved');
SELECT pg_temp.expect(pg_temp.call('marketcheck-specs', :harte, :vin_canary) = 'reserve_duplicate_in_flight', 'a duplicate decode for the same VIN joins the in-flight one');
SELECT pg_temp.expect(pg_temp.call('marketcheck-specs', :harte, :vin_canary, :canary) = 'reserve_duplicate_in_flight', 'naming the correct rooftop is accepted');
SELECT pg_temp.expect(pg_temp.admit_reason('marketcheck-specs', :harte, :vin_canary) = 'launch_paused_canary_ceiling_reached', 'the canary ceiling refuses the next call');
SELECT pg_temp.expect(pg_temp.state() = 'paused' AND (SELECT paused_reason FROM marketcheck_launch_control) = 'canary_ceiling_reached', 'and pauses the launch for review');
SELECT pg_temp.expect(pg_temp.admit_reason('marketcheck-specs', :harte, :vin_canary) = 'launch_inactive', 'nothing is admitted while paused');
SELECT pg_temp.expect((SELECT count(*) FROM provider_call_events WHERE provider = 'marketcheck' AND outcome <> 'budget_denied') = 3, 'exactly the canary ceiling was admitted');

-- Promotion needs provider usage reported after the canary started.
UPDATE provider_accounts SET provider_reported_at = now() - interval '2 hours' WHERE account_ref = 'marketcheck_primary';
SELECT pg_temp.expect((marketcheck_launch_resume('RESUME')->>'reason') = 'canary_consumption_not_reconciled', 'pilot needs the canary''s real consumption reconciled');
SELECT marketcheck_launch_record_quota(5000, 13, 4987, now() + interval '20 days', 'MarketCheck account usage page after canary');
SELECT pg_temp.expect((marketcheck_launch_resume('RESUME')->>'state') = 'pilot_active', 'resume after reconciliation enters PILOT ACTIVE');
UPDATE marketcheck_launch_plans SET hourly_call_ceiling = 100, daily_call_ceiling = 200 WHERE version = 1;
UPDATE provider_requests SET status = 'consumed', settled_at = now() WHERE status = 'reserved';
SELECT pg_temp.expect(pg_temp.call('marketcheck-specs', :harte, :vin_canary) = 'admitted', 'pilot admits again under the daily ceiling');

-- Tripwire: provider errors pause the launch.
UPDATE provider_call_events SET outcome = 'refused_rate' WHERE id IN (SELECT id FROM provider_call_events WHERE provider = 'marketcheck' AND outcome = 'admitted' ORDER BY id LIMIT 4);
INSERT INTO provider_call_events (provider, product, caller, essential, tenant_id, outcome) VALUES ('marketcheck', 'neovin', 'marketcheck-specs', false, :harte, 'provider_error');
SELECT pg_temp.expect(pg_temp.admit_reason('marketcheck-specs', :harte, :vin_canary) = 'launch_paused_provider_errors', 'five provider errors in an hour trip the breaker');
SELECT pg_temp.expect(pg_temp.state() = 'paused', 'and the launch pauses itself');
UPDATE provider_call_events SET at = at - interval '2 hours' WHERE outcome IN ('refused_rate','provider_error');
SELECT pg_temp.expect((marketcheck_launch_resume('RESUME')->>'state') = 'pilot_active', 'an admin resume returns to the pilot');

-- Feed integrity: a held snapshot for an active store pauses calls.
INSERT INTO inventory_store_snapshots (path, source_dealer_id, store_id, group_id, source_mtime, content_sha256, status)
VALUES ('prod/inventory/vauto/inbound/MP15398_inventory.csv', 'MP15398', :canary, '79feb0ce-0214-48b4-8709-f8d94bdecb5b', now(), 'def', 'held');
SELECT pg_temp.expect(pg_temp.admit_reason('marketcheck-specs', :harte, :vin_canary) = 'launch_paused_feed_integrity_hold', 'a held feed snapshot pauses MarketCheck');
UPDATE inventory_store_snapshots SET status = 'superseded' WHERE content_sha256 = 'def';
SELECT pg_temp.expect((marketcheck_launch_resume('RESUME')->>'state') = 'pilot_active', 'resume once the hold is resolved');

-- ── Expansion revalidates the rooftop, in plan order ────────────────────
SELECT pg_temp.raises($$SELECT marketcheck_launch_expand('35d5584b-93d4-4419-9a50-6daead08e7a9', 'go')$$, 'confirmation_required', 'expansion needs confirmation');
SELECT pg_temp.expect((marketcheck_launch_expand('02b4f1ac-e15a-40a7-9c49-811fd043ef53', 'EXPAND')->>'reason') = 'out_of_order', 'rooftops activate in plan order only');
SELECT pg_temp.expect((marketcheck_launch_expand(:nissan, 'EXPAND')->>'reason') = 'waiting_period', 'the next rooftop waits out the plan period');
UPDATE marketcheck_launch_control SET pilot_started_at = now() - interval '3 days';
SELECT pg_temp.expect((marketcheck_launch_expand(:nissan, 'EXPAND')->>'reason') = 'store_feed_not_live', 'a rooftop whose feed import is paused cannot join');
UPDATE dealer_stores SET feed_import_paused = false WHERE id = :nissan;
SELECT pg_temp.expect((marketcheck_launch_expand(:nissan, 'EXPAND')->>'reason') = 'store_policy_not_ready', 'a rooftop without a verified MarketCheck identity cannot join');
INSERT INTO store_enrichment_policies (store_id, mode, credential_ref, mc_rooftop_id, mc_rooftop_verified_at, allowed_products, daily_request_limit, monthly_request_cap)
VALUES (:nissan, 'feed_only', 'MARKETCHECK_API_KEY', 'harte-nissan', now(), ARRAY['neovin'], 500, 400);
SELECT pg_temp.expect((marketcheck_launch_expand(:nissan, 'EXPAND')->>'reason') = 'store_limits_invalid', 'a store daily limit above the plan ceiling is refused');
UPDATE store_enrichment_policies SET daily_request_limit = 20 WHERE store_id = :nissan;
SELECT pg_temp.expect((marketcheck_launch_expand(:nissan, 'EXPAND')->>'reason') = 'store_usd_cap_missing', 'a rooftop without a dollar cap cannot join');
UPDATE store_enrichment_policies SET monthly_usd_cap = 8 WHERE store_id = :nissan;
UPDATE store_enrichment_policies SET allowed_products = ARRAY['vin_history'] WHERE store_id = :nissan;
SELECT pg_temp.expect((marketcheck_launch_expand(:nissan, 'EXPAND')->>'reason') = 'store_products_not_allowed', 'a rooftop whose policy does not allow the plan products cannot join');
UPDATE store_enrichment_policies SET allowed_products = ARRAY['neovin'] WHERE store_id = :nissan;
SELECT pg_temp.expect((marketcheck_launch_expand(:nissan, 'EXPAND')->>'reason') = 'store_feed_not_clean', 'a rooftop that never applied a feed cannot join');
INSERT INTO inventory_store_snapshots (path, source_dealer_id, store_id, group_id, source_mtime, content_sha256, clean, status, applied_at)
VALUES ('prod/inventory/vauto/inbound/MP15397_inventory.csv', 'MP15397', :nissan, '79feb0ce-0214-48b4-8709-f8d94bdecb5b', now() - interval '20 hours', 'n1', true, 'applied', now() - interval '20 hours');
SELECT pg_temp.expect((marketcheck_launch_expand(:nissan, 'EXPAND')->>'reason') = 'store_feed_not_clean', 'a stale last feed (older than the plan window) is refused');
INSERT INTO inventory_store_snapshots (path, source_dealer_id, store_id, group_id, source_mtime, content_sha256, clean, status, applied_at)
VALUES ('prod/inventory/vauto/inbound/MP15397_inventory.csv', 'MP15397', :nissan, '79feb0ce-0214-48b4-8709-f8d94bdecb5b', now() - interval '2 hours', 'n2', true, 'applied', now() - interval '2 hours');
INSERT INTO inventory_store_snapshots (path, source_dealer_id, store_id, group_id, source_mtime, content_sha256, status)
VALUES ('prod/inventory/vauto/inbound/MP15397_inventory.csv', 'MP15397', :nissan, '79feb0ce-0214-48b4-8709-f8d94bdecb5b', now(), 'n3', 'quarantined');
SELECT pg_temp.expect((marketcheck_launch_expand(:nissan, 'EXPAND')->>'reason') = 'store_feed_not_clean', 'a quarantined snapshot after the last applied one is refused');
UPDATE inventory_store_snapshots SET status = 'superseded' WHERE content_sha256 = 'n3';
UPDATE inventory_source_mappings SET evidence = '{"approved_comparison":{"verdict":"mismatch"}}' WHERE store_id = :nissan AND status = 'approved';
SELECT pg_temp.expect((marketcheck_launch_expand(:nissan, 'EXPAND')->>'reason') = 'store_identity_unverified', 'a rooftop whose feed identity did not match is refused');
UPDATE inventory_source_mappings SET evidence = '{"approved_comparison":{"verdict":"match"}}' WHERE store_id = :nissan AND status = 'approved';
SELECT pg_temp.expect((SELECT count(*) FROM marketcheck_launch_events WHERE action = 'expand' AND result = 'refused') >= 8, 'every refused expansion is audited with its reason');
SELECT pg_temp.expect((marketcheck_launch_expand(:nissan, 'EXPAND')->>'state') = 'expanding', 'Harte Nissan joins once every check passes');
SELECT pg_temp.expect((SELECT mode FROM store_enrichment_policies WHERE store_id = :nissan) = 'enrichment', 'its store policy is enabled');
SELECT pg_temp.expect(pg_temp.call('marketcheck-specs', :harte, :vin_nissan) = 'admitted', 'a Harte Nissan VIN is admitted once Harte Nissan is live');
SELECT pg_temp.expect(pg_temp.admit_reason('marketcheck-specs', :harte, NULL, :ginf) = 'launch_store_not_active', 'George Harte INFINITI, same tenant, is still refused');
SELECT pg_temp.expect((marketcheck_launch_expand(:ginf, 'EXPAND')->>'reason') = 'waiting_period', 'the next rooftop waits again');

-- ── Emergency stop ──────────────────────────────────────────────────────
CREATE TEMP TABLE before_counts AS SELECT (SELECT count(*) FROM store_inventory) si, (SELECT count(*) FROM marketcheck_launch_events) ev,
  (SELECT count(*) FROM provider_call_events) pce, (SELECT count(*) FROM inventory_store_snapshots) snaps;
SELECT pg_temp.expect((marketcheck_emergency_stop('test stop')->>'state') = 'emergency_stop', 'Stop All MarketCheck Paid Calls engages');
SELECT pg_temp.expect(pg_temp.admit_reason('marketcheck-specs', :harte, :vin_canary) = 'emergency_stop', 'the next admission is refused');
SELECT pg_temp.raises($$SELECT pg_temp.reserve()$$, 'launch_gate_closed: emergency_stop', 'the coordinator refuses to reserve during the stop');
SELECT pg_temp.expect((SELECT NOT active FROM cron.job WHERE jobname = 'specs-backfill'), 'every MarketCheck-reaching cron job is parked, including ones the plan did not enable');
SELECT pg_temp.expect((SELECT active FROM cron.job WHERE jobname = 'title-reminders-sweep'), 'unrelated jobs are untouched');
SELECT pg_temp.expect((SELECT bool_and(mode = 'paused') FROM store_enrichment_policies), 'store enrichment policies are paused');
SELECT pg_temp.expect((SELECT si = (SELECT count(*) FROM store_inventory) AND snaps = (SELECT count(*) FROM inventory_store_snapshots)
  AND pce <= (SELECT count(*) FROM provider_call_events) AND ev < (SELECT count(*) FROM marketcheck_launch_events) FROM before_counts),
  'the stop deleted no inventory, snapshots, ledger rows or audit history');
SELECT pg_temp.expect((marketcheck_launch_activate(1, 'START')->>'reason') = 'emergency_stop', 'activation is refused while stopped');
SELECT pg_temp.expect((marketcheck_launch_resume('RESUME')->>'reason') = 'not_paused', 'resume is refused while stopped');
SELECT pg_temp.expect((marketcheck_launch_expand(:ginf, 'EXPAND')->>'reason') = 'not_in_pilot', 'expansion is refused while stopped');
SELECT pg_temp.expect((marketcheck_launch_stop_drill()->>'reason') = 'drill_only_when_off', 'the drill never runs while a launch exists');
SELECT pg_temp.raises($$UPDATE marketcheck_launch_events SET result = 'ok'$$, 'append-only', 'audit rows cannot be edited');
SELECT pg_temp.raises($$DELETE FROM marketcheck_launch_events$$, 'append-only', 'audit rows cannot be deleted');
SELECT pg_temp.expect((marketcheck_launch_release_stop('RELEASE')->>'state') = 'paused', 'releasing the stop lands in PAUSED, never live');
SELECT pg_temp.expect(pg_temp.admit_reason('marketcheck-specs', :harte, :vin_canary) = 'launch_inactive', 'still nothing admitted after release');

-- The SQL-editor stop needs no RPC at all.
SELECT pg_temp.as_user(NULL);
UPDATE marketcheck_launch_control SET emergency_stop = true, state = 'emergency_stop' WHERE id = 1;
SELECT pg_temp.expect(pg_temp.admit_reason('marketcheck-specs', :harte, :vin_canary) = 'emergency_stop', 'a bare UPDATE of the stop column refuses admissions');
SELECT pg_temp.expect((marketcheck_emergency_stop('service stop')->>'ok')::boolean, 'the service role can call the stop');
SELECT pg_temp.as_user(:admin);
SELECT marketcheck_launch_release_stop('RELEASE');

-- ── Rollback ────────────────────────────────────────────────────────────
SELECT pg_temp.expect((marketcheck_launch_rollback('ROLLBACK')->>'state') = 'not_ready', 'rollback returns the switch to OFF');
SELECT pg_temp.expect((SELECT monthly_call_cap = 0 AND notes LIKE 'owner hold%' AND notes NOT LIKE '%activated by%' FROM provider_call_budgets WHERE provider = 'marketcheck'), 'the owner hold budget row is restored');
SELECT pg_temp.expect((SELECT monthly_usd_cap IS NULL FROM provider_accounts WHERE account_ref = 'marketcheck_primary'), 'the account dollar cap is restored');
SELECT pg_temp.expect((SELECT NOT active AND schedule = '7 * * * *' FROM cron.job WHERE jobname = 'marketcheck-sync'), 'marketcheck-sync is untouched');
SELECT pg_temp.expect((SELECT mode FROM store_enrichment_policies WHERE store_id = :canary) = 'paused', 'the canary policy returns to its pre-activation mode');
SELECT pg_temp.expect(pg_temp.admit_reason('marketcheck-specs', :harte, :vin_canary) = 'launch_inactive', 'nothing is admitted after rollback');
SELECT pg_temp.expect((SELECT count(*) FROM marketcheck_launch_events WHERE action IN ('activate','tripwire_pause','resume','expand','emergency_stop','release_stop','rollback','stop_drill')) >= 10,
  'every action is in the audit log');
