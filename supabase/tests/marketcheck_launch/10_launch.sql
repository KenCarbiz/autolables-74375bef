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
CREATE OR REPLACE FUNCTION pg_temp.admit(p_caller text, p_tenant uuid, p_version text DEFAULT 'launch-2026-11-02', p_vin text DEFAULT NULL)
RETURNS record LANGUAGE sql AS $$
  SELECT (admitted, reason) FROM provider_call_admit_v2('marketcheck', 'neovin', p_caller, p_version, false, p_tenant, p_vin, 0.0)
$$;
CREATE OR REPLACE FUNCTION pg_temp.admit_reason(p_caller text, p_tenant uuid, p_vin text DEFAULT NULL) RETURNS text LANGUAGE sql AS $$
  SELECT reason FROM provider_call_admit_v2('marketcheck', 'neovin', p_caller, 'launch-2026-11-02', false, p_tenant, p_vin, 0.0)
$$;
CREATE OR REPLACE FUNCTION pg_temp.state() RETURNS text LANGUAGE sql AS $$ SELECT state FROM marketcheck_launch_control WHERE id = 1 $$;
CREATE OR REPLACE FUNCTION pg_temp.reserve(p_channel text DEFAULT 'rest', p_tenant uuid DEFAULT '3f0f97f5-4151-4e32-88ef-e2d6fc5a3142') RETURNS jsonb LANGUAGE sql AS $$
  SELECT provider_reserve('marketcheck_primary', 'neovin', 'marketcheck-sync', 'unit', 1, p_tenant, NULL, NULL, 'k-' || gen_random_uuid(), NULL, false, NULL, 300,
    jsonb_build_object('channel', p_channel, 'initiated_by', '00000000-0000-0000-0000-00000000a001', 'purpose', 'unit test', 'tool_name', 'decode_vin_neovin', 'invocation_id', gen_random_uuid()))
$$;

\set harte '''3f0f97f5-4151-4e32-88ef-e2d6fc5a3142'''
\set canary '''45cdc1e0-7e88-4b44-9d07-27369d74ab21'''
\set admin '''00000000-0000-0000-0000-00000000a001'''
\set dealer '''00000000-0000-0000-0000-00000000b001'''
INSERT INTO user_roles (user_id, role) VALUES (:admin, 'admin');
UPDATE provider_ai_tools SET staff_enabled = true WHERE tool_name = 'decode_vin_neovin';

-- ── Applying the migration changes nothing that spends ──────────────────
SELECT pg_temp.expect(pg_temp.state() = 'not_ready' AND NOT (SELECT emergency_stop FROM marketcheck_launch_control), 'switch starts OFF (not ready, no stop)');
SELECT pg_temp.expect((SELECT monthly_call_cap = 0 AND reserve_for_essential = 1000 FROM provider_call_budgets WHERE provider = 'marketcheck'),
  'owner hold cap 0 kept; older 250 reserve reconciled to the coordinator 1,000');
SELECT pg_temp.expect((SELECT status = 'draft' AND canary_store_id = :canary AND jsonb_array_length(rollout) = 5 FROM marketcheck_launch_plans WHERE version = 1),
  'draft plan v1 seeded for Harte INFINITI with the five sister rooftops in order, not approved');
SELECT pg_temp.expect((SELECT NOT admitted AND reason = 'gate_upgrade_required' FROM provider_call_admit('marketcheck', 'neovin', 'old-deploy', false, :harte, NULL, NULL)),
  'a function deployed before this release cannot admit a MarketCheck call');
SELECT pg_temp.expect((SELECT NOT admitted AND reason = 'gate_upgrade_required' FROM provider_call_admit('marketcheck', 'search', 'marketcheck-sync', true, :harte, NULL, NULL)),
  'even the old essential feed lane is refused');
SELECT pg_temp.expect((SELECT reason FROM provider_call_admit('firecrawl', 'scrape', 'firecrawl-scrape', false, NULL, NULL, NULL)) = 'ungated',
  'other providers keep the original gate behaviour');
SELECT pg_temp.expect(pg_temp.admit_reason('marketcheck-sync', :harte) = 'launch_inactive', 'the new gate refuses while the switch is OFF');
SELECT pg_temp.expect((SELECT reason FROM provider_call_admit_v2('marketcheck', 'neovin', 'marketcheck-sync', NULL, false, :harte, NULL, NULL)) = 'gate_version_missing',
  'a caller without a gate version is refused');
