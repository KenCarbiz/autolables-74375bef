-- Phase4 local consumer contract; never canonical or physical staging. Fresh UUID keys, no shared projection writes.
-- All fixture changes roll back when the sentinel is raised. Do not swallow a different exception.
DO $$
DECLARE actor uuid; run text:=replace(gen_random_uuid()::text,'-',''); reg gw_extension_registry;
 vi uuid; syn_vin text:='DEVSYN00000000401'; inst text:='syn-p4-'||run; ep text:='syn-p4-ep-'||run;
 prior_inst text:='syn-p4-prior-'||run; prior_ep text:='syn-p4-prior-ep-'||run;
 k text; reader text; acl text; d jsonb; bad jsonb; f jsonb; raw text; h text; r jsonb; rr jsonb; n int; passed int:=0; x text;
BEGIN
 SELECT m.user_id INTO actor FROM gw_tenant_members m JOIN auth.users u ON u.id=m.user_id WHERE m.tenant_id='grp-syn-northwind' AND m.role='admin' AND u.email_confirmed_at IS NOT NULL AND NOT coalesce(u.is_anonymous,false) LIMIT 1;
 IF actor IS NULL THEN RAISE EXCEPTION 'VERIFIED_OWNER_REQUIRED';END IF;
 IF (SELECT count(*) FROM gw_routes)<>8 OR (SELECT count(*) FROM gw_extension_registry WHERE NOT enabled)<>4 OR gw_extension_delivery()->>'decision'<>'disabled' THEN RAISE EXCEPTION 'P4 catalog/off invariant';END IF;passed:=passed+1;
 IF has_table_privilege('authenticated','gw_extension_state','SELECT') OR has_table_privilege('authenticated','gw_extension_keys','INSERT') OR has_table_privilege('anon','gw_extension_registry','SELECT') OR has_function_privilege('authenticated','gw_extension_apply_local(text,jsonb,text,text,timestamptz)','EXECUTE') OR has_function_privilege('authenticated','gw_extension_read_local(text,text,text,text,text,text,text)','EXECUTE') THEN RAISE EXCEPTION 'P4 browser privilege';END IF;passed:=passed+1;
 INSERT INTO gw_vehicle_identities(tenant_id,vin) VALUES('grp-syn-northwind',syn_vin) ON CONFLICT(tenant_id,vin) DO NOTHING;
 SELECT id INTO vi FROM gw_vehicle_identities WHERE tenant_id='grp-syn-northwind' AND vin=syn_vin;
 INSERT INTO gw_vehicle_instances(id,tenant_id,rooftop_id,identity_id) VALUES(inst,'grp-syn-northwind','rt-syn-nw-01',vi),(prior_inst,'grp-syn-northwind','rt-syn-nw-01',vi);
 INSERT INTO gw_listing_episodes(id,tenant_id,instance_id) VALUES(ep,'grp-syn-northwind',inst),(prior_ep,'grp-syn-northwind',prior_inst);
 INSERT INTO gw_extension_custody(tenant_id,rooftop_id,instance_id,vin,episode_id,status,prior_instance_id,prior_episode_id,evidence_ref) VALUES('grp-syn-northwind','rt-syn-nw-01',inst,syn_vin,ep,'active',prior_inst,prior_ep,'syn-audited-custody');
 FOR reg IN SELECT * FROM gw_extension_registry ORDER BY id LOOP
  k:='syn-p4-k-'||reg.id||run;reader:='syn-p4-reader-'||reg.id||run;acl:='syn-p4-acl-'||replace(reg.id,'->','-')||run;
  INSERT INTO gw_extension_keys(key_id,extension_id,tenant_id,rooftop_id,source_app,fingerprint,provisioned_by,not_before,not_after) VALUES(k,reg.id,'grp-syn-northwind','rt-syn-nw-01',reg.source_app,repeat('a',64),actor,clock_timestamp()-interval '1 minute',clock_timestamp()+interval '1 hour');
  INSERT INTO gw_extension_readers(key_id,extension_id,app,tenant_id,rooftop_id,provisioned_by,not_before,not_after) VALUES(reader,reg.id,reg.target_app,'grp-syn-northwind','rt-syn-nw-01',actor,clock_timestamp()-interval '1 minute',clock_timestamp()+interval '1 hour');
  f:=CASE reg.id WHEN 'labels->frame' THEN '{"status":"active"}'::jsonb WHEN 'film->frame' THEN '{"verified":true,"condition":"attention","shot_hints":["damage_detail"],"evidence_ref":"syn-evidence","visit_ref":"syn-visit","reviewer_ref":"syn-reviewer","technician_ref":"syn-technician"}'::jsonb WHEN 'curb->frame' THEN jsonb_build_object('completed',true,'transition','purchase_complete','title_audit_ref','syn-title','completion_audit_ref','syn-completion','title_verified_at','2026-11-02T01:00:00Z','completed_at','2026-11-02T01:30:00Z','prior_instance',prior_inst,'prior_episode',prior_ep) ELSE jsonb_build_object('media_id','syn-media','content_sha256',repeat('a',64),'object_ref','objref:synthetic/media-01.jpg','mime','image/jpeg','width',1280,'height',720,'preset_version','syn-v1','preset_order',0,'approval_id','syn-manager','role','sales_manager','approved_at','2026-11-02T01:00:00Z') END;
  d:=jsonb_build_object('protocol','gw.extension/1','extension',reg.id,'source',reg.source_app,'target',reg.target_app,'event',reg.event_type,'tenant','grp-syn-northwind','rooftop','rt-syn-nw-01','vehicle',jsonb_build_object('vin',syn_vin,'instance',inst,'episode',ep),'source_event','syn-source-01','revision',1,'receipt_ref','syn-signed-receipt','acl_ref',acl,'occurred_at','2026-11-02T02:00:00Z','facts',f);
  IF gw_extension_contract_violation(d) IS NOT NULL THEN RAISE EXCEPTION 'P4 positive shape % %',reg.id,gw_extension_contract_violation(d);END IF;passed:=passed+1;
  raw:=d::text;h:=encode(extensions.digest(raw,'sha256'),'hex');
  INSERT INTO gw_extension_grants(acl_ref,key_id,reader_key_id,extension_id,tenant_id,rooftop_id,instance_id,episode_id,receipt_ref,source_event,revision,raw_sha256,facts,expires_at,purpose,read_allowed) VALUES(acl,k,reader,reg.id,'grp-syn-northwind','rt-syn-nw-01',inst,ep,'syn-signed-receipt','syn-source-01',1,h,f,clock_timestamp()+interval '1 hour',reg.purpose,true);
  r:=gw_extension_apply_local(k,d,raw,'synthetic_nonce_0001',clock_timestamp());IF r->>'decision'<>'applied' THEN RAISE EXCEPTION 'P4 positive apply % %',reg.id,r;END IF;passed:=passed+1;
  r:=gw_extension_apply_local(k,d,raw,'synthetic_nonce_0002',clock_timestamp());IF r->>'decision'<>'duplicate' THEN RAISE EXCEPTION 'P4 duplicate %',r;END IF;passed:=passed+1;
  SELECT apply_count INTO n FROM gw_extension_state WHERE extension_id=reg.id AND instance_id=inst;IF n<>1 THEN RAISE EXCEPTION 'P4 exactly once';END IF;passed:=passed+1;
  r:=gw_extension_apply_local(k,d,raw,'synthetic_nonce_0001',clock_timestamp());IF r->>'reason'<>'nonce replay' THEN RAISE EXCEPTION 'P4 nonce replay %',r;END IF;passed:=passed+1;
  r:=gw_extension_apply_local('syn-unknown',d,raw,'synthetic_nonce_0003',clock_timestamp());IF r->>'decision'<>'denied' THEN RAISE EXCEPTION 'P4 unknown source';END IF;passed:=passed+1;
  bad:=d||'{"tenant":"grp-syn-lakeshore","rooftop":"rt-syn-ls-01"}'::jsonb;r:=gw_extension_apply_local(k,bad,bad::text,'synthetic_nonce_0004',clock_timestamp());IF r->>'decision'<>'denied' THEN RAISE EXCEPTION 'P4 cross tenant same VIN';END IF;passed:=passed+1;
  bad:=jsonb_set(d,'{vehicle,episode}',to_jsonb(prior_ep));r:=gw_extension_apply_local(k,bad,bad::text,'synthetic_nonce_0005',clock_timestamp());IF r->>'decision' NOT IN('denied','rejected') THEN RAISE EXCEPTION 'P4 prior episode';END IF;passed:=passed+1;
  bad:=d||'{"receipt_ref":"syn-missing"}'::jsonb;r:=gw_extension_apply_local(k,bad,bad::text,'synthetic_nonce_0006',clock_timestamp());IF r->>'decision'<>'held' THEN RAISE EXCEPTION 'P4 unknown receipt';END IF;passed:=passed+1;
  UPDATE gw_extension_grants SET revoked_at=clock_timestamp() WHERE acl_ref=acl;r:=gw_extension_apply_local(k,d,raw,'synthetic_nonce_0007',clock_timestamp());IF r->>'decision'<>'held' THEN RAISE EXCEPTION 'P4 owner revoke';END IF;passed:=passed+1;UPDATE gw_extension_grants SET revoked_at=NULL WHERE acl_ref=acl;
  rr:=gw_extension_read_local(reader,acl,'grp-syn-northwind','rt-syn-nw-01',inst,ep,reg.purpose);IF rr IS DISTINCT FROM f THEN RAISE EXCEPTION 'P4 local minimized read %',reg.id;END IF;passed:=passed+1;
  UPDATE gw_extension_grants SET read_allowed=false WHERE acl_ref=acl;rr:=gw_extension_read_local(reader,acl,'grp-syn-northwind','rt-syn-nw-01',inst,ep,reg.purpose);IF rr IS NOT NULL THEN RAISE EXCEPTION 'P4 nonconsented read';END IF;passed:=passed+1;UPDATE gw_extension_grants SET read_allowed=true WHERE acl_ref=acl;
  rr:=gw_extension_read_local(reader,acl,'grp-syn-lakeshore','rt-syn-ls-01',inst,ep,reg.purpose);IF rr IS NOT NULL THEN RAISE EXCEPTION 'P4 cross tenant read';END IF;passed:=passed+1;
  rr:=gw_extension_read_local(reader,acl,'grp-syn-northwind','rt-syn-nw-01',inst,prior_ep,reg.purpose);IF rr IS NOT NULL THEN RAISE EXCEPTION 'P4 old episode read';END IF;passed:=passed+1;
  FOREACH x IN ARRAY ARRAY['acv_value','acv_cents','offered_price','finance_amount','bytes','binary','customer_name'] LOOP
   bad:=jsonb_set(d,'{facts}',f||jsonb_build_object(x,jsonb_build_object('nested','synthetic-canary')));IF gw_extension_contract_violation(bad) IS NULL THEN RAISE EXCEPTION 'P4 protected field admitted';END IF;passed:=passed+1;
  END LOOP;
  IF reg.id='labels->frame' THEN
   bad:=jsonb_set(d,'{facts}',f||'{"advertised_price_cents":12345,"currency":"USD"}'::jsonb);UPDATE gw_extension_grants SET facts=bad->'facts',raw_sha256=encode(extensions.digest(bad::text,'sha256'),'hex') WHERE acl_ref=acl;
   r:=gw_extension_apply_local(k,bad,bad::text,'synthetic_nonce_price',clock_timestamp());IF r->>'decision'<>'held' THEN RAISE EXCEPTION 'P4 price consent';END IF;passed:=passed+1;
   UPDATE gw_extension_custody SET status='archived' WHERE instance_id=inst;r:=gw_extension_apply_local(k,bad,bad::text,'synthetic_nonce_archived',clock_timestamp());IF r->>'decision'<>'held' THEN RAISE EXCEPTION 'P4 archived relist';END IF;passed:=passed+1;UPDATE gw_extension_custody SET status='active' WHERE instance_id=inst;
  ELSIF reg.id='film->frame' THEN
   bad:=jsonb_set(d,'{facts,verified}','false');IF gw_extension_contract_violation(bad) IS NULL THEN RAISE EXCEPTION 'P4 unverified MPI';END IF;passed:=passed+1;
  ELSIF reg.id='curb->frame' THEN
   FOREACH x IN ARRAY ARRAY['offer_accepted','deal_finalized'] LOOP bad:=jsonb_set(d,'{facts,transition}',to_jsonb(x));IF gw_extension_contract_violation(bad) IS NULL THEN RAISE EXCEPTION 'P4 false acquisition';END IF;passed:=passed+1;END LOOP;
  ELSE
   UPDATE gw_extension_grants SET media_revoked=true WHERE acl_ref=acl;r:=gw_extension_apply_local(k,d,raw,'synthetic_nonce_revoked',clock_timestamp());rr:=gw_extension_read_local(reader,acl,'grp-syn-northwind','rt-syn-nw-01',inst,ep,reg.purpose);IF r->>'decision'<>'held' OR rr IS NOT NULL THEN RAISE EXCEPTION 'P4 media revoked';END IF;passed:=passed+1;UPDATE gw_extension_grants SET media_revoked=false WHERE acl_ref=acl;
   UPDATE gw_extension_custody SET status='sold' WHERE instance_id=inst;r:=gw_extension_apply_local(k,d,raw,'synthetic_nonce_sold',clock_timestamp());IF r->>'decision'<>'held' THEN RAISE EXCEPTION 'P4 sold media';END IF;passed:=passed+1;UPDATE gw_extension_custody SET status='active' WHERE instance_id=inst;
  END IF;
  -- Same event+new hash never replaces a previously applied receipt.
  bad:=d||'{"revision":2}'::jsonb;UPDATE gw_extension_grants SET facts=f,source_event='syn-source-01',revision=2,raw_sha256=encode(extensions.digest(bad::text,'sha256'),'hex') WHERE acl_ref=acl;
  r:=gw_extension_apply_local(k,bad,bad::text,'synthetic_nonce_conflict',clock_timestamp());IF r->>'decision'<>'conflict' THEN RAISE EXCEPTION 'P4 dupe hash conflict';END IF;passed:=passed+1;
  bad:=d||'{"revision":3,"source_event":"syn-source-03"}'::jsonb;UPDATE gw_extension_grants SET revision=3,source_event='syn-source-03',raw_sha256=encode(extensions.digest(bad::text,'sha256'),'hex') WHERE acl_ref=acl;
  r:=gw_extension_apply_local(k,bad,bad::text,'synthetic_nonce_rev3',clock_timestamp());IF r->>'decision'<>'applied' THEN RAISE EXCEPTION 'P4 forward ordering';END IF;passed:=passed+1;
  bad:=d||'{"revision":2,"source_event":"syn-source-02"}'::jsonb;UPDATE gw_extension_grants SET revision=2,source_event='syn-source-02',raw_sha256=encode(extensions.digest(bad::text,'sha256'),'hex') WHERE acl_ref=acl;
  r:=gw_extension_apply_local(k,bad,bad::text,'synthetic_nonce_rev2',clock_timestamp());IF r->>'decision'<>'stale' THEN RAISE EXCEPTION 'P4 out of order';END IF;passed:=passed+1;
  UPDATE gw_extension_keys SET revoked_at=clock_timestamp() WHERE key_id=k;r:=gw_extension_apply_local(k,bad,bad::text,'synthetic_nonce_keyrevoke',clock_timestamp());IF r->>'decision'<>'denied' THEN RAISE EXCEPTION 'P4 revoked key';END IF;passed:=passed+1;
 END LOOP;
 RAISE EXCEPTION 'GW_TESTS_PASSED: %',passed;
END $$;