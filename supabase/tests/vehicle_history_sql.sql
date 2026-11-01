-- Permanent vehicle history: lifecycle, service-after-sale, reacquisition, access,
-- settings and spine behaviour. Scratch database only; one transaction, rolled back.
-- Synthetic data only. Requires the spine and 20261109000000_vehicle_history_foundation.sql.

BEGIN;

CREATE TEMP TABLE _ids AS SELECT
  gen_random_uuid() AS mgr_a, gen_random_uuid() AS mgr_a2, gen_random_uuid() AS staff_a, gen_random_uuid() AS mgr_b,
  gen_random_uuid() AS cust_1, gen_random_uuid() AS cust_2, gen_random_uuid() AS plat,
  gen_random_uuid() AS tenant_a, gen_random_uuid() AS tenant_b,
  gen_random_uuid() AS conn_a, gen_random_uuid() AS conn_b;
GRANT SELECT ON _ids TO authenticated, anon, service_role;

INSERT INTO auth.users (id, email) SELECT u, 'vh-' || u || '@example.test'
  FROM _ids, unnest(ARRAY[mgr_a, mgr_a2, staff_a, mgr_b, cust_1, cust_2, plat]) u;
INSERT INTO public.tenants (id, name, slug) SELECT tenant_a, 'Synthetic Dealer A', 'vh-a-' || tenant_a FROM _ids;
INSERT INTO public.tenants (id, name, slug) SELECT tenant_b, 'Synthetic Dealer B', 'vh-b-' || tenant_b FROM _ids;
INSERT INTO public.tenant_members (tenant_id, user_id, role, accepted_at)
  SELECT tenant_a, mgr_a, 'owner', now() FROM _ids UNION ALL
  SELECT tenant_a, mgr_a2, 'admin', now() FROM _ids UNION ALL
  SELECT tenant_a, staff_a, 'sales', now() FROM _ids UNION ALL
  SELECT tenant_b, mgr_b, 'owner', now() FROM _ids;
INSERT INTO public.user_roles (user_id, role) SELECT plat, 'admin' FROM _ids;

-- Synthetic VINs with valid check digits.
INSERT INTO public.vehicles (vin) VALUES ('1HGCM82633A004352'), ('1M8GDM9AXKP042788'), ('JH4KA7561PC008269');
INSERT INTO public.integration_connections (id, tenant_id, app, display_name, status, adapter, external_rooftop_ref)
  SELECT conn_a, tenant_a, 'autofilm', 'A film', 'active', 'autofilm.v1', 'af-vh-a' FROM _ids;
INSERT INTO public.integration_connections (id, tenant_id, app, display_name, status, adapter, external_rooftop_ref)
  SELECT conn_b, tenant_b, 'autofilm', 'B film', 'active', 'autofilm.v1', 'af-vh-b' FROM _ids;
INSERT INTO public.integration_direction_flags (tenant_id, direction, enabled)
  SELECT tenant_a, 'film_to_labels', true FROM _ids UNION ALL SELECT tenant_b, 'film_to_labels', true FROM _ids;

CREATE FUNCTION public._vh_enqueue(p_conn uuid, p_tenant uuid, p_type text, p_record text, p_version bigint,
  p_vin text, p_visit text, p_payload jsonb DEFAULT '{}'::jsonb) RETURNS uuid
LANGUAGE sql AS $$
  INSERT INTO public.integration_inbox (connection_id, tenant_id, producer, event_id, event_type, schema_version,
      idempotency_key, payload_checksum, source_record_id, source_version, vin, visibility, envelope)
  VALUES (p_conn, p_tenant, 'autofilm', gen_random_uuid(), p_type, '1.1.0',
      'idem-' || gen_random_uuid(), 'x', p_record, p_version, p_vin, 'tenant_private',
      jsonb_build_object('occurred_at', to_char((now() - interval '10 days') AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), 'payload', p_payload,
        'service_visit_ref', CASE WHEN p_visit IS NULL THEN NULL ELSE jsonb_build_object('app', 'autofilm', 'id', p_visit) END))
  RETURNING id;
$$;
GRANT EXECUTE ON FUNCTION public._vh_enqueue(uuid, uuid, text, text, bigint, text, text, jsonb) TO service_role;

SET LOCAL ROLE service_role;

-- Platform turns on service attachment for the test; tenant A agrees, tenant B says nothing.
DO $$
BEGIN
  PERFORM public.vehicle_history_set_setting('platform', NULL, 'service.attach_enabled', 'true', 0, 'synthetic test enable');
  PERFORM public.vehicle_history_set_setting('tenant', (SELECT tenant_a FROM _ids), 'service.attach_enabled', 'true', 0, 'synthetic test enable');
  RAISE NOTICE 'PASS: settings written through the versioned RPC';
END $$;

