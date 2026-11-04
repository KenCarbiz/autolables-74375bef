-- Phase3E PRIVATE preparation only. No HTTP route; no provisioned keys or enabled gate rows.
CREATE TABLE public.gw_service_connections (
 connection_id text PRIMARY KEY CHECK(connection_id ~ '^[A-Za-z0-9_-]{1,64}$'), app public.gw_app NOT NULL,
 tenant_id text NOT NULL REFERENCES public.gw_tenants(id), rooftop_ids text[] NOT NULL,
 mode text NOT NULL DEFAULT 'service_staging' CHECK(mode='service_staging'),
 endpoint_ref text NOT NULL CHECK(endpoint_ref ~ '^local-test:[A-Za-z0-9_-]{1,64}$'),
 network_allowlist inet[] NOT NULL CHECK(cardinality(network_allowlist) BETWEEN 1 AND 16),
 provisioned_by uuid NOT NULL, enabled boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
REVOKE ALL ON public.gw_service_connections FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.gw_service_connections TO service_role;
ALTER TABLE public.gw_service_connections ENABLE ROW LEVEL SECURITY;
CREATE TABLE public.gw_service_keys (
 key_id text PRIMARY KEY CHECK(key_id ~ '^[A-Za-z0-9_-]{1,64}$'), connection_id text NOT NULL REFERENCES public.gw_service_connections(connection_id),
 fingerprint text NOT NULL CHECK(fingerprint ~ '^[a-f0-9]{64}$'), key_role text NOT NULL CHECK(key_role IN('event_publisher','fact_reader')),
 directions text[] NOT NULL, event_types text[] NOT NULL DEFAULT '{}', targets public.gw_app[] NOT NULL DEFAULT '{}', owners public.gw_app[] NOT NULL DEFAULT '{}', purposes text[] NOT NULL DEFAULT '{}',
 not_before timestamptz NOT NULL, not_after timestamptz NOT NULL, rotate_after timestamptz NOT NULL, revoked_at timestamptz,
 budget_per_min integer NOT NULL CHECK(budget_per_min BETWEEN 1 AND 120), max_batch integer NOT NULL DEFAULT 50 CHECK(max_batch BETWEEN 1 AND 50),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), CHECK(not_after>not_before AND not_after-not_before<=interval '24 hours'), CHECK(rotate_after>=not_before AND rotate_after<=not_after),
 CHECK((key_role='event_publisher' AND directions=ARRAY['event_push']::text[]) OR (key_role='fact_reader' AND directions=ARRAY['authorized_pull']::text[]))
);
REVOKE ALL ON public.gw_service_keys FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.gw_service_keys TO service_role;
ALTER TABLE public.gw_service_keys ENABLE ROW LEVEL SECURITY;
CREATE TABLE public.gw_service_stage_gates (
 id integer PRIMARY KEY CHECK(id=1), enabled boolean NOT NULL DEFAULT false, audience_reviewed boolean NOT NULL DEFAULT false,
 threat_reviewed boolean NOT NULL DEFAULT false, private_transport boolean NOT NULL DEFAULT false, evidence_ref text NOT NULL
);
REVOKE ALL ON public.gw_service_stage_gates FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.gw_service_stage_gates TO service_role;
ALTER TABLE public.gw_service_stage_gates ENABLE ROW LEVEL SECURITY;
CREATE TABLE public.gw_service_nonces (
 key_id text NOT NULL REFERENCES public.gw_service_keys(key_id), nonce text NOT NULL CHECK(nonce ~ '^[A-Za-z0-9_-]{16,64}$'),
 received_at timestamptz NOT NULL DEFAULT clock_timestamp(), PRIMARY KEY(key_id,nonce)
);
REVOKE ALL ON public.gw_service_nonces FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.gw_service_nonces TO service_role;
ALTER TABLE public.gw_service_nonces ENABLE ROW LEVEL SECURITY;
CREATE TABLE public.gw_service_receipts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), key_id text, connection_id text, tenant_id text, app public.gw_app, direction text,
 nonce text, body_sha256 text, event_id uuid, decision text NOT NULL, reason text, http_status integer NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
