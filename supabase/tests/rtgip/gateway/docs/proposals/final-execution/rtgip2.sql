-- PROPOSED ONLY. Outside the Drizzle journal. No shared hosted application permission.
-- Execute only on a fresh socket-only disposable database; later hosted application needs approval.
-- No Vault/custom database roles, no new browser grants, no changes to canonical v1.
CREATE TABLE public.gw_r2_connections (
 id text PRIMARY KEY, source_app text NOT NULL, target_app text NOT NULL,
 tenant_id text NOT NULL REFERENCES public.gw_tenants(id), rooftop_id text NOT NULL REFERENCES public.gw_rooftops(id),
 events text[] NOT NULL, purposes text[] NOT NULL, status text NOT NULL DEFAULT 'suspended' CHECK(status IN('active','suspended','revoked')),
 source_enabled boolean NOT NULL DEFAULT false, target_enabled boolean NOT NULL DEFAULT false,
 CHECK(source_app IN('autolabels','autocurb','autoframe') AND target_app IN('autolabels','autocurb','autoframe') AND source_app<>target_app),
 UNIQUE(source_app,target_app,tenant_id,rooftop_id)
);
GRANT SELECT ON public.gw_r2_connections TO service_role;
ALTER TABLE public.gw_r2_connections ENABLE ROW LEVEL SECURITY;
CREATE TABLE public.gw_r2_keys (
 id text PRIMARY KEY, owner text NOT NULL CHECK(owner IN('gateway','autolabels','autocurb','autoframe')),
 connections text[] NOT NULL, status text NOT NULL CHECK(status IN('current','previous','revoked')),
 not_before timestamptz NOT NULL, not_after timestamptz NOT NULL, fingerprint text NOT NULL,
 CHECK(not_after>not_before)
);
GRANT SELECT ON public.gw_r2_keys TO service_role;
ALTER TABLE public.gw_r2_keys ENABLE ROW LEVEL SECURITY;
CREATE TABLE public.gw_r2_mappings (
 connection_id text NOT NULL REFERENCES public.gw_r2_connections(id), instance_id text NOT NULL,
 episode_id text NOT NULL, source_store_id text NOT NULL, vin text NOT NULL,
 reviewed_ref text NOT NULL, status text NOT NULL CHECK(status IN('active','revoked')),
 PRIMARY KEY(connection_id,instance_id,episode_id), CHECK(source_store_id<>'' AND reviewed_ref<>'')
);
GRANT SELECT ON public.gw_r2_mappings TO service_role;
ALTER TABLE public.gw_r2_mappings ENABLE ROW LEVEL SECURITY;
CREATE TABLE public.gw_r2_admissions (
 delivery_id text PRIMARY KEY CHECK(delivery_id ~ '^[0-9a-f]{64}$'), event_id uuid NOT NULL,
 connection_id text NOT NULL REFERENCES public.gw_r2_connections(id), source_key_id text NOT NULL REFERENCES public.gw_r2_keys(id),
 envelope_sha256 text NOT NULL CHECK(envelope_sha256 ~ '^[0-9a-f]{64}$'), canonical_body text NOT NULL,
 envelope jsonb NOT NULL, gateway_key_id text NOT NULL REFERENCES public.gw_r2_keys(id), issued_at bigint NOT NULL,
 lane text NOT NULL, seq bigint GENERATED ALWAYS AS IDENTITY, UNIQUE(event_id,connection_id)
);
GRANT SELECT ON public.gw_r2_admissions TO service_role;
ALTER TABLE public.gw_r2_admissions ENABLE ROW LEVEL SECURITY;
CREATE TABLE public.gw_r2_nonces (
 key_id text NOT NULL REFERENCES public.gw_r2_keys(id), nonce text NOT NULL CHECK(nonce ~ '^[A-Za-z0-9_-]{16,128}$'),
 envelope_sha256 text NOT NULL, delivery_id text NOT NULL REFERENCES public.gw_r2_admissions(delivery_id),
 accepted_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(key_id,nonce)
);
GRANT SELECT ON public.gw_r2_nonces TO service_role;
ALTER TABLE public.gw_r2_nonces ENABLE ROW LEVEL SECURITY;
CREATE TABLE public.gw_r2_dispatch (
 delivery_id text PRIMARY KEY REFERENCES public.gw_r2_admissions(delivery_id),
 state text NOT NULL DEFAULT 'pending' CHECK(state IN('pending','leased','target_persisted','committed','quarantined','dead')),
 generation bigint NOT NULL DEFAULT 0, token uuid, worker text, lease_until timestamptz,
 attempts int NOT NULL DEFAULT 0, next_attempt_at timestamptz NOT NULL DEFAULT now(),
 last_reason text CHECK(last_reason IN('delivery_not_confirmed','authorization_changed','attempt_budget_exhausted','redriven'))
);
GRANT SELECT ON public.gw_r2_dispatch TO service_role;
ALTER TABLE public.gw_r2_dispatch ENABLE ROW LEVEL SECURITY;
CREATE INDEX gw_r2_dispatch_due ON public.gw_r2_dispatch(state,next_attempt_at);
CREATE INDEX gw_r2_admission_lanes ON public.gw_r2_admissions(lane,seq);
CREATE TABLE public.gw_r2_receipts (
 digest text PRIMARY KEY, delivery_id text NOT NULL REFERENCES public.gw_r2_admissions(delivery_id),
 stage text NOT NULL CHECK(stage IN('gateway_admission','target_inbox','consumer_commit')),
 receipt jsonb NOT NULL, recorded_at timestamptz NOT NULL DEFAULT now(), UNIQUE(delivery_id,stage)
);
GRANT SELECT ON public.gw_r2_receipts TO service_role;
ALTER TABLE public.gw_r2_receipts ENABLE ROW LEVEL SECURITY;
CREATE TABLE public.gw_r2_audit (
 seq bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, at timestamptz NOT NULL DEFAULT now(),
 delivery_id text, action text NOT NULL CHECK(action IN('admitted','exact_retry','conflict','signed_admission','committed','failed','redrive')),
 actor uuid, case_ref text, generation bigint
);
GRANT SELECT ON public.gw_r2_audit TO service_role;
ALTER TABLE public.gw_r2_audit ENABLE ROW LEVEL SECURITY;

