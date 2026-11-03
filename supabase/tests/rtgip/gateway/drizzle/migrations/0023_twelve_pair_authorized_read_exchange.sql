-- Synthetic DEV only: independent pull permissions, no event route changes, no browser writes.
CREATE TABLE public.gw_read_exchange_policy (
 source_app public.gw_app NOT NULL, consumer_app public.gw_app NOT NULL, purpose text NOT NULL,
 sections text[] NOT NULL, PRIMARY KEY(source_app,consumer_app), CHECK(source_app<>consumer_app)
);
REVOKE ALL ON public.gw_read_exchange_policy FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.gw_read_exchange_policy TO authenticated;
GRANT ALL ON public.gw_read_exchange_policy TO service_role;
ALTER TABLE public.gw_read_exchange_policy ENABLE ROW LEVEL SECURITY;
CREATE POLICY "signed operators inspect exchange semantics" ON public.gw_read_exchange_policy FOR SELECT TO authenticated USING(true);
CREATE TABLE public.gw_read_exchange_grants (
 key_id text NOT NULL REFERENCES public.gw_ingest_keys(key_id), source_app public.gw_app NOT NULL,
 purpose text NOT NULL, budget_per_min integer NOT NULL DEFAULT 2400 CHECK(budget_per_min BETWEEN 1 AND 10000),
 max_batch integer NOT NULL DEFAULT 50 CHECK(max_batch BETWEEN 1 AND 50), ttl_s integer NOT NULL DEFAULT 15 CHECK(ttl_s BETWEEN 1 AND 60),
 not_after timestamptz NOT NULL, revoked_at timestamptz, PRIMARY KEY(key_id,source_app)
);
REVOKE ALL ON public.gw_read_exchange_grants FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.gw_read_exchange_grants TO authenticated;
GRANT ALL ON public.gw_read_exchange_grants TO service_role;
ALTER TABLE public.gw_read_exchange_grants ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant admins inspect exchange grants" ON public.gw_read_exchange_grants FOR SELECT TO authenticated
 USING(EXISTS(SELECT 1 FROM public.gw_ingest_keys k WHERE k.key_id=gw_read_exchange_grants.key_id AND public.gw_has_role(k.tenant_id,ARRAY['admin']::public.gw_role[])));
CREATE INDEX gw_episodes_scope_current ON public.gw_listing_episodes(tenant_id,instance_id,opened_at DESC,id);
CREATE INDEX gw_outbox_owned_aggregate ON public.gw_outbox(tenant_id,source_app,aggregate_type,aggregate_id,aggregate_revision DESC);
CREATE INDEX gw_instances_scope ON public.gw_vehicle_instances(tenant_id,rooftop_id,identity_id,id);

