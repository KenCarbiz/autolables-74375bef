-- Cases for the proposed pricing authority and delegation
-- (supabase/proposed/20261030000000_pricing_authority_delegation.sql).
-- Expected access is the proposed matrix in ADMIN_V2_SERVER_AUTHORITY.md,
-- section 10. Listing 1 is used, listing 2 is new.

-- ── 1. Price edits without any delegation ────────────────────────────────
DO $$
DECLARE
  p text;
  pricing text[] := ARRAY['owner','admin','general_manager','gsm'];
BEGIN
  FOREACH p IN ARRAY ARRAY['owner','general_manager','gsm','admin','manager','used_car_manager','inventory_manager',
                           'sales_manager','salesperson','service_manager','finance','office','compliance','readonly'] LOOP
    PERFORM t.check('pricing matrix', 'change a used vehicle''s price', p,
      $q$UPDATE public.vehicle_listings SET price = price + 100 WHERE id = 'c0000000-0000-4000-8000-000000000001'$q$,
      CASE WHEN p = ANY (pricing) THEN 'ok rows=1' ELSE 'error 42501' END,
      $q$SELECT price::text FROM public.vehicle_listings WHERE id = 'c0000000-0000-4000-8000-000000000001'$q$,
      CASE WHEN p = ANY (pricing) THEN '20100.00' ELSE '20000.00' END);
    PERFORM t.check('pricing matrix', 'change a new vehicle''s dealer discount', p,
      $q$UPDATE public.vehicle_listings SET dealer_discount = 500 WHERE id = 'c0000000-0000-4000-8000-000000000002'$q$,
      CASE WHEN p = ANY (pricing) THEN 'ok rows=1' ELSE 'error 42501' END);
    PERFORM t.check('pricing matrix', 'non-price edit (description) is unaffected', p,
      $q$UPDATE public.vehicle_listings SET description = 'Updated' WHERE id = 'c0000000-0000-4000-8000-000000000001'$q$, 'ok rows=1');
  END LOOP;
END $$;
SELECT t.check('pricing matrix', 'service jobs (feed, crawl) still write prices', 'service_role',
  $q$UPDATE public.vehicle_listings SET price = 21000 WHERE id = 'c0000000-0000-4000-8000-000000000001'$q$, 'ok rows=1');
SELECT t.check('pricing matrix', 'recall override is unchanged: manager may', 'manager',
  $q$UPDATE public.vehicle_listings SET recall_override_notes = 'Reviewed' WHERE id = 'c0000000-0000-4000-8000-000000000001'$q$, 'ok rows=1');
SELECT t.check('pricing matrix', 'recall override is unchanged: used-car manager may not', 'used_car_manager',
  $q$UPDATE public.vehicle_listings SET recall_override_notes = 'Reviewed' WHERE id = 'c0000000-0000-4000-8000-000000000001'$q$, 'error 42501');
SELECT t.check('pricing matrix', 'the owner''s reviewed fee apply still updates prices', 'owner',
  $q$SELECT public.admin_doc_fee_change_apply('b0000000-0000-4000-8000-000000000001', true, 900, 1, 'review-key-0101')$q$, 'ok',
  $q$SELECT count(*)::text FROM public.vehicle_listings WHERE doc_fee = 900$q$, '3');

-- ── 2. Granting ──────────────────────────────────────────────────────────
SELECT t.check('delegation grant', 'general manager delegates used pricing to the used-car manager for 30 days: one open row, one audit row', 'general_manager',
  $q$SELECT public.admin_grant_pricing_delegation('b0000000-0000-4000-8000-000000000001', t.u('used_car_manager'), 'used', now() + interval '30 days', 'Used desk pricing while the GM travels')$q$, 'ok',
  $q$SELECT concat_ws('|', (SELECT count(*) FROM public.pricing_delegations WHERE revoked_at IS NULL AND scope = 'used'),
       (SELECT count(*) FROM public.audit_log WHERE action = 'pricing_delegation_granted' AND details->>'scope' = 'used' AND details->>'delegate_role' = 'used_car_manager'))$q$, '1|1');