REVOKE ALL ON public.gw_service_receipts FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT ON public.gw_service_receipts TO service_role;
ALTER TABLE public.gw_service_receipts ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER gw_service_receipts_immutable BEFORE UPDATE OR DELETE ON public.gw_service_receipts FOR EACH ROW EXECUTE FUNCTION public.gw_forbid_mutation();
CREATE INDEX gw_service_receipts_budget ON public.gw_service_receipts(key_id,created_at);
CREATE UNIQUE INDEX gw_service_single_accept ON public.gw_service_receipts(key_id,event_id) WHERE decision='accepted';
CREATE FUNCTION public.gw_service_provision(_operator uuid,_connection text,_app public.gw_app,_tenant text,_rooftops text[],_network inet[],_key text,_fingerprint text,_role text,_events text[],_targets public.gw_app[],_owners public.gw_app[],_purposes text[],_not_before timestamptz,_not_after timestamptz,_budget integer) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE member_role gw_role; f text; owner gw_app; BEGIN
 IF NOT EXISTS(SELECT 1 FROM gw_settings WHERE id=1 AND environment='DEV') OR _tenant !~ '^grp-syn-[a-z0-9-]+$' OR NOT EXISTS(SELECT 1 FROM gw_tenants WHERE id=_tenant AND is_synthetic) THEN RAISE EXCEPTION 'synthetic DEV only'; END IF;
 SELECT role INTO member_role FROM gw_tenant_members WHERE user_id=_operator AND tenant_id=_tenant;
 IF member_role IS NULL OR member_role NOT IN('admin','operator') OR NOT EXISTS(SELECT 1 FROM auth.users WHERE id=_operator AND email_confirmed_at IS NOT NULL AND email IS NOT NULL AND NOT coalesce(is_anonymous,false)) THEN RAISE EXCEPTION 'verified DEV operator required'; END IF;
 IF cardinality(_rooftops) NOT BETWEEN 1 AND 16 OR EXISTS(SELECT 1 FROM unnest(_rooftops)r WHERE r !~ '^rt-syn-' OR NOT EXISTS(SELECT 1 FROM gw_rooftops WHERE id=r AND tenant_id=_tenant)) THEN RAISE EXCEPTION 'rooftop binding';END IF;
 IF _not_before IS NULL OR _not_after IS NULL OR _not_after<=clock_timestamp() OR _not_before<clock_timestamp()-interval '5 minutes' OR _not_before>clock_timestamp()+interval '5 minutes' OR _not_after-_not_before>interval '24 hours' THEN RAISE EXCEPTION 'short key validity required';END IF;
 IF _role='event_publisher' THEN
  IF cardinality(_events) NOT BETWEEN 1 AND 16 OR cardinality(_targets) NOT BETWEEN 1 AND 3 OR cardinality(_owners)<>0 OR cardinality(_purposes)<>0 THEN RAISE EXCEPTION 'publisher grants';END IF;
  FOREACH f IN ARRAY _events LOOP
   IF NOT EXISTS(SELECT 1 FROM gw_source_allowlist WHERE source_app=_app AND event_type=f AND classification<>'pii' AND 1=ANY(schema_versions)) OR EXISTS(SELECT 1 FROM gw_routes WHERE source_app=_app AND f=ANY(event_types) AND NOT(target_app=ANY(_targets))) OR NOT EXISTS(SELECT 1 FROM gw_routes WHERE source_app=_app AND f=ANY(event_types)) THEN RAISE EXCEPTION 'owned event/fanout required';END IF;
  END LOOP;
 ELSIF _role='fact_reader' THEN
  IF cardinality(_owners) NOT BETWEEN 1 AND 3 OR cardinality(_purposes) NOT BETWEEN 1 AND 3 OR cardinality(_events)<>0 OR cardinality(_targets)<>0 THEN RAISE EXCEPTION 'reader grants';END IF;
  FOREACH owner IN ARRAY _owners LOOP IF owner=_app OR NOT EXISTS(SELECT 1 FROM gw_read_exchange_policy WHERE source_app=owner AND consumer_app=_app AND purpose=ANY(_purposes)) THEN RAISE EXCEPTION 'owned purpose required';END IF;END LOOP;
  FOREACH f IN ARRAY _purposes LOOP IF NOT EXISTS(SELECT 1 FROM gw_read_exchange_policy WHERE source_app=ANY(_owners) AND consumer_app=_app AND purpose=f) THEN RAISE EXCEPTION 'purpose mismatch';END IF;END LOOP;
 ELSE RAISE EXCEPTION 'non-admin service role required'; END IF;
 INSERT INTO gw_service_connections(connection_id,app,tenant_id,rooftop_ids,endpoint_ref,network_allowlist,provisioned_by) VALUES(_connection,_app,_tenant,_rooftops,'local-test:'||_connection,_network,_operator);
 INSERT INTO gw_service_keys(key_id,connection_id,fingerprint,key_role,directions,event_types,targets,owners,purposes,not_before,not_after,rotate_after,budget_per_min)
 VALUES(_key,_connection,_fingerprint,_role,ARRAY[CASE WHEN _role='event_publisher' THEN 'event_push' ELSE 'authorized_pull' END],_events,_targets,_owners,_purposes,_not_before,_not_after,_not_before+(_not_after-_not_before)/2,_budget);
 INSERT INTO gw_audit_log(tenant_id,actor,action,detail) VALUES(_tenant,_operator,'service_staging_provisioned',jsonb_build_object('connection_id',_connection,'key_id',_key,'key_role',_role,'enabled',false));
 RETURN jsonb_build_object('decision','provisioned_disabled','connection_id',_connection,'key_id',_key);