-- S1. Sell -> awaiting delivery -> deliver; listing archive is separate. Later MPI attaches
-- to the same vehicle and a new service visit, opens no inventory and no listing.
DO $$
DECLARE t uuid; inst uuid; r jsonb; n_inst int; ev public.inspection_evidence; sv public.service_visits; i uuid;
BEGIN
  SELECT tenant_a INTO t FROM _ids;
  INSERT INTO public.vehicle_instances (tenant_id, vin, opened_reason) VALUES (t, '1HGCM82633A004352', 'initial') RETURNING id INTO inst;
  r := public.vehicle_history_record_milestone(inst, 'sold', now() - interval '20 days', 'America/New_York', 'staff', 'deal-1', NULL);
  IF r->>'custody_state' <> 'sold' THEN RAISE EXCEPTION 'FAIL: sold state %', r; END IF;
  r := public.vehicle_history_record_milestone(inst, 'awaiting_delivery', now() - interval '19 days', NULL, 'staff', 'deal-1', NULL);
  IF r->>'custody_state' <> 'awaiting_delivery' THEN RAISE EXCEPTION 'FAIL: awaiting state %', r; END IF;
  r := public.vehicle_history_record_milestone(inst, 'delivered', now() - interval '18 days', NULL, 'staff', 'deal-1', NULL);
  IF (SELECT status FROM public.vehicle_instances WHERE id = inst) <> 'disposed' THEN RAISE EXCEPTION 'FAIL: delivered not disposed'; END IF;
  RAISE NOTICE 'PASS: sold, awaiting delivery and delivered are distinct recorded states';

  SELECT count(*) INTO n_inst FROM public.vehicle_instances WHERE tenant_id = t AND vin = '1HGCM82633A004352';
  i := public._vh_enqueue((SELECT conn_a FROM _ids), t, 'autofilm.inspection.completed', 'insp:mpi-1', 1,
    '1HGCM82633A004352', 'ro-9001', '{"ro_number":"9001","odometer_miles":21000,"odometer_unit":"mi"}');
  r := public.integration_apply_event(i, jsonb_build_object('verdict', 'apply', 'outcome', 'applied', 'effect', jsonb_build_object(
    'kind', 'inspection_evidence_upsert', 'inspected_at', now() - interval '10 days', 'odometer_miles', 21000,
    'measurements', '{"front_pads_mm":7}'::jsonb)));
  IF r->>'status' <> 'applied' THEN RAISE EXCEPTION 'FAIL: MPI after sale not applied: %', r; END IF;
  SELECT * INTO ev FROM public.inspection_evidence WHERE tenant_id = t AND source_record_id = 'insp:mpi-1';
  SELECT * INTO sv FROM public.service_visits WHERE id = ev.service_visit_id;
  IF ev.vin <> '1HGCM82633A004352' OR ev.instance_id IS NOT NULL OR sv.id IS NULL OR sv.instance_id IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL: MPI not attached to vehicle + visit only (vin %, instance %, visit %)', ev.vin, ev.instance_id, sv.id;
  END IF;
  IF sv.odometer_unit <> 'mi' OR sv.odometer_value <> 21000 OR sv.intake_verification <> 'connection_attested' THEN
    RAISE EXCEPTION 'FAIL: visit units/verification wrong';
  END IF;
  IF (SELECT count(*) FROM public.vehicle_instances WHERE tenant_id = t AND vin = '1HGCM82633A004352') <> n_inst THEN
    RAISE EXCEPTION 'FAIL: service intake opened inventory';
  END IF;
  RAISE NOTICE 'PASS: MPI after delivery attaches to the vehicle and a new service visit; no episode or listing opened';

  -- Same delivery applied twice: one effect.
  r := public.integration_apply_event(i, '{"verdict":"apply","outcome":"applied","effect":{"kind":"inspection_evidence_upsert","odometer_miles":1}}');
  IF r->>'status' <> 'noop' OR (SELECT odometer_miles FROM public.inspection_evidence WHERE id = ev.id) <> 21000 THEN
    RAISE EXCEPTION 'FAIL: duplicate apply changed state: %', r;
  END IF;
  RAISE NOTICE 'PASS: re-applying a delivered event is a no-op';
END $$;

-- S2. Service attachment switched off at the tenant: held, kept, not discarded.
DO $$
DECLARE t uuid; i uuid; r jsonb;
BEGIN
  SELECT tenant_b INTO t FROM _ids;
  PERFORM public.vehicle_history_set_setting('tenant', t, 'service.attach_enabled', 'false', 0, 'synthetic: B not enabled');
  i := public._vh_enqueue((SELECT conn_b FROM _ids), t, 'autofilm.inspection.completed', 'insp:b-1', 1, '1HGCM82633A004352', 'ro-b-1');
  r := public.integration_apply_event(i, '{"verdict":"apply","outcome":"applied","effect":{"kind":"inspection_evidence_upsert"}}');
  IF r->>'status' <> 'held' OR (SELECT status FROM public.integration_inbox WHERE id = i) <> 'held' THEN
    RAISE EXCEPTION 'FAIL: disabled attach did not hold: %', r;
  END IF;
  IF EXISTS (SELECT 1 FROM public.service_visits WHERE tenant_id = t) THEN RAISE EXCEPTION 'FAIL: disabled attach wrote a visit'; END IF;
  RAISE NOTICE 'PASS: service attach disabled holds a no-stock event without writing or dropping it';

  -- Same switch off, car in B stock: unchanged spine 1.0 behaviour (attach to the episode).
  INSERT INTO public.vehicle_instances (tenant_id, vin) VALUES (t, '1HGCM82633A004352');
  i := public._vh_enqueue((SELECT conn_b FROM _ids), t, 'autofilm.inspection.completed', 'insp:b-2', 1, '1HGCM82633A004352', 'ro-b-2');
  r := public.integration_apply_event(i, '{"verdict":"apply","outcome":"applied","effect":{"kind":"inspection_evidence_upsert"}}');
  IF r->>'status' <> 'applied' OR (SELECT service_visit_id FROM public.inspection_evidence WHERE source_record_id = 'insp:b-2') IS NOT NULL
     OR (SELECT instance_id FROM public.inspection_evidence WHERE source_record_id = 'insp:b-2') IS NULL THEN
    RAISE EXCEPTION 'FAIL: switch-off in-stock path changed: %', r;
  END IF;
  RAISE NOTICE 'PASS: with the switch off, an in-stock car keeps the existing episode attachment';
END $$;

