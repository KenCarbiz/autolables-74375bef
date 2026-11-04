-- Phase3D: 12 positive fact reads + 12 negative access cases; isolated fresh aggregates. Always rolls back.
DO $$
<<read_exchange_test>>
DECLARE actor_id uuid:=gen_random_uuid(); run text:=replace(gen_random_uuid()::text,'-','');
 inst text:='vi-exchange-'||run; epi text:='ep-exchange-'||run; vin text:='DEVSYNEX'||upper(substr(run,1,9));
 base jsonb; payload jsonb; result jsonb; p record; i integer; passed integer:=0; key_id text; ident uuid;
BEGIN
 IF (SELECT count(*) FROM gw_read_exchange_policy)<>12 OR EXISTS(SELECT 1 FROM gw_read_exchange_policy WHERE source_app=consumer_app)
 THEN RAISE EXCEPTION 'matrix must contain 12 directed pairs';END IF;
 INSERT INTO gw_tenant_members(user_id,tenant_id,role) VALUES(actor_id,'grp-syn-northwind','admin');
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',actor_id,'role','authenticated')::text,true);
 INSERT INTO gw_vehicle_identities(tenant_id,vin) VALUES('grp-syn-northwind',vin) ON CONFLICT DO NOTHING;
 SELECT v.id INTO ident FROM gw_vehicle_identities v WHERE v.tenant_id='grp-syn-northwind' AND v.vin=read_exchange_test.vin;
 INSERT INTO gw_vehicle_instances(id,tenant_id,rooftop_id,identity_id) VALUES(inst,'grp-syn-northwind','rt-syn-nw-01',ident);
 INSERT INTO gw_listing_episodes(id,tenant_id,instance_id) VALUES(epi,'grp-syn-northwind',inst);
 base:=jsonb_build_object('schema_version',1,'tenant_id','grp-syn-northwind','rooftop_id','rt-syn-nw-01',
  'vehicle',jsonb_build_object('vin',vin,'instance_id',inst,'episode_id',epi),'occurred_at',clock_timestamp(),'emitted_at',clock_timestamp(),
  'aggregate',jsonb_build_object('type','vehicle_instance','id',inst,'revision',1));
 FOR p IN SELECT DISTINCT source_app FROM gw_read_exchange_policy LOOP
  payload:=CASE p.source_app WHEN 'autolabels' THEN '{"status":"active","price_cents":2400000,"mileage":100}'::jsonb
   WHEN 'autofilm' THEN jsonb_build_object('technician_verified',true,'reviewer_role','quality_reviewer','reviewer_approved_at',clock_timestamp(),'mpi_id','mpi-exchange')
   WHEN 'autocurb' THEN '{"finalized_at":"2026-11-02T01:00:00Z","appraisal_cents":1500000}'::jsonb
   ELSE jsonb_build_object('media_id','med-exchange','content_sha256',repeat('a',64),'object_ref','objref:dev-synthetic-media/exchange.jpg',
    'mime','image/jpeg','width',1920,'height',1080,'preset_version','dev-1','preset_order',0,
    'approval',jsonb_build_object('role','inventory_manager','approval_id','apr-exchange','approved_at',clock_timestamp())) END;
  result:=gw_publish(base||jsonb_build_object('event_id',gen_random_uuid(),'source_app',p.source_app,'event_type',
   CASE p.source_app WHEN 'autolabels' THEN 'inventory.updated' WHEN 'autofilm' THEN 'service.mpi_verified' WHEN 'autocurb' THEN 'appraisal.completed' ELSE 'media.approved' END,
   'payload',payload)||CASE WHEN p.source_app='autofilm' THEN jsonb_build_object('refs',jsonb_build_object('service_visit_ref','visit-exchange','evidence_refs',jsonb_build_array('ev-exchange'))) ELSE '{}' END);
  IF result->>'status' IS DISTINCT FROM 'accepted' THEN RAISE EXCEPTION 'setup publish %',result;END IF;
 END LOOP;
 FOR i IN 1..5 LOOP PERFORM gw_worker_step('exchange-test',100,50);END LOOP;
 FOR p IN SELECT * FROM gw_read_exchange_policy ORDER BY source_app,consumer_app LOOP
  key_id:=replace(p.consumer_app::text,'auto','')||'-nw-x1';
  result:=gw_read_exchange(key_id,'positive-'||run||passed,clock_timestamp(),'grp-syn-northwind','rt-syn-nw-01',p.source_app,p.purpose,
    jsonb_build_array(jsonb_build_object('vin',vin,'instance_id',inst)));
  IF result->>'decision' IS DISTINCT FROM 'ok' OR jsonb_array_length(result->'items') IS DISTINCT FROM 1
    OR (result->'items'->0->'freshness'->>'stale')::boolean IS DISTINCT FROM false THEN RAISE EXCEPTION 'positive % %',p,result;END IF;
  IF result::text LIKE '%1500000%' OR result::text LIKE '%appraisal_cents%' OR result::text LIKE '%contact_ref%' THEN RAISE EXCEPTION 'finance/CRM leak';END IF;
  IF p.source_app='autofilm' AND result->'items'->0->'facts' ? 'listing' THEN RAISE EXCEPTION 'Film price ownership leak';END IF;
  IF p.source_app='autolabels' AND (result->'items'->0->'facts'->'listing'->>'price_cents')::int IS DISTINCT FROM 2400000 THEN RAISE EXCEPTION 'canonical price missing';END IF;
  IF p.source_app='autofilm' AND result->'items'->0->'facts'->'service'->'mpi'->>'mpi_id' IS DISTINCT FROM 'mpi-exchange' THEN RAISE EXCEPTION 'verified MPI missing';END IF;
  IF p.source_app='autoframe' AND result->'items'->0->'facts'->'media'->0->>'object_ref' IS DISTINCT FROM 'objref:dev-synthetic-media/exchange.jpg' THEN RAISE EXCEPTION 'approved metadata missing';END IF;
  IF p.source_app='autocurb' AND ((result->'items'->0->'facts'->'acquisition'->>'appraisal_completed')::boolean IS DISTINCT FROM true OR result->'items'->0->'facts'->'acquisition' ? 'acquired' OR result->'items'->0->'facts'->'acquisition'->>'audit_ref' IS NULL OR result->'items'->0->'facts'->'acquisition'->>'completed_at' IS NULL) THEN RAISE EXCEPTION 'appraisal minimal fact contract';END IF;
  passed:=passed+1;
  result:=gw_read_exchange(key_id,'negative-'||run||passed,clock_timestamp(),'grp-syn-lakeshore','rt-syn-ls-01',p.source_app,p.purpose,
    jsonb_build_array(jsonb_build_object('vin',vin,'instance_id',inst)));
  IF (result->>'http_status')::integer IS DISTINCT FROM 403 OR result ? 'items' THEN RAISE EXCEPTION 'negative % %',p,result;END IF;
  passed:=passed+1;
 END LOOP;
 IF has_function_privilege('authenticated','public.gw_read_exchange(text,text,timestamptz,text,text,public.gw_app,text,jsonb)','execute')
  OR has_table_privilege('authenticated','public.gw_read_exchange_grants','insert') THEN RAISE EXCEPTION 'privilege escalation';END IF;
 passed:=passed+1;
 result:=gw_dev_ingest('film-nw-x1','read-only-'||run,clock_timestamp(),repeat('0',64),base||jsonb_build_object('event_id',gen_random_uuid(),'source_app','autofilm','event_type','service.mpi_verified','payload','{}'::jsonb));
 IF result->>'reason' IS DISTINCT FROM 'read-only identity cannot ingest' THEN RAISE EXCEPTION 'read key writes %',result;END IF;passed:=passed+1;
 result:=gw_read_exchange('film-nw-x1','bad-purpose-'||run,clock_timestamp(),'grp-syn-northwind','rt-syn-nw-01','autolabels','finance',jsonb_build_array(jsonb_build_object('vin',vin)));
 IF (result->>'http_status')::integer IS DISTINCT FROM 403 THEN RAISE EXCEPTION 'purpose escape';END IF;passed:=passed+1;
 RAISE EXCEPTION 'GW_TESTS_PASSED: %',passed;
END $$;