CREATE FUNCTION public.gw_r2_append_only() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN RAISE EXCEPTION 'immutable evidence'; END $$;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['gw_r2_admissions','gw_r2_nonces','gw_r2_receipts','gw_r2_audit'] LOOP
 EXECUTE format('CREATE TRIGGER immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON public.%I FOR EACH STATEMENT EXECUTE FUNCTION public.gw_r2_append_only()',t);
 END LOOP;
END $$;

-- Mirrors the six approved routes from the supplied core; no AutoFilm translation or v1 fanout.
CREATE FUNCTION public.gw_r2_route_allowed(s text,t text,e text,p text) RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path='' AS $$
SELECT CASE
 WHEN s='autolabels' AND t IN('autocurb','autoframe') THEN
  (e IN('vehicle.identity_registered','inventory.status_changed') AND p='inventory_sync') OR
  (e IN('custody.episode_opened','custody.episode_closed','sale.milestone_recorded') AND p='custody_evidence') OR
  (t='autocurb' AND e='listing.price_published' AND p='inventory_sync') OR
  (t='autoframe' AND e='listing.availability_changed' AND p='inventory_sync')
 WHEN s='autocurb' AND t IN('autolabels','autoframe') THEN
  (e='appraisal.completed' AND p='acquisition_evidence') OR
  (t='autolabels' AND e='acquisition.milestone_recorded' AND p='acquisition_evidence') OR
  (e='acquisition.purchase_completed' AND (p='acquisition_evidence' OR (t='autolabels' AND p='custody_evidence')))
 WHEN s='autoframe' AND t IN('autolabels','autocurb') THEN e IN('media.approved','media.revoked') AND p='media_reference'
 ELSE false END
