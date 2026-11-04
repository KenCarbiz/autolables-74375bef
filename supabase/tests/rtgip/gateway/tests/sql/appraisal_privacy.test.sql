-- Synthetic owner amount canaries only, per-run aggregates, never print values. Always rolls back.
DO $$ DECLARE actor uuid:=gen_random_uuid();viewer uuid:=gen_random_uuid();run text:=replace(gen_random_uuid()::text,'-','');
 inst text:='vi-privacy-'||run;ep text:='ep-privacy-'||run;vin text:='DEVSYNPR'||upper(substr(run,1,9));
 env jsonb;result jsonb;payload jsonb;f text;k text;n int;passed int:=0;event uuid:=gen_random_uuid();
BEGIN
 INSERT INTO gw_tenant_members(user_id,tenant_id,role)VALUES(actor,'grp-syn-northwind','admin'),(viewer,'grp-syn-northwind','viewer');
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
 payload:=jsonb_build_object('acv_value',101,'acv_cents',102,'offered_price',103,'finance_amount',104,'nested',jsonb_build_object('acv_value',105,'acv_cents',106,'offered_price',107,'finance_amount',108));
 env:=jsonb_build_object('event_id',event,'schema_version',1,'tenant_id','grp-syn-northwind','rooftop_id','rt-syn-nw-01','source_app','autocurb','event_type','appraisal.completed','occurred_at',clock_timestamp(),'emitted_at',clock_timestamp(),'vehicle',jsonb_build_object('vin',vin,'instance_id',inst,'episode_id',ep),'aggregate',jsonb_build_object('type','vehicle_instance','id',inst,'revision',1),'payload',payload);
 result:=gw_publish(env);IF result->>'status' IS DISTINCT FROM 'accepted' THEN RAISE EXCEPTION 'PRIVACY_SETUP_FAILED';END IF;
 FOR n IN 1..5 LOOP PERFORM gw_worker_step('privacy',100,50);END LOOP;
 SELECT state->'appraisal' INTO result FROM gw_projections WHERE tenant_id='grp-syn-northwind' AND target_app='autofilm' AND aggregate_id=inst;
 FOREACH f IN ARRAY ARRAY['acv_value','acv_cents','offered_price','finance_amount'] LOOP IF result IS NULL OR result::text LIKE '%'||f||'%' THEN RAISE EXCEPTION 'PROJECTION_PROTECTED_FIELD';END IF;passed:=passed+1;END LOOP;
 -- Simulate an old contaminated projection on only this fresh fixture: reads must remain safe before cleanup.
 UPDATE gw_projections SET state=state||jsonb_build_object('appraisal',payload||jsonb_build_object('source','autocurb','rev',1)) WHERE tenant_id='grp-syn-northwind' AND aggregate_id=inst;
 INSERT INTO gw_read_grants(key_id,read_model,sections,purposes,budget_per_min,max_limit,ttl_s,not_after)VALUES('frame-nw-r1','vehicle_360',ARRAY['acquisition'],ARRAY['privacy_test'],100,10,15,clock_timestamp()+interval '1 hour');
 -- A temporary actual Frame-target projection tests a valid Frame legacy read grant; no fake delivered receipt.
 INSERT INTO gw_projections(tenant_id,target_app,aggregate_type,aggregate_id,vin,state,source_revisions,apply_count)VALUES('grp-syn-northwind','autoframe','vehicle_instance',inst,vin,jsonb_build_object('appraisal',payload),'{}',0);
 FOREACH k IN ARRAY ARRAY['film-nw-r1','frame-nw-r1'] LOOP
 result:=gw_read_fetch(k,'privacy-read-'||run||replace(k,'-',''),clock_timestamp(),'grp-syn-northwind','rt-syn-nw-01',CASE WHEN k='film-nw-r1' THEN 'service_lane' ELSE 'privacy_test' END,vin,10);
 IF result->>'decision' IS DISTINCT FROM 'ok' THEN RAISE EXCEPTION 'VALID_GRANT_DENIED: %',result->>'reason';END IF;
 FOREACH f IN ARRAY ARRAY['acv_value','acv_cents','offered_price','finance_amount'] LOOP
 IF result::text LIKE '%'||f||'%' THEN RAISE EXCEPTION 'SQL_READ_PROTECTED_FIELD';END IF;passed:=passed+1;
 END LOOP;
 IF k='film-nw-r1' AND result->'items'->0->'sections'->'appraisal'->>'audit_ref' IS DISTINCT FROM event::text THEN RAISE EXCEPTION 'SAFE_AUDIT_REF_MISSING';END IF;
 IF k='frame-nw-r1' AND (result->'items'->0->'sections'->'appraisal'->>'appraisal_completed')::boolean IS DISTINCT FROM false THEN RAISE EXCEPTION 'UNDELIVERED_FRAME_FACT_FABRICATED';END IF;passed:=passed+1;
 END LOOP;
 FOREACH k IN ARRAY ARRAY['film-nw-x1','frame-nw-x1'] LOOP
 result:=gw_read_exchange(k,'privacy-ex-'||run||replace(k,'-',''),clock_timestamp(),'grp-syn-northwind','rt-syn-nw-01','autocurb','acquisition_context',jsonb_build_array(jsonb_build_object('vin',vin,'instance_id',inst)));
 IF result->>'decision' IS DISTINCT FROM 'ok' THEN RAISE EXCEPTION 'EXCHANGE_VALID_GRANT_DENIED';END IF;
 FOREACH f IN ARRAY ARRAY['acv_value','acv_cents','offered_price','finance_amount'] LOOP IF result::text LIKE '%'||f||'%' THEN RAISE EXCEPTION 'EXCHANGE_PROTECTED_FIELD';END IF;passed:=passed+1;END LOOP;
 END LOOP;
 EXECUTE 'SET LOCAL ROLE authenticated';
 BEGIN PERFORM envelope FROM gw_outbox WHERE event_id=event;RAISE EXCEPTION 'RAW_OUTBOX_READABLE';EXCEPTION WHEN insufficient_privilege THEN passed:=passed+1;END;
 BEGIN PERFORM state FROM gw_projections WHERE aggregate_id=inst;RAISE EXCEPTION 'RAW_STATE_READABLE';EXCEPTION WHEN insufficient_privilege THEN passed:=passed+1;END;
 BEGIN PERFORM report FROM gw_recovery_forensic_reports LIMIT 1;RAISE EXCEPTION 'RAW_FORENSICS_READABLE';EXCEPTION WHEN insufficient_privilege THEN passed:=passed+1;END;
 PERFORM event_id FROM gw_outbox WHERE event_id=event;passed:=passed+1;
 result:=gw_privileged_audit('grp-syn-northwind','outbox',event::text,'','case-synthetic');IF result->>'decision' IS DISTINCT FROM 'denied' THEN RAISE EXCEPTION 'PURPOSE_REQUIRED';END IF;passed:=passed+1;
 result:=gw_privileged_audit('grp-syn-lakeshore','outbox',event::text,'source_authority_audit','case-synthetic');IF result->>'decision' IS DISTINCT FROM 'denied' THEN RAISE EXCEPTION 'AUDIT_CROSS_TENANT';END IF;passed:=passed+1;
 result:=gw_privileged_audit('grp-syn-northwind','outbox',event::text,'source_authority_audit','case-synthetic');IF result->>'decision' IS DISTINCT FROM 'ok' OR result->'data'->'payload' IS DISTINCT FROM payload THEN RAISE EXCEPTION 'PRIVILEGED_ORIGINAL_CHANGED';END IF;passed:=passed+1;
 EXECUTE 'RESET ROLE';
 SELECT count(*) INTO n FROM gw_audit_log WHERE action='privileged_raw_audit' AND detail->>'resource_id'=event::text AND detail->>'purpose'='source_authority_audit';IF n<>1 THEN RAISE EXCEPTION 'AUDIT_RECORD_MISSING';END IF;passed:=passed+1;
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',viewer,'role','authenticated')::text,true);
 result:=gw_privileged_audit('grp-syn-northwind','outbox',event::text,'source_authority_audit','case-synthetic');IF result->>'decision' IS DISTINCT FROM 'denied' THEN RAISE EXCEPTION 'VIEWER_RAW_AUDIT';END IF;passed:=passed+1;
 RAISE EXCEPTION 'GW_TESTS_PASSED: %',passed;
END $$;