-- Returns already-validated derived facts; no copies or app-owner writes are introduced.
CREATE FUNCTION public.gw_read_exchange(_key_id text,_nonce text,_ts timestamptz,_tenant text,_rooftop text,
 _source public.gw_app,_purpose text,_lookups jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
 SET search_path=public AS $$
DECLARE k gw_ingest_keys%rowtype; g gw_read_exchange_grants%rowtype; pol gw_read_exchange_policy%rowtype;
 t0 timestamptz:=clock_timestamp(); dec text; reason text; status integer:=200; used integer; n integer;
 lookup jsonb; inst record; chosen record; sec text; domain text; value jsonb; safe jsonb;
 items jsonb:='[]'; facts jsonb; revisions jsonb; provenance jsonb; cur_epi text; expected bigint; applied bigint;
 stale boolean; rows_n integer:=0; stale_n integer:=0; lag integer; latest timestamptz; br boolean;
BEGIN
 SELECT * INTO k FROM gw_ingest_keys WHERE key_id=_key_id;
 IF NOT FOUND THEN reason:='no app identity'; status:=401;
 ELSIF k.revoked_at IS NOT NULL OR clock_timestamp()<k.not_before OR clock_timestamp()>k.not_after THEN reason:='invalid app identity';status:=401;
 ELSIF _ts IS NULL OR abs(extract(epoch FROM clock_timestamp()-_ts))>300 THEN reason:='timestamp outside +/-300s';status:=401;
 ELSIF _nonce IS NULL OR _nonce !~ '^[A-Za-z0-9_-]{16,64}$' THEN reason:='bad nonce';status:=400;
 ELSIF _tenant IS DISTINCT FROM k.tenant_id OR NOT coalesce(_rooftop=ANY(k.rooftop_ids),false)
   OR NOT EXISTS(SELECT 1 FROM gw_rooftops WHERE id=_rooftop AND tenant_id=_tenant) THEN reason:='identity not bound to tenant/rooftop';status:=403;
 END IF;
 IF reason IS NULL THEN
  SELECT * INTO pol FROM gw_read_exchange_policy WHERE source_app=_source AND consumer_app=k.source_app;
  IF NOT FOUND OR pol.purpose IS DISTINCT FROM _purpose THEN reason:='source/purpose not authorized';status:=403; END IF;
 END IF;
 IF reason IS NULL THEN
  -- Per-key serialization enforces nonce/budget atomically; no global/tenant delivery lock.
  PERFORM 1 FROM gw_ingest_keys WHERE key_id=_key_id FOR UPDATE;
  SELECT * INTO g FROM gw_read_exchange_grants WHERE key_id=_key_id AND source_app=_source;
  IF NOT FOUND OR g.purpose IS DISTINCT FROM _purpose OR g.revoked_at IS NOT NULL OR g.not_after<clock_timestamp() THEN reason:='no exchange grant';status:=403;
  ELSIF jsonb_typeof(_lookups) IS DISTINCT FROM 'array' THEN reason:='lookups array required';status:=400;
  ELSIF jsonb_array_length(_lookups)<1 OR jsonb_array_length(_lookups)>g.max_batch THEN reason:='batch outside 1..50 cap';status:=400;
  ELSE
   n:=jsonb_array_length(_lookups);
   IF EXISTS(SELECT 1 FROM jsonb_array_elements(_lookups) l WHERE jsonb_typeof(l) IS DISTINCT FROM 'object'
     OR jsonb_typeof(l->'vin') IS DISTINCT FROM 'string' OR coalesce(l->>'vin','') !~ '^[A-HJ-NPR-Z0-9]{17}$'
     OR EXISTS(SELECT 1 FROM jsonb_object_keys(l) x WHERE x NOT IN('vin','instance_id'))
     OR (l ? 'instance_id' AND (jsonb_typeof(l->'instance_id') IS DISTINCT FROM 'string' OR l->>'instance_id' !~ '^[A-Za-z0-9._:-]{1,128}$')))
     THEN reason:='invalid lookup';status:=400; END IF;
  END IF;
 END IF;
 IF reason IS NULL THEN
  SELECT coalesce(sum(rows),0) INTO used FROM gw_read_audit WHERE key_id=_key_id AND mode='exchange' AND created_at>clock_timestamp()-interval '60 seconds';
  IF used+n>g.budget_per_min THEN reason:='exchange budget exhausted';status:=429; END IF;
 END IF;
 IF reason IS NULL THEN
  INSERT INTO gw_ingest_nonces(key_id,nonce) VALUES(_key_id,'x:'||_nonce) ON CONFLICT DO NOTHING;
  IF NOT FOUND THEN reason:='nonce replay';status:=409; END IF;
 END IF;
 IF reason IS NULL THEN
  FOR lookup IN SELECT * FROM jsonb_array_elements(_lookups) LOOP
   FOR inst IN SELECT vi.id,vid.vin FROM gw_vehicle_instances vi JOIN gw_vehicle_identities vid ON vid.id=vi.identity_id AND vid.tenant_id=vi.tenant_id
    WHERE vi.tenant_id=_tenant AND vi.rooftop_id=_rooftop AND vid.vin=lookup->>'vin'
     AND (NOT lookup ? 'instance_id' OR vi.id=lookup->>'instance_id') ORDER BY vi.id LIMIT 10 LOOP
    SELECT id INTO cur_epi FROM gw_listing_episodes WHERE tenant_id=_tenant AND instance_id=inst.id ORDER BY opened_at DESC,id DESC LIMIT 1;
    SELECT coalesce(max(aggregate_revision),0),max(accepted_at) INTO expected,latest FROM gw_outbox
      WHERE tenant_id=_tenant AND source_app=_source AND aggregate_type='vehicle_instance' AND aggregate_id=inst.id;
    facts:='{}';revisions:='{}';provenance:='{}';applied:=0;
    SELECT coalesce(bool_or(forced_open OR state IN('open','half_open')),false) INTO br FROM gw_circuit_breakers WHERE tenant_id=_tenant;
    SELECT count(*) INTO lag FROM gw_queue q JOIN gw_outbox o ON o.event_id=q.event_id
      WHERE q.tenant_id=_tenant AND o.source_app=_source AND o.aggregate_id=inst.id AND q.status IN('pending','retry','leased','held');
    stale:=expected=0 OR lag>0 OR br;
    FOREACH sec IN ARRAY pol.sections LOOP
     domain:=CASE sec WHEN 'sold_history' THEN 'listing' ELSE sec END;
     IF sec='identity' THEN facts:=facts||jsonb_build_object('identity',jsonb_build_object('vin',inst.vin,'instance_id',inst.id,'episode_id',cur_epi)); CONTINUE; END IF;
     -- Find highest source-specific validated derived projection. Never relabel another owner's fields.
     SELECT p.* INTO chosen FROM gw_projections p WHERE p.tenant_id=_tenant AND p.aggregate_type='vehicle_instance' AND p.aggregate_id=inst.id
      AND coalesce((p.source_revisions->>(_source::text||':vehicle_instance'))::bigint,0)>0
      AND CASE sec WHEN 'sold_history' THEN p.state ? 'listing_history' WHEN 'service' THEN p.state ? 'mpi' OR p.state ? 'repair'
        WHEN 'acquisition' THEN p.state ? 'appraisal' ELSE p.state ? sec END
      ORDER BY coalesce((p.source_revisions->>(_source::text||':vehicle_instance'))::bigint,0) DESC,p.updated_at DESC,p.target_app LIMIT 1;
     IF NOT FOUND THEN facts:=facts||jsonb_build_object(sec,jsonb_build_object('unavailable','no validated owned facts'));stale:=true;CONTINUE;END IF;
     applied:=greatest(applied,coalesce((chosen.source_revisions->>(_source::text||':vehicle_instance'))::bigint,0));
     value:=CASE sec WHEN 'sold_history' THEN chosen.state->'listing_history' WHEN 'acquisition' THEN chosen.state->'appraisal' ELSE chosen.state->sec END;
     safe:='{}';
     IF sec='listing' THEN
      IF value->>'source' IS DISTINCT FROM _source::text OR value->>'episode_id' IS DISTINCT FROM cur_epi THEN safe:='{"unavailable":"current episode not projected"}';stale:=true;
      ELSE SELECT coalesce(jsonb_object_agg(x.key,x.value),'{}') INTO safe FROM jsonb_each(value) x JOIN gw_source_authority a ON a.domain=domain AND a.field=x.key AND a.owner_app=_source AND a.shareable AND a.classification='internal';END IF;
     ELSIF sec='sold_history' THEN
      SELECT coalesce(jsonb_agg(jsonb_build_object('episode_id',h->>'episode_id','status',h->>'status','sold_at',h->'sold_at','lifecycle',h->'lifecycle') ORDER BY ord),'[]') INTO safe
        FROM jsonb_array_elements(coalesce(value,'[]')) WITH ORDINALITY x(h,ord) WHERE h->>'source'=_source::text AND h->>'status' IN('sold','delivered');
     ELSIF sec='media' THEN
      SELECT coalesce(jsonb_agg(filtered ORDER BY (filtered->>'preset_order')::int),'[]') INTO safe FROM (
       SELECT (SELECT jsonb_object_agg(z.key,z.value) FROM jsonb_each(m.value)z JOIN gw_source_authority a ON a.domain='media' AND a.field=z.key AND a.owner_app=_source AND a.shareable) filtered
       FROM jsonb_each(coalesce(value->'assets','{}'))m WHERE m.value->>'episode_id'=cur_epi
         AND m.value->>'mime' IN('image/jpeg','image/png','image/webp') AND m.value->>'object_ref' ~ '^objref:[A-Za-z0-9_-]+/[A-Za-z0-9._/-]+$'
         AND m.value->'approval'->>'role' IN('sales_manager','inventory_manager','general_manager')) assets;
     ELSIF sec='service' THEN
      value:=chosen.state->'mpi';
      IF value->>'source'='autofilm' AND value->'technician_verified'='true'::jsonb AND coalesce(value->>'evidence_ref','')<>''
       AND coalesce(value->>'approval_ref','')<>'' AND coalesce(value->>'service_visit_ref','')<>''
       AND value->>'reviewer_role' IN('service_manager','shop_foreman','quality_reviewer') THEN
       SELECT coalesce(jsonb_object_agg(x.key,x.value),'{}') INTO safe FROM jsonb_each(value)x JOIN gw_source_authority a ON a.domain='service' AND a.field=x.key AND a.owner_app=_source AND a.shareable;
      ELSE safe:='{"unavailable":"independent verified MPI evidence required"}';stale:=true;END IF;
     ELSIF sec='acquisition' THEN
      IF value->>'source'='autocurb' THEN safe:=jsonb_build_object('appraisal_completed',coalesce((value->>'appraisal_completed')::boolean,false),'acquired',coalesce((value->>'acquired')::boolean,false),'rev',value->'rev');
      ELSE safe:='{"unavailable":"no owned acquisition facts"}';stale:=true;END IF;
     ELSE
      IF value->>'source'=_source::text THEN SELECT coalesce(jsonb_object_agg(x.key,x.value),'{}') INTO safe FROM jsonb_each(value)x JOIN gw_source_authority a ON a.domain=domain AND a.field=x.key AND a.owner_app=_source AND a.shareable AND a.classification='internal';
      ELSE safe:='{"unavailable":"source ownership mismatch"}';stale:=true;END IF;
     END IF;
     facts:=facts||jsonb_build_object(sec,safe);
     revisions:=revisions||jsonb_build_object(sec,jsonb_build_object('applied',applied,'accepted',expected));
     provenance:=provenance||jsonb_build_object(sec,jsonb_build_object('owner',_source,'derived_projection_target',chosen.target_app,'source_updated_at',chosen.updated_at));
    END LOOP;
    stale:=stale OR applied<expected;
    items:=items||jsonb_build_array(jsonb_build_object('instance_id',inst.id,'vin',inst.vin,'episode_id',cur_epi,'source_app',_source,'facts',facts,
      'versions',revisions,'provenance',provenance,'freshness',jsonb_build_object('stale',stale,'as_of',clock_timestamp(),'source_timestamp',latest,'lag_copies',lag)));
    rows_n:=rows_n+1;IF stale THEN stale_n:=stale_n+1;END IF;
   END LOOP;
  END LOOP;
 END IF;
 INSERT INTO gw_read_audit(key_id,tenant_id,rooftop_id,purpose,mode,decision,http_status,reason,rows,stale_rows,duration_ms)
 VALUES(_key_id,k.tenant_id,_rooftop,_purpose,'exchange',CASE WHEN reason IS NULL THEN 'ok' ELSE 'denied' END,status,reason,coalesce(n,0),stale_n,extract(epoch FROM clock_timestamp()-t0)*1000);
 IF reason IS NOT NULL THEN RETURN jsonb_build_object('decision','denied','http_status',status,'reason',reason);END IF;
 RETURN jsonb_build_object('decision','ok','http_status',200,'schema','gw.read-exchange/1','source_app',_source,'consumer_app',k.source_app,
  'tenant_id',_tenant,'rooftop_id',_rooftop,'purpose',_purpose,'as_of',clock_timestamp(),'ttl_s',g.ttl_s,'items',items,'lookup_count',n);
END $$;
REVOKE ALL ON FUNCTION public.gw_read_exchange(text,text,timestamptz,text,text,public.gw_app,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.gw_read_exchange(text,text,timestamptz,text,text,public.gw_app,text,jsonb) TO service_role;