SELECT pg_temp.expect((SELECT gate_version FROM provider_gate_heartbeats WHERE caller = 'marketcheck-sync') = 'launch-2026-11-02', 'the gate records the caller''s deployed version');
SELECT pg_temp.raises($$SELECT pg_temp.reserve()$$, 'launch_gate_closed', 'the account coordinator cannot reserve while OFF');
SELECT pg_temp.raises($$SELECT pg_temp.reserve('staff_ai')$$, 'launch_gate_closed', 'staff AI/MCP requests cannot reserve while OFF');
SELECT pg_temp.expect((SELECT count(*) FROM provider_call_events WHERE provider = 'marketcheck' AND outcome <> 'budget_denied') = 0, 'no MarketCheck call was admitted');

-- ── Only platform admins may act ────────────────────────────────────────
SELECT pg_temp.as_user(:dealer);
SELECT pg_temp.raises($$SELECT marketcheck_launch_status()$$, 'platform_admin_required', 'a dealer user cannot read launch status');
SELECT pg_temp.raises($$SELECT marketcheck_launch_activate(1, 'START')$$, 'platform_admin_required', 'a dealer user cannot activate');
SELECT pg_temp.raises($$SELECT marketcheck_emergency_stop('x')$$, 'platform_admin_required', 'a dealer user cannot stop');
SELECT pg_temp.raises($$SELECT marketcheck_launch_attest('sticker_templates', 'passed', 'looks good', 'none provided')$$, 'platform_admin_required', 'a dealer user cannot attest');
SELECT pg_temp.as_user(NULL);
SELECT pg_temp.raises($$SELECT marketcheck_launch_attest('sticker_templates', 'passed', 'all seven', 'ref-123456')$$, 'platform_admin_required', 'the service role may attest only credentials and gate version');

-- ── Readiness fails truthfully against the production-like state ────────
SELECT pg_temp.as_user(:admin);
SELECT pg_temp.expect((marketcheck_launch_status()->>'state') = 'not_ready', 'status shows NOT READY');
SELECT pg_temp.expect(NOT (marketcheck_launch_status()->>'activation_allowed')::boolean, 'activation is disabled');
SELECT pg_temp.raises($$SELECT marketcheck_launch_activate(1, 'yes')$$, 'confirmation_required', 'activation needs the typed confirmation');
SELECT pg_temp.expect((marketcheck_launch_activate(1, 'START')->>'reason') = 'plan_not_approved', 'an unapproved plan cannot be activated');
SELECT marketcheck_launch_approve_plan(1);
SELECT pg_temp.expect((SELECT marketcheck_launch_activate(1, 'START')->>'reason') = 'readiness_failed', 'activation refused while checks fail');
SELECT pg_temp.expect((SELECT result = 'refused' AND detail->>'reason' = 'readiness_failed' FROM marketcheck_launch_events WHERE action = 'activate' ORDER BY id DESC LIMIT 1),
  'the refusal is audited with the failing checks');
SELECT pg_temp.expect(pg_temp.state() = 'not_ready' AND (SELECT monthly_call_cap FROM provider_call_budgets WHERE provider = 'marketcheck') = 0,
  'a refused activation changes nothing');
SELECT pg_temp.expect((SELECT array_agg(e->>'key' ORDER BY e->>'key') FROM jsonb_array_elements(marketcheck_launch_readiness(1)->'checks') e WHERE e->>'status' <> 'passed')
  @> ARRAY['quota_known','entitlements','primary_feed','canary_policy','schedulers','feed_mappings','credentials','sticker_templates'],
  'quota, entitlements, feed freshness, canary policy, scheduler, mappings and evidence are reported as not passed');

