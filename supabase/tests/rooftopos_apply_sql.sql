-- RooftopOS spine: apply/claim function behaviour and two-dealership isolation.
-- Same harness conventions as rooftopos_spine_rls.sql: one transaction, rolled back,
-- run against a scratch database only.

BEGIN;

CREATE TEMP TABLE _ids AS SELECT
  gen_random_uuid() AS user_a, gen_random_uuid() AS user_b,
  gen_random_uuid() AS tenant_a, gen_random_uuid() AS tenant_b,
  gen_random_uuid() AS conn_a, gen_random_uuid() AS conn_b;
GRANT SELECT ON _ids TO authenticated, anon, service_role;

INSERT INTO auth.users (id, email) SELECT user_a, 'apply-a@example.test' FROM _ids;
INSERT INTO auth.users (id, email) SELECT user_b, 'apply-b@example.test' FROM _ids;
INSERT INTO public.tenants (id, name, slug) SELECT tenant_a, 'Dealer A', 'apply-a-' || tenant_a FROM _ids;
INSERT INTO public.tenants (id, name, slug) SELECT tenant_b, 'Dealer B', 'apply-b-' || tenant_b FROM _ids;
INSERT INTO public.tenant_members (tenant_id, user_id, role, accepted_at) SELECT tenant_a, user_a, 'owner', now() FROM _ids;
INSERT INTO public.tenant_members (tenant_id, user_id, role, accepted_at) SELECT tenant_b, user_b, 'owner', now() FROM _ids;
INSERT INTO public.vehicles (vin) VALUES ('1HGCM82633A004352');
INSERT INTO public.vehicle_instances (tenant_id, vin) SELECT tenant_a, '1HGCM82633A004352' FROM _ids;
INSERT INTO public.vehicle_instances (tenant_id, vin) SELECT tenant_b, '1HGCM82633A004352' FROM _ids;
INSERT INTO public.integration_connections (id, tenant_id, app, display_name, status, adapter, external_rooftop_ref)
  SELECT conn_a, tenant_a, 'autofilm', 'A film', 'active', 'autofilm.v1', 'af-rooftop-a' FROM _ids;
INSERT INTO public.integration_connections (id, tenant_id, app, display_name, status, adapter, external_rooftop_ref)
  SELECT conn_b, tenant_b, 'autofilm', 'B film', 'active', 'autofilm.v1', 'af-rooftop-b' FROM _ids;
INSERT INTO public.integration_direction_flags (tenant_id, direction, enabled) SELECT tenant_a, 'film_to_labels', true FROM _ids;

CREATE FUNCTION public._t_enqueue(p_conn uuid, p_tenant uuid, p_type text, p_record text, p_version bigint,
  p_visibility text DEFAULT 'tenant_private', p_vin text DEFAULT '1HGCM82633A004352') RETURNS uuid
LANGUAGE sql AS $$
  INSERT INTO public.integration_inbox (connection_id, tenant_id, producer, event_id, event_type, schema_version,
      idempotency_key, payload_checksum, source_record_id, source_version, vin, visibility, envelope)
  VALUES (p_conn, p_tenant, 'autofilm', gen_random_uuid(), p_type, '1.0.0',
      'idem-' || gen_random_uuid(), 'x', p_record, p_version, p_vin, p_visibility, '{}'::jsonb)
  RETURNING id;
$$;
GRANT EXECUTE ON FUNCTION public._t_enqueue(uuid, uuid, text, text, bigint, text, text) TO service_role;

SET LOCAL ROLE service_role;