-- S3. Service-only vehicle: unknown at this dealer -> quarantined until the policy allows it.
DO $$
DECLARE t uuid; i uuid; r jsonb;
BEGIN
  SELECT tenant_a INTO t FROM _ids;
  i := public._vh_enqueue((SELECT conn_a FROM _ids), t, 'autofilm.inspection.completed', 'insp:svc-only', 1, 'JH4KA7561PC008269', 'ro-7');
  r := public.integration_apply_event(i, '{"verdict":"apply","outcome":"applied","effect":{"kind":"inspection_evidence_upsert"}}');
  IF r->>'outcome' <> 'service_only_disabled' THEN RAISE EXCEPTION 'FAIL: service-only not refused by default: %', r; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.vehicle_identity_quarantine WHERE inbox_id = i AND reason = 'service_only_disabled' AND status = 'open') THEN
    RAISE EXCEPTION 'FAIL: no quarantine row';
  END IF;
  RAISE NOTICE 'PASS: service-only vehicle is quarantined while the policy is off';

  PERFORM public.vehicle_history_set_setting('platform', NULL, 'service.allow_service_only_vehicle', 'true', 0, 'synthetic enable');
  IF public.integration_replay_inbox(t, ARRAY[i], 'synthetic replay after enable') <> 1 THEN RAISE EXCEPTION 'FAIL: replay count'; END IF;
  r := public.integration_apply_event(i, '{"verdict":"apply","outcome":"applied","effect":{"kind":"inspection_evidence_upsert"}}');
  IF r->>'outcome' <> 'service_only_unverified' THEN RAISE EXCEPTION 'FAIL: service-only accepted without a repair order: %', r; END IF;
  IF EXISTS (SELECT 1 FROM public.service_visits WHERE tenant_id = t AND vin = 'JH4KA7561PC008269') THEN
    RAISE EXCEPTION 'FAIL: unverified service-only intake wrote a visit';
  END IF;
  IF (SELECT status FROM public.vehicle_identity_quarantine WHERE inbox_id = i AND reason = 'service_only_disabled') <> 'resolved' THEN
    RAISE EXCEPTION 'FAIL: quarantine not resolved by replay';
  END IF;
  RAISE NOTICE 'PASS: with the policy on, service-only intake without a repair order number is quarantined, not recorded';

  i := public._vh_enqueue((SELECT conn_a FROM _ids), t, 'autofilm.inspection.completed', 'insp:svc-only', 2, 'JH4KA7561PC008269', 'ro-7',
    '{"ro_number":"7"}');
  r := public.integration_apply_event(i, '{"verdict":"apply","outcome":"applied","effect":{"kind":"inspection_evidence_upsert"}}');
  IF r->>'status' <> 'applied' THEN RAISE EXCEPTION 'FAIL: service-only not applied after enable: %', r; END IF;
  IF EXISTS (SELECT 1 FROM public.vehicle_instances WHERE tenant_id = t AND vin = 'JH4KA7561PC008269') THEN
    RAISE EXCEPTION 'FAIL: service-only intake created inventory';
  END IF;
  RAISE NOTICE 'PASS: service-only vehicle gets a service record without sale inventory once allowed';
END $$;

-- S4. Visit already on file for another VIN: quarantined, nothing guessed.
DO $$
DECLARE t uuid; i uuid; r jsonb;
BEGIN
  SELECT tenant_a INTO t FROM _ids;
  i := public._vh_enqueue((SELECT conn_a FROM _ids), t, 'autofilm.inspection.completed', 'insp:wrong-vin', 1, '1M8GDM9AXKP042788', 'ro-9001');
  r := public.integration_apply_event(i, '{"verdict":"apply","outcome":"applied","effect":{"kind":"inspection_evidence_upsert"}}');
  IF r->>'outcome' <> 'service_visit_vin_conflict' THEN RAISE EXCEPTION 'FAIL: VIN/RO conflict not quarantined: %', r; END IF;
  IF EXISTS (SELECT 1 FROM public.inspection_evidence WHERE source_record_id = 'insp:wrong-vin') THEN RAISE EXCEPTION 'FAIL: conflicting evidence attached'; END IF;
  RAISE NOTICE 'PASS: RO mapped to another VIN is quarantined, not attached';

  -- No visit ref and no active episode: unmatched, quarantined.
  i := public._vh_enqueue((SELECT conn_a FROM _ids), t, 'autofilm.inspection.completed', 'insp:no-anchor', 1, '1M8GDM9AXKP042788', NULL);
  r := public.integration_apply_event(i, '{"verdict":"apply","outcome":"applied","effect":{"kind":"inspection_evidence_upsert"}}');
  IF r->>'outcome' <> 'no_active_instance' THEN RAISE EXCEPTION 'FAIL: unanchored event: %', r; END IF;
  RAISE NOTICE 'PASS: event with neither a visit nor an active episode is quarantined';
END $$;

-- S5. Reacquisition after delivery: review queue, restore refused, new episode linked, old deal untouched.
DO $$
DECLARE t uuid; prior uuid; rv uuid; r jsonb; n_ms int; newi public.vehicle_instances;
BEGIN
  SELECT tenant_a INTO t FROM _ids;
  SELECT id INTO prior FROM public.vehicle_instances WHERE tenant_id = t AND vin = '1HGCM82633A004352';
  SELECT count(*) INTO n_ms FROM public.vehicle_custody_milestones WHERE instance_id = prior;
  rv := public.vehicle_history_flag_reappearance(t, NULL, '1hgcm82633a004352', NULL, 'feed_snapshot', 'snap-1');
  IF rv IS NULL THEN RAISE EXCEPTION 'FAIL: reappearance not flagged'; END IF;
  IF public.vehicle_history_flag_reappearance(t, NULL, '1HGCM82633A004352', NULL, 'feed_snapshot', 'snap-2') IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL: second open review created';
  END IF;
  IF (SELECT custody_state FROM public.vehicle_instances WHERE id = prior) <> 'delivered' THEN RAISE EXCEPTION 'FAIL: flag changed custody'; END IF;
  RAISE NOTICE 'PASS: reappearing VIN opens one review and changes nothing by itself';

  BEGIN
    PERFORM public.vehicle_history_resolve_reappearance(rv, 'restore_episode', 'synthetic restore attempt');
    RAISE EXCEPTION 'FAIL: delivered episode was restored';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'restore_requires_archived_episode%' THEN RAISE; END IF;
  END;
  r := public.vehicle_history_resolve_reappearance(rv, 'new_episode', 'synthetic: traded back in');
  SELECT * INTO newi FROM public.vehicle_instances WHERE id = (r->>'instance_id')::uuid;
  IF newi.previous_instance_id <> prior OR newi.opened_reason <> 'reacquisition' OR newi.status <> 'active' THEN
    RAISE EXCEPTION 'FAIL: new episode not linked: %', row_to_json(newi);
  END IF;
  IF (SELECT count(*) FROM public.vehicle_custody_milestones WHERE instance_id = prior) <> n_ms
     OR (SELECT custody_state FROM public.vehicle_instances WHERE id = prior) <> 'delivered' THEN
    RAISE EXCEPTION 'FAIL: prior episode changed';
  END IF;
  IF (SELECT count(*) FROM public.inspection_evidence WHERE source_record_id = 'insp:mpi-1' AND vin = '1HGCM82633A004352') <> 1 THEN
    RAISE EXCEPTION 'FAIL: service evidence lost on reacquisition';
  END IF;
  RAISE NOTICE 'PASS: reacquisition opens a new linked episode; prior deal milestones and service evidence unchanged';
