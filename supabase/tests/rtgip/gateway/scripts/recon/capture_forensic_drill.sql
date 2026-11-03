-- Privileged synthetic Gateway DEV session only. All test tenants/actors/events roll back.
-- Only the immutable gw_recovery_forensic_reports row commits. No shared aggregate is changed.
-- Before running: set_config('gw.forensic_source_sha', verified checkout HEAD, false) through the privileged tool.
-- This is caller-attested checkout provenance, not independently established by PostgreSQL.
DO $$
DECLARE
  run_id uuid := gen_random_uuid();
  execution_sha text := current_setting('gw.forensic_source_sha', true);
  tenant text := 'grp-syn-forensic-' || run_id;
  roof text := 'rt-syn-forensic-' || run_id;
  actor_id uuid := gen_random_uuid(); ident uuid;
  aggregates text[] := ARRAY['vi-forensic-' || run_id || '-a', 'vi-forensic-' || run_id || '-b'];
  original_claims text := current_setting('request.jwt.claims', true);
  before_snapshot jsonb; missing_snapshot jsonb; partial_snapshot jsonb; restored_snapshot jsonb;
  pending_snapshot jsonb; missing_reconcile jsonb; r jsonb; report jsonb; resolutions jsonb; env jsonb; payload jsonb;
  app text; event_type text; i int; step int; qid bigint; flags int; checked int := 0;