-- ── Bring every check to green with synthetic evidence ─────────────────
SELECT pg_temp.expect((SELECT e->>'status' FROM jsonb_array_elements(marketcheck_launch_readiness(1)->'checks') e WHERE e->>'key' = 'migrations') = 'passed', 'migrations check passes');
SELECT pg_temp.expect((SELECT e->>'status' FROM jsonb_array_elements(marketcheck_launch_readiness(1)->'checks') e WHERE e->>'key' = 'coordinator') = 'passed', 'coordinator check passes after reserve reconciliation');
SELECT pg_temp.raises($$SELECT marketcheck_launch_record_quota(5000, 10, 4990, now() + interval '20 days', 'no')$$, 'evidence_required', 'provider figures need evidence');
SELECT marketcheck_launch_record_quota(5000, 10, 4990, now() + interval '20 days', 'MarketCheck account usage page, Nov 2 screenshot');
INSERT INTO inventory_source_mappings (source_dealer_id, group_id, store_id, status, observed_identity, evidence, approved_at)
SELECT 'MP' || row_number() OVER () || '_inventory', '79feb0ce-0214-48b4-8709-f8d94bdecb5b', id, 'approved', '{}'::jsonb,
  '{"approved_comparison":{"verdict":"match"}}'::jsonb, now()
FROM dealer_stores WHERE tenant_id = :harte;
INSERT INTO inventory_store_snapshots (path, source_dealer_id, store_id, group_id, source_mtime, content_sha256, clean, status, applied_at)
VALUES ('prod/inventory/vauto/inbound/MP1_inventory.csv', 'MP1_inventory', :canary, '79feb0ce-0214-48b4-8709-f8d94bdecb5b', now() - interval '1 hour', 'abc', true, 'applied', now() - interval '1 hour');
UPDATE provider_product_catalog SET verified_at = now() WHERE product_key = 'neovin';
INSERT INTO store_enrichment_policies (store_id, mode, credential_ref, mc_rooftop_id, mc_rooftop_verified_at, allowed_products, daily_request_limit, monthly_request_cap)
VALUES (:canary, 'paused', 'MARKETCHECK_API_KEY', 'harte-infiniti-hartford', now(), ARRAY['neovin'], 30, 600);
UPDATE inventory_feed_controls SET ingestion_paused = false;
INSERT INTO cron.job (jobname, schedule, command) VALUES ('files-inventory-worker', '*/10 * * * *', $c$SELECT net.http_post(url := 'https://x.supabase.co/functions/v1/files-inventory-worker')$c$);
INSERT INTO provider_gate_heartbeats (caller, gate_version) VALUES ('marketcheck-specs', 'launch-2026-11-02'), ('vehicle-enrich', 'launch-2026-11-02')
ON CONFLICT (caller) DO UPDATE SET gate_version = EXCLUDED.gate_version, last_seen = now();
SELECT marketcheck_launch_attest(k, 'passed', 'synthetic evidence for ' || k, 'scratch-db-test-run') FROM unnest(ARRAY['credentials','quota_concurrency','sticker_templates','auto_generation','print_passport_qa','rollback_tested']) k;
SELECT pg_temp.expect((marketcheck_launch_readiness(1)->>'all_mandatory_passed')::boolean, 'every mandatory check passes');
SELECT pg_temp.expect((marketcheck_launch_status()->>'state') = 'ready_to_activate' AND (marketcheck_launch_status()->>'activation_allowed')::boolean, 'status shows READY TO ACTIVATE');
SELECT pg_temp.expect(pg_temp.state() = 'not_ready', 'readiness alone never flips the stored switch');

-- Stop drill while OFF.
SELECT pg_temp.expect((marketcheck_launch_stop_drill()->>'gate_answer') = 'emergency_stop', 'the stop drill proves the gate refuses on stop');
SELECT pg_temp.expect(pg_temp.state() = 'not_ready' AND NOT (SELECT emergency_stop FROM marketcheck_launch_control), 'the drill leaves the switch as it was');

-- ── Activate ────────────────────────────────────────────────────────────
UPDATE marketcheck_launch_plans SET canary_max_calls = 3 WHERE version = 1;
SELECT pg_temp.expect((marketcheck_launch_activate(1, 'START')->>'ok')::boolean, 'activation succeeds when every check passes');
SELECT pg_temp.expect(pg_temp.state() = 'activating_canary', 'state is ACTIVATING CANARY');
SELECT pg_temp.expect((marketcheck_launch_activate(1, 'START')->>'reason') = 'already_activating_canary', 'a second activation is refused');
SELECT pg_temp.expect((SELECT monthly_call_cap = 5000 AND reserve_for_essential = 1000 FROM provider_call_budgets WHERE provider = 'marketcheck'), 'budget follows the account quota and reserve');
SELECT pg_temp.expect((SELECT mode FROM store_enrichment_policies WHERE store_id = :canary) = 'enrichment', 'canary store policy switched to enrichment');
SELECT pg_temp.expect((SELECT active AND schedule = '7 */4 * * *' FROM cron.job WHERE jobname = 'marketcheck-sync'), 'the plan''s marketcheck-sync job is enabled on the plan schedule');
SELECT pg_temp.expect((SELECT NOT active FROM cron.job WHERE jobname = 'enrich-sweep-nightly'), 'jobs outside the plan stay off');
SELECT pg_temp.expect((SELECT previous_budget->>'monthly_call_cap' = '0' FROM marketcheck_launch_control), 'the pre-activation budget is kept for rollback');