END $$;

-- S6. Archived episode reappears: only an explicit restore brings it back.
DO $$
DECLARE t uuid; inst uuid; rv uuid; r jsonb;
BEGIN
  SELECT tenant_a INTO t FROM _ids;
  INSERT INTO public.vehicle_instances (tenant_id, vin) VALUES (t, '1M8GDM9AXKP042788') RETURNING id INTO inst;
  PERFORM public.vehicle_history_record_milestone(inst, 'archived', now() - interval '3 days', NULL, 'staff', NULL, 'left feed');
  rv := public.vehicle_history_flag_reappearance(t, NULL, '1M8GDM9AXKP042788', NULL, 'feed_snapshot', 'snap-3');
  IF (SELECT custody_state FROM public.vehicle_instances WHERE id = inst) <> 'archived' THEN RAISE EXCEPTION 'FAIL: auto-restore'; END IF;
  r := public.vehicle_history_resolve_reappearance(rv, 'keep_quarantined', 'synthetic: not enough evidence');
  IF (SELECT status FROM public.vehicle_reappearance_reviews WHERE id = rv) <> 'open' THEN RAISE EXCEPTION 'FAIL: keep_quarantined closed review'; END IF;
  r := public.vehicle_history_resolve_reappearance(rv, 'restore_episode', 'synthetic: archived in error');
  IF (SELECT custody_state FROM public.vehicle_instances WHERE id = inst) <> 'in_stock' OR (r->>'instance_id')::uuid <> inst THEN
    RAISE EXCEPTION 'FAIL: restore did not reopen the same episode';
  END IF;
  RAISE NOTICE 'PASS: archived reappearance stays put until a reviewer restores the same episode';
END $$;

-- S7. Void and correction append; history rows cannot be edited.
DO $$
DECLARE t uuid; inst uuid; d uuid; r jsonb;
BEGIN
  SELECT tenant_a INTO t FROM _ids;
  SELECT id INTO inst FROM public.vehicle_instances WHERE tenant_id = t AND vin = '1M8GDM9AXKP042788';
  PERFORM public.vehicle_history_record_milestone(inst, 'sold', now() - interval '2 days', NULL, 'staff', 'deal-2', NULL);
  r := public.vehicle_history_record_milestone(inst, 'delivered', now() - interval '1 day', NULL, 'staff', 'deal-2', NULL);
  d := (r->>'milestone_id')::uuid;
  BEGIN
    PERFORM public.vehicle_history_record_milestone(inst, 'delivery_corrected', now() - interval '30 hours', NULL, 'staff', 'deal-2', NULL, d);
    RAISE EXCEPTION 'FAIL: correction without reason accepted';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM NOT LIKE 'reason_required%' THEN RAISE; END IF;
  END;
  PERFORM public.vehicle_history_record_milestone(inst, 'delivery_corrected', now() - interval '30 hours', NULL, 'staff', 'deal-2', 'date keyed wrong', d);
  PERFORM public.vehicle_history_record_milestone(inst, 'sale_voided', now(), NULL, 'staff', 'deal-2', 'financing fell through');
  IF (SELECT count(*) FROM public.vehicle_custody_milestones WHERE instance_id = inst) <> 6 THEN RAISE EXCEPTION 'FAIL: milestones not appended'; END IF;
  IF (SELECT custody_state FROM public.vehicle_instances WHERE id = inst) <> 'in_stock' THEN RAISE EXCEPTION 'FAIL: void did not return to stock'; END IF;
  BEGIN
    UPDATE public.vehicle_custody_milestones SET reason = 'x' WHERE id = d;
    RAISE EXCEPTION 'FAIL: milestone edited';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM NOT LIKE 'append_only%' THEN RAISE; END IF;
  END;
  BEGIN
    DELETE FROM public.vehicle_instances WHERE id = inst;
    RAISE EXCEPTION 'FAIL: episode with history deleted';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;
  RAISE NOTICE 'PASS: correction and void append audited rows; history is append-only and episodes cannot be deleted';
END $$;