BEGIN
  IF execution_sha IS NULL OR execution_sha !~ '^[0-9a-f]{40}$' THEN
    RAISE EXCEPTION 'required verified Gateway checkout SHA missing'; END IF;
  IF NOT EXISTS (SELECT 1 FROM gw_settings WHERE id = 1 AND environment = 'DEV' AND NOT external_delivery_enabled AND NOT global_kill)
    THEN RAISE EXCEPTION 'drill requires isolated DEV, external OFF, kill OFF'; END IF;
  IF has_table_privilege('authenticated', 'public.gw_recovery_forensic_reports', 'INSERT')
     OR has_function_privilege('authenticated', 'public.gw_recovery_snapshot(text,text[])', 'EXECUTE')
    THEN RAISE EXCEPTION 'forensic privilege boundary failed'; END IF;
  BEGIN
    INSERT INTO gw_tenants(id,name) VALUES (tenant, 'Forensic drill SYNTHETIC');
    INSERT INTO gw_rooftops(id,tenant_id,name,city,state) VALUES (roof,tenant,'Forensic SYNTHETIC','Synthetic','XX');
    INSERT INTO gw_tenant_members(user_id,tenant_id,role) VALUES (actor_id,tenant,'admin');
    PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',actor_id,'role','authenticated')::text,true);
    FOR i IN 1..2 LOOP
      INSERT INTO gw_vehicle_identities(tenant_id,vin) VALUES (tenant,'DEVSYN0000000080' || i) RETURNING id INTO ident;
      INSERT INTO gw_vehicle_instances(id,tenant_id,rooftop_id,identity_id) VALUES (aggregates[i],tenant,roof,ident);
      INSERT INTO gw_listing_episodes(id,tenant_id,instance_id) VALUES ('ep-' || aggregates[i],tenant,aggregates[i]);
      FOREACH app IN ARRAY ARRAY['autolabels','autofilm','autocurb','autoframe'] LOOP
        event_type := CASE app WHEN 'autolabels' THEN 'inventory.updated' WHEN 'autofilm' THEN 'video.engagement'
          WHEN 'autocurb' THEN 'appraisal.completed' ELSE 'media.approved' END;
        payload := CASE app WHEN 'autolabels' THEN '{"status":"active","mileage":100}'::jsonb
          WHEN 'autofilm' THEN '{"views":1,"watch_seconds":3}'::jsonb
          WHEN 'autocurb' THEN '{"value_band":"B"}'::jsonb ELSE jsonb_build_object(
            'media_id','med-forensic-' || i,'content_sha256',repeat('a',64),'object_ref','objref:dev-synthetic-media/forensic.jpg',
            'mime','image/jpeg','width',1920,'height',1080,'preset_version','dev-1','preset_order',i,
            'approval',jsonb_build_object('role','inventory_manager','approval_id','apr-forensic-' || i,'approved_at',clock_timestamp())) END;
        env := jsonb_build_object('event_id',gen_random_uuid(),'schema_version',1,'tenant_id',tenant,'rooftop_id',roof,
          'vehicle',jsonb_build_object('vin','DEVSYN0000000080' || i,'instance_id',aggregates[i],'episode_id','ep-' || aggregates[i]),
          'source_app',app,'event_type',event_type,'aggregate',jsonb_build_object('type','vehicle_instance','id',aggregates[i],'revision',100),
          'correlation_id',run_id,'occurred_at',clock_timestamp(),'emitted_at',clock_timestamp(),'payload',payload);
        r := gw_publish(env);
        IF r->>'status' <> 'accepted' OR (r->>'fanout')::int <> 2 THEN RAISE EXCEPTION 'fixture rejected %',r; END IF;
      END LOOP;
    END LOOP;
    pending_snapshot := gw_recovery_snapshot(tenant,aggregates);
    IF (pending_snapshot->>'projection_behind_delivered')::int <> 0 OR (pending_snapshot->>'source_events')::int <> 8
      THEN RAISE EXCEPTION 'pending events incorrectly classified as delivered-projection failures'; END IF;
    checked := checked + 1;
    FOR step IN 1..4 LOOP
      FOR qid IN SELECT gw_claim('forensic-worker',100,30,100) LOOP
        IF gw_ack(qid,'forensic-worker') <> 'delivered' THEN RAISE EXCEPTION 'fixture delivery failed'; END IF;
      END LOOP;
    END LOOP;
    before_snapshot := gw_recovery_snapshot(tenant,aggregates);
    IF (before_snapshot->>'route_copies')::int <> 16 OR (before_snapshot->>'projection_behind_delivered')::int <> 0
      OR jsonb_array_length(before_snapshot->'groups') <> 16 THEN RAISE EXCEPTION 'baseline not complete'; END IF;
    checked := checked + 1;
    BEGIN
      -- Controlled corruption is confined to this new tenant. Capture before any recovery/rollback.
      DELETE FROM gw_source_revisions WHERE tenant_id = tenant AND aggregate_id = ANY(aggregates);
      DELETE FROM gw_projections WHERE tenant_id = tenant AND aggregate_id = ANY(aggregates);
      missing_snapshot := gw_recovery_snapshot(tenant,aggregates);
      r := gw_reconcile(tenant);
      missing_reconcile := r;
      flags := (r->>'projection_behind_delivered')::int;
      IF flags <> 16 OR (missing_snapshot->>'projection_behind_delivered')::int <> 16
        OR (SELECT mismatches FROM gw_reconciliation_runs WHERE tenant_id = tenant ORDER BY id DESC LIMIT 1) <> 16
        THEN RAISE EXCEPTION 'exact 16 mismatch detector failed %',r; END IF;
      IF (SELECT count(DISTINCT g->>'route_id') FROM jsonb_array_elements(missing_snapshot->'groups') g) <> 8
        OR (SELECT count(DISTINCT g->>'aggregate_id') FROM jsonb_array_elements(missing_snapshot->'groups') g) <> 2
        THEN RAISE EXCEPTION '8 routes / 2 aggregates not captured'; END IF;
      checked := checked + 1;
      -- Historical-shape partial recreation: low revision inventory cannot erase delivered maximum 100.
      FOR i IN 1..2 LOOP
        r := gw_publish(jsonb_build_object('event_id',gen_random_uuid(),'schema_version',1,'tenant_id',tenant,'rooftop_id',roof,
          'vehicle',jsonb_build_object('vin','DEVSYN0000000080' || i,'instance_id',aggregates[i],'episode_id','ep-' || aggregates[i]),
          'source_app','autolabels','event_type','inventory.updated','aggregate',jsonb_build_object('type','vehicle_instance','id',aggregates[i],'revision',1),
          'occurred_at',clock_timestamp(),'emitted_at',clock_timestamp(),'payload',jsonb_build_object('mileage',1)));
        IF r->>'status' <> 'accepted' THEN RAISE EXCEPTION 'partial recreation rejected %',r; END IF;
      END LOOP;
      FOR qid IN SELECT gw_claim('forensic-partial',100,30,100) LOOP
        IF gw_ack(qid,'forensic-partial') <> 'delivered' THEN RAISE EXCEPTION 'partial recreation failed'; END IF;
      END LOOP;
      partial_snapshot := gw_recovery_snapshot(tenant,aggregates);
      IF (partial_snapshot->>'projection_behind_delivered')::int <> 16 THEN RAISE EXCEPTION 'low revision hid corruption'; END IF;
      checked := checked + 1;
      RAISE EXCEPTION 'FORENSIC_CORRUPTION_ROLLBACK';
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM <> 'FORENSIC_CORRUPTION_ROLLBACK' THEN RAISE; END IF;
    END;
    restored_snapshot := gw_recovery_snapshot(tenant,aggregates);
    IF (restored_snapshot->>'projection_behind_delivered')::int <> 0
      OR before_snapshot->'originals' IS DISTINCT FROM restored_snapshot->'originals'
      THEN RAISE EXCEPTION 'original outbox/inbox/evidence/ACK/projection changed or event lost'; END IF;
    checked := checked + 1;
    SELECT jsonb_agg(jsonb_build_object(
      'event_id',b->>'event_id','route_id',b->>'route_id','aggregate_id',b->>'aggregate_id',
      'expected_revision',b->'expected_revision','before_revision',b->'actual_revision',
      'missing_revision',m->'actual_revision','partial_revision',p->'actual_revision','restored_revision',a->'actual_revision',
      'inbox_result',b->>'inbox_result','inbox_applied_at',b->'inbox_applied_at','ack_at',b->'ack_at',
      'applied_evidence_exists',b->'applied_evidence_exists','receipt_wrong',false,
      'vanished_because','controlled corruption subtransaction rolled back; original projection restored, not replayed',
      'historical_original',false) ORDER BY b->>'aggregate_id',b->>'route_id') INTO resolutions
    FROM jsonb_array_elements(before_snapshot->'groups') b
    JOIN jsonb_array_elements(missing_snapshot->'groups') m ON m->>'event_id'=b->>'event_id' AND m->>'route_id'=b->>'route_id'
    JOIN jsonb_array_elements(partial_snapshot->'groups') p ON p->>'event_id'=b->>'event_id' AND p->>'route_id'=b->>'route_id'
    JOIN jsonb_array_elements(restored_snapshot->'groups') a ON a->>'event_id'=b->>'event_id' AND a->>'route_id'=b->>'route_id';
    IF jsonb_array_length(resolutions) <> 16 OR EXISTS (SELECT 1 FROM jsonb_array_elements(before_snapshot->'groups') g
      WHERE g->>'inbox_result' IS DISTINCT FROM 'applied' OR NOT (g->>'applied_evidence_exists')::boolean
        OR (g->>'actual_revision')::int <> 100) THEN RAISE EXCEPTION 'receipt evidence incomplete'; END IF;
    checked := checked + 1;
    RAISE EXCEPTION 'FORENSIC_FIXTURE_ROLLBACK';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'FORENSIC_FIXTURE_ROLLBACK' THEN RAISE; END IF;
  END;
  PERFORM set_config('request.jwt.claims',coalesce(original_claims,''),true);
  IF EXISTS (SELECT 1 FROM gw_tenants WHERE id = tenant) OR EXISTS (SELECT 1 FROM gw_tenant_members WHERE user_id = actor_id)
    OR EXISTS (SELECT 1 FROM gw_outbox WHERE tenant_id = tenant) THEN RAISE EXCEPTION 'fixture escaped rollback'; END IF;
  checked := checked + 1;
  report := jsonb_build_object('version',1,'run_id',run_id,'source_sha',execution_sha,
    'source_sha_scope','caller-attested checkout HEAD plus working changes; function fingerprints identify executed DB code',
    'recorded_at',clock_timestamp(),'kind','controlled-isolated-reproduction','historical_original_ids_verified',false,
    'historical_claim_status','UNVERIFIED: original 16 rows and D1-time revisions were never preserved',
    'checks_passed',checked,'synthetic_source_events',8,'delivered_copies',16,'reproduced_discrepancies',16,
    'lost_fixture_events',0,'fixture_rolled_back',true,'pending',pending_snapshot,'before',before_snapshot,
    'missing',missing_snapshot,'missing_reconcile',missing_reconcile,'partial_recreation',partial_snapshot,'restored',restored_snapshot,'resolutions',resolutions,
    'function_hashes',jsonb_build_object('gw_reconcile',md5(pg_get_functiondef('public.gw_reconcile(text)'::regprocedure)),
      'gw_apply_internal',md5(pg_get_functiondef('public.gw_apply_internal(bigint,text)'::regprocedure)),
      'gw_recovery_snapshot',md5(pg_get_functiondef('public.gw_recovery_snapshot(text,text[])'::regprocedure)),
      'gw_publish',md5(pg_get_functiondef('public.gw_publish(jsonb)'::regprocedure)),
      'gw_publish_internal',md5(pg_get_functiondef('public.gw_publish_internal(jsonb,uuid)'::regprocedure)),
      'gw_publish_core',md5(pg_get_functiondef('public.gw_publish_core(jsonb,uuid)'::regprocedure)),
      'gw_claim',md5(pg_get_functiondef('public.gw_claim(text,integer,integer,integer)'::regprocedure)),
      'gw_claim_internal',md5(pg_get_functiondef('public.gw_claim_internal(text,text[],integer,integer,integer)'::regprocedure)),
      'gw_ack',md5(pg_get_functiondef('public.gw_ack(bigint,text)'::regprocedure))));
  INSERT INTO gw_recovery_forensic_reports(id,tenant_id,source_sha,report,report_sha256)
    VALUES (run_id,'grp-syn-northwind',execution_sha,report,
      encode(extensions.digest(report::text,'sha256'),'hex'));
END $$;