-- Ordering: v2 then v1 leaves v2 in force and v1 superseded; equal version is superseded too.
DO $$
DECLARE c uuid; t uuid; i2 uuid; i1 uuid; ieq uuid; r jsonb; sev text; st text;
BEGIN
  SELECT conn_a, tenant_a INTO c, t FROM _ids;
  i2 := public._t_enqueue(c, t, 'autofilm.repair.recommended', 'finding:ro1:f1', 2);
  i1 := public._t_enqueue(c, t, 'autofilm.repair.recommended', 'finding:ro1:f1', 1);
  ieq := public._t_enqueue(c, t, 'autofilm.repair.recommended', 'finding:ro1:f1', 2);
  r := public.integration_apply_event(i2, '{"verdict":"apply","outcome":"applied","effect":{"kind":"repair_item_upsert","status":"recommended","finding_ref":"f1","item":"rear_brakes","severity":"monitor"}}');
  IF r->>'status' <> 'applied' THEN RAISE EXCEPTION 'FAIL: v2 not applied: %', r; END IF;
  r := public.integration_apply_event(i1, '{"verdict":"apply","outcome":"applied","effect":{"kind":"repair_item_upsert","status":"declined","finding_ref":"f1","item":"STALE","severity":"STALE"}}');
  IF r->>'status' <> 'superseded' THEN RAISE EXCEPTION 'FAIL: v1 after v2 not superseded: %', r; END IF;
  r := public.integration_apply_event(ieq, '{"verdict":"apply","outcome":"applied","effect":{"kind":"repair_item_upsert","status":"declined","finding_ref":"f1","item":"STALE","severity":"STALE"}}');
  IF r->>'status' <> 'superseded' THEN RAISE EXCEPTION 'FAIL: equal version not superseded: %', r; END IF;
  SELECT status, item INTO st, sev FROM public.repair_items WHERE tenant_id = t AND source_record_id = 'finding:ro1:f1';
  IF st <> 'recommended' OR sev <> 'rear_brakes' THEN RAISE EXCEPTION 'FAIL: stale event changed the effect (% %)', st, sev; END IF;
  IF (SELECT latest_version FROM public.integration_source_versions WHERE connection_id = c AND source_record_id = 'finding:ro1:f1') <> 2 THEN
    RAISE EXCEPTION 'FAIL: watermark is not 2';
  END IF;
  IF (SELECT count(*) FROM public.integration_inbox WHERE id IN (i1, ieq) AND status = 'superseded' AND outcome_code = 'stale_version') <> 2 THEN
    RAISE EXCEPTION 'FAIL: inbox rows not marked superseded';
  END IF;
  RAISE NOTICE 'PASS: v2 then v1 and equal version are superseded, effect and watermark untouched';

  -- Reapplying an already-final row is a no-op (idempotent worker retry).
  r := public.integration_apply_event(i2, '{"verdict":"apply","outcome":"applied","effect":{"kind":"repair_item_upsert","status":"declined"}}');
  IF r->>'status' <> 'noop' THEN RAISE EXCEPTION 'FAIL: re-apply of final row was not a no-op: %', r; END IF;
  RAISE NOTICE 'PASS: re-applying a finalized row is a no-op';
END $$;

-- A newer decision keeps item details that the decision payload does not carry.
DO $$
DECLARE c uuid; t uuid; i3 uuid; r jsonb; row_ public.repair_items;
BEGIN
  SELECT conn_a, tenant_a INTO c, t FROM _ids;
  i3 := public._t_enqueue(c, t, 'autofilm.repair.approved', 'finding:ro1:f1', 3);
  r := public.integration_apply_event(i3, '{"verdict":"apply","outcome":"applied","effect":{"kind":"repair_item_upsert","status":"approved","finding_ref":"f1"}}');
  SELECT * INTO row_ FROM public.repair_items WHERE tenant_id = t AND source_record_id = 'finding:ro1:f1';
  IF row_.status <> 'approved' OR row_.item <> 'rear_brakes' OR row_.source_version <> 3 THEN
    RAISE EXCEPTION 'FAIL: approved update lost details: % % %', row_.status, row_.item, row_.source_version;
  END IF;
  RAISE NOTICE 'PASS: later decision updates status and keeps item details';
END $$;

-- completed_verified without evidence cannot be stored even via the apply function, and the failure rolls back.
DO $$
DECLARE c uuid; t uuid; iv uuid; blocked boolean := false; st text; lv bigint;
BEGIN
  SELECT conn_a, tenant_a INTO c, t FROM _ids;
  iv := public._t_enqueue(c, t, 'autofilm.repair.completed_verified', 'finding:ro1:f9', 1);
  BEGIN
    PERFORM public.integration_apply_event(iv, '{"verdict":"apply","outcome":"applied","effect":{"kind":"repair_item_upsert","status":"completed_verified"}}');
  EXCEPTION WHEN check_violation THEN blocked := true; END;
  IF NOT blocked THEN RAISE EXCEPTION 'FAIL: completed_verified without evidence was stored'; END IF;
  SELECT status INTO st FROM public.integration_inbox WHERE id = iv;
  SELECT latest_version INTO lv FROM public.integration_source_versions WHERE connection_id = c AND source_record_id = 'finding:ro1:f9';
  IF st <> 'received' OR lv IS NOT NULL THEN RAISE EXCEPTION 'FAIL: failed apply left partial state (% %)', st, lv; END IF;
  RAISE NOTICE 'PASS: a failing apply leaves no partial state';
END $$;

