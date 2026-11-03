-- Service receipt remains durable across apply crashes; only fresh per-run rows. Always rolls back.
DO $$ DECLARE run text:=replace(gen_random_uuid()::text,'-','');cid text:='sc-'||run;kid text:='sck-'||run;inst text:='vi-sc-'||run;ep text:='ep-sc-'||run;actor uuid:=gen_random_uuid();q jsonb;e jsonb;r jsonb;raw text;ev uuid;point text;rev int:=0;copy record;passed int:=0;
BEGIN
 INSERT INTO gw_tenant_members(user_id,tenant_id,role) VALUES(actor,'grp-syn-northwind','admin');PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
 INSERT INTO gw_service_stage_gates VALUES(1,true,true,true,true,'rollback-only') ON CONFLICT(id) DO UPDATE SET enabled=true,audience_reviewed=true,threat_reviewed=true,private_transport=true;
 INSERT INTO gw_service_connections(connection_id,app,tenant_id,rooftop_ids,endpoint_ref,network_allowlist,provisioned_by,enabled) VALUES(cid,'autolabels','grp-syn-northwind',ARRAY['rt-syn-nw-01'],'local-test:'||cid,ARRAY['127.0.0.1'::inet],actor,true);
 INSERT INTO gw_service_keys(key_id,connection_id,fingerprint,key_role,directions,event_types,targets,not_before,not_after,rotate_after,budget_per_min) VALUES(kid,cid,repeat('a',64),'event_publisher',ARRAY['event_push'],ARRAY['inventory.updated'],ARRAY['autofilm','autocurb']::gw_app[],clock_timestamp()-interval '1 minute',clock_timestamp()+interval '1 hour',clock_timestamp()+interval '30 minutes',120);
 FOREACH point IN ARRAY ARRAY['before_inbox','after_inbox','after_projection'] LOOP
 rev:=rev+1;ev:=gen_random_uuid();e:=jsonb_build_object('event_id',ev,'schema_version',1,'tenant_id','grp-syn-northwind','rooftop_id','rt-syn-nw-01','source_app','autolabels','event_type','inventory.updated','aggregate',jsonb_build_object('type','vehicle_instance','id',inst,'revision',rev),'vehicle',jsonb_build_object('vin','DEVSYNSC'||upper(substr(run,1,9)),'instance_id',inst,'episode_id',ep),'occurred_at',clock_timestamp(),'emitted_at',clock_timestamp(),'payload',jsonb_build_object('status','active','_synthetic_crash',point));
 q:=jsonb_build_object('protocol','gw.service-staging/1','app','autolabels','direction','event_push','tenant','grp-syn-northwind','rooftop','rt-syn-nw-01','body',e);raw:=q::text;
 r:=gw_service_execute(kid,repeat('a',64),'service-crash-'||run||rev,clock_timestamp(),raw,encode(extensions.digest(raw,'sha256'),'hex'),'127.0.0.1');IF r->>'decision' IS DISTINCT FROM 'accepted' THEN RAISE EXCEPTION 'CRASH_ACCEPT_FAILED';END IF;
 UPDATE gw_queue SET status='leased',leased_by='sc-worker',attempts=1,lease_until=clock_timestamp()+interval '30 seconds' WHERE event_id=ev;
 FOR copy IN SELECT id FROM gw_queue WHERE event_id=ev LOOP
  BEGIN PERFORM gw_apply_internal(copy.id,'sc-worker');RAISE EXCEPTION 'NO_CRASH';EXCEPTION WHEN others THEN IF sqlerrm NOT LIKE 'SYNTHETIC_CRASH:%' THEN RAISE;END IF;END;
 END LOOP;
 IF EXISTS(SELECT 1 FROM gw_inbox WHERE event_id=ev) OR EXISTS(SELECT 1 FROM gw_queue WHERE event_id=ev AND status<>'leased') OR (SELECT count(*) FROM gw_service_receipts WHERE event_id=ev AND decision='accepted')<>1 THEN RAISE EXCEPTION 'CRASH_PARTIAL_ACK';END IF;passed:=passed+1;
 UPDATE gw_queue SET attempts=2 WHERE event_id=ev;
 FOR copy IN SELECT id FROM gw_queue WHERE event_id=ev LOOP IF gw_apply_internal(copy.id,'sc-worker')<>'delivered' THEN RAISE EXCEPTION 'CRASH_RECOVERY';END IF;END LOOP;
 IF (SELECT count(*) FROM gw_inbox WHERE event_id=ev AND result='applied')<>2 OR EXISTS(SELECT 1 FROM gw_projections WHERE aggregate_id=inst AND apply_count<>rev) THEN RAISE EXCEPTION 'CRASH_EXACTLY_ONCE';END IF;passed:=passed+1;
 r:=gw_service_execute(kid,repeat('a',64),'service-after-ack-'||run||rev,clock_timestamp(),raw,encode(extensions.digest(raw,'sha256'),'hex'),'127.0.0.1');IF r->>'decision' IS DISTINCT FROM 'duplicate' OR (SELECT count(*) FROM gw_service_receipts WHERE event_id=ev AND decision='accepted')<>1 THEN RAISE EXCEPTION 'AFTER_ACK_REPLAY';END IF;passed:=passed+1;
 END LOOP;
 RAISE EXCEPTION 'GW_TESTS_PASSED: %',passed;
END $$;