-- S8. Repairs: authorization is not completion; declined stays in history.
DO $$
DECLARE t uuid; i uuid; r jsonb;
BEGIN
  SELECT tenant_a INTO t FROM _ids;
  i := public._vh_enqueue((SELECT conn_a FROM _ids), t, 'autofilm.repair.recommended', 'finding:9001:f1', 1, '1HGCM82633A004352', 'ro-9001');
  PERFORM public.integration_apply_event(i, '{"verdict":"apply","outcome":"applied","effect":{"kind":"repair_item_upsert","status":"recommended","item":"rear_brakes"}}');
  i := public._vh_enqueue((SELECT conn_a FROM _ids), t, 'autofilm.repair.declined', 'finding:9001:f1', 2, '1HGCM82633A004352', 'ro-9001');
  PERFORM public.integration_apply_event(i, '{"verdict":"apply","outcome":"applied","effect":{"kind":"repair_item_upsert","status":"declined"}}');
  i := public._vh_enqueue((SELECT conn_a FROM _ids), t, 'autofilm.inspection.completed', 'insp:clean-later', 1, '1HGCM82633A004352', 'ro-9002');
  PERFORM public.integration_apply_event(i, '{"verdict":"apply","outcome":"applied","effect":{"kind":"inspection_evidence_upsert"}}');
  IF (SELECT status FROM public.repair_items WHERE source_record_id = 'finding:9001:f1') <> 'declined' THEN RAISE EXCEPTION 'FAIL: declined erased'; END IF;
  IF (SELECT array_agg(to_status ORDER BY h.changed_at, h.source_version) FROM public.repair_item_status_history h
      JOIN public.repair_items ri ON ri.id = h.repair_item_id WHERE ri.source_record_id = 'finding:9001:f1') <> ARRAY['recommended','declined'] THEN
    RAISE EXCEPTION 'FAIL: repair history not kept';
  END IF;
  BEGIN
    INSERT INTO public.repair_items (tenant_id, vin, service_visit_id, source_app, source_record_id, status, source_version)
    SELECT t, '1HGCM82633A004352', service_visit_id, 'autofilm', 'finding:x', 'completed_verified', 1
      FROM public.repair_items WHERE source_record_id = 'finding:9001:f1';
    RAISE EXCEPTION 'FAIL: verified completion without evidence';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  RAISE NOTICE 'PASS: declined recommendation survives a later clean inspection; verified completion needs evidence';
END $$;

-- S9. Settings: hard caps, version conflict, revert-as-new-version, emergency hold.
DO $$
DECLARE t uuid; inst uuid; v jsonb;
BEGIN
  SELECT tenant_a INTO t FROM _ids;
  PERFORM public.vehicle_history_set_setting('platform', NULL, 'integration.replay_max_batch', '10', 0, 'synthetic platform cap');
  BEGIN
    PERFORM public.vehicle_history_set_setting('tenant', t, 'integration.replay_max_batch', '50', 0, 'try to exceed the cap');
    RAISE EXCEPTION 'FAIL: tenant exceeded platform cap';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM NOT LIKE 'exceeds_parent_cap%' THEN RAISE; END IF;
  END;
  PERFORM public.vehicle_history_set_setting('tenant', t, 'integration.replay_max_batch', '5', 0, 'tenant lowers itself');
  BEGIN
    PERFORM public.vehicle_history_set_setting('tenant', t, 'integration.replay_max_batch', '3', 0, 'stale editor');
    RAISE EXCEPTION 'FAIL: stale version accepted';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM NOT LIKE 'version_conflict%' THEN RAISE; END IF;
  END;
  PERFORM public.vehicle_history_set_setting('platform', NULL, 'integration.replay_max_batch', '2', 1, 'platform tightens');
  v := public.vehicle_history_effective_setting(t, NULL, 'integration.replay_max_batch');
  IF (v->>'value')::int <> 2 THEN RAISE EXCEPTION 'FAIL: minimum not applied: %', v; END IF;
  PERFORM public.vehicle_history_set_setting('platform', NULL, 'integration.replay_max_batch', '10', 2, 'revert to previous');
  IF (SELECT count(*) FROM public.vehicle_history_settings WHERE scope_type = 'platform' AND key = 'integration.replay_max_batch') <> 3 THEN
    RAISE EXCEPTION 'FAIL: revert overwrote history';
  END IF;
  BEGIN
    PERFORM public.integration_replay_inbox(t, ARRAY(SELECT id FROM public.integration_inbox WHERE tenant_id = t LIMIT 6), 'too many at once');
    RAISE EXCEPTION 'FAIL: replay above cap';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM NOT LIKE 'replay_batch_exceeds_cap%' THEN RAISE; END IF;
  END;
  RAISE NOTICE 'PASS: tenant cannot exceed the platform cap; stale edits conflict; reverts append; replay is capped';

  SELECT id INTO inst FROM public.vehicle_instances WHERE tenant_id = t AND vin = '1M8GDM9AXKP042788';
  PERFORM public.vehicle_history_set_setting('platform', NULL, 'lifecycle.emergency_hold', 'true', 0, 'synthetic emergency');
  PERFORM public.vehicle_history_set_setting('tenant', t, 'lifecycle.emergency_hold', 'false', 0, 'tenant tries to clear it');
  BEGIN
    PERFORM public.vehicle_history_record_milestone(inst, 'sold', now(), NULL, 'staff', NULL, NULL);
    RAISE EXCEPTION 'FAIL: milestone during emergency hold';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM NOT LIKE 'emergency_hold%' THEN RAISE; END IF;
  END;
  PERFORM public.vehicle_history_set_setting('platform', NULL, 'lifecycle.emergency_hold', 'false', 1, 'synthetic all clear');
  RAISE NOTICE 'PASS: the most restrictive emergency hold wins over a tenant setting';
END $$;

-- S9b. A dealer cannot switch on a policy the platform has not enabled.
DO $$
DECLARE t uuid;
BEGIN
  SELECT tenant_b INTO t FROM _ids;
  PERFORM public.vehicle_history_set_setting('tenant', t, 'integration.outbound_capture_enabled', 'true', 0, 'dealer tries alone');
  IF public.vehicle_history_flag(t, NULL, 'integration.outbound_capture_enabled') THEN
    RAISE EXCEPTION 'FAIL: tenant enabled an unapproved policy without the platform';
  END IF;
  RAISE NOTICE 'PASS: an enable needs the platform; a tenant true alone stays off';
END $$;