-- Unmatched instance does not move the watermark, so a later replay still applies.
DO $$
DECLARE c uuid; t uuid; iu uuid; ir uuid; r jsonb; n bigint;
BEGIN
  SELECT conn_a, tenant_a INTO c, t FROM _ids;
  iu := public._t_enqueue(c, t, 'autofilm.inspection.completed', 'inspection:i1', 1, 'tenant_private', '1M8GDM9AXKP042788');
  r := public.integration_apply_event(iu, '{"verdict":"apply","outcome":"applied","effect":{"kind":"inspection_evidence_upsert","odometer_miles":10}}');
  IF r->>'status' <> 'unmatched' OR r->>'outcome' <> 'no_active_instance' THEN RAISE EXCEPTION 'FAIL: expected unmatched, got %', r; END IF;
  SELECT latest_version INTO n FROM public.integration_source_versions WHERE connection_id = c AND source_record_id = 'inspection:i1';
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL: unmatched event moved the watermark to %', n; END IF;
  RAISE NOTICE 'PASS: unmatched instance leaves the watermark at 0';
END $$;

-- Direction flag gates the claim; rows are leased exclusively and demoted to held when the flag is off.
DO $$
DECLARE n int; held int; claimed int; again int;
BEGIN
  PERFORM public._t_enqueue((SELECT conn_b FROM _ids), (SELECT tenant_b FROM _ids), 'autofilm.repair.recommended', 'finding:b:f1', 1);
  SELECT count(*) INTO claimed FROM public.integration_claim_inbox(100, 300);
  SELECT count(*) INTO held FROM public.integration_inbox WHERE tenant_id = (SELECT tenant_b FROM _ids) AND status = 'held';
  IF held <> 1 THEN RAISE EXCEPTION 'FAIL: tenant B row not held while its flag is off (held=%)', held; END IF;
  IF EXISTS (SELECT 1 FROM public.integration_inbox WHERE tenant_id = (SELECT tenant_b FROM _ids) AND claimed_until IS NOT NULL) THEN
    RAISE EXCEPTION 'FAIL: a row of a disabled direction was leased';
  END IF;
  SELECT count(*) INTO again FROM public.integration_claim_inbox(100, 300)
    WHERE tenant_id = (SELECT tenant_a FROM _ids);
  IF again <> 0 THEN RAISE EXCEPTION 'FAIL: leased rows were claimed twice (%)', again; END IF;
  RAISE NOTICE 'PASS: claim skips disabled directions and leased rows (claimed %)', claimed;
END $$;

-- Two dealerships, same VIN, same source record ids: each effect lands only in its own tenant.
DO $$
DECLARE ia uuid; ib uuid; ra jsonb; rb jsonb;
BEGIN
  UPDATE public.integration_direction_flags SET enabled = true WHERE direction = 'film_to_labels';
  INSERT INTO public.integration_direction_flags (tenant_id, direction, enabled)
    SELECT tenant_b, 'film_to_labels', true FROM _ids ON CONFLICT DO NOTHING;
  ia := public._t_enqueue((SELECT conn_a FROM _ids), (SELECT tenant_a FROM _ids), 'autofilm.inspection.completed', 'inspection:same', 5, 'custody_shared');
  ib := public._t_enqueue((SELECT conn_b FROM _ids), (SELECT tenant_b FROM _ids), 'autofilm.inspection.completed', 'inspection:same', 1);
  ra := public.integration_apply_event(ia, '{"verdict":"apply","outcome":"applied","effect":{"kind":"inspection_evidence_upsert","odometer_miles":45000,"technician_verified":false}}');
  rb := public.integration_apply_event(ib, '{"verdict":"apply","outcome":"applied","effect":{"kind":"inspection_evidence_upsert","odometer_miles":99999,"technician_verified":false}}');
  IF ra->>'status' <> 'applied' OR rb->>'status' <> 'applied' THEN
    RAISE EXCEPTION 'FAIL: both tenants should apply independently: % %', ra, rb;
  END IF;
  IF (SELECT odometer_miles FROM public.inspection_evidence WHERE tenant_id = (SELECT tenant_a FROM _ids) AND source_record_id = 'inspection:same') <> 45000
     OR (SELECT odometer_miles FROM public.inspection_evidence WHERE tenant_id = (SELECT tenant_b FROM _ids) AND source_record_id = 'inspection:same') <> 99999 THEN
    RAISE EXCEPTION 'FAIL: effects crossed tenants';
  END IF;
  IF (SELECT visibility FROM public.inspection_evidence WHERE tenant_id = (SELECT tenant_a FROM _ids) AND source_record_id = 'inspection:same') <> 'custody_shared' THEN
    RAISE EXCEPTION 'FAIL: custody_shared visibility was not carried to the effect';
  END IF;
  RAISE NOTICE 'PASS: same VIN and same record id apply independently per tenant (version 5 vs 1 never compared)';
END $$;

