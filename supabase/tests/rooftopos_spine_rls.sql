-- RooftopOS spine: tenant isolation, privilege and constraint checks.
-- Run against a scratch database that has the full migration history applied:
--   psql "$SCRATCH_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/rooftopos_spine_rls.sql
-- Everything runs inside one transaction that is rolled back. Never run this
-- against a production database. It needs a role that can SET ROLE.

BEGIN;

CREATE TEMP TABLE _ids AS SELECT
  gen_random_uuid() AS user_a, gen_random_uuid() AS user_b, gen_random_uuid() AS user_pending,
  gen_random_uuid() AS tenant_a, gen_random_uuid() AS tenant_b;
GRANT SELECT ON _ids TO authenticated, anon, service_role;

INSERT INTO auth.users (id, email) SELECT user_a, 'rls-a@example.test' FROM _ids;
INSERT INTO auth.users (id, email) SELECT user_b, 'rls-b@example.test' FROM _ids;
INSERT INTO auth.users (id, email) SELECT user_pending, 'rls-pending@example.test' FROM _ids;
INSERT INTO public.tenants (id, name, slug) SELECT tenant_a, 'RLS Tenant A', 'rls-a-' || tenant_a FROM _ids;
INSERT INTO public.tenants (id, name, slug) SELECT tenant_b, 'RLS Tenant B', 'rls-b-' || tenant_b FROM _ids;
INSERT INTO public.tenant_members (tenant_id, user_id, role, accepted_at) SELECT tenant_a, user_a, 'owner', now() FROM _ids;
INSERT INTO public.tenant_members (tenant_id, user_id, role, accepted_at) SELECT tenant_b, user_b, 'owner', now() FROM _ids;
INSERT INTO public.tenant_members (tenant_id, user_id, role, accepted_at) SELECT tenant_a, user_pending, 'staff', NULL FROM _ids;

INSERT INTO public.vehicles (vin) VALUES ('1HGCM82633A004352');

INSERT INTO public.vehicle_instances (id, tenant_id, vin) SELECT gen_random_uuid(), tenant_a, '1HGCM82633A004352' FROM _ids;
INSERT INTO public.vehicle_instances (id, tenant_id, vin) SELECT gen_random_uuid(), tenant_b, '1HGCM82633A004352' FROM _ids;

INSERT INTO public.inspection_evidence (tenant_id, instance_id, source_app, source_record_id, source_version)
  SELECT i.tenant_id, i.id, 'autofilm', 'mpi_1', 1 FROM public.vehicle_instances i WHERE i.vin = '1HGCM82633A004352';
INSERT INTO public.repair_items (tenant_id, instance_id, source_app, source_record_id, status, source_version)
  SELECT i.tenant_id, i.id, 'autofilm', 'rep_1', 'recommended', 1 FROM public.vehicle_instances i WHERE i.vin = '1HGCM82633A004352';
INSERT INTO public.acquisition_records (tenant_id, instance_id, channel, appraisal_value, acquisition_cost)
  SELECT i.tenant_id, i.id, 'trade', 17500, 15000 FROM public.vehicle_instances i WHERE i.vin = '1HGCM82633A004352';

INSERT INTO public.integration_connections (id, tenant_id, app, display_name, status)
  SELECT gen_random_uuid(), tenant_a, 'autofilm', 'A film', 'active' FROM _ids;
INSERT INTO public.integration_connections (id, tenant_id, app, display_name, status)
  SELECT gen_random_uuid(), tenant_b, 'autofilm', 'B film', 'active' FROM _ids;
INSERT INTO public.integration_connection_keys (connection_id, key_id, vault_secret_name)
  SELECT id, 'rls_key_' || tenant_id, 'rls_secret_' || tenant_id FROM public.integration_connections WHERE display_name IN ('A film', 'B film');
INSERT INTO public.integration_inbox (connection_id, tenant_id, producer, event_id, event_type, schema_version,
    idempotency_key, payload_checksum, source_record_id, source_version, vin, envelope)
  SELECT c.id, c.tenant_id, 'autofilm', gen_random_uuid(), 'autofilm.inspection.completed', '1.0.0',
    'rls-idem-' || c.tenant_id, 'x', 'mpi_1', 1, '1HGCM82633A004352', '{}'::jsonb
  FROM public.integration_connections c WHERE c.display_name IN ('A film', 'B film');