SELECT pg_temp.expect(pg_temp.admit_reason('description-orchestrate', :harte) = 'launch_caller_not_approved', 'a caller outside the plan is refused');
SELECT pg_temp.expect(pg_temp.admit_reason('marketcheck-sync', '00000000-0000-0000-0000-0000000000e2') = 'launch_tenant_not_approved', 'another tenant is refused');
SELECT pg_temp.expect(pg_temp.admit_reason('marketcheck-sync', NULL) = 'launch_tenant_not_approved', 'a call with no tenant is refused');
SELECT pg_temp.expect(pg_temp.admit_reason('marketcheck-sync', :harte) = 'admitted', 'the canary caller for the canary tenant is admitted');
SELECT pg_temp.expect((pg_temp.reserve()->>'reserved')::boolean, 'the account coordinator reserves while the canary is live');
SELECT pg_temp.raises($$SELECT pg_temp.reserve('staff_ai')$$, 'launch_staff_ai_not_approved', 'staff AI stays off unless the plan allows it');
SELECT pg_temp.expect((SELECT NOT admitted FROM provider_call_admit('marketcheck', 'neovin', 'marketcheck-sync', true, :harte, NULL, NULL)), 'old deployments stay refused even while active');
SELECT pg_temp.expect(pg_temp.admit_reason('marketcheck-specs', :harte) = 'admitted', 'second canary call admitted');
SELECT pg_temp.expect(pg_temp.admit_reason('vehicle-enrich', :harte) = 'admitted', 'third canary call admitted');
SELECT pg_temp.expect(pg_temp.admit_reason('marketcheck-sync', :harte) = 'launch_paused_canary_ceiling_reached', 'the canary ceiling refuses the next call');
SELECT pg_temp.expect(pg_temp.state() = 'paused' AND (SELECT paused_reason FROM marketcheck_launch_control) = 'canary_ceiling_reached', 'and pauses the launch for review');
SELECT pg_temp.expect(pg_temp.admit_reason('marketcheck-sync', :harte) = 'launch_inactive', 'nothing is admitted while paused');
SELECT pg_temp.expect((SELECT count(*) FROM provider_call_events WHERE provider = 'marketcheck' AND outcome <> 'budget_denied') = 3, 'exactly the canary ceiling was admitted');

-- Promotion needs provider usage reported after the canary started.
UPDATE provider_accounts SET provider_reported_at = now() - interval '2 hours' WHERE account_ref = 'marketcheck_primary';
SELECT pg_temp.expect((marketcheck_launch_resume('RESUME')->>'reason') = 'canary_consumption_not_reconciled', 'pilot needs the canary''s real consumption reconciled');
SELECT marketcheck_launch_record_quota(5000, 13, 4987, now() + interval '20 days', 'MarketCheck account usage page after canary');
SELECT pg_temp.expect((marketcheck_launch_resume('RESUME')->>'state') = 'pilot_active', 'resume after reconciliation enters PILOT ACTIVE');
UPDATE marketcheck_launch_plans SET hourly_call_ceiling = 100, daily_call_ceiling = 200 WHERE version = 1;
SELECT pg_temp.expect(pg_temp.admit_reason('marketcheck-sync', :harte) = 'admitted', 'pilot admits again under the daily ceiling');