SELECT t.check('delegation grant', 'owner delegates all pricing to the inventory manager', 'owner',
  $q$SELECT public.admin_grant_pricing_delegation('b0000000-0000-4000-8000-000000000001', t.u('inventory_manager'), 'all', now() + interval '14 days', 'Month-end repricing')$q$, 'ok');
DO $$
DECLARE p text;
BEGIN
  FOREACH p IN ARRAY ARRAY['gsm','admin','manager','used_car_manager','inventory_manager','sales_manager','salesperson','other_tenant_owner','pending_manager'] LOOP
    PERFORM t.check('delegation grant', 'grant refused: only the owner or general manager may delegate', p,
      $q$SELECT public.admin_grant_pricing_delegation('b0000000-0000-4000-8000-000000000001', t.u('used_car_manager'), 'used', now() + interval '30 days', 'Attempted grant')$q$, 'error 42501',
      $q$SELECT count(*)::text FROM public.pricing_delegations$q$, '0');
  END LOOP;
END $$;
SELECT t.check('delegation grant', 'anon cannot grant', 'anon',
  $q$SELECT public.admin_grant_pricing_delegation('b0000000-0000-4000-8000-000000000001', t.u('used_car_manager'), 'used', now() + interval '30 days', 'Attempted grant')$q$, 'error 42501');
DO $$
DECLARE p text;
BEGIN
  FOREACH p IN ARRAY ARRAY['salesperson','manager','sales_manager','finance','pending_manager','other_tenant_owner'] LOOP
    PERFORM t.check('delegation grant', 'only an accepted used-car or inventory manager can receive pricing authority (delegate: ' || p || ')', 'general_manager',
      format('SELECT public.admin_grant_pricing_delegation(%L, t.u(%L), %L, now() + interval %L, %L)', 'b0000000-0000-4000-8000-000000000001', p, 'used', '30 days', 'Attempted grant'),
      'error 22023');
  END LOOP;
END $$;
SELECT t.check('delegation grant', 'a grant to oneself is refused', 'general_manager',
  $q$SELECT public.admin_grant_pricing_delegation('b0000000-0000-4000-8000-000000000001', t.u('general_manager'), 'used', now() + interval '30 days', 'Self grant')$q$, 'error 22023');
SELECT t.check('delegation grant', 'a grant longer than 90 days is refused', 'general_manager',
  $q$SELECT public.admin_grant_pricing_delegation('b0000000-0000-4000-8000-000000000001', t.u('used_car_manager'), 'used', now() + interval '91 days', 'Long grant')$q$, 'error 22023');
SELECT t.check('delegation grant', 'a grant without an end date is refused', 'general_manager',
  $q$SELECT public.admin_grant_pricing_delegation('b0000000-0000-4000-8000-000000000001', t.u('used_car_manager'), 'used', NULL, 'Open grant')$q$, 'error 22023');
SELECT t.check('delegation grant', 'a grant without a reason is refused', 'general_manager',
  $q$SELECT public.admin_grant_pricing_delegation('b0000000-0000-4000-8000-000000000001', t.u('used_car_manager'), 'used', now() + interval '30 days', ' ')$q$, 'error 22023');
SELECT t.check('delegation grant', 'an unknown scope is refused', 'general_manager',
  $q$SELECT public.admin_grant_pricing_delegation('b0000000-0000-4000-8000-000000000001', t.u('used_car_manager'), 'everything', now() + interval '30 days', 'Bad scope')$q$, 'error 22023');