$$;

CREATE FUNCTION public.gw_r2_authorized_internal(a public.gw_r2_admissions) RETURNS boolean LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.gw_r2_connections c JOIN public.gw_tenants t ON t.id=c.tenant_id
 JOIN public.gw_rooftops r ON r.id=c.rooftop_id AND r.tenant_id=c.tenant_id
 JOIN public.gw_r2_mappings m ON m.connection_id=c.id AND m.instance_id=a.envelope#>>'{vehicle,instance_id}' AND m.episode_id=a.envelope#>>'{vehicle,episode_id}'
 JOIN public.gw_settings g ON g.id=1
 WHERE c.id=a.connection_id AND c.source_app=a.envelope->>'source_app' AND c.target_app=a.envelope->>'target_app'
 AND c.tenant_id=a.envelope->>'tenant_id' AND c.rooftop_id=a.envelope->>'rooftop_id'
 AND c.status='active' AND c.source_enabled AND c.target_enabled AND t.is_synthetic
 AND g.environment='DEV' AND NOT g.global_kill AND NOT g.external_delivery_enabled
 AND m.status='active' AND m.vin=a.envelope#>>'{vehicle,vin}'
 AND a.envelope->>'event_type'=ANY(c.events) AND a.envelope->>'purpose'=ANY(c.purposes)
 AND public.gw_r2_route_allowed(c.source_app,c.target_app,a.envelope->>'event_type',a.envelope->>'purpose'))
$$;