-- Tripwire: provider errors pause the launch.
UPDATE provider_call_events SET outcome = 'refused_rate' WHERE id IN (SELECT id FROM provider_call_events WHERE provider = 'marketcheck' AND outcome = 'admitted' ORDER BY id LIMIT 4);
INSERT INTO provider_call_events (provider, product, caller, essential, tenant_id, outcome) VALUES ('marketcheck', 'neovin', 'marketcheck-sync', false, :harte, 'provider_error');
SELECT pg_temp.expect(pg_temp.admit_reason('marketcheck-sync', :harte) = 'launch_paused_provider_errors', 'five provider errors in an hour trip the breaker');
SELECT pg_temp.expect(pg_temp.state() = 'paused', 'and the launch pauses itself');
UPDATE provider_call_events SET at = at - interval '2 hours' WHERE outcome IN ('refused_rate','provider_error');
SELECT pg_temp.expect((marketcheck_launch_resume('RESUME')->>'state') = 'pilot_active', 'an admin resume returns to the pilot');

-- Feed integrity: a held snapshot for an active store pauses calls.
INSERT INTO inventory_store_snapshots (path, source_dealer_id, store_id, group_id, source_mtime, content_sha256, status)
VALUES ('prod/inventory/vauto/inbound/MP1_inventory.csv', 'MP1_inventory', :canary, '79feb0ce-0214-48b4-8709-f8d94bdecb5b', now(), 'def', 'held');
SELECT pg_temp.expect(pg_temp.admit_reason('marketcheck-sync', :harte) = 'launch_paused_feed_integrity_hold', 'a held feed snapshot pauses MarketCheck');
UPDATE inventory_store_snapshots SET status = 'superseded' WHERE content_sha256 = 'def';
SELECT pg_temp.expect((marketcheck_launch_resume('RESUME')->>'state') = 'pilot_active', 'resume once the hold is resolved');

-- ── Expansion follows the plan order and waiting period ─────────────────
SELECT pg_temp.raises($$SELECT marketcheck_launch_expand('35d5584b-93d4-4419-9a50-6daead08e7a9', 'go')$$, 'confirmation_required', 'expansion needs confirmation');
SELECT pg_temp.expect((marketcheck_launch_expand('02b4f1ac-e15a-40a7-9c49-811fd043ef53', 'EXPAND')->>'reason') = 'out_of_order', 'rooftops activate in plan order only');
SELECT pg_temp.expect((marketcheck_launch_expand('35d5584b-93d4-4419-9a50-6daead08e7a9', 'EXPAND')->>'reason') = 'waiting_period', 'the next rooftop waits out the plan period');
UPDATE marketcheck_launch_control SET pilot_started_at = now() - interval '3 days';
SELECT pg_temp.expect((marketcheck_launch_expand('35d5584b-93d4-4419-9a50-6daead08e7a9', 'EXPAND')->>'reason') = 'store_policy_not_ready', 'a rooftop without a verified MarketCheck identity cannot join');
INSERT INTO store_enrichment_policies (store_id, mode, credential_ref, mc_rooftop_id, mc_rooftop_verified_at, allowed_products, daily_request_limit, monthly_request_cap)
VALUES ('35d5584b-93d4-4419-9a50-6daead08e7a9', 'feed_only', 'MARKETCHECK_API_KEY', 'harte-nissan', now(), ARRAY['neovin'], 20, 400);
SELECT pg_temp.expect((marketcheck_launch_expand('35d5584b-93d4-4419-9a50-6daead08e7a9', 'EXPAND')->>'reason') = 'store_feed_not_live', 'a rooftop whose feed import is paused cannot join');
UPDATE dealer_stores SET feed_import_paused = false WHERE id = '35d5584b-93d4-4419-9a50-6daead08e7a9';
SELECT pg_temp.expect((marketcheck_launch_expand('35d5584b-93d4-4419-9a50-6daead08e7a9', 'EXPAND')->>'state') = 'expanding', 'Harte Nissan joins as the first expansion');
SELECT pg_temp.expect((SELECT mode FROM store_enrichment_policies WHERE store_id = '35d5584b-93d4-4419-9a50-6daead08e7a9') = 'enrichment', 'its store policy is enabled');

-- ── Emergency stop ──────────────────────────────────────────────────────
CREATE TEMP TABLE before_counts AS SELECT (SELECT count(*) FROM store_inventory) si, (SELECT count(*) FROM marketcheck_launch_events) ev,
  (SELECT count(*) FROM provider_call_events) pce, (SELECT count(*) FROM inventory_store_snapshots) snaps;