SELECT t.check('delegation grant', 'a second grant replaces the first: one open, one revoked, both audited', 'general_manager',
  $q$SELECT public.admin_grant_pricing_delegation('b0000000-0000-4000-8000-000000000001', t.u('used_car_manager'), 'used', now() + interval '30 days', 'First grant');;
     SELECT public.admin_grant_pricing_delegation('b0000000-0000-4000-8000-000000000001', t.u('used_car_manager'), 'all', now() + interval '7 days', 'Second grant')$q$, 'ok',
  $q$SELECT concat_ws('|', (SELECT count(*) FROM public.pricing_delegations WHERE revoked_at IS NULL AND scope = 'all'),
       (SELECT count(*) FROM public.pricing_delegations WHERE revoke_reason = 'replaced by a new delegation'),
       (SELECT count(*) FROM public.audit_log WHERE action = 'pricing_delegation_granted'))$q$, '1|1|2');
SELECT t.check('delegation grant', 'the table cannot be written directly, even by the owner', 'owner',
  $q$INSERT INTO public.pricing_delegations (tenant_id, delegate_user_id, scope, reason, granted_by, expires_at) VALUES ('b0000000-0000-4000-8000-000000000001', t.u('used_car_manager'), 'all', 'Direct', t.u('owner'), now() + interval '1 day')$q$, 'error 42501');

-- ── 3. Using a delegation ────────────────────────────────────────────────
SELECT t.check('delegated pricing', 'used-scope delegate reprices a used vehicle', 'general_manager',
  $q$SELECT public.admin_grant_pricing_delegation('b0000000-0000-4000-8000-000000000001', t.u('used_car_manager'), 'used', now() + interval '30 days', 'Used desk');;
     SELECT t.become('used_car_manager');;
     UPDATE public.vehicle_listings SET price = 19500, advertised_price_before_doc = 19500, website_sale_price = 20395 WHERE id = 'c0000000-0000-4000-8000-000000000001'$q$, 'ok rows=1',
  $q$SELECT price::text FROM public.vehicle_listings WHERE id = 'c0000000-0000-4000-8000-000000000001'$q$, '19500.00');
SELECT t.check('delegated pricing', 'used-scope delegate cannot reprice a new vehicle', 'general_manager',
  $q$SELECT public.admin_grant_pricing_delegation('b0000000-0000-4000-8000-000000000001', t.u('used_car_manager'), 'used', now() + interval '30 days', 'Used desk');;
     SELECT t.become('used_car_manager');;
     UPDATE public.vehicle_listings SET price = 39000 WHERE id = 'c0000000-0000-4000-8000-000000000002'$q$, 'error 42501');
SELECT t.check('delegated pricing', 'used-scope delegate cannot reprice a new vehicle by relabelling it used in the same write', 'general_manager',
  $q$SELECT public.admin_grant_pricing_delegation('b0000000-0000-4000-8000-000000000001', t.u('used_car_manager'), 'used', now() + interval '30 days', 'Used desk');;
     SELECT t.become('used_car_manager');;
     UPDATE public.vehicle_listings SET condition = 'used', price = 39000 WHERE id = 'c0000000-0000-4000-8000-000000000002'$q$, 'error 42501');
SELECT t.check('delegated pricing', 'all-scope delegate reprices a new vehicle', 'owner',
  $q$SELECT public.admin_grant_pricing_delegation('b0000000-0000-4000-8000-000000000001', t.u('inventory_manager'), 'all', now() + interval '14 days', 'Month-end');;
     SELECT t.become('inventory_manager');;
     UPDATE public.vehicle_listings SET price = 39000 WHERE id = 'c0000000-0000-4000-8000-000000000002'$q$, 'ok rows=1');
SELECT t.check('delegated pricing', 'an expired delegation grants nothing', 'used_car_manager',
  $q$RESET ROLE;;
     INSERT INTO public.pricing_delegations (tenant_id, delegate_user_id, scope, reason, granted_by, granted_at, expires_at) VALUES ('b0000000-0000-4000-8000-000000000001', t.u('used_car_manager'), 'all', 'Ended yesterday', t.u('general_manager'), now() - interval '10 days', now() - interval '1 day');;
     SELECT t.become('used_car_manager');;
     UPDATE public.vehicle_listings SET price = 19500 WHERE id = 'c0000000-0000-4000-8000-000000000001'$q$, 'error 42501');