-- Dead-letter bookkeeping.
DO $$
DECLARE c uuid; t uuid; id1 uuid; n int; st text; nxt timestamptz;
BEGIN
  SELECT conn_a, tenant_a INTO c, t FROM _ids;
  id1 := public._t_enqueue(c, t, 'autofilm.repair.recommended', 'finding:dl:f1', 1);
  n := public.integration_fail_inbox(id1, 'apply_error', 60, false);
  SELECT status, next_attempt_at INTO st, nxt FROM public.integration_inbox WHERE id = id1;
  IF n <> 1 OR st <> 'received' OR nxt <= now() THEN RAISE EXCEPTION 'FAIL: first failure should back off (n=%, st=%)', n, st; END IF;
  IF EXISTS (SELECT 1 FROM public.integration_claim_inbox(100, 300) WHERE id = id1) THEN
    RAISE EXCEPTION 'FAIL: backed-off row was claimed before next_attempt_at';
  END IF;
  n := public.integration_fail_inbox(id1, 'apply_error', 0, true);
  SELECT status INTO st FROM public.integration_inbox WHERE id = id1;
  IF n <> 2 OR st <> 'dead' THEN RAISE EXCEPTION 'FAIL: row not dead-lettered (n=%, st=%)', n, st; END IF;
  RAISE NOTICE 'PASS: failure backs off, then dead-letters';
END $$;

-- RLS: each dealer's authenticated user sees only its own rows on every client-readable table.
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', (SELECT json_build_object('sub', user_a, 'role', 'authenticated')::text FROM _ids), true);
DO $$
DECLARE t text; other int; own int; ta uuid; tb uuid;
BEGIN
  SELECT tenant_a, tenant_b INTO ta, tb FROM _ids;
  FOREACH t IN ARRAY ARRAY['vehicle_instances','inspection_evidence','repair_items','integration_inbox'] LOOP
    EXECUTE format('SELECT count(*) FROM public.%I WHERE tenant_id = $1', t) INTO other USING tb;
    EXECUTE format('SELECT count(*) FROM public.%I WHERE tenant_id = $1', t) INTO own USING ta;
    IF other <> 0 THEN RAISE EXCEPTION 'FAIL %: dealer A read % rows of dealer B', t, other; END IF;
    IF own = 0 THEN RAISE EXCEPTION 'FAIL %: dealer A sees none of its own rows', t; END IF;
    EXECUTE format('SELECT count(*) FROM public.%I', t) INTO own;
    EXECUTE format('SELECT count(*) FROM public.%I WHERE tenant_id <> $1', t) INTO other USING ta;
    IF other <> 0 THEN RAISE EXCEPTION 'FAIL %: unfiltered read returned other tenants'' rows', t; END IF;
  END LOOP;
  IF (SELECT count(*) FROM public.inspection_evidence WHERE source_record_id = 'inspection:same' AND odometer_miles = 99999) <> 0 THEN
    RAISE EXCEPTION 'FAIL: dealer A can read dealer B evidence for the same VIN';
  END IF;
  IF (SELECT count(*) FROM public.inspection_evidence WHERE visibility = 'custody_shared') <> 1 THEN
    RAISE EXCEPTION 'FAIL: dealer A should see its own custody_shared record';
  END IF;
  RAISE NOTICE 'PASS: dealer A sees only dealer A rows on instances, evidence, repair items and inbox';
END $$;

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', (SELECT json_build_object('sub', user_b, 'role', 'authenticated')::text FROM _ids), true);
DO $$
DECLARE t text; other int; own int; ta uuid; tb uuid;
BEGIN
  SELECT tenant_a, tenant_b INTO ta, tb FROM _ids;
  FOREACH t IN ARRAY ARRAY['vehicle_instances','inspection_evidence','repair_items','integration_inbox'] LOOP
    EXECUTE format('SELECT count(*) FROM public.%I WHERE tenant_id = $1', t) INTO other USING ta;
    IF other <> 0 THEN RAISE EXCEPTION 'FAIL %: dealer B read % rows of dealer A', t, other; END IF;
  END LOOP;
  IF (SELECT count(*) FROM public.inspection_evidence WHERE visibility = 'custody_shared') <> 0 THEN
    RAISE EXCEPTION 'FAIL: dealer A custody_shared evidence is visible to dealer B';
  END IF;
  IF (SELECT count(*) FROM public.repair_items) <> 0 THEN
    RAISE EXCEPTION 'FAIL: dealer B sees repair items it never received';
  END IF;
  RAISE NOTICE 'PASS: dealer B sees nothing of dealer A, including custody_shared (custody_shared never crosses tenants in Phase 1)';
END $$;

ROLLBACK;
