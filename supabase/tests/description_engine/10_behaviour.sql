-- Behaviour tests for the proposed 20261109000000_description_store_settings
-- and 20261109000100_vauto_export_gate migrations. Run by
-- scripts/test-description-engine-sql.sh against a scratch database.
-- Synthetic data only. Any failed expectation raises and stops the run.
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

CREATE OR REPLACE FUNCTION pg_temp.as_user(p uuid) RETURNS void LANGUAGE sql AS $$ SELECT set_config('test.uid', coalesce(p::text, ''), false) $$;

-- ── Fixtures ───────────────────────────────────────────────────────────────
-- Tenant A (a Harte-like group) has two CT rooftops; tenant B is unrelated.
-- gsm = configure + approve, sales_manager = approve only, sales = neither.
INSERT INTO tenants (id, name) VALUES ('00000000-0000-0000-0000-0000000000a1', 'Group A'), ('00000000-0000-0000-0000-0000000000b1', 'Group B');
INSERT INTO tenant_members (tenant_id, user_id, role) VALUES
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000aa01', 'gsm'),
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000aa02', 'sales'),
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000aa03', 'sales_manager'),
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-00000000bb01', 'owner');
INSERT INTO dealer_stores (id, tenant_id, display_name, state) VALUES
  ('00000000-0000-0000-0000-00000000a5a1', '00000000-0000-0000-0000-0000000000a1', 'North', 'CT'),
  ('00000000-0000-0000-0000-00000000a5a2', '00000000-0000-0000-0000-0000000000a1', 'South', 'CT'),
  ('00000000-0000-0000-0000-00000000b5b1', '00000000-0000-0000-0000-0000000000b1', 'Other', 'NY');
INSERT INTO dealer_profiles (tenant_id, settings) VALUES
  ('00000000-0000-0000-0000-0000000000a1', '{"advertised_includes_doc_fee": true, "doc_fee_enabled": true, "doc_fee_amount": 499}');

-- The synthetic vehicle: $28,496 selling price + $499 fee = $28,995 advertised.
INSERT INTO vehicle_listings (id, tenant_id, vin, price, doc_fee, advertised_price_before_doc, website_sale_price, owning_store_id) VALUES
  ('00000000-0000-0000-0000-0000000c0001', '00000000-0000-0000-0000-0000000000a1', 'SYNTHETIC1', 28995, 499, 28496, 28995, '00000000-0000-0000-0000-00000000a5a1'),
  ('00000000-0000-0000-0000-0000000c0002', '00000000-0000-0000-0000-0000000000a1', 'SYNTHETIC2', 28995, 499, 28496, 28995, '00000000-0000-0000-0000-00000000a5a2');