SELECT t.check('delegated pricing', 'a revoked delegation grants nothing', 'general_manager',
  $q$SELECT public.admin_grant_pricing_delegation('b0000000-0000-4000-8000-000000000001', t.u('used_car_manager'), 'used', now() + interval '30 days', 'Used desk');;
     SELECT public.admin_revoke_pricing_delegation((SELECT id FROM public.pricing_delegations WHERE revoked_at IS NULL), 'Back from travel');;
     SELECT t.become('used_car_manager');;
     UPDATE public.vehicle_listings SET price = 19500 WHERE id = 'c0000000-0000-4000-8000-000000000001'$q$, 'error 42501');
SELECT t.check('delegated pricing', 'moving the delegate to another role voids the delegation', 'general_manager',
  $q$SELECT public.admin_grant_pricing_delegation('b0000000-0000-4000-8000-000000000001', t.u('used_car_manager'), 'used', now() + interval '30 days', 'Used desk');;
     RESET ROLE;;
     UPDATE public.tenant_members SET role = 'salesperson' WHERE user_id = t.u('used_car_manager');;
     SELECT t.become('used_car_manager');;
     UPDATE public.vehicle_listings SET price = 19500 WHERE id = 'c0000000-0000-4000-8000-000000000001'$q$, 'error 42501');
SELECT t.check('delegated pricing', 'a delegate cannot change the dealer-wide doc fee', 'general_manager',
  $q$SELECT public.admin_grant_pricing_delegation('b0000000-0000-4000-8000-000000000001', t.u('used_car_manager'), 'all', now() + interval '30 days', 'Used desk');;
     SELECT t.become('used_car_manager');;
     SELECT public.merge_dealer_settings('b0000000-0000-4000-8000-000000000001', '{"doc_fee_amount": 1}')$q$, 'error 42501');
SELECT t.check('delegated pricing', 'a delegate cannot apply a reviewed fee change', 'general_manager',
  $q$SELECT public.admin_grant_pricing_delegation('b0000000-0000-4000-8000-000000000001', t.u('used_car_manager'), 'all', now() + interval '30 days', 'Used desk');;
     SELECT t.become('used_car_manager');;
     SELECT public.admin_doc_fee_change_apply('b0000000-0000-4000-8000-000000000001', true, 900, 1, 'review-key-0102')$q$, 'error 42501');
SELECT t.check('delegated pricing', 'a delegate cannot override a recall', 'general_manager',
  $q$SELECT public.admin_grant_pricing_delegation('b0000000-0000-4000-8000-000000000001', t.u('used_car_manager'), 'all', now() + interval '30 days', 'Used desk');;
     SELECT t.become('used_car_manager');;
     UPDATE public.vehicle_listings SET recall_override_notes = 'Reviewed' WHERE id = 'c0000000-0000-4000-8000-000000000001'$q$, 'error 42501');
SELECT t.check('delegated pricing', 'has_pricing_authority answers for the caller (delegate, used vehicle)', 'general_manager',
  $q$SELECT public.admin_grant_pricing_delegation('b0000000-0000-4000-8000-000000000001', t.u('used_car_manager'), 'used', now() + interval '30 days', 'Used desk');;
     SELECT t.become('used_car_manager');;
     SELECT 1 WHERE public.has_pricing_authority('b0000000-0000-4000-8000-000000000001', 'used') AND NOT public.has_pricing_authority('b0000000-0000-4000-8000-000000000001', 'new')$q$, 'ok rows=1');

-- ── 4. Seeing and revoking ───────────────────────────────────────────────
SELECT t.check('delegation visibility', 'the delegate sees their own delegation', 'general_manager',
  $q$SELECT public.admin_grant_pricing_delegation('b0000000-0000-4000-8000-000000000001', t.u('used_car_manager'), 'used', now() + interval '30 days', 'Used desk');;
     SELECT t.become('used_car_manager');;
     SELECT id FROM public.pricing_delegations$q$, 'ok rows=1');