-- S10. Pause application: capture continues, nothing is claimed, nothing is lost.
DO $$
DECLARE t uuid; i uuid; n int;
BEGIN
  SELECT tenant_a INTO t FROM _ids;
  PERFORM public.vehicle_history_set_setting('tenant', t, 'integration.apply_paused', 'true', 0, 'synthetic pause');
  i := public._vh_enqueue((SELECT conn_a FROM _ids), t, 'autofilm.inspection.completed', 'insp:paused', 1, '1HGCM82633A004352', 'ro-9003');
  SELECT count(*) INTO n FROM public.integration_claim_inbox(100, 60) c WHERE c.tenant_id = t;
  IF n <> 0 OR (SELECT status FROM public.integration_inbox WHERE id = i) <> 'received' THEN RAISE EXCEPTION 'FAIL: paused tenant claimed'; END IF;
  PERFORM public.vehicle_history_set_setting('tenant', t, 'integration.apply_paused', 'false', 1, 'synthetic resume');
  SELECT count(*) INTO n FROM public.integration_claim_inbox(100, 60) c WHERE c.id = i;
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL: resumed tenant not claimed'; END IF;
  RAISE NOTICE 'PASS: pausing application keeps capturing and resumes without loss';
END $$;

-- S11. Transactional outbox and echo guard.
DO $$
DECLARE t uuid; inst uuid; before int; cause uuid;
BEGIN
  SELECT tenant_a INTO t FROM _ids;
  SELECT id INTO inst FROM public.vehicle_instances WHERE tenant_id = t AND vin = '1M8GDM9AXKP042788';
  SELECT count(*) INTO before FROM public.integration_outbox WHERE tenant_id = t;
  PERFORM public.vehicle_history_record_milestone(inst, 'sold', now(), NULL, 'staff', NULL, NULL);
  IF (SELECT count(*) FROM public.integration_outbox WHERE tenant_id = t) <> before THEN RAISE EXCEPTION 'FAIL: outbox written while capture is off'; END IF;
  PERFORM public.vehicle_history_set_setting('platform', NULL, 'integration.outbound_capture_enabled', 'true', 0, 'synthetic capture on');
  PERFORM public.vehicle_history_record_milestone(inst, 'awaiting_delivery', now(), NULL, 'staff', NULL, NULL);
  IF (SELECT count(*) FROM public.integration_outbox WHERE tenant_id = t) <> before THEN RAISE EXCEPTION 'FAIL: non-catalog milestone emitted'; END IF;
  BEGIN
    PERFORM public.vehicle_history_record_milestone(inst, 'archived', now(), NULL, 'staff', NULL, NULL);
  EXCEPTION WHEN raise_exception THEN NULL;
  END;
  IF (SELECT count(*) FROM public.integration_outbox WHERE tenant_id = t) <> before THEN RAISE EXCEPTION 'FAIL: failed change left an outbox row'; END IF;
  SELECT event_id INTO cause FROM public.integration_inbox WHERE connection_id = (SELECT conn_a FROM _ids) LIMIT 1;
  PERFORM public.vehicle_history_record_milestone(inst, 'delivered', now(), NULL, 'integration', NULL, NULL, NULL, cause);
  IF (SELECT count(*) FROM public.integration_outbox WHERE tenant_id = t) <> before THEN RAISE EXCEPTION 'FAIL: echoed back to the causing app'; END IF;
  PERFORM public.vehicle_history_record_milestone(inst, 'sale_voided', now(), NULL, 'staff', NULL, 'synthetic unwind');
  IF (SELECT count(*) FROM public.integration_outbox WHERE tenant_id = t AND event_type = 'autolabels.vehicle.sale_voided') <> 1 THEN
    RAISE EXCEPTION 'FAIL: sale_voided not captured';
  END IF;
  RAISE NOTICE 'PASS: outbox row exists only with its committed milestone; capture switch and echo guard enforced';
END $$;

-- S12. Prior owner vs new owner; revocation takes effect on the next read.
DO $$
DECLARE t uuid; prior uuid; cur uuid; g1 uuid; g2 uuid;
BEGIN
  SELECT tenant_a INTO t FROM _ids;
  SELECT id INTO prior FROM public.vehicle_instances WHERE tenant_id = t AND vin = '1HGCM82633A004352' AND opened_reason = 'initial';
  SELECT id INTO cur FROM public.vehicle_instances WHERE tenant_id = t AND vin = '1HGCM82633A004352' AND opened_reason = 'reacquisition';
  g1 := public.vehicle_history_grant_access(t, '1HGCM82633A004352', prior, 'purchaser', (SELECT cust_1 FROM _ids), 'crm:cust-1',
    'owner records', ARRAY['transaction_records','service_history','inspection_evidence'], 'signed_deal', now() - interval '18 days', NULL);
  PERFORM public.vehicle_history_end_access(g1, 'end_relationship', now() - interval '5 days', 'traded the car back');
  INSERT INTO public.service_visits (tenant_id, vin, source_app, source_record_id, opened_at, intake_verification)
    VALUES (t, '1HGCM82633A004352', 'autolabels', 'visit-after-trade', now() - interval '2 days', 'staff_confirmed');
  g2 := public.vehicle_history_grant_access(t, '1HGCM82633A004352', cur, 'purchaser', (SELECT cust_2 FROM _ids), 'crm:cust-2',
    'owner records', ARRAY['service_history'], 'signed_deal', now() - interval '4 days', NULL);
  PERFORM set_config('vh.g1', g1::text, true);
  PERFORM set_config('vh.a_inst', cur::text, true);
  PERFORM set_config('vh.g2', g2::text, true);
  BEGIN
    PERFORM public.vehicle_history_grant_access(t, '1HGCM82633A004352', NULL, 'purchaser', (SELECT cust_2 FROM _ids), 'jane@example.test',
      'bad ref', ARRAY['service_history'], 'signed_deal', now(), NULL);
    RAISE EXCEPTION 'FAIL: email accepted as subject ref';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  RAISE NOTICE 'PASS: grants need a scoped reference, not an email';