SELECT pg_temp.expect((marketcheck_emergency_stop('test stop')->>'state') = 'emergency_stop', 'Stop All MarketCheck Paid Calls engages');
SELECT pg_temp.expect(pg_temp.admit_reason('marketcheck-sync', :harte) = 'emergency_stop', 'the next admission is refused');
SELECT pg_temp.raises($$SELECT pg_temp.reserve()$$, 'launch_gate_closed', 'the coordinator refuses to reserve during the stop');
SELECT pg_temp.expect((SELECT NOT active FROM cron.job WHERE jobname = 'marketcheck-sync') AND (SELECT NOT active FROM cron.job WHERE jobname = 'specs-backfill'),
  'every MarketCheck-reaching cron job is parked, including ones the plan did not enable');
SELECT pg_temp.expect((SELECT active FROM cron.job WHERE jobname = 'title-reminders-sweep'), 'unrelated jobs are untouched');
SELECT pg_temp.expect((SELECT bool_and(mode = 'paused') FROM store_enrichment_policies), 'store enrichment policies are paused');
SELECT pg_temp.expect((SELECT si = (SELECT count(*) FROM store_inventory) AND snaps = (SELECT count(*) FROM inventory_store_snapshots)
  AND pce <= (SELECT count(*) FROM provider_call_events) AND ev < (SELECT count(*) FROM marketcheck_launch_events) FROM before_counts),
  'the stop deleted no inventory, snapshots, ledger rows or audit history');
SELECT pg_temp.expect((marketcheck_launch_activate(1, 'START')->>'reason') = 'emergency_stop', 'activation is refused while stopped');
SELECT pg_temp.expect((marketcheck_launch_resume('RESUME')->>'reason') = 'not_paused', 'resume is refused while stopped');
SELECT pg_temp.raises($$UPDATE marketcheck_launch_events SET result = 'ok'$$, 'append-only', 'audit rows cannot be edited');
SELECT pg_temp.raises($$DELETE FROM marketcheck_launch_events$$, 'append-only', 'audit rows cannot be deleted');
SELECT pg_temp.expect((marketcheck_launch_release_stop('RELEASE')->>'state') = 'paused', 'releasing the stop lands in PAUSED, never live');
SELECT pg_temp.expect(pg_temp.admit_reason('marketcheck-sync', :harte) = 'launch_inactive', 'still nothing admitted after release');

-- The SQL-editor stop needs no RPC at all.
SELECT pg_temp.as_user(NULL);
UPDATE marketcheck_launch_control SET emergency_stop = true, state = 'emergency_stop' WHERE id = 1;
SELECT pg_temp.expect(pg_temp.admit_reason('marketcheck-sync', :harte) = 'emergency_stop', 'a bare UPDATE of the stop column refuses admissions');
SELECT pg_temp.expect((marketcheck_emergency_stop('service stop')->>'ok')::boolean, 'the service role can call the stop');
SELECT pg_temp.as_user(:admin);
SELECT marketcheck_launch_release_stop('RELEASE');

-- ── Rollback ────────────────────────────────────────────────────────────
SELECT pg_temp.expect((marketcheck_launch_rollback('ROLLBACK')->>'state') = 'not_ready', 'rollback returns the switch to OFF');
SELECT pg_temp.expect((SELECT monthly_call_cap = 0 AND notes LIKE 'owner hold%' AND notes NOT LIKE '%activated by%' FROM provider_call_budgets WHERE provider = 'marketcheck'), 'the owner hold budget row is restored');
SELECT pg_temp.expect((SELECT NOT active AND schedule = '7 * * * *' FROM cron.job WHERE jobname = 'marketcheck-sync'), 'marketcheck-sync is restored to its pre-activation state');
SELECT pg_temp.expect((SELECT mode FROM store_enrichment_policies WHERE store_id = :canary) = 'paused', 'the canary policy returns to its pre-activation mode');
SELECT pg_temp.expect(pg_temp.admit_reason('marketcheck-sync', :harte) = 'launch_inactive', 'nothing is admitted after rollback');
SELECT pg_temp.expect((SELECT count(*) FROM marketcheck_launch_events WHERE action IN ('activate','tripwire_pause','resume','expand','emergency_stop','release_stop','rollback','stop_drill')) >= 10,
  'every action is in the audit log');