SELECT t.check('delegation visibility', 'the GSM sees the dealership''s delegations', 'general_manager',
  $q$SELECT public.admin_grant_pricing_delegation('b0000000-0000-4000-8000-000000000001', t.u('used_car_manager'), 'used', now() + interval '30 days', 'Used desk');;
     SELECT t.become('gsm');;
     SELECT id FROM public.pricing_delegations$q$, 'ok rows=1');
SELECT t.check('delegation visibility', 'a salesperson sees none', 'general_manager',
  $q$SELECT public.admin_grant_pricing_delegation('b0000000-0000-4000-8000-000000000001', t.u('used_car_manager'), 'used', now() + interval '30 days', 'Used desk');;
     SELECT t.become('salesperson');;
     SELECT id FROM public.pricing_delegations$q$, 'ok rows=0');
SELECT t.check('delegation visibility', 'another dealership''s owner sees none', 'general_manager',
  $q$SELECT public.admin_grant_pricing_delegation('b0000000-0000-4000-8000-000000000001', t.u('used_car_manager'), 'used', now() + interval '30 days', 'Used desk');;
     SELECT t.become('other_tenant_owner');;
     SELECT id FROM public.pricing_delegations$q$, 'ok rows=0');
SELECT t.check('delegation revoke', 'the owner revokes: row closed, audit row written', 'general_manager',
  $q$SELECT public.admin_grant_pricing_delegation('b0000000-0000-4000-8000-000000000001', t.u('used_car_manager'), 'used', now() + interval '30 days', 'Used desk');;
     SELECT t.become('owner');;
     SELECT public.admin_revoke_pricing_delegation((SELECT id FROM public.pricing_delegations WHERE revoked_at IS NULL), 'No longer needed')$q$, 'ok',
  $q$SELECT concat_ws('|', (SELECT count(*) FROM public.pricing_delegations WHERE revoked_at IS NOT NULL AND revoked_by = t.u('owner')),
       (SELECT count(*) FROM public.audit_log WHERE action = 'pricing_delegation_revoked'))$q$, '1|1');
SELECT t.check('delegation revoke', 'revoking twice reports it was already revoked and audits once', 'general_manager',
  $q$SELECT public.admin_grant_pricing_delegation('b0000000-0000-4000-8000-000000000001', t.u('used_car_manager'), 'used', now() + interval '30 days', 'Used desk');;
     SELECT public.admin_revoke_pricing_delegation((SELECT id FROM public.pricing_delegations LIMIT 1), 'First');;
     SELECT public.admin_revoke_pricing_delegation((SELECT id FROM public.pricing_delegations LIMIT 1), 'Second')$q$, 'ok',
  $q$SELECT count(*)::text FROM public.audit_log WHERE action = 'pricing_delegation_revoked'$q$, '1');
DO $$
DECLARE p text;
BEGIN
  FOREACH p IN ARRAY ARRAY['gsm','admin','used_car_manager','salesperson','other_tenant_owner'] LOOP
    PERFORM t.check('delegation revoke', 'revoke refused: only the owner or general manager may revoke', 'general_manager',
      format($f$SELECT public.admin_grant_pricing_delegation('b0000000-0000-4000-8000-000000000001', t.u('used_car_manager'), 'used', now() + interval '30 days', 'Used desk');;
                SELECT t.become(%L);;
                SELECT public.admin_revoke_pricing_delegation((SELECT id FROM public.pricing_delegations WHERE delegate_user_id = t.u('used_car_manager') AND revoked_at IS NULL), 'Attempt')$f$, p),
      'error 42501');
  END LOOP;
END $$;

-- ── 5. Fee recalculation ────────────────────────────────────────────────
-- This proposal no longer redefines recalc_tenant_doc_fee; the fee basis
-- proposal retires it (scripts/db-verify/30_fee_basis.sql checks that).
