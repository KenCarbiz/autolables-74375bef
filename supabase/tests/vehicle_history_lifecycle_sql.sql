-- Phase 3D A1/A6: delivered custody is terminal. Scratch database only; one
-- transaction, rolled back. Synthetic data only. Requires the spine and
-- 20261109000000_vehicle_history_foundation.sql.

BEGIN;

CREATE TEMP TABLE _lc AS SELECT
  gen_random_uuid() AS mgr, gen_random_uuid() AS staff, gen_random_uuid() AS tenant, gen_random_uuid() AS other_tenant,
  gen_random_uuid() AS conn;
GRANT SELECT ON _lc TO authenticated, anon, service_role;
INSERT INTO auth.users (id, email) SELECT u, 'lc-' || u || '@example.test' FROM _lc, unnest(ARRAY[mgr, staff]) u;
INSERT INTO public.tenants (id, name, slug) SELECT tenant, 'Synthetic Lifecycle Dealer', 'lc-' || tenant FROM _lc;
INSERT INTO public.tenants (id, name, slug) SELECT other_tenant, 'Synthetic Other Dealer', 'lc-o-' || other_tenant FROM _lc;
INSERT INTO public.tenant_members (tenant_id, user_id, role, accepted_at)
  SELECT tenant, mgr, 'owner', now() FROM _lc UNION ALL SELECT tenant, staff, 'sales', now() FROM _lc;
INSERT INTO public.vehicles (vin) VALUES ('1FTFW1E53MFA00001'), ('2HGFC2F59MH000002'), ('3VW2B7AJ6JM000003');
INSERT INTO public.integration_connections (id, tenant_id, app, display_name, status, adapter, external_rooftop_ref)
  SELECT conn, tenant, 'autocurb', 'Synthetic curb', 'active', 'rooftop.v1', 'ac-lc' FROM _lc;