END $$;
REVOKE ALL ON FUNCTION public.gw_service_provision(uuid,text,public.gw_app,text,text[],inet[],text,text,text,text[],public.gw_app[],public.gw_app[],text[],timestamptz,timestamptz,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.gw_service_provision(uuid,text,public.gw_app,text,text[],inet[],text,text,text,text[],public.gw_app[],public.gw_app[],text[],timestamptz,timestamptz,integer) TO service_role;
CREATE FUNCTION public.gw_service_execute(_key text,_fingerprint text,_nonce text,_ts timestamptz,_raw text,_body_sha256 text,_peer inet) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions AS $$
DECLARE k gw_service_keys%rowtype;c gw_service_connections%rowtype;q jsonb;b jsonb;reason text;status integer:=403;decision text:='denied';v_result jsonb;event uuid; g gw_service_stage_gates%rowtype;s gw_settings%rowtype; owner gw_app; units integer:=1; bridge text; bridge_nonce text;BEGIN
 SELECT * INTO s FROM gw_settings WHERE id=1;
 SELECT * INTO g FROM gw_service_stage_gates WHERE id=1;
 IF s.environment IS DISTINCT FROM 'DEV' OR s.global_kill IS DISTINCT FROM false OR g.enabled IS DISTINCT FROM true OR g.audience_reviewed IS DISTINCT FROM true OR g.threat_reviewed IS DISTINCT FROM true OR g.private_transport IS DISTINCT FROM true THEN reason:='staging gates closed';status:=503;
 ELSE
  SELECT * INTO k FROM gw_service_keys WHERE key_id=_key FOR UPDATE;
  SELECT * INTO c FROM gw_service_connections WHERE connection_id=k.connection_id FOR SHARE;
  IF k.key_id IS NULL OR c.enabled IS DISTINCT FROM true OR c.mode IS DISTINCT FROM 'service_staging' OR _fingerprint IS DISTINCT FROM k.fingerprint THEN reason:='unknown or disabled service key';status:=401;
  ELSIF k.revoked_at IS NOT NULL OR clock_timestamp()<k.not_before OR clock_timestamp()>=k.not_after THEN reason:='revoked or expired service key';status:=401;
  ELSIF _ts IS NULL OR abs(extract(epoch FROM clock_timestamp()-_ts))>300 OR _nonce IS NULL OR _nonce !~ '^[A-Za-z0-9_-]{16,64}$' THEN reason:='timestamp or nonce';status:=401;
  ELSIF _peer IS NULL OR NOT(_peer=ANY(c.network_allowlist)) THEN reason:='private network required';
  ELSIF c.tenant_id !~ '^grp-syn-' OR NOT EXISTS(SELECT 1 FROM gw_tenants WHERE id=c.tenant_id AND is_synthetic) THEN reason:='synthetic tenant required';
  ELSIF octet_length(_raw)>16384 OR _body_sha256 IS DISTINCT FROM encode(digest(_raw,'sha256'),'hex') THEN reason:='raw body hash or size';status:=400;
  ELSE
   BEGIN q:=_raw::jsonb;EXCEPTION WHEN others THEN reason:='invalid JSON';status:=400;END;
   IF reason IS NULL THEN
    b:=q->'body';
    IF q->>'protocol' IS DISTINCT FROM 'gw.service-staging/1' OR q->>'app' IS DISTINCT FROM c.app::text OR q->>'tenant' IS DISTINCT FROM c.tenant_id OR NOT coalesce(q->>'rooftop'=ANY(c.rooftop_ids),false) OR NOT coalesce(q->>'direction'=ANY(k.directions),false) OR NOT EXISTS(SELECT 1 FROM gw_rooftops WHERE id=q->>'rooftop' AND tenant_id=c.tenant_id) THEN reason:='service scope mismatch';
    ELSIF q->>'direction'='event_push' THEN
     BEGIN event:=(b->>'event_id')::uuid;EXCEPTION WHEN others THEN event:=NULL;END;
     IF k.key_role<>'event_publisher' OR b->'schema_version' IS DISTINCT FROM '1'::jsonb OR b->>'source_app' IS DISTINCT FROM c.app::text OR b->>'tenant_id' IS DISTINCT FROM c.tenant_id OR b->>'rooftop_id' IS DISTINCT FROM q->>'rooftop' OR NOT coalesce(b->>'event_type'=ANY(k.event_types),false) OR b->>'classification'='pii' OR b->>'event_type'='lead.consented' OR event IS NULL OR b->'vehicle'->>'vin' NOT LIKE 'DEVSYN%' OR coalesce(b->'vehicle'->>'instance_id','')='' OR coalesce(b->'vehicle'->>'episode_id','')='' OR (b ? 'target_app' AND NOT coalesce(b->>'target_app'=ANY(k.targets::text[]),false)) OR EXISTS(SELECT 1 FROM gw_routes WHERE source_app=c.app AND b->>'event_type'=ANY(event_types) AND NOT(target_app=ANY(k.targets))) OR NOT EXISTS(SELECT 1 FROM gw_source_allowlist WHERE source_app=c.app AND event_type=b->>'event_type' AND classification<>'pii') THEN reason:='event not granted';END IF;
    ELSIF q->>'direction'='authorized_pull' THEN
     BEGIN owner:=(b->>'source_app')::gw_app;EXCEPTION WHEN others THEN owner:=NULL;END;
     IF k.key_role<>'fact_reader' OR owner IS NULL OR owner=c.app OR NOT coalesce(owner=ANY(k.owners),false) OR b->>'tenant' IS DISTINCT FROM c.tenant_id OR b->>'rooftop' IS DISTINCT FROM q->>'rooftop' OR NOT coalesce(b->>'purpose'=ANY(k.purposes),false) OR NOT EXISTS(SELECT 1 FROM gw_read_exchange_policy WHERE source_app=owner AND consumer_app=c.app AND purpose=b->>'purpose') OR jsonb_typeof(b->'lookups') IS DISTINCT FROM 'array' THEN reason:='read not granted';
     ELSE units:=jsonb_array_length(b->'lookups');IF units NOT BETWEEN 1 AND k.max_batch OR EXISTS(SELECT 1 FROM jsonb_array_elements(b->'lookups')l WHERE coalesce(l->>'vin','') NOT LIKE 'DEVSYN%' OR coalesce(l->>'instance_id','')='') THEN reason:='bounded synthetic custody required';END IF;END IF;
    ELSE reason:='direction not granted';END IF;
   END IF;
   IF reason IS NULL THEN
    INSERT INTO gw_service_nonces(key_id,nonce) VALUES(_key,_nonce) ON CONFLICT DO NOTHING;
    IF NOT FOUND THEN reason:='nonce replay';status:=409;
    ELSIF (SELECT count(*) FROM gw_service_receipts WHERE key_id=_key AND created_at>clock_timestamp()-interval '1 minute')+units>k.budget_per_min THEN reason:='service rate budget';status:=429;
    ELSE
     -- Transactional internal delegate only after service-only verifier authorizes exact canonical body.
     IF q->>'direction'='event_push' THEN v_result:=gw_publish_internal(b,NULL);decision:=v_result->>'status';status:=CASE decision WHEN 'accepted' THEN 202 WHEN 'duplicate' THEN 200 WHEN 'stale' THEN 409 WHEN 'backpressure' THEN 429 WHEN 'rate_limited' THEN 429 ELSE 422 END;reason:=v_result->>'reason';
     ELSE
      -- Private short-lived bridge key is scoped identically; neither key nor token leaves this transaction.
      bridge:='svc-'||left(encode(digest(_key,'sha256'),'hex'),48);bridge_nonce:='svc-'||left(encode(digest(_nonce,'sha256'),'hex'),48);
      INSERT INTO gw_ingest_keys(key_id,source_app,tenant_id,rooftop_ids,key_fingerprint,not_before,not_after,key_usage) VALUES(bridge,c.app,c.tenant_id,c.rooftop_ids,k.fingerprint,k.not_before,k.not_after,'read_only') ON CONFLICT(key_id) DO UPDATE SET not_after=excluded.not_after,revoked_at=NULL;
      INSERT INTO gw_read_exchange_grants(key_id,source_app,purpose,budget_per_min,max_batch,ttl_s,not_after) VALUES(bridge,owner,b->>'purpose',k.budget_per_min,k.max_batch,15,k.not_after) ON CONFLICT(key_id,source_app,purpose) DO UPDATE SET not_after=excluded.not_after;
      v_result:=gw_read_exchange(bridge,bridge_nonce,_ts,c.tenant_id,q->>'rooftop',owner,b->>'purpose',b->'lookups');decision:=v_result->>'decision';status:=coalesce((v_result->>'http_status')::int,200);reason:=v_result->>'reason';
     END IF;
    END IF;
   END IF;
  END IF;
 END IF;
 INSERT INTO gw_service_receipts(key_id,connection_id,tenant_id,app,direction,nonce,body_sha256,event_id,decision,reason,http_status) VALUES(left(_key,64),c.connection_id,c.tenant_id,c.app,q->>'direction',left(_nonce,64),left(_body_sha256,64),event,decision,left(reason,128),status);
 RETURN jsonb_build_object('http_status',status,'decision',decision,'reason',reason,'data',CASE WHEN status BETWEEN 200 AND 299 THEN v_result ELSE NULL END);
END $$;
REVOKE ALL ON FUNCTION public.gw_service_execute(text,text,text,timestamptz,text,text,inet) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.gw_service_execute(text,text,text,timestamptz,text,text,inet) TO service_role;
COMMENT ON FUNCTION public.gw_service_execute(text,text,text,timestamptz,text,text,inet) IS 'PRIVATE ONLY: trusted server verifier must validate exact canonical raw HMAC first; default no gate row, no endpoint, no key. No browser executor.';