INSERT INTO public.integration_direction_flags (tenant_id, direction, enabled) SELECT tenant_a, 'film_to_labels', true FROM _ids;
INSERT INTO public.integration_direction_flags (tenant_id, direction, enabled) SELECT tenant_b, 'film_to_labels', false FROM _ids;
INSERT INTO public.vehicle_external_refs (tenant_id, instance_id, app, external_id)
  SELECT i.tenant_id, i.id, 'autolabels', 'listing-' || i.tenant_id FROM public.vehicle_instances i WHERE i.vin = '1HGCM82633A004352';

-- Tenant A sees only tenant A rows, on every client-readable table.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', (SELECT json_build_object('sub', user_a, 'role', 'authenticated')::text FROM _ids), true);
DO $$
DECLARE t text; n int; own int; other int; ta uuid; tb uuid;
BEGIN
  SELECT tenant_a, tenant_b INTO ta, tb FROM _ids;
  FOREACH t IN ARRAY ARRAY['vehicle_instances','vehicle_external_refs','integration_connections','integration_inbox',
    'integration_direction_flags','inspection_evidence','repair_items'] LOOP
    EXECUTE format('SELECT count(*) FROM public.%I WHERE tenant_id = $1', t) INTO own USING ta;
    EXECUTE format('SELECT count(*) FROM public.%I WHERE tenant_id = $1', t) INTO other USING tb;
    IF own <> 1 THEN RAISE EXCEPTION 'FAIL %: tenant A should see its 1 row, saw %', t, own; END IF;
    IF other <> 0 THEN RAISE EXCEPTION 'FAIL %: tenant A read % rows of tenant B', t, other; END IF;
  END LOOP;
  RAISE NOTICE 'PASS: tenant A isolated on 7 tables (VIN-01)';
END $$;

-- Tables with no client grant are unreadable, and no client write is possible anywhere.
DO $$
DECLARE t text; denied boolean;
BEGIN
  FOREACH t IN ARRAY ARRAY['vehicles','acquisition_records','integration_connection_keys','integration_source_versions'] LOOP
    denied := false;
    BEGIN EXECUTE format('SELECT count(*) FROM public.%I', t);
    EXCEPTION WHEN insufficient_privilege THEN denied := true; END;
    IF NOT denied THEN RAISE EXCEPTION 'FAIL %: client read was not denied', t; END IF;
  END LOOP;
  RAISE NOTICE 'PASS: private tables are not client-readable (CURB-01 cost privacy)';

  FOREACH t IN ARRAY ARRAY['vehicle_instances','integration_inbox','integration_direction_flags','inspection_evidence','repair_items','integration_outbox'] LOOP
    denied := false;
    BEGIN EXECUTE format('DELETE FROM public.%I', t);
    EXCEPTION WHEN insufficient_privilege THEN denied := true; END;
    IF NOT denied THEN RAISE EXCEPTION 'FAIL %: client DELETE was not denied', t; END IF;
    denied := false;
    BEGIN EXECUTE format('UPDATE public.%I SET tenant_id = tenant_id', t);
    EXCEPTION WHEN insufficient_privilege THEN denied := true; END;
    IF NOT denied THEN RAISE EXCEPTION 'FAIL %: client UPDATE was not denied', t; END IF;
  END LOOP;
  RAISE NOTICE 'PASS: no client writes (SEC-01)';
END $$;

DO $$
DECLARE denied boolean := false;
BEGIN
  BEGIN PERFORM public.integration_key_secret('rls_key_x');
  EXCEPTION WHEN insufficient_privilege THEN denied := true; END;
  IF NOT denied THEN RAISE EXCEPTION 'FAIL: authenticated can execute integration_key_secret'; END IF;
  denied := false;
  BEGIN PERFORM public.integration_record_source_version(gen_random_uuid(), 'x', 1);
  EXCEPTION WHEN insufficient_privilege THEN denied := true; END;
  IF NOT denied THEN RAISE EXCEPTION 'FAIL: authenticated can execute integration_record_source_version'; END IF;
  RAISE NOTICE 'PASS: secret and watermark functions are service-role only';
END $$;

-- A member who has not accepted the invite sees nothing.
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', (SELECT json_build_object('sub', user_pending, 'role', 'authenticated')::text FROM _ids), true);
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM public.vehicle_instances;
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL: unaccepted member saw % instances', n; END IF;
  RAISE NOTICE 'PASS: unaccepted member sees nothing';