END $$;

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', (SELECT json_build_object('sub', cust_1, 'role', 'authenticated')::text FROM _ids), true);
DO $$
DECLARE v jsonb;
BEGIN
  v := public.vehicle_history_owner_view('1HGCM82633A004352');
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v) x WHERE x->>'kind' = 'inspection') THEN RAISE EXCEPTION 'FAIL: prior owner lost own-period MPI: %', v; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(v) x WHERE (x->>'at')::timestamptz >= now() - interval '5 days') THEN
    RAISE EXCEPTION 'FAIL: prior owner sees the visit after the relationship ended: %', v;
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(v) x WHERE x->>'kind' = 'custody_milestone') THEN
    RAISE EXCEPTION 'FAIL: ended relationship keeps transaction records while policy is off';
  END IF;
  IF EXISTS (SELECT 1 FROM public.vehicle_access_grants) THEN RAISE EXCEPTION 'FAIL: customer can read grant table'; END IF;
  IF EXISTS (SELECT 1 FROM public.service_visits) THEN RAISE EXCEPTION 'FAIL: customer reads service_visits directly'; END IF;
  RAISE NOTICE 'PASS: prior owner sees only their period; no direct table access; transaction records follow policy';
END $$;
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', (SELECT json_build_object('sub', cust_2, 'role', 'authenticated')::text FROM _ids), true);
DO $$
DECLARE v jsonb;
BEGIN
  v := public.vehicle_history_owner_view('1HGCM82633A004352');
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v) x WHERE x->>'kind' = 'service_visit' AND (x->>'at')::timestamptz >= now() - interval '4 days') THEN
    RAISE EXCEPTION 'FAIL: new owner cannot see their visit: %', v;
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(v) x WHERE (x->>'at')::timestamptz < now() - interval '4 days') THEN
    RAISE EXCEPTION 'FAIL: new owner sees prior owner period: %', v;
  END IF;
  RAISE NOTICE 'PASS: new owner sees only records from their own relationship';
END $$;
RESET ROLE;
SET LOCAL ROLE service_role;
SELECT public.vehicle_history_end_access(current_setting('vh.g2')::uuid, 'revoke', now(), 'synthetic revocation');
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', (SELECT json_build_object('sub', cust_2, 'role', 'authenticated')::text FROM _ids), true);
DO $$
BEGIN
  IF jsonb_array_length(public.vehicle_history_owner_view('1HGCM82633A004352')) <> 0 THEN RAISE EXCEPTION 'FAIL: revoked grant still reads'; END IF;
  RAISE NOTICE 'PASS: revocation is effective on the very next read';
END $$;

-- S12b. Proposed former-customer policy: own episode's transaction records only, only
-- while the policy is on and a retention date is set; never the next owner's episode.
RESET ROLE;
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
DO $$
DECLARE t uuid; cur uuid;
BEGIN
  SELECT tenant_a INTO t FROM _ids;
  SELECT id INTO cur FROM public.vehicle_instances WHERE tenant_id = t AND vin = '1HGCM82633A004352' AND opened_reason = 'reacquisition';
  IF NOT EXISTS (SELECT 1 FROM public.vehicle_custody_milestones WHERE instance_id = cur) THEN
    PERFORM public.vehicle_history_record_milestone(cur, 'sold', now() - interval '1 day', NULL, 'staff', 'deal-2', NULL);
  END IF;
  PERFORM public.vehicle_history_set_setting('platform', NULL, 'access.prior_owner_keeps_transaction_records', 'true', 0, 'synthetic policy on');
  PERFORM public.vehicle_history_set_setting('tenant', t, 'access.prior_owner_keeps_transaction_records', 'true', 0, 'synthetic policy on');
END $$;
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', (SELECT json_build_object('sub', cust_1, 'role', 'authenticated')::text FROM _ids), true);
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(public.vehicle_history_owner_view('1HGCM82633A004352')) x WHERE x->>'kind' = 'custody_milestone') THEN
    RAISE EXCEPTION 'FAIL: policy on but no retention date still grants transaction records';
  END IF;
  RAISE NOTICE 'PASS: policy on without a retention date grants nothing after the relationship ends';
END $$;
RESET ROLE;
SET LOCAL ROLE service_role;
SELECT public.vehicle_history_set_transaction_retention(current_setting('vh.g1')::uuid, now() + interval '30 days', 'synthetic retention window');
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', (SELECT json_build_object('sub', cust_1, 'role', 'authenticated')::text FROM _ids), true);
DO $$
DECLARE v jsonb; prior_inst uuid; t uuid;
BEGIN
  v := public.vehicle_history_owner_view('1HGCM82633A004352');
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v) x WHERE x->>'kind' = 'custody_milestone' AND x #>> '{detail,milestone}' = 'delivered') THEN
    RAISE EXCEPTION 'FAIL: former customer lost their own delivery record inside retention: %', v;
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(v) x WHERE x->>'kind' = 'custody_milestone' AND (x->>'at')::timestamptz >= now() - interval '5 days') THEN
    RAISE EXCEPTION 'FAIL: former customer sees the next owner''s transaction: %', v;
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(v) x WHERE x->>'kind' <> 'custody_milestone' AND (x->>'at')::timestamptz >= now() - interval '5 days') THEN
    RAISE EXCEPTION 'FAIL: former customer sees service after the relationship ended: %', v;
  END IF;
  RAISE NOTICE 'PASS: inside retention a former customer reads their own transaction records, not the next owner''s or later service';
END $$;
RESET ROLE;
SET LOCAL ROLE service_role;
SELECT public.vehicle_history_set_transaction_retention(current_setting('vh.g1')::uuid, now() - interval '1 second', 'synthetic retention expired');
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', (SELECT json_build_object('sub', cust_1, 'role', 'authenticated')::text FROM _ids), true);
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(public.vehicle_history_owner_view('1HGCM82633A004352')) x WHERE x->>'kind' = 'custody_milestone') THEN
    RAISE EXCEPTION 'FAIL: transaction records still readable after retention ended';
  END IF;
  RAISE NOTICE 'PASS: transaction access ends when the retention date passes';
END $$;
RESET ROLE;
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
DO $$
DECLARE t uuid;
BEGIN
  SELECT tenant_a INTO t FROM _ids;
  PERFORM public.vehicle_history_set_setting('platform', NULL, 'access.prior_owner_keeps_transaction_records', 'false', 1, 'synthetic policy back off');