CREATE FUNCTION pg_temp.as_manager() RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', (SELECT json_build_object('sub', mgr, 'role', 'authenticated')::text FROM _lc), true);
$$;
CREATE FUNCTION pg_temp.as_service() RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
$$;
CREATE FUNCTION pg_temp.expect(p_sql text, p_err text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE p_sql;
  RAISE EXCEPTION 'FAIL: expected % from: %', p_err, p_sql;
EXCEPTION WHEN raise_exception OR unique_violation OR check_violation THEN
  IF SQLERRM NOT LIKE p_err || '%' THEN RAISE EXCEPTION 'FAIL: expected %, got % from: %', p_err, SQLERRM, p_sql; END IF;
END $$;

SET LOCAL ROLE service_role;
SELECT pg_temp.as_service();

-- Fixture: episode E1 sold and delivered, seen by the staff UI and a DMS feed.
CREATE TEMP TABLE _e AS SELECT NULL::uuid AS e1, NULL::uuid AS sold1, NULL::uuid AS deliv1, NULL::uuid AS e2;
DO $$
DECLARE t uuid := (SELECT tenant FROM _lc); e uuid; s uuid; d uuid;
BEGIN
  INSERT INTO public.vehicle_instances (tenant_id, vin) VALUES (t, '1FTFW1E53MFA00001') RETURNING id INTO e;
  s := (public.vehicle_history_record_milestone(e, 'sold', now() - interval '10 days', NULL, 'dms', 'deal-77', NULL,
        NULL, NULL, 'dms:deal-77:r1', 1)->>'milestone_id')::uuid;
  d := (public.vehicle_history_record_milestone(e, 'delivered', now() - interval '9 days', NULL, 'dms', 'deal-77', NULL,
        NULL, NULL, 'dms:deal-77:r2', 2)->>'milestone_id')::uuid;
  UPDATE _e SET e1 = e, sold1 = s, deliv1 = d;
END $$;

-- N1. Delivered episode followed by a delayed sale void: refused, whoever sends it.
DO $$
DECLARE e uuid := (SELECT e1 FROM _e); s uuid := (SELECT sold1 FROM _e); n int;
BEGIN
  SELECT count(*) INTO n FROM public.vehicle_custody_milestones WHERE instance_id = e;
  PERFORM pg_temp.expect(format($q$SELECT public.vehicle_history_record_milestone(%L, 'sale_voided', now(), NULL, 'dms', 'deal-77',
    'late void replayed', %L, NULL, 'dms:deal-77:r3', 3)$q$, e, s), 'delivered_is_terminal');
  PERFORM pg_temp.as_manager();
  PERFORM pg_temp.expect(format($q$SELECT public.vehicle_history_record_milestone(%L, 'sale_voided', now(), NULL, 'staff', 'deal-77',
    'manager tries a void', %L)$q$, e, s), 'delivered_is_terminal');
  PERFORM pg_temp.as_service();
  IF (SELECT custody_state || '/' || status FROM public.vehicle_instances WHERE id = e) <> 'delivered/disposed'
     OR (SELECT count(*) FROM public.vehicle_custody_milestones WHERE instance_id = e) <> n THEN
    RAISE EXCEPTION 'FAIL: late void changed the delivered episode';
  END IF;
  IF public.vehicle_history_next_state('delivered', 'sale_voided') IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL: transition table still maps delivered + sale_voided';
  END IF;
  RAISE NOTICE 'PASS: N1 delayed sale void after delivery is refused and nothing changes';
END $$;

-- N1b. No other path reopens it: direct UPDATE (even by service_role), restore via review.
DO $$
DECLARE e uuid := (SELECT e1 FROM _e); rv uuid;
BEGIN
  PERFORM pg_temp.expect(format($q$UPDATE public.vehicle_instances SET custody_state = 'in_stock', status = 'active' WHERE id = %L$q$, e),
    'terminal_custody');
  PERFORM pg_temp.expect(format($q$UPDATE public.vehicle_instances SET disposition = NULL WHERE id = %L$q$, e), 'custody_write_requires_rpc');
  PERFORM pg_temp.expect(format($q$UPDATE public.vehicle_instances SET vin = '2HGFC2F59MH000002' WHERE id = %L$q$, e), 'episode_identity_immutable');
  PERFORM pg_temp.expect(format($q$INSERT INTO public.vehicle_custody_milestones (tenant_id, instance_id, vin, milestone, from_state, to_state,
    occurred_at, source, corrects_id, reason) SELECT tenant_id, id, vin, 'sale_voided', 'delivered', 'in_stock', now(), 'staff', %L, 'direct late void'
    FROM public.vehicle_instances WHERE id = %L$q$, (SELECT sold1 FROM _e), e), 'new row for relation "vehicle_custody_milestones" violates check constraint');
  PERFORM pg_temp.as_manager();
  rv := public.vehicle_history_flag_reappearance((SELECT tenant FROM _lc), NULL, '1FTFW1E53MFA00001', NULL, 'feed_snapshot', 'snap-lc');
  PERFORM pg_temp.expect(format($q$SELECT public.vehicle_history_resolve_reappearance(%L, 'restore_episode', 'try to reuse old episode')$q$, rv),
    'restore_requires_archived_episode');
  DELETE FROM public.vehicle_reappearance_reviews WHERE id = rv;
  PERFORM pg_temp.as_service();
  RAISE NOTICE 'PASS: N1b direct updates and the review path cannot reopen a delivered episode';
END $$;

-- N2. Duplicate source event and duplicate correction.
DO $$
DECLARE e uuid := (SELECT e1 FROM _e); d uuid := (SELECT deliv1 FROM _e); r jsonb; c uuid; n int;
BEGIN
  r := public.vehicle_history_record_milestone(e, 'delivered', now() - interval '9 days', NULL, 'dms', 'deal-77', NULL,
        NULL, NULL, 'dms:deal-77:r2', 2);
  IF NOT COALESCE((r->>'duplicate')::boolean, false) OR (r->>'milestone_id')::uuid <> d THEN
    RAISE EXCEPTION 'FAIL: replayed delivery not idempotent: %', r;
  END IF;
  PERFORM pg_temp.expect(format($q$SELECT public.vehicle_history_record_milestone(%L, 'delivery_corrected', now(), NULL, 'dms', 'deal-77',
    'different body, same key', %L, NULL, 'dms:deal-77:r2', 2)$q$, e, d), 'idempotency_key_conflict');

  PERFORM pg_temp.as_manager();
  c := (public.vehicle_history_record_milestone(e, 'delivery_corrected', now() - interval '8 days', NULL, 'staff', 'deal-77',
        'delivery date keyed wrong', d, NULL, 'staff:corr-1')->>'milestone_id')::uuid;
  r := public.vehicle_history_record_milestone(e, 'delivery_corrected', now() - interval '8 days', NULL, 'staff', 'deal-77',
        'delivery date keyed wrong', d, NULL, 'staff:corr-1');
  IF NOT COALESCE((r->>'duplicate')::boolean, false) THEN RAISE EXCEPTION 'FAIL: duplicate correction appended'; END IF;
  PERFORM pg_temp.expect(format($q$SELECT public.vehicle_history_record_milestone(%L, 'delivery_corrected', now(), NULL, 'staff', 'deal-77',
    'second correction of the same row', %L)$q$, e, d), 'already_corrected');
  PERFORM pg_temp.as_service();
  SELECT count(*) INTO n FROM public.vehicle_custody_milestones WHERE corrects_id = d;
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL: % corrections of one milestone', n; END IF;
  RAISE NOTICE 'PASS: N2 duplicate source event and duplicate correction are idempotent; a row is corrected once';
END $$;

-- N3. Missing correction reference, missing reason, missing actor.
DO $$
DECLARE e uuid := (SELECT e1 FROM _e); d uuid;
BEGIN
  SELECT id INTO d FROM public.vehicle_custody_milestones WHERE instance_id = e AND milestone = 'delivery_corrected';
  PERFORM pg_temp.as_manager();
  PERFORM pg_temp.expect(format($q$SELECT public.vehicle_history_record_milestone(%L, 'delivery_corrected', now(), NULL, 'staff', 'x',
    'no reference given')$q$, e), 'correction_reference_required');
  PERFORM pg_temp.expect(format($q$SELECT public.vehicle_history_record_milestone(%L, 'delivery_corrected', now(), NULL, 'staff', 'x',
    NULL, %L)$q$, e, d), 'reason_required');
  PERFORM pg_temp.as_service();
  PERFORM pg_temp.expect(format($q$SELECT public.vehicle_history_record_milestone(%L, 'delivery_corrected', now(), NULL, 'integration', 'x',
    'service with no cause', %L)$q$, e, d), 'correction_actor_required');
  PERFORM pg_temp.expect(format($q$INSERT INTO public.vehicle_custody_milestones (tenant_id, instance_id, vin, milestone, from_state, to_state,
    occurred_at, source) SELECT tenant_id, id, vin, 'sale_voided', 'sold', 'in_stock', now(), 'staff' FROM public.vehicle_instances WHERE id = %L$q$, e),
    'new row for relation "vehicle_custody_milestones" violates check constraint');
  RAISE NOTICE 'PASS: N3 corrections need a reference, a reason and an accountable actor (also enforced by a table constraint)';
END $$;

-- N4. Stale source events cannot move custody.
DO $$
DECLARE t uuid := (SELECT tenant FROM _lc); e uuid;
BEGIN
  INSERT INTO public.vehicle_instances (tenant_id, vin) VALUES (t, '2HGFC2F59MH000002') RETURNING id INTO e;
  PERFORM public.vehicle_history_record_milestone(e, 'sold', now() - interval '2 days', NULL, 'dms', 'deal-88', NULL, NULL, NULL, NULL, 5);
  PERFORM pg_temp.expect(format($q$SELECT public.vehicle_history_record_milestone(%L, 'awaiting_delivery', now(), NULL, 'dms', 'deal-88',
    NULL, NULL, NULL, NULL, 4)$q$, e), 'stale_source_revision');
  PERFORM pg_temp.expect(format($q$SELECT public.vehicle_history_record_milestone(%L, 'awaiting_delivery', now() - interval '3 days', NULL, 'dms',
    'deal-88', NULL, NULL, NULL, NULL, 6)$q$, e), 'stale_occurred_at');
  IF (SELECT custody_state FROM public.vehicle_instances WHERE id = e) <> 'sold' THEN RAISE EXCEPTION 'FAIL: stale event moved custody'; END IF;
  UPDATE _e SET e2 = e;
  RAISE NOTICE 'PASS: N4 lower source revision or older automated occurrence is refused';
END $$;

-- N4b. Legitimate pre-delivery cancellation is its own transition and must cite the current sale.
DO $$
DECLARE e uuid := (SELECT e2 FROM _e); s uuid; d uuid := (SELECT deliv1 FROM _e);
BEGIN
  SELECT id INTO s FROM public.vehicle_custody_milestones WHERE instance_id = e AND milestone = 'sold';
  PERFORM pg_temp.as_manager();
  PERFORM pg_temp.expect(format($q$SELECT public.vehicle_history_record_milestone(%L, 'sale_voided', now(), NULL, 'staff', 'deal-88',
    'cites another episode', %L)$q$, e, d), 'corrects_unknown_milestone');
  PERFORM public.vehicle_history_record_milestone(e, 'sale_voided', now(), NULL, 'staff', 'deal-88', 'buyer financing declined', s);
  PERFORM pg_temp.as_service();
  IF (SELECT custody_state || '/' || status FROM public.vehicle_instances WHERE id = e) <> 'in_stock/active' THEN
    RAISE EXCEPTION 'FAIL: pre-delivery cancellation did not return to stock';
  END IF;
  RAISE NOTICE 'PASS: N4b pre-delivery cancellation returns the same episode to stock and cites its own sale';
END $$;

-- N6. Same VIN, different vehicle instance: a correction cannot cite another episode's row.
DO $$
DECLARE t uuid := (SELECT tenant FROM _lc); e uuid := (SELECT e2 FROM _e); s2 uuid; ot uuid := (SELECT other_tenant FROM _lc); oe uuid;
BEGIN
  INSERT INTO public.vehicle_instances (tenant_id, vin) VALUES (ot, '2HGFC2F59MH000002') RETURNING id INTO oe;
  s2 := (public.vehicle_history_record_milestone(oe, 'sold', now() - interval '1 hour', NULL, 'staff', NULL, NULL)->>'milestone_id')::uuid;
  PERFORM public.vehicle_history_record_milestone(e, 'sold', now() - interval '30 minutes', NULL, 'staff', NULL, NULL);
  PERFORM pg_temp.as_manager();
  PERFORM pg_temp.expect(format($q$SELECT public.vehicle_history_record_milestone(%L, 'sale_voided', now(), NULL, 'staff', NULL,
    'cites same VIN other tenant', %L)$q$, e, s2), 'corrects_unknown_milestone');
  PERFORM pg_temp.as_service();
  RAISE NOTICE 'PASS: N6 a same-VIN episode of another tenant cannot be cited or affected';
END $$;

-- N8. New custody episode after delivery: unwind is recorded on the old episode, which
-- stays delivered; the returning car gets a reviewed, linked new episode.
DO $$
DECLARE t uuid := (SELECT tenant FROM _lc); e uuid := (SELECT e1 FROM _e); c uuid; rv uuid; r jsonb; ne public.vehicle_instances;
BEGIN
  SELECT id INTO c FROM public.vehicle_custody_milestones WHERE instance_id = e AND milestone = 'delivery_corrected';
  PERFORM pg_temp.expect(format($q$SELECT public.vehicle_history_record_milestone(%L, 'post_delivery_unwind', now(), NULL, 'integration', 'x',
    'automated unwind', %L, gen_random_uuid())$q$, e, c), 'post_delivery_unwind_requires_manager');
  PERFORM pg_temp.as_manager();
  r := public.vehicle_history_record_milestone(e, 'post_delivery_unwind', now(), NULL, 'staff', 'deal-77', 'customer returned under state law', c);
  IF (SELECT custody_state || '/' || status || '/' || disposition FROM public.vehicle_instances WHERE id = e) <> 'delivered/disposed/return' THEN
    RAISE EXCEPTION 'FAIL: unwind reopened or relabelled the episode wrongly';
  END IF;
  SELECT id INTO rv FROM public.vehicle_reappearance_reviews WHERE tenant_id = t AND vin = '1FTFW1E53MFA00001' AND status = 'open';
  IF rv IS NULL THEN RAISE EXCEPTION 'FAIL: unwind did not open a review'; END IF;
  r := public.vehicle_history_resolve_reappearance(rv, 'new_episode', 'returned vehicle back in stock');
  SELECT * INTO ne FROM public.vehicle_instances WHERE id = (r->>'instance_id')::uuid;
  IF ne.id = e OR ne.previous_instance_id <> e OR ne.custody_state <> 'in_stock' THEN
    RAISE EXCEPTION 'FAIL: returned car did not get a linked new episode';
  END IF;
  PERFORM pg_temp.as_service();
  PERFORM pg_temp.expect(format($q$INSERT INTO public.vehicle_instances (tenant_id, vin, previous_instance_id)
    VALUES (%L, '3VW2B7AJ6JM000003', %L)$q$, t, e), 'invalid_predecessor_episode');
  IF (SELECT count(*) FROM public.vehicle_custody_milestones WHERE instance_id = e AND milestone IN ('sold','delivered')) <> 2 THEN
    RAISE EXCEPTION 'FAIL: original sale and delivery rows lost';
  END IF;
  RAISE NOTICE 'PASS: N8 post-delivery unwind keeps the old episode terminal and opens a reviewed new episode';
END $$;

-- N12. Rollback removes both the authoritative fact and its outbox row.
DO $$
DECLARE t uuid := (SELECT tenant FROM _lc); e uuid := (SELECT e2 FROM _e); n_ms int; n_ob int;
BEGIN
  PERFORM public.vehicle_history_set_setting('platform', NULL, 'integration.outbound_capture_enabled', 'true',
    (SELECT COALESCE(max(version), 0) FROM public.vehicle_history_settings WHERE scope_type = 'platform' AND key = 'integration.outbound_capture_enabled'),
    'synthetic capture on');
  SELECT count(*) INTO n_ms FROM public.vehicle_custody_milestones WHERE instance_id = e;
  SELECT count(*) INTO n_ob FROM public.integration_outbox WHERE tenant_id = t;
  BEGIN
    PERFORM public.vehicle_history_record_milestone(e, 'delivered', now(), NULL, 'staff', NULL, NULL);
    IF (SELECT count(*) FROM public.integration_outbox WHERE tenant_id = t) <> n_ob + 1 THEN RAISE EXCEPTION 'FAIL: delivered not enqueued'; END IF;
    RAISE EXCEPTION 'synthetic_abort';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'synthetic_abort' THEN RAISE; END IF;
  END;
  IF (SELECT count(*) FROM public.vehicle_custody_milestones WHERE instance_id = e) <> n_ms
     OR (SELECT count(*) FROM public.integration_outbox WHERE tenant_id = t) <> n_ob
     OR (SELECT custody_state FROM public.vehicle_instances WHERE id = e) <> 'sold' THEN
    RAISE EXCEPTION 'FAIL: rollback left a fact or an outbox row behind';
  END IF;
  RAISE NOTICE 'PASS: N12 rolling back removes the milestone, the custody change and the outbox row together';
END $$;

ROLLBACK;