END $$;

-- Tenant B symmetric check.
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', (SELECT json_build_object('sub', user_b, 'role', 'authenticated')::text FROM _ids), true);
DO $$
DECLARE n int; ta uuid;
BEGIN
  SELECT tenant_a INTO ta FROM _ids;
  SELECT count(*) INTO n FROM public.vehicle_instances WHERE tenant_id = ta;
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL: tenant B read % tenant A instances', n; END IF;
  SELECT count(*) INTO n FROM public.vehicle_instances WHERE vin = '1HGCM82633A004352';
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL: tenant B should see exactly its own instance of the shared VIN, saw %', n; END IF;
  RAISE NOTICE 'PASS: tenant B isolated, same VIN independent (VIN-01)';
END $$;

-- Service role and constraints.
RESET ROLE;
SET LOCAL ROLE service_role;
DO $$
DECLARE ta uuid; blocked boolean; inst uuid; n int;
BEGIN
  SELECT tenant_a INTO ta FROM _ids;

  blocked := false;
  BEGIN INSERT INTO public.vehicle_instances (tenant_id, vin) VALUES (ta, '1HGCM82633A004352');
  EXCEPTION WHEN unique_violation THEN blocked := true; END;
  IF NOT blocked THEN RAISE EXCEPTION 'FAIL: second active instance of one VIN in one tenant was allowed'; END IF;

  UPDATE public.vehicle_instances SET status = 'disposed', disposition = 'retail_sale', disposed_at = now()
    WHERE tenant_id = ta AND vin = '1HGCM82633A004352' AND status = 'active';
  INSERT INTO public.vehicle_instances (tenant_id, vin, acquisition_channel) VALUES (ta, '1HGCM82633A004352', 'trade');
  SELECT count(*) INTO n FROM public.vehicle_instances WHERE tenant_id = ta AND vin = '1HGCM82633A004352';
  IF n <> 2 THEN RAISE EXCEPTION 'FAIL: expected 2 custody episodes, found %', n; END IF;
  RAISE NOTICE 'PASS: sell and reacquire gives two episodes (VIN-02)';

  SELECT id INTO inst FROM public.vehicle_instances WHERE tenant_id = ta AND status = 'active' LIMIT 1;
  blocked := false;
  BEGIN INSERT INTO public.repair_items (tenant_id, instance_id, source_app, source_record_id, status, source_version)
    VALUES (ta, inst, 'autofilm', 'rep_unverified', 'completed_verified', 1);
  EXCEPTION WHEN check_violation THEN blocked := true; END;
  IF NOT blocked THEN RAISE EXCEPTION 'FAIL: completed_verified without evidence was stored'; END IF;
  RAISE NOTICE 'PASS: completed_verified requires an evidence reference (FILM-02)';

  blocked := false;
  BEGIN INSERT INTO public.vehicles (vin) VALUES ('1HGCM8263IA004352');
  EXCEPTION WHEN check_violation THEN blocked := true; END;
  IF NOT blocked THEN RAISE EXCEPTION 'FAIL: malformed VIN accepted'; END IF;

  blocked := false;
  BEGIN INSERT INTO public.inspection_evidence (tenant_id, instance_id, source_app, source_record_id, source_version)
    VALUES ((SELECT tenant_b FROM _ids), inst, 'autofilm', 'cross', 1);
  EXCEPTION WHEN foreign_key_violation THEN blocked := true; END;
  IF NOT blocked THEN RAISE EXCEPTION 'FAIL: evidence attached to another tenant''s instance'; END IF;
  RAISE NOTICE 'PASS: constraints hold';

  PERFORM public.integration_record_source_version((SELECT id FROM public.integration_connections LIMIT 1), 'rec', 5);
  PERFORM public.integration_record_source_version((SELECT id FROM public.integration_connections LIMIT 1), 'rec', 3);
  SELECT latest_version INTO n FROM public.integration_source_versions WHERE source_record_id = 'rec';
  IF n <> 5 THEN RAISE EXCEPTION 'FAIL: version watermark moved backwards to %', n; END IF;
  RAISE NOTICE 'PASS: version watermark is monotonic (EVT-02)';
END $$;

ROLLBACK;
