-- Only per-run fixtures; success sentinel always rolls back. No values in output.
DO $$ DECLARE actor uuid:=gen_random_uuid();run text:=replace(gen_random_uuid()::text,'-','');inst text:='vi-privacy-merge-'||run;ep text:='ep-privacy-merge-'||run;
 env jsonb;j jsonb;n int;f text;passed int:=0;
BEGIN
 INSERT INTO gw_tenant_members(user_id,tenant_id,role)VALUES(actor,'grp-syn-northwind','admin');
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
 env:=jsonb_build_object('event_id',gen_random_uuid(),'schema_version',1,'tenant_id','grp-syn-northwind','rooftop_id','rt-syn-nw-01','source_app','autocurb','event_type','appraisal.completed','occurred_at',clock_timestamp(),'emitted_at',clock_timestamp(),'vehicle',jsonb_build_object('vin','DEVSYNPR'||upper(substr(run,1,9)),'instance_id',inst,'episode_id',ep),'aggregate',jsonb_build_object('type','vehicle_instance','id',inst,'revision',1),'payload','{}'::jsonb);
 j:=gw_publish(env);FOR n IN 1..4 LOOP PERFORM gw_worker_step('privacy-merge',100,50);END LOOP;
 UPDATE gw_projections SET state=state||jsonb_build_object('appraisal',jsonb_build_object('source','autocurb','rev',1,'acv_value',101,'acv_cents',102,'offered_price',103,'finance_amount',104,'nested',jsonb_build_object('acv_value',105))) WHERE aggregate_id=inst AND tenant_id='grp-syn-northwind';
 j:=gw_publish(env||jsonb_build_object('event_id',gen_random_uuid(),'aggregate',jsonb_build_object('type','vehicle_instance','id',inst,'revision',2),'payload',jsonb_build_object('acv_value',101,'acv_cents',102,'offered_price',103,'finance_amount',104)));
 IF j->>'status' IS DISTINCT FROM 'accepted' THEN RAISE EXCEPTION 'MERGE_SETUP_FAILED';END IF;
 FOR n IN 1..4 LOOP PERFORM gw_worker_step('privacy-merge',100,50);END LOOP;
 SELECT state->'appraisal' INTO j FROM gw_projections WHERE tenant_id='grp-syn-northwind' AND aggregate_id=inst AND target_app='autofilm';
 FOREACH f IN ARRAY ARRAY['acv_value','acv_cents','offered_price','finance_amount'] LOOP IF j IS NULL OR j::text LIKE '%'||f||'%' THEN RAISE EXCEPTION 'OLD_APPRAISAL_MERGE_RETAINED_AMOUNT';END IF;passed:=passed+1;END LOOP;
 IF (j->>'appraisal_completed')::boolean IS DISTINCT FROM true OR j->>'audit_ref' IS NULL OR j->>'completed_at' IS NULL THEN RAISE EXCEPTION 'SAFE_FACTS_MISSING';END IF;passed:=passed+1;
 RAISE EXCEPTION 'GW_TESTS_PASSED: %',passed;
END $$;