INSERT INTO description_cases (id, tenant_id, vehicle_id) VALUES
  ('00000000-0000-0000-0000-0000000ca001', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000c0001'),
  ('00000000-0000-0000-0000-0000000ca002', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000c0002');
INSERT INTO description_versions (id, tenant_id, vehicle_id, description_case_id, content) VALUES
  ('00000000-0000-0000-0000-0000000de001', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000c0001', '00000000-0000-0000-0000-0000000ca001', 'master'),
  ('00000000-0000-0000-0000-0000000de002', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000c0002', '00000000-0000-0000-0000-0000000ca002', 'master');
UPDATE description_cases SET current_master_version_id = '00000000-0000-0000-0000-0000000de001' WHERE id = '00000000-0000-0000-0000-0000000ca001';
UPDATE description_cases SET current_master_version_id = '00000000-0000-0000-0000-0000000de002' WHERE id = '00000000-0000-0000-0000-0000000ca002';

CREATE TEMP TABLE t (k text PRIMARY KEY, v text);
GRANT SELECT ON t TO authenticated, service_role;
INSERT INTO t VALUES ('template', 'The advertised price includes the Dealer Conveyance Fee. Dealer Conveyance Fee: {conveyance_fee}. This fee is negotiable and is not payable to the State of Connecticut. State and local taxes and registration fees are excluded from the advertised price.');
INSERT INTO t SELECT 'disclosure', description_render_disclosure((SELECT v FROM t WHERE k = 'template'), 499);
INSERT INTO t SELECT 'cta', 'Call North Motors to schedule a test drive.';
INSERT INTO t SELECT 'good',
  left(repeat('Clean synthetic sedan with verified equipment and a documented history. ', 80),
       3921 - char_length((SELECT v FROM t WHERE k = 'disclosure')) - char_length((SELECT v FROM t WHERE k = 'cta')) - 2)
  || ' ' || (SELECT v FROM t WHERE k = 'cta') || ' ' || (SELECT v FROM t WHERE k = 'disclosure');

INSERT INTO description_channel_versions (id, tenant_id, vehicle_id, description_case_id, master_version_id, channel, content) VALUES
  ('00000000-0000-0000-0000-0000000cc001', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000c0001', '00000000-0000-0000-0000-0000000ca001',
   '00000000-0000-0000-0000-0000000de001', 'vauto', (SELECT v FROM t WHERE k = 'good')),
  ('00000000-0000-0000-0000-0000000cc002', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000c0002', '00000000-0000-0000-0000-0000000ca002',
   '00000000-0000-0000-0000-0000000de002', 'vauto', (SELECT v FROM t WHERE k = 'good'));

SELECT pg_temp.expect(char_length((SELECT v FROM t WHERE k = 'good')) = 3921, 'synthetic text is exactly 3,921 characters');
SELECT pg_temp.expect((SELECT v FROM t WHERE k = 'disclosure') LIKE '%Dealer Conveyance Fee: $499.%', 'disclosure renders the stored $499 fee');

-- ── Helpers ────────────────────────────────────────────────────────────────
SELECT pg_temp.expect(description_fee_basis('{"advertised_includes_doc_fee": true}') = 'includes_fee', 'basis: includes');
SELECT pg_temp.expect(description_fee_basis('{"advertised_includes_doc_fee": "false"}') = 'before_fee', 'basis: string false');
SELECT pg_temp.expect(description_fee_basis('{"advertised_includes_doc_fee": "yes"}') = 'unconfigured', 'basis: unreadable');
SELECT pg_temp.expect(description_fee_basis('{"advertised_includes_doc_fee": true, "advertised_excludes_doc_fee": true}') = 'conflict', 'basis: conflict');
SELECT pg_temp.expect(description_fee_basis('{"advertised_excludes_doc_fee": false}') = 'includes_fee', 'basis: legacy excludes=false');
SELECT pg_temp.expect(description_fee_basis('{}') = 'unconfigured', 'basis: not set');
SELECT pg_temp.expect(description_money(499) = '$499' AND description_money(1234.5) = '$1,234.50' AND description_money(28995) = '$28,995', 'money format matches the gate');

-- ── Disclosure lifecycle ───────────────────────────────────────────────────
SELECT pg_temp.expect(vauto_export_sql_blockers('00000000-0000-0000-0000-0000000cc001') = ARRAY['DISCLOSURE_NOT_APPROVED'], 'no approved disclosure blocks export');
SELECT pg_temp.as_user('00000000-0000-0000-0000-00000000aa02');
SELECT pg_temp.raises($$SELECT propose_description_disclosure('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000a5a1', 'includes_fee', (SELECT v FROM t WHERE k = 'template'))$$, 'not_authorized', 'sales cannot propose a disclosure');
SELECT pg_temp.as_user('00000000-0000-0000-0000-00000000bb01');
SELECT pg_temp.raises($$SELECT propose_description_disclosure('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000a5a1', 'includes_fee', (SELECT v FROM t WHERE k = 'template'))$$, 'not_authorized', 'another dealership cannot propose');
SELECT pg_temp.as_user('00000000-0000-0000-0000-00000000aa01');
SELECT pg_temp.raises($$SELECT propose_description_disclosure('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000b5b1', 'includes_fee', (SELECT v FROM t WHERE k = 'template'))$$, 'store_not_in_tenant', 'store from another dealership refused');
INSERT INTO t SELECT 'd1', propose_description_disclosure('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000a5a1', 'includes_fee', (SELECT v FROM t WHERE k = 'template'))::text;
SELECT pg_temp.expect((SELECT status FROM description_store_disclosures WHERE id = (SELECT v FROM t WHERE k = 'd1')::uuid) = 'pending_legal_review', 'proposal starts pending legal review');
SELECT pg_temp.expect('DISCLOSURE_NOT_APPROVED' = ANY (vauto_export_sql_blockers('00000000-0000-0000-0000-0000000cc001')), 'pending disclosure still blocks');
SELECT pg_temp.raises($$SELECT approve_description_disclosure((SELECT v FROM t WHERE k = 'd1')::uuid)$$, 'legal_review_missing', 'cannot approve before legal review');
SELECT pg_temp.raises($$SELECT record_description_disclosure_legal_review((SELECT v FROM t WHERE k = 'd1')::uuid, '', now(), null, true)$$, 'legal_review_incomplete', 'legal review needs a reviewer');
SELECT record_description_disclosure_legal_review((SELECT v FROM t WHERE k = 'd1')::uuid, 'Synthetic Counsel LLC', now(), 'SYNTHETIC-ONLY', false);
SELECT pg_temp.raises($$SELECT approve_description_disclosure((SELECT v FROM t WHERE k = 'd1')::uuid)$$, 'plain_text_format_not_accepted', 'counsel must accept the plain-text format');
SELECT record_description_disclosure_legal_review((SELECT v FROM t WHERE k = 'd1')::uuid, 'Synthetic Counsel LLC', now(), 'SYNTHETIC-ONLY', true);
SELECT approve_description_disclosure((SELECT v FROM t WHERE k = 'd1')::uuid);
SELECT pg_temp.expect(vauto_export_sql_blockers('00000000-0000-0000-0000-0000000cc001') = '{}', 'approved disclosure + reconciled price: SQL finds no blocker');
SELECT pg_temp.expect('DISCLOSURE_NOT_APPROVED' = ANY (vauto_export_sql_blockers('00000000-0000-0000-0000-0000000cc002')), 'North approval does not approve South');

-- ── Checks and approvals ───────────────────────────────────────────────────
SELECT pg_temp.raises($$SELECT record_vauto_export_check('00000000-0000-0000-0000-0000000cc001', true, '[]', '{}', 'vauto_gate_2', '00000000-0000-0000-0000-00000000bb01')$$, 'requester_not_member', 'check requester must belong to the dealership');
INSERT INTO t SELECT 'bad_check', (record_vauto_export_check('00000000-0000-0000-0000-0000000cc001', false, '[{"code":"X"}]', '{}', 'vauto_gate_2', '00000000-0000-0000-0000-00000000aa01'))->>'check_id';
INSERT INTO t SELECT 'old_gate', (record_vauto_export_check('00000000-0000-0000-0000-0000000cc001', true, '[]', '{}', 'vauto_gate_1', '00000000-0000-0000-0000-00000000aa01'))->>'check_id';
INSERT INTO t SELECT 'check', (record_vauto_export_check('00000000-0000-0000-0000-0000000cc001', true, '[]', '{}', 'vauto_gate_2', '00000000-0000-0000-0000-00000000aa01'))->>'check_id';
SELECT pg_temp.expect((SELECT ok FROM description_export_checks WHERE id = (SELECT v FROM t WHERE k = 'check')::uuid), 'passing check recorded as ok');
SELECT pg_temp.expect(NOT (SELECT ok FROM description_export_checks WHERE id = (SELECT v FROM t WHERE k = 'old_gate')::uuid), 'stale gate version recorded as failed');
INSERT INTO t SELECT 'south_check', (record_vauto_export_check('00000000-0000-0000-0000-0000000cc002', true, '[]', '{}', 'vauto_gate_2', '00000000-0000-0000-0000-00000000aa01'))->>'check_id';
SELECT pg_temp.expect(NOT (SELECT ok FROM description_export_checks WHERE id = (SELECT v FROM t WHERE k = 'south_check')::uuid), 'SQL overrides a TS pass when it finds a blocker');

SELECT pg_temp.as_user(NULL);
SELECT pg_temp.raises($$SELECT approve_vauto_export((SELECT v FROM t WHERE k = 'check')::uuid)$$, 'approval_requires_signed_in_approver', 'a background job cannot approve');
SELECT pg_temp.as_user('00000000-0000-0000-0000-00000000aa02');
SELECT pg_temp.raises($$SELECT approve_vauto_export((SELECT v FROM t WHERE k = 'check')::uuid)$$, 'not_authorized', 'sales cannot approve');
SELECT pg_temp.as_user('00000000-0000-0000-0000-00000000aa03');
SELECT pg_temp.raises($$SELECT approve_vauto_export((SELECT v FROM t WHERE k = 'bad_check')::uuid)$$, 'check_failed', 'a failed check cannot be approved');
SELECT pg_temp.raises($$SELECT approve_vauto_export((SELECT v FROM t WHERE k = 'old_gate')::uuid)$$, 'check_failed', 'an old-gate check cannot be approved');
SELECT pg_temp.raises($$SELECT approve_vauto_export((SELECT v FROM t WHERE k = 'south_check')::uuid)$$, 'check_failed', 'a SQL-blocked check cannot be approved');

SET ROLE service_role;
SELECT pg_temp.raises($$INSERT INTO description_export_approvals (tenant_id, channel_version_id, check_id, fingerprint, approved_by)
  SELECT tenant_id, channel_version_id, id, fingerprint, '00000000-0000-0000-0000-00000000aa01' FROM description_export_checks WHERE id = (SELECT v FROM t WHERE k = 'check')::uuid$$,
  'permission denied', 'service role cannot insert an approval directly');
SELECT pg_temp.raises($$INSERT INTO description_export_checks (tenant_id, channel_version_id, channel, ok, gate_version, fingerprint)
  VALUES ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000cc002', 'vauto', true, 'vauto_gate_2', 'x')$$, 'permission denied', 'service role cannot forge a check row');
RESET ROLE;
SET ROLE authenticated;
SELECT pg_temp.raises($$INSERT INTO description_export_approvals (tenant_id, channel_version_id, check_id, fingerprint, approved_by)
  SELECT tenant_id, channel_version_id, id, fingerprint, '00000000-0000-0000-0000-00000000aa03' FROM description_export_checks WHERE id = (SELECT v FROM t WHERE k = 'check')::uuid$$,
  'permission denied', 'a signed-in user cannot insert an approval directly');
SELECT pg_temp.raises($$SELECT record_vauto_export_check('00000000-0000-0000-0000-0000000cc001', true, '[]', '{}', 'vauto_gate_2', '00000000-0000-0000-0000-00000000aa03')$$, 'permission denied', 'a signed-in user cannot record a check');
RESET ROLE;
-- Even the table owner's direct insert is refused without a signed-in approver.
SELECT pg_temp.as_user(NULL);
SELECT pg_temp.raises($$INSERT INTO description_export_approvals (tenant_id, channel_version_id, check_id, fingerprint, approved_by)
  SELECT tenant_id, channel_version_id, id, fingerprint, '00000000-0000-0000-0000-00000000aa01' FROM description_export_checks WHERE id = (SELECT v FROM t WHERE k = 'check')::uuid$$,
  'approval_requires_signed_in_approver', 'owner-level insert without an approver refused');

SELECT pg_temp.as_user('00000000-0000-0000-0000-00000000aa03');
SELECT pg_temp.raises($$SELECT export_vauto_description('00000000-0000-0000-0000-0000000cc001')$$, 'export_not_approved', 'no export before approval');
SELECT pg_temp.expect((record_description_output_use('00000000-0000-0000-0000-0000000de001', 'vauto', 'copied'))->>'error' = 'use_export_vauto_description', 'old copy route refuses vauto');
SELECT pg_temp.expect((record_description_output_use('00000000-0000-0000-0000-0000000de001', 'website', 'copied'))->>'ok' = 'true', 'old copy route still works for website');
SELECT pg_temp.raises($$INSERT INTO description_deliveries (tenant_id, vehicle_id, description_case_id, version_id, destination, status, idempotency_key)
  VALUES ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000c0001', '00000000-0000-0000-0000-0000000ca001', '00000000-0000-0000-0000-0000000de001', 'vauto', 'recorded', 'k1')$$,
  'vauto_delivery_requires_valid_export_approval', 'a vauto delivery row needs an approval');
INSERT INTO description_deliveries (tenant_id, vehicle_id, description_case_id, version_id, destination, status, idempotency_key)
  VALUES ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000c0001', '00000000-0000-0000-0000-0000000ca001', '00000000-0000-0000-0000-0000000de001', 'vauto', 'skipped', 'k2');
SELECT pg_temp.expect(true, 'orchestrator skipped row still allowed');

SELECT approve_vauto_export((SELECT v FROM t WHERE k = 'check')::uuid, 'synthetic approval');
SELECT pg_temp.expect((SELECT approved_by FROM description_export_approvals WHERE check_id = (SELECT v FROM t WHERE k = 'check')::uuid) = '00000000-0000-0000-0000-00000000aa03', 'approval records the signed-in approver');
SELECT pg_temp.raises($$SELECT approve_vauto_export((SELECT v FROM t WHERE k = 'check')::uuid)$$, 'duplicate key', 'one approval per check');
SELECT pg_temp.expect((export_vauto_description('00000000-0000-0000-0000-0000000cc001'))->>'characters' = '3921', 'approved export returns the 3,921-character text');
SELECT pg_temp.expect(EXISTS (SELECT 1 FROM description_deliveries WHERE destination = 'vauto' AND status = 'recorded'), 'export recorded as an export-only delivery');
SELECT pg_temp.as_user('00000000-0000-0000-0000-00000000bb01');
SELECT pg_temp.raises($$SELECT export_vauto_description('00000000-0000-0000-0000-0000000cc001')$$, 'not_authorized', 'another dealership cannot export');

-- ── Any change voids the approval ──────────────────────────────────────────
SELECT pg_temp.as_user('00000000-0000-0000-0000-00000000aa03');
UPDATE vehicle_listings SET price = 29995, advertised_price_before_doc = 29496, website_sale_price = 29995 WHERE id = '00000000-0000-0000-0000-0000000c0001';
SELECT pg_temp.raises($$SELECT export_vauto_description('00000000-0000-0000-0000-0000000cc001')$$, 'export_not_approved', 'price change voids the approval');
UPDATE vehicle_listings SET price = 28995, advertised_price_before_doc = 28496, website_sale_price = 28995 WHERE id = '00000000-0000-0000-0000-0000000c0001';
SELECT pg_temp.expect((export_vauto_description('00000000-0000-0000-0000-0000000cc001'))->>'characters' = '3921', 'restoring the exact state restores the approval');

UPDATE vehicle_listings SET price = 28900 WHERE id = '00000000-0000-0000-0000-0000000c0001';
SELECT pg_temp.expect('PRICE_SPLIT_MISMATCH' = ANY (vauto_export_sql_blockers('00000000-0000-0000-0000-0000000cc001')), 'selling + fee must equal the advertised price');
UPDATE vehicle_listings SET price = 28995 WHERE id = '00000000-0000-0000-0000-0000000c0001';
UPDATE dealer_profiles SET settings = settings || '{"doc_fee_amount": 599}' WHERE tenant_id = '00000000-0000-0000-0000-0000000000a1';
SELECT pg_temp.expect('DOC_FEE_MISMATCH' = ANY (vauto_export_sql_blockers('00000000-0000-0000-0000-0000000cc001')), 'configured fee must equal the stored fee');
SELECT pg_temp.raises($$SELECT export_vauto_description('00000000-0000-0000-0000-0000000cc001')$$, 'export_not_approved', 'fee setting change voids the approval');
UPDATE dealer_profiles SET settings = settings || '{"doc_fee_amount": 499, "advertised_excludes_doc_fee": false}' WHERE tenant_id = '00000000-0000-0000-0000-0000000000a1';
SELECT pg_temp.expect('FEE_BASIS_CONFLICT' = ANY (vauto_export_sql_blockers('00000000-0000-0000-0000-0000000cc001')) IS FALSE, 'matching legacy key is not a conflict');
UPDATE dealer_profiles SET settings = settings || '{"advertised_excludes_doc_fee": true}' WHERE tenant_id = '00000000-0000-0000-0000-0000000000a1';
SELECT pg_temp.expect('FEE_BASIS_CONFLICT' = ANY (vauto_export_sql_blockers('00000000-0000-0000-0000-0000000cc001')), 'contradictory fee keys block');
UPDATE dealer_profiles SET settings = settings - 'advertised_excludes_doc_fee' WHERE tenant_id = '00000000-0000-0000-0000-0000000000a1';

INSERT INTO description_exceptions (tenant_id, vehicle_id, description_case_id, exception_type, blocking)
  VALUES ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000c0001', '00000000-0000-0000-0000-0000000ca001', 'unverified_claim', true);
SELECT pg_temp.expect('EVIDENCE_BLOCKING_EXCEPTION' = ANY (vauto_export_sql_blockers('00000000-0000-0000-0000-0000000cc001')), 'open blocking exception blocks');
UPDATE description_exceptions SET status = 'resolved';
INSERT INTO description_validation_results (tenant_id, description_case_id, channel_version_id, validator_code, blocking)
  VALUES ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000ca001', '00000000-0000-0000-0000-0000000cc001', 'X', true);
SELECT pg_temp.expect('EVIDENCE_BLOCKING_FINDING' = ANY (vauto_export_sql_blockers('00000000-0000-0000-0000-0000000cc001')), 'open blocking finding blocks');
UPDATE description_validation_results SET status = 'resolved';
UPDATE description_cases SET potentially_stale = true WHERE id = '00000000-0000-0000-0000-0000000ca001';
SELECT pg_temp.expect('EVIDENCE_STALE' = ANY (vauto_export_sql_blockers('00000000-0000-0000-0000-0000000cc001')), 'stale case blocks');
UPDATE description_cases SET potentially_stale = false WHERE id = '00000000-0000-0000-0000-0000000ca001';
SELECT pg_temp.expect((export_vauto_description('00000000-0000-0000-0000-0000000cc001'))->>'characters' = '3921', 'clean state exports again');

UPDATE description_channel_versions SET content = content || 'x' WHERE id = '00000000-0000-0000-0000-0000000cc001';
SELECT pg_temp.expect('CHARACTER_COUNT' = ANY (vauto_export_sql_blockers('00000000-0000-0000-0000-0000000cc001')), '3,922 characters blocks');
SELECT pg_temp.expect('DISCLOSURE_PLACEMENT' = ANY (vauto_export_sql_blockers('00000000-0000-0000-0000-0000000cc001')), 'text after the disclosure blocks');
UPDATE description_channel_versions SET content = (SELECT 'Now only $27,995. ' || substr(v, 19) FROM t WHERE k = 'good') WHERE id = '00000000-0000-0000-0000-0000000cc001';
SELECT pg_temp.expect('PRICE_IN_DESCRIPTION' = ANY (vauto_export_sql_blockers('00000000-0000-0000-0000-0000000cc001')), 'a price outside the disclosure blocks');
UPDATE description_channel_versions SET content = (SELECT replace(v, 'Clean synthetic', E'Clean\nsynthetic') FROM t WHERE k = 'good') WHERE id = '00000000-0000-0000-0000-0000000cc001';
SELECT pg_temp.expect('LINE_BREAKS' = ANY (vauto_export_sql_blockers('00000000-0000-0000-0000-0000000cc001')), 'line breaks block');
UPDATE description_channel_versions SET content = (SELECT v FROM t WHERE k = 'good') WHERE id = '00000000-0000-0000-0000-0000000cc001';

-- Check expiry and revocation.
SELECT pg_temp.as_user('00000000-0000-0000-0000-00000000aa01');
INSERT INTO t SELECT 'check2', (record_vauto_export_check('00000000-0000-0000-0000-0000000cc001', true, '[]', '{}', 'vauto_gate_2', '00000000-0000-0000-0000-00000000aa01'))->>'check_id';
UPDATE description_export_checks SET created_at = now() - interval '20 minutes' WHERE id = (SELECT v FROM t WHERE k = 'check2')::uuid;
SELECT pg_temp.raises($$SELECT approve_vauto_export((SELECT v FROM t WHERE k = 'check2')::uuid)$$, 'check_expired', 'a check older than 15 minutes cannot be approved');
UPDATE description_export_approvals SET revoked_at = now(), revoked_by = '00000000-0000-0000-0000-00000000aa01';
SELECT pg_temp.raises($$SELECT export_vauto_description('00000000-0000-0000-0000-0000000cc001')$$, 'export_not_approved', 'revoked approval cannot export');
SELECT pg_temp.raises($$UPDATE description_export_approvals SET revoked_at = NULL$$, 'append_only', 'a revocation cannot be undone');

-- Approving a new disclosure version retires the old one and voids approvals.
INSERT INTO t SELECT 'check3', (record_vauto_export_check('00000000-0000-0000-0000-0000000cc001', true, '[]', '{}', 'vauto_gate_2', '00000000-0000-0000-0000-00000000aa01'))->>'check_id';
SELECT approve_vauto_export((SELECT v FROM t WHERE k = 'check3')::uuid);
INSERT INTO t SELECT 'd2', propose_description_disclosure('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000a5a1', 'includes_fee', (SELECT v FROM t WHERE k = 'template'))::text;
SELECT record_description_disclosure_legal_review((SELECT v FROM t WHERE k = 'd2')::uuid, 'Synthetic Counsel LLC', now(), 'SYNTHETIC-ONLY-2', true);
SELECT approve_description_disclosure((SELECT v FROM t WHERE k = 'd2')::uuid);
SELECT pg_temp.expect((SELECT status FROM description_store_disclosures WHERE id = (SELECT v FROM t WHERE k = 'd1')::uuid) = 'retired', 'previous disclosure retired');
SELECT pg_temp.expect((SELECT count(*) FROM description_store_disclosures WHERE status = 'approved') = 1, 'one approved disclosure per store and basis');
SELECT pg_temp.raises($$SELECT export_vauto_description('00000000-0000-0000-0000-0000000cc001')$$, 'export_not_approved', 'new disclosure version voids the old approval');

-- ── Per-store settings ─────────────────────────────────────────────────────
SELECT pg_temp.as_user('00000000-0000-0000-0000-00000000aa02');
SELECT pg_temp.raises($$SELECT apply_description_store_settings('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000a5a1', 0, '{"brand_voice":"warm"}', 'r', gen_random_uuid())$$, 'not_authorized', 'sales cannot change store settings');
SELECT pg_temp.as_user('00000000-0000-0000-0000-00000000aa01');
SELECT pg_temp.raises($$SELECT apply_description_store_settings('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000b5b1', 0, '{"brand_voice":"warm"}', 'r', gen_random_uuid())$$, 'store_not_in_tenant', 'cannot configure another dealership''s store');
SELECT pg_temp.raises($$SELECT apply_description_store_settings('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000a5a1', 0, '{"advertised_includes_doc_fee":false}', 'r', gen_random_uuid())$$, 'invalid_overrides', 'fee basis cannot be set per store');
SELECT pg_temp.raises($$SELECT apply_description_store_settings('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000a5a1', 0, '{"review_mode":"YOLO"}', 'r', gen_random_uuid())$$, 'invalid_overrides', 'unknown review mode refused');
INSERT INTO t VALUES ('req1', gen_random_uuid()::text);
SELECT pg_temp.expect((apply_description_store_settings('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000a5a1', 0,
  '{"brand_voice":"warm","cta_template":"Call North.","state":"CT"}', 'North voice', (SELECT v FROM t WHERE k = 'req1')::uuid))->>'version' = '1', 'North version 1');
SELECT pg_temp.expect((apply_description_store_settings('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000a5a1', 0,
  '{"brand_voice":"warm","cta_template":"Call North.","state":"CT"}', 'North voice', (SELECT v FROM t WHERE k = 'req1')::uuid))->>'replayed' = 'true', 'repeated request replays');
SELECT pg_temp.raises($$SELECT apply_description_store_settings('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000a5a1', 0, '{"brand_voice":"bold"}', 'r', gen_random_uuid())$$, 'stale_version', 'stale draft refused');
SELECT apply_description_store_settings('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000a5a2', 0, '{"brand_voice":"precise"}', 'South voice', gen_random_uuid());
SELECT apply_description_store_settings('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000a5a1', 1, '{"brand_voice":"bold"}', 'North again', gen_random_uuid());
SELECT pg_temp.expect((SELECT overrides->>'brand_voice' FROM description_store_settings WHERE store_id = '00000000-0000-0000-0000-00000000a5a2') = 'precise'
  AND (SELECT version FROM description_store_settings WHERE store_id = '00000000-0000-0000-0000-00000000a5a2') = 1, 'changing North never changes South');
SELECT pg_temp.expect((SELECT count(*) FROM description_store_settings_versions WHERE store_id = '00000000-0000-0000-0000-00000000a5a1') = 2, 'North history has both versions');
SELECT pg_temp.expect((SELECT prev_overrides->>'cta_template' FROM description_store_settings_versions WHERE store_id = '00000000-0000-0000-0000-00000000a5a1' AND version = 2) = 'Call North.', 'history keeps the previous overrides');
SET ROLE authenticated;
SELECT pg_temp.raises($$UPDATE description_store_settings SET overrides = '{}'$$, 'permission denied', 'store settings cannot be written directly');
RESET ROLE;
SELECT pg_temp.expect((SELECT count(*) FROM audit_log WHERE action = 'description_store_settings_applied') = 3, 'every applied change is audited');