-- HMAC, strict canonical/schema and source signature are verified server-side BEFORE this call.
-- One RPC is the durability boundary. It persists original receipt intent atomically, never signs.
CREATE FUNCTION public.gw_r2_admit(_body text,_connection text,_source_key text,_gateway_key text,_nonce text,_timestamp bigint,_delivery_id text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE e jsonb; a gw_r2_admissions; prior gw_r2_admissions; n gw_r2_nonces; k gw_r2_keys; g gw_r2_keys; h text;
BEGIN
 IF octet_length(_body)>65536 OR abs(extract(epoch FROM clock_timestamp())-_timestamp)>300 THEN RAISE EXCEPTION 'invalid size or timestamp'; END IF;
 e:=_body::jsonb; h:=encode(digest(convert_to(_body,'UTF8'),'sha256'),'hex');
 IF e->>'protocol' IS DISTINCT FROM 'rtgip/2' OR e->'schema_version' IS DISTINCT FROM '2'::jsonb THEN RAISE EXCEPTION 'unsupported protocol'; END IF;
 PERFORM 1 FROM gw_settings WHERE id=1 FOR SHARE;
 PERFORM 1 FROM gw_r2_connections WHERE id=_connection FOR SHARE;
 PERFORM 1 FROM gw_r2_mappings WHERE connection_id=_connection AND instance_id=e#>>'{vehicle,instance_id}' AND episode_id=e#>>'{vehicle,episode_id}' FOR SHARE;
 SELECT * INTO k FROM gw_r2_keys WHERE id=_source_key FOR SHARE;
 SELECT * INTO g FROM gw_r2_keys WHERE id=_gateway_key FOR SHARE;
 IF k.id IS NULL OR k.owner IS DISTINCT FROM e->>'source_app' OR k.status='revoked' OR clock_timestamp() NOT BETWEEN k.not_before AND k.not_after OR NOT(_connection=ANY(k.connections)) OR
 g.id IS NULL OR g.owner<>'gateway' OR g.status<>'current' OR clock_timestamp() NOT BETWEEN g.not_before AND g.not_after OR NOT(_connection=ANY(g.connections)) THEN RAISE EXCEPTION 'key not authorized'; END IF;
 a.connection_id:=_connection; a.envelope:=e;
 IF NOT gw_r2_authorized_internal(a) THEN RAISE EXCEPTION 'mapping or connection not authorized'; END IF;
 -- Narrow per-nonce serialization, not a global lock. Prevents conflicting concurrent reservations.
 PERFORM pg_advisory_xact_lock(hashtextextended(_source_key||chr(31)||_nonce,0));
 SELECT * INTO n FROM gw_r2_nonces WHERE key_id=_source_key AND nonce=_nonce;
 IF FOUND AND n.envelope_sha256<>h THEN RAISE EXCEPTION 'nonce conflict'; END IF;
 -- Serialize publication before allocating seq, so an uncommitted predecessor cannot be skipped.
 PERFORM pg_advisory_xact_lock(hashtextextended('gw_r2_lane|'||
 (e->>'target_app')||'|'||(e->>'tenant_id')||'|'||(e#>>'{vehicle,instance_id}')||'|'||(e#>>'{vehicle,episode_id}')||'|'||(e#>>'{aggregate,domain}')||'|'||(e#>>'{aggregate,type}')||'|'||(e#>>'{aggregate,id}'),0));
 INSERT INTO gw_r2_admissions(delivery_id,event_id,connection_id,source_key_id,envelope_sha256,canonical_body,envelope,gateway_key_id,issued_at,lane)
 VALUES(_delivery_id,(e->>'event_id')::uuid,_connection,_source_key,h,_body,e,_gateway_key,floor(extract(epoch FROM clock_timestamp())),
 (e->>'target_app')||'|'||(e->>'tenant_id')||'|'||(e#>>'{vehicle,instance_id}')||'|'||(e#>>'{vehicle,episode_id}')||'|'||(e#>>'{aggregate,domain}')||'|'||(e#>>'{aggregate,type}')||'|'||(e#>>'{aggregate,id}'))
 ON CONFLICT(event_id,connection_id) DO NOTHING RETURNING * INTO prior;
 IF prior.delivery_id IS NULL THEN
 SELECT * INTO prior FROM gw_r2_admissions WHERE event_id=(e->>'event_id')::uuid AND connection_id=_connection;
 IF prior.envelope_sha256<>h OR prior.delivery_id<>_delivery_id THEN
 INSERT INTO gw_r2_audit(delivery_id,action)VALUES(prior.delivery_id,'conflict');
 RETURN jsonb_build_object('outcome','conflict'); END IF;
 ELSE
 INSERT INTO gw_r2_dispatch(delivery_id)VALUES(prior.delivery_id);
 INSERT INTO gw_r2_audit(delivery_id,action)VALUES(prior.delivery_id,'admitted');
 END IF;
 INSERT INTO gw_r2_nonces(key_id,nonce,envelope_sha256,delivery_id)VALUES(_source_key,_nonce,h,prior.delivery_id)ON CONFLICT DO NOTHING;
 RETURN jsonb_build_object('outcome',CASE WHEN n.key_id IS NULL THEN 'admitted' ELSE 'exact_retry' END,'delivery_id',prior.delivery_id,'connection_id',prior.connection_id,'envelope_sha256',prior.envelope_sha256,'gateway_key_id',prior.gateway_key_id,'issued_at',prior.issued_at);
END $$;

-- Server verifies HMAC/full chain. SQL rebinds every identity and current key/connection under locks.
CREATE FUNCTION public.gw_r2_receipt_bound_internal(a public.gw_r2_admissions,r jsonb,stage text) RETURNS boolean LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT r->>'protocol'='rtgip/2-receipt/2' AND r->'receipt_version'='2'::jsonb AND r->>'kind'=stage
 AND r->>'event_id'=a.event_id::text AND r->>'connection_id'=a.connection_id AND r->>'delivery_id'=a.delivery_id
 AND r->>'envelope_sha256'=a.envelope_sha256 AND r->>'payload_sha256'=a.envelope->>'payload_sha256'
 AND r->>'route'=a.envelope->>'route' AND r->>'source_app'=a.envelope->>'source_app' AND r->>'target_app'=a.envelope->>'target_app'
 AND r->>'tenant_id'=a.envelope->>'tenant_id' AND r->>'rooftop_id'=a.envelope->>'rooftop_id'
 AND r->>'issuer'=CASE WHEN stage='gateway_admission' THEN 'gateway' ELSE a.envelope->>'target_app' END
 AND r->>'recipient'=CASE WHEN stage='gateway_admission' THEN a.envelope->>'source_app' ELSE 'gateway' END
 AND r->>'signature' ~ '^[0-9a-f]{64}$' AND EXISTS(SELECT 1 FROM public.gw_r2_keys k WHERE k.id=r->>'key_id'
 AND k.owner=r->>'issuer' AND k.status<>'revoked' AND clock_timestamp() BETWEEN k.not_before AND k.not_after
 AND to_timestamp((r->>'issued_at')::bigint) BETWEEN k.not_before AND k.not_after AND a.connection_id=ANY(k.connections))
$$;
CREATE FUNCTION public.gw_r2_save_admission_receipt(_id text,_receipt jsonb,_digest text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE a gw_r2_admissions; old gw_r2_receipts;
BEGIN
 SELECT * INTO a FROM gw_r2_admissions WHERE delivery_id=_id;
 PERFORM 1 FROM gw_r2_keys WHERE id=_receipt->>'key_id' FOR SHARE;
 IF a.delivery_id IS NULL OR gw_r2_receipt_bound_internal(a,_receipt,'gateway_admission') IS DISTINCT FROM true OR _receipt->>'key_id'<>a.gateway_key_id OR
 _receipt->>'outcome'<>'admitted' OR _receipt->'prev_receipt_sha256'<>'null'::jsonb OR (_receipt->>'issued_at')::bigint<>a.issued_at THEN RAISE EXCEPTION 'invalid admission receipt'; END IF;
 INSERT INTO gw_r2_receipts(digest,delivery_id,stage,receipt)VALUES(_digest,_id,'gateway_admission',_receipt)ON CONFLICT(delivery_id,stage)DO NOTHING;
 SELECT * INTO old FROM gw_r2_receipts WHERE delivery_id=_id AND stage='gateway_admission';
 IF old.digest<>_digest OR old.receipt<>_receipt THEN RAISE EXCEPTION 'conflicting admission receipt'; END IF;
END $$;

CREATE FUNCTION public.gw_r2_claim(_worker text,_limit int DEFAULT 4,_lease_s int DEFAULT 30) RETURNS SETOF public.gw_r2_dispatch LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE d gw_r2_dispatch; a gw_r2_admissions; n int:=0; tenants text[]:='{}';
BEGIN
 IF _limit NOT BETWEEN 1 AND 8 OR _lease_s NOT BETWEEN 5 AND 60 THEN RAISE EXCEPTION 'bounded worker policy'; END IF;
 FOR d IN SELECT q.* FROM gw_r2_dispatch q JOIN gw_r2_admissions x USING(delivery_id)
 WHERE q.state IN('pending','leased','target_persisted') AND q.next_attempt_at<=clock_timestamp()
 AND (q.state='pending' OR q.lease_until<=clock_timestamp())
 AND NOT EXISTS(SELECT 1 FROM gw_r2_admissions p JOIN gw_r2_dispatch pd USING(delivery_id) WHERE p.lane=x.lane AND p.seq<x.seq AND pd.state NOT IN('committed','quarantined','dead'))
 ORDER BY x.envelope->>'tenant_id',x.envelope->>'target_app',x.lane,x.seq FOR UPDATE OF q SKIP LOCKED LOOP
 SELECT * INTO a FROM gw_r2_admissions WHERE delivery_id=d.delivery_id;
 IF a.envelope->>'tenant_id'=ANY(tenants) THEN CONTINUE; END IF;
 IF d.attempts>=10 THEN
 UPDATE gw_r2_dispatch SET state='dead',token=NULL,lease_until=NULL,last_reason='attempt_budget_exhausted' WHERE delivery_id=d.delivery_id;
 INSERT INTO gw_r2_audit(delivery_id,action,generation)VALUES(d.delivery_id,'failed',d.generation);
 CONTINUE;
 END IF;
 PERFORM 1 FROM gw_settings WHERE id=1 FOR SHARE;
 PERFORM 1 FROM gw_r2_connections WHERE id=a.connection_id FOR SHARE;
 PERFORM 1 FROM gw_r2_mappings WHERE connection_id=a.connection_id AND instance_id=a.envelope#>>'{vehicle,instance_id}' AND episode_id=a.envelope#>>'{vehicle,episode_id}' FOR SHARE;
 IF NOT gw_r2_authorized_internal(a) OR NOT EXISTS(SELECT 1 FROM gw_r2_receipts WHERE delivery_id=d.delivery_id AND stage='gateway_admission') THEN CONTINUE; END IF;
 UPDATE gw_r2_dispatch q SET state='leased',generation=q.generation+1,token=gen_random_uuid(),worker=_worker,lease_until=clock_timestamp()+make_interval(secs=>_lease_s),attempts=q.attempts+1
 WHERE q.delivery_id=d.delivery_id AND q.state IN('pending','leased','target_persisted') AND q.next_attempt_at<=clock_timestamp()
 AND (q.state='pending' OR q.lease_until<=clock_timestamp())
 AND NOT EXISTS(SELECT 1 FROM gw_r2_admissions p JOIN gw_r2_dispatch pd USING(delivery_id) WHERE p.lane=a.lane AND p.seq<a.seq AND pd.state NOT IN('committed','quarantined','dead'))
 RETURNING q.* INTO d;
 IF FOUND THEN RETURN NEXT d; n:=n+1; tenants:=array_append(tenants,a.envelope->>'tenant_id'); END IF;
 EXIT WHEN n>=_limit;
 END LOOP;
END $$;

CREATE FUNCTION public.gw_r2_complete(_id text,_generation bigint,_token uuid,_inbox jsonb,_inbox_digest text,_commit jsonb,_commit_digest text) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE d gw_r2_dispatch; a gw_r2_admissions; adm gw_r2_receipts; old gw_r2_receipts;
BEGIN
 SELECT * INTO d FROM gw_r2_dispatch WHERE delivery_id=_id FOR UPDATE;
 SELECT * INTO a FROM gw_r2_admissions WHERE delivery_id=_id;
 SELECT * INTO adm FROM gw_r2_receipts WHERE delivery_id=_id AND stage='gateway_admission';
 PERFORM 1 FROM gw_settings WHERE id=1 FOR SHARE;
 PERFORM 1 FROM gw_r2_connections WHERE id=a.connection_id FOR SHARE;
 PERFORM 1 FROM gw_r2_mappings WHERE connection_id=a.connection_id AND instance_id=a.envelope#>>'{vehicle,instance_id}' AND episode_id=a.envelope#>>'{vehicle,episode_id}' FOR SHARE;
 PERFORM 1 FROM gw_r2_keys WHERE id IN(_inbox->>'key_id',_commit->>'key_id') ORDER BY id FOR SHARE;
 IF d.delivery_id IS NULL OR NOT gw_r2_authorized_internal(a) THEN RETURN 'forbidden'; END IF;
 IF d.state='committed' THEN
 SELECT * INTO old FROM gw_r2_receipts WHERE delivery_id=_id AND stage='consumer_commit';
 RETURN CASE WHEN old.digest=_commit_digest AND old.receipt=_commit THEN 'exact_retry' ELSE 'conflict' END; END IF;
 IF d.state NOT IN('leased','target_persisted') OR d.generation<>_generation OR d.token IS DISTINCT FROM _token OR d.lease_until<=clock_timestamp() THEN RETURN 'lost_lease'; END IF;
 IF gw_r2_receipt_bound_internal(a,_inbox,'target_inbox') IS DISTINCT FROM true OR gw_r2_receipt_bound_internal(a,_commit,'consumer_commit') IS DISTINCT FROM true OR
 _inbox->>'prev_receipt_sha256' IS DISTINCT FROM adm.digest OR _commit->>'prev_receipt_sha256' IS DISTINCT FROM _inbox_digest OR
 _inbox->>'outcome' NOT IN('applied','duplicate','stale_ignored') OR _commit->>'outcome' NOT IN('applied','stale_ignored') OR
 (_inbox->>'outcome'<>'duplicate' AND _inbox->>'outcome'<>_commit->>'outcome') THEN RETURN 'invalid_chain'; END IF;
 INSERT INTO gw_r2_receipts(digest,delivery_id,stage,receipt)VALUES(_inbox_digest,_id,'target_inbox',_inbox),(_commit_digest,_id,'consumer_commit',_commit);
 UPDATE gw_r2_dispatch SET state='committed',token=NULL,lease_until=NULL WHERE delivery_id=_id;
 INSERT INTO gw_r2_audit(delivery_id,action,generation)VALUES(_id,'committed',_generation);
 RETURN 'committed';
END $$;
CREATE FUNCTION public.gw_r2_fail(_id text,_generation bigint,_token uuid) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE d gw_r2_dispatch;
BEGIN
 SELECT * INTO d FROM gw_r2_dispatch WHERE delivery_id=_id FOR UPDATE;
 IF d.delivery_id IS NULL OR d.state NOT IN('leased','target_persisted') OR d.generation<>_generation OR d.token IS DISTINCT FROM _token OR d.lease_until<=clock_timestamp() THEN RETURN 'lost_lease'; END IF;
 UPDATE gw_r2_dispatch SET state=CASE WHEN attempts>=10 THEN 'dead' ELSE 'pending' END,token=NULL,lease_until=NULL,
 next_attempt_at=clock_timestamp()+make_interval(secs=>least(900,5*power(2,least(attempts-1,10))::int)),last_reason='delivery_not_confirmed' WHERE delivery_id=_id;
 INSERT INTO gw_r2_audit(delivery_id,action,generation)VALUES(_id,'failed',_generation);
 RETURN CASE WHEN d.attempts>=10 THEN 'dead' ELSE 'retry' END;
END $$;
CREATE FUNCTION public.gw_r2_redrive(_id text,_case text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE a gw_r2_admissions;
BEGIN
 SELECT * INTO a FROM gw_r2_admissions WHERE delivery_id=_id;
 IF a.delivery_id IS NULL OR NOT gw_has_role(a.envelope->>'tenant_id',ARRAY['admin']::gw_role[]) OR length(trim(coalesce(_case,''))) NOT BETWEEN 3 AND 128 THEN RAISE EXCEPTION 'admin and case required'; END IF;
 UPDATE gw_r2_dispatch SET state='pending',attempts=0,generation=generation+1,token=NULL,lease_until=NULL,next_attempt_at=clock_timestamp(),last_reason='redriven' WHERE delivery_id=_id AND state IN('dead','quarantined');
 IF NOT FOUND THEN RAISE EXCEPTION 'not redrivable'; END IF;
 INSERT INTO gw_r2_audit(delivery_id,action,actor,case_ref)VALUES(_id,'redrive',auth.uid(),_case);
END $$;
REVOKE ALL ON FUNCTION public.gw_r2_append_only(),public.gw_r2_route_allowed(text,text,text,text),public.gw_r2_authorized_internal(public.gw_r2_admissions),public.gw_r2_receipt_bound_internal(public.gw_r2_admissions,jsonb,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.gw_r2_admit(text,text,text,text,text,bigint,text),public.gw_r2_save_admission_receipt(text,jsonb,text),public.gw_r2_claim(text,int,int),public.gw_r2_complete(text,bigint,uuid,jsonb,text,jsonb,text),public.gw_r2_fail(text,bigint,uuid),public.gw_r2_redrive(text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.gw_r2_admit(text,text,text,text,text,bigint,text),public.gw_r2_save_admission_receipt(text,jsonb,text),public.gw_r2_claim(text,int,int),public.gw_r2_complete(text,bigint,uuid,jsonb,text,jsonb,text),public.gw_r2_fail(text,bigint,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.gw_r2_redrive(text,text) TO authenticated;