END $$;

-- S13. Two tenants, same VIN: staff see only their own tenant; a store cannot change settings it does not own.
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', (SELECT json_build_object('sub', mgr_b, 'role', 'authenticated')::text FROM _ids), true);
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.service_visits WHERE tenant_id <> (SELECT tenant_b FROM _ids)) THEN RAISE EXCEPTION 'FAIL: B sees A visits'; END IF;
  IF EXISTS (SELECT 1 FROM public.vehicle_custody_milestones) THEN RAISE EXCEPTION 'FAIL: B sees A milestones'; END IF;
  IF EXISTS (SELECT 1 FROM public.inspection_evidence WHERE tenant_id <> (SELECT tenant_b FROM _ids)) THEN RAISE EXCEPTION 'FAIL: B sees A evidence'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.inspection_evidence) THEN RAISE EXCEPTION 'FAIL: B cannot see its own evidence'; END IF;
  IF EXISTS (SELECT 1 FROM public.vehicle_identity_quarantine) THEN RAISE EXCEPTION 'FAIL: B sees A quarantine'; END IF;
  IF jsonb_array_length(public.vehicle_history_owner_view('1HGCM82633A004352')) <> 0 THEN RAISE EXCEPTION 'FAIL: B reads owner view'; END IF;
  BEGIN
    PERFORM public.vehicle_history_set_setting('tenant', (SELECT tenant_a FROM _ids), 'lifecycle.emergency_hold', 'true', 1, 'cross tenant attempt');
    RAISE EXCEPTION 'FAIL: B changed A settings';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM NOT LIKE 'not_authorized%' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.vehicle_history_record_milestone(current_setting('vh.a_inst')::uuid, 'sold', now(), NULL, 'staff', NULL, NULL);
    RAISE EXCEPTION 'FAIL: B wrote a milestone';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM NOT LIKE 'not_authorized%' THEN RAISE; END IF;
  END;
  RAISE NOTICE 'PASS: same VIN at two dealers: no cross-tenant reads, writes or existence leaks';
END $$;
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', (SELECT json_build_object('sub', staff_a, 'role', 'authenticated')::text FROM _ids), true);
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.service_visits) THEN RAISE EXCEPTION 'FAIL: staff cannot read own tenant visits'; END IF;
  IF EXISTS (SELECT 1 FROM public.vehicle_access_grants) OR EXISTS (SELECT 1 FROM public.vehicle_history_audit) THEN
    RAISE EXCEPTION 'FAIL: non-manager staff read grants or audit';
  END IF;
  BEGIN
    PERFORM public.vehicle_history_set_setting('tenant', (SELECT tenant_a FROM _ids), 'integration.apply_paused', 'true', 2, 'staff attempt');
    RAISE EXCEPTION 'FAIL: staff changed a setting';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM NOT LIKE 'not_authorized%' THEN RAISE; END IF;
  END;
  RAISE NOTICE 'PASS: staff read history but not customer grants or audit, and cannot change settings';
END $$;

-- S14. VIN correction needs a second manager and moves only the listed records.
RESET ROLE;
SET LOCAL ROLE service_role;
DO $$
DECLARE t uuid; ev uuid; c uuid;
BEGIN
  SELECT tenant_a INTO t FROM _ids;
  SELECT id INTO ev FROM public.inspection_evidence WHERE source_record_id = 'insp:svc-only';
  INSERT INTO public.vehicle_identity_corrections (tenant_id, from_vin, to_vin, record_refs, reason, requested_by)
  VALUES (t, 'JH4KA7561PC008269', '1M8GDM9AXKP042788', jsonb_build_array(jsonb_build_object('table', 'inspection_evidence', 'id', ev)),
          'technician keyed the wrong VIN', (SELECT mgr_a FROM _ids)) RETURNING id INTO c;
  PERFORM set_config('vh.c', c::text, true);
END $$;
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', (SELECT json_build_object('sub', mgr_a, 'role', 'authenticated')::text FROM _ids), true);
DO $$
BEGIN
  PERFORM public.vehicle_history_apply_identity_correction(current_setting('vh.c')::uuid);
  RAISE EXCEPTION 'FAIL: requester applied own correction';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM NOT LIKE 'second_person_required%' THEN RAISE; END IF;
  RAISE NOTICE 'PASS: requester cannot approve their own VIN correction';
END $$;
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', (SELECT json_build_object('sub', mgr_a2, 'role', 'authenticated')::text FROM _ids), true);
DO $$
DECLARE r jsonb;
BEGIN
  r := public.vehicle_history_apply_identity_correction(current_setting('vh.c')::uuid);
  IF (r->>'moved')::int <> 1 THEN RAISE EXCEPTION 'FAIL: correction moved %', r; END IF;
  IF (SELECT vin FROM public.inspection_evidence WHERE source_record_id = 'insp:svc-only') <> '1M8GDM9AXKP042788' THEN RAISE EXCEPTION 'FAIL: not moved'; END IF;
  IF (SELECT vin FROM public.service_visits WHERE source_record_id = 'ro-7') <> 'JH4KA7561PC008269' THEN RAISE EXCEPTION 'FAIL: unlisted visit moved'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.vehicle_history_audit WHERE action = 'identity.correct') THEN RAISE EXCEPTION 'FAIL: no audit'; END IF;
  RAISE NOTICE 'PASS: second manager applies the correction; only listed records move, with audit';
END $$;

-- S15. Anonymous callers reach nothing.
RESET ROLE;
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);
DO $$
BEGIN
  BEGIN
    PERFORM public.vehicle_history_owner_view('1HGCM82633A004352');
    RAISE EXCEPTION 'FAIL: anon called owner view';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM 1 FROM public.service_visits;
    RAISE EXCEPTION 'FAIL: anon read service visits';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  RAISE NOTICE 'PASS: anonymous callers cannot read history or call the owner view';
END $$;

ROLLBACK;
