-- Isolated disabled extension catalog; canonical gw_routes/allowlist/engine and operator endpoints untouched.
CREATE TABLE public.gw_extension_registry (
 id text PRIMARY KEY CHECK(id IN('labels->frame','film->frame','curb->frame','frame->curb')),
 source_app public.gw_app NOT NULL, target_app public.gw_app NOT NULL, event_type text NOT NULL, purpose text NOT NULL,
 version text NOT NULL DEFAULT 'gw.extension/1' CHECK(version='gw.extension/1'), enabled boolean NOT NULL DEFAULT false CHECK(enabled=false),
 UNIQUE(source_app,target_app), CHECK(source_app<>target_app)
);
GRANT SELECT ON public.gw_extension_registry TO authenticated;
GRANT ALL ON public.gw_extension_registry TO service_role;
ALTER TABLE public.gw_extension_registry ENABLE ROW LEVEL SECURITY;
CREATE POLICY extension_catalog_member ON public.gw_extension_registry FOR SELECT TO authenticated USING(EXISTS(SELECT 1 FROM public.gw_tenant_members WHERE user_id=auth.uid()));
CREATE TABLE public.gw_extension_keys (
 key_id text PRIMARY KEY, extension_id text NOT NULL REFERENCES public.gw_extension_registry(id), tenant_id text NOT NULL REFERENCES public.gw_tenants(id), rooftop_id text NOT NULL REFERENCES public.gw_rooftops(id),
 source_app public.gw_app NOT NULL, fingerprint text NOT NULL CHECK(fingerprint ~ '^[a-f0-9]{64}$'), provisioned_by uuid NOT NULL,
 not_before timestamptz NOT NULL, not_after timestamptz NOT NULL, revoked_at timestamptz,
 CHECK(not_after>not_before AND not_after-not_before<=interval '24 hours')
);
GRANT SELECT,INSERT,UPDATE ON public.gw_extension_keys TO service_role;
ALTER TABLE public.gw_extension_keys ENABLE ROW LEVEL SECURITY;
CREATE TABLE public.gw_extension_custody (
 tenant_id text NOT NULL REFERENCES public.gw_tenants(id), rooftop_id text NOT NULL REFERENCES public.gw_rooftops(id), instance_id text NOT NULL REFERENCES public.gw_vehicle_instances(id),
 vin text NOT NULL CHECK(vin ~ '^DEVSYN[A-HJ-NPR-Z0-9]{11}$'), episode_id text NOT NULL REFERENCES public.gw_listing_episodes(id),
 status text NOT NULL CHECK(status IN('active','sold','delivered','archived')), prior_instance_id text, prior_episode_id text, evidence_ref text NOT NULL,
 PRIMARY KEY(tenant_id,instance_id)
);
GRANT SELECT,INSERT,UPDATE ON public.gw_extension_custody TO service_role;
ALTER TABLE public.gw_extension_custody ENABLE ROW LEVEL SECURITY;
CREATE TABLE public.gw_extension_grants (
 acl_ref text PRIMARY KEY, key_id text NOT NULL REFERENCES public.gw_extension_keys(key_id), extension_id text NOT NULL REFERENCES public.gw_extension_registry(id),
 tenant_id text NOT NULL, rooftop_id text NOT NULL, instance_id text NOT NULL, episode_id text NOT NULL,
 receipt_ref text NOT NULL, source_event text NOT NULL, revision bigint NOT NULL CHECK(revision BETWEEN 1 AND 9007199254740991),
 raw_sha256 text NOT NULL CHECK(raw_sha256 ~ '^[a-f0-9]{64}$'), facts jsonb NOT NULL,
 expires_at timestamptz NOT NULL, revoked_at timestamptz, price_authorized boolean NOT NULL DEFAULT false, media_revoked boolean NOT NULL DEFAULT false,
 purpose text NOT NULL, read_allowed boolean NOT NULL DEFAULT false
);
GRANT SELECT,INSERT,UPDATE ON public.gw_extension_grants TO service_role;
ALTER TABLE public.gw_extension_grants ENABLE ROW LEVEL SECURITY;
CREATE TABLE public.gw_extension_state (
 tenant_id text NOT NULL, extension_id text NOT NULL REFERENCES public.gw_extension_registry(id), rooftop_id text NOT NULL, instance_id text NOT NULL, episode_id text NOT NULL,
 revision bigint NOT NULL DEFAULT 0, source_event text, raw_sha256 text, facts jsonb NOT NULL DEFAULT '{}', apply_count integer NOT NULL DEFAULT 0,
 PRIMARY KEY(tenant_id,extension_id,instance_id,episode_id)
);
GRANT SELECT,INSERT,UPDATE ON public.gw_extension_state TO service_role;
ALTER TABLE public.gw_extension_state ENABLE ROW LEVEL SECURITY;
CREATE TABLE public.gw_extension_receipts (
 key_id text NOT NULL, nonce text NOT NULL, tenant_id text NOT NULL, extension_id text NOT NULL, instance_id text NOT NULL, episode_id text NOT NULL,
 source_event text NOT NULL, revision bigint NOT NULL, raw_sha256 text NOT NULL, decision text NOT NULL CHECK(decision IN('applied','duplicate','stale','held','conflict')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), PRIMARY KEY(key_id,nonce)
);
GRANT SELECT,INSERT ON public.gw_extension_receipts TO service_role;
ALTER TABLE public.gw_extension_receipts ENABLE ROW LEVEL SECURITY;
CREATE UNIQUE INDEX gw_extension_single_effect ON public.gw_extension_receipts(tenant_id,extension_id,instance_id,episode_id,source_event) WHERE decision='applied';
CREATE TRIGGER gw_extension_receipt_immutable BEFORE UPDATE OR DELETE ON public.gw_extension_receipts FOR EACH ROW EXECUTE FUNCTION public.gw_forbid_mutation();
-- No browser rights to evidence, raw documents, grants, local state or executor. No new privileged browser RPC.
REVOKE ALL ON public.gw_extension_keys,public.gw_extension_custody,public.gw_extension_grants,public.gw_extension_state,public.gw_extension_receipts FROM PUBLIC,anon,authenticated;
REVOKE INSERT,UPDATE,DELETE ON public.gw_extension_registry FROM anon,authenticated;
CREATE FUNCTION public.gw_extension_contract_violation(d jsonb) RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path=public AS $$
DECLARE f jsonb; e text; allowed text[]; k text; r numeric;
BEGIN
 IF jsonb_typeof(d) IS DISTINCT FROM 'object' OR d->>'protocol' IS DISTINCT FROM 'gw.extension/1' THEN RETURN 'extension version';END IF;
 IF (SELECT count(*) FROM jsonb_object_keys(d))<>15 OR EXISTS(SELECT 1 FROM jsonb_object_keys(d)x WHERE x<>ALL(ARRAY['protocol','extension','source','target','event','tenant','rooftop','vehicle','source_event','revision','receipt_ref','acl_ref','occurred_at','facts','reserved'])) THEN
  -- Exactly fourteen fields; reserved is never admitted.
  IF (SELECT count(*) FROM jsonb_object_keys(d))<>14 OR EXISTS(SELECT 1 FROM jsonb_object_keys(d)x WHERE x<>ALL(ARRAY['protocol','extension','source','target','event','tenant','rooftop','vehicle','source_event','revision','receipt_ref','acl_ref','occurred_at','facts'])) THEN RETURN 'extension fields';END IF;
 ELSE RETURN 'extension fields';END IF;
 e:=d->>'extension'; f:=d->'facts';
 IF e NOT IN('labels->frame','film->frame','curb->frame','frame->curb') OR jsonb_typeof(f) IS DISTINCT FROM 'object' OR jsonb_typeof(d->'vehicle') IS DISTINCT FROM 'object' THEN RETURN 'extension shape';END IF;
 IF jsonb_typeof(d->'revision') IS DISTINCT FROM 'number' THEN RETURN 'revision type';END IF;
 r:=(d->>'revision')::numeric;IF r<>trunc(r) OR r NOT BETWEEN 1 AND 9007199254740991 THEN RETURN 'revision bounds';END IF;
 IF (SELECT count(*) FROM jsonb_object_keys(d->'vehicle'))<>3 OR EXISTS(SELECT 1 FROM jsonb_object_keys(d->'vehicle')x WHERE x<>ALL(ARRAY['vin','instance','episode'])) OR d->'vehicle'->>'vin' !~ '^DEVSYN[A-HJ-NPR-Z0-9]{11}$' THEN RETURN 'synthetic vehicle';END IF;
 FOREACH k IN ARRAY ARRAY['source_event','receipt_ref','acl_ref'] LOOP IF jsonb_typeof(d->k) IS DISTINCT FROM 'string' OR d->>k !~ '^[A-Za-z0-9._:-]{1,128}$' THEN RETURN 'reference type';END IF;END LOOP;
 FOREACH k IN ARRAY ARRAY['instance','episode'] LOOP IF jsonb_typeof(d->'vehicle'->k) IS DISTINCT FROM 'string' OR d->'vehicle'->>k !~ '^[A-Za-z0-9._:-]{1,128}$' THEN RETURN 'custody reference';END IF;END LOOP;
 IF d->>'tenant' !~ '^grp-syn-[a-z0-9-]{1,64}$' OR d->>'rooftop' !~ '^rt-syn-[a-z0-9-]{1,64}$' OR length(d::text)>16384 OR d::text ~* '(https?:|data:|;base64|[[:alnum:]._%+-]+@[[:alnum:].-]+\.[[:alpha:]]{2})' THEN RETURN 'unsafe data';END IF;
 IF jsonb_typeof(d->'occurred_at') IS DISTINCT FROM 'string' THEN RETURN 'event time';END IF;PERFORM (d->>'occurred_at')::timestamptz;
 IF e='labels->frame' THEN
  allowed:=ARRAY['status','advertised_price_cents','currency'];
  IF jsonb_typeof(f->'status') IS DISTINCT FROM 'string' OR f->>'status' NOT IN('active','sold','delivered','archived') THEN RETURN 'inventory status';END IF;
  IF (f?'advertised_price_cents')<>(f?'currency') THEN RETURN 'price currency';END IF;
  IF f?'advertised_price_cents' THEN IF jsonb_typeof(f->'advertised_price_cents') IS DISTINCT FROM 'number' OR f->>'currency' IS DISTINCT FROM 'USD' THEN RETURN 'price type';END IF;r:=(f->>'advertised_price_cents')::numeric;IF r<>trunc(r) OR r NOT BETWEEN 0 AND 1000000000 THEN RETURN 'price bounds';END IF;END IF;
 ELSIF e='film->frame' THEN
  allowed:=ARRAY['verified','condition','shot_hints','evidence_ref','visit_ref','reviewer_ref','technician_ref'];
  IF f->'verified' IS DISTINCT FROM 'true'::jsonb OR f->>'condition' NOT IN('pass','attention','fail') OR jsonb_typeof(f->'shot_hints') IS DISTINCT FROM 'array' THEN RETURN 'independent MPI required';END IF;
  IF jsonb_array_length(f->'shot_hints')>16 OR EXISTS(SELECT 1 FROM jsonb_array_elements(f->'shot_hints')x WHERE jsonb_typeof(x)<>'string' OR x#>>'{}' NOT IN('exterior_front','exterior_rear','interior','wheel','damage_detail')) THEN RETURN 'shot hint allowlist';END IF;
  FOREACH k IN ARRAY ARRAY['evidence_ref','visit_ref','reviewer_ref','technician_ref'] LOOP IF jsonb_typeof(f->k) IS DISTINCT FROM 'string' OR f->>k !~ '^[A-Za-z0-9._:-]{1,128}$' THEN RETURN 'MPI evidence';END IF;END LOOP;
  IF f->>'reviewer_ref'=f->>'technician_ref' THEN RETURN 'independent reviewer required';END IF;
 ELSIF e='curb->frame' THEN
  allowed:=ARRAY['completed','transition','title_audit_ref','completion_audit_ref','title_verified_at','completed_at','prior_instance','prior_episode'];
  IF f->'completed' IS DISTINCT FROM 'true'::jsonb OR f->>'transition' IS DISTINCT FROM 'purchase_complete' THEN RETURN 'completed acquisition required';END IF;
  FOREACH k IN ARRAY ARRAY['title_audit_ref','completion_audit_ref','prior_instance','prior_episode'] LOOP IF jsonb_typeof(f->k) IS DISTINCT FROM 'string' OR f->>k !~ '^[A-Za-z0-9._:-]{1,128}$' THEN RETURN 'acquisition audit';END IF;END LOOP;
  IF jsonb_typeof(f->'title_verified_at') IS DISTINCT FROM 'string' OR jsonb_typeof(f->'completed_at') IS DISTINCT FROM 'string' OR (f->>'title_verified_at')::timestamptz>(f->>'completed_at')::timestamptz OR f->>'prior_instance'=d->'vehicle'->>'instance' OR f->>'prior_episode'=d->'vehicle'->>'episode' THEN RETURN 'new custody chronology';END IF;
 ELSE
  allowed:=ARRAY['media_id','content_sha256','object_ref','mime','width','height','preset_version','preset_order','approval_id','role','approved_at'];
  FOREACH k IN ARRAY ARRAY['media_id','preset_version','approval_id'] LOOP IF jsonb_typeof(f->k) IS DISTINCT FROM 'string' OR f->>k !~ '^[A-Za-z0-9._:-]{1,128}$' THEN RETURN 'media reference';END IF;END LOOP;
  IF jsonb_typeof(f->'content_sha256') IS DISTINCT FROM 'string' OR f->>'content_sha256' !~ '^[a-f0-9]{64}$' OR jsonb_typeof(f->'object_ref') IS DISTINCT FROM 'string' OR f->>'object_ref' !~ '^objref:[a-z0-9-]{1,64}/[A-Za-z0-9._/-]{1,255}$' OR f->>'mime' NOT IN('image/jpeg','image/png','image/webp') OR f->>'role' NOT IN('sales_manager','inventory_manager','general_manager') THEN RETURN 'manager metadata required';END IF;
  FOREACH k IN ARRAY ARRAY['width','height','preset_order'] LOOP IF jsonb_typeof(f->k) IS DISTINCT FROM 'number' THEN RETURN 'media dimensions';END IF;r:=(f->>k)::numeric;IF r<>trunc(r) OR (k='preset_order' AND r NOT BETWEEN 0 AND 999) OR (k<>'preset_order' AND r NOT BETWEEN 1 AND 20000) THEN RETURN 'media bounds';END IF;END LOOP;
  IF jsonb_typeof(f->'approved_at') IS DISTINCT FROM 'string' THEN RETURN 'approval time';END IF;PERFORM (f->>'approved_at')::timestamptz;
 END IF;
 IF EXISTS(SELECT 1 FROM jsonb_object_keys(f)x WHERE x<>ALL(allowed)) THEN RETURN 'positive facts allowlist';END IF;
 IF e<>'labels->frame' AND (SELECT count(*) FROM jsonb_object_keys(f))<>cardinality(allowed) THEN RETURN 'required facts';END IF;
 RETURN NULL;
EXCEPTION WHEN others THEN RETURN 'invalid extension contract';END $$;
REVOKE ALL ON FUNCTION public.gw_extension_contract_violation(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.gw_extension_contract_violation(jsonb) TO service_role;
-- This is NOT ingress: only a trusted private server that has verified the domain-separated HMAC could call it.
-- No runtime wiring exists. Authoritative receipt/raw/facts binding and nonce rechecks remain in DB.
CREATE FUNCTION public.gw_extension_apply_local(_key text,d jsonb,_raw text,_nonce text,_ts timestamptz) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE k gw_extension_keys; g gw_extension_grants; c gw_extension_custody; reg gw_extension_registry; st gw_extension_state; old gw_extension_receipts; actor gw_role; h text; why text; decision text; v text;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM gw_settings WHERE environment='DEV' AND external_delivery_enabled=false) THEN RETURN jsonb_build_object('decision','denied');END IF;
 why:=gw_extension_contract_violation(d);IF why IS NOT NULL THEN RETURN jsonb_build_object('decision','rejected','reason',why);END IF;
 IF _raw IS NULL OR octet_length(_raw)>16384 OR _raw::jsonb IS DISTINCT FROM d OR _nonce IS NULL OR _nonce !~ '^[A-Za-z0-9_-]{16,64}$' OR _ts IS NULL OR abs(extract(epoch FROM clock_timestamp()-_ts))>300 THEN RETURN jsonb_build_object('decision','denied','reason','body or nonce');END IF;
 h:=encode(extensions.digest(_raw,'sha256'),'hex');
 SELECT * INTO k FROM gw_extension_keys WHERE key_id=_key FOR SHARE;
 SELECT * INTO reg FROM gw_extension_registry WHERE id=d->>'extension';
 SELECT role INTO actor FROM gw_tenant_members WHERE user_id=k.provisioned_by AND tenant_id=k.tenant_id;
 IF k.key_id IS NULL OR reg.id IS NULL OR k.revoked_at IS NOT NULL OR clock_timestamp()<k.not_before OR clock_timestamp()>=k.not_after OR k.extension_id<>reg.id OR k.source_app<>reg.source_app OR d->>'source'<>reg.source_app::text OR d->>'target'<>reg.target_app::text OR d->>'event'<>reg.event_type OR k.tenant_id<>d->>'tenant' OR k.rooftop_id<>d->>'rooftop' OR actor IS NULL OR actor NOT IN('admin','operator') OR NOT EXISTS(SELECT 1 FROM auth.users WHERE id=k.provisioned_by AND email_confirmed_at IS NOT NULL AND NOT coalesce(is_anonymous,false)) OR NOT EXISTS(SELECT 1 FROM gw_tenants WHERE id=k.tenant_id AND is_synthetic) OR NOT EXISTS(SELECT 1 FROM gw_rooftops WHERE id=k.rooftop_id AND tenant_id=k.tenant_id) THEN RETURN jsonb_build_object('decision','denied','reason','upstream key scope');END IF;
 SELECT * INTO c FROM gw_extension_custody WHERE tenant_id=k.tenant_id AND instance_id=d->'vehicle'->>'instance' FOR SHARE;
 IF c.instance_id IS NULL OR c.rooftop_id<>k.rooftop_id OR c.vin<>d->'vehicle'->>'vin' OR c.episode_id<>d->'vehicle'->>'episode' OR NOT EXISTS(SELECT 1 FROM gw_vehicle_instances i JOIN gw_vehicle_identities vi ON vi.id=i.identity_id JOIN gw_listing_episodes ep ON ep.instance_id=i.id WHERE i.id=c.instance_id AND i.tenant_id=c.tenant_id AND i.rooftop_id=c.rooftop_id AND vi.tenant_id=c.tenant_id AND vi.vin=c.vin AND ep.id=c.episode_id AND ep.tenant_id=c.tenant_id) THEN RETURN jsonb_build_object('decision','denied','reason','current custody');END IF;
 SELECT * INTO g FROM gw_extension_grants WHERE acl_ref=d->>'acl_ref' AND key_id=_key FOR SHARE;
 IF g.acl_ref IS NULL OR g.revoked_at IS NOT NULL OR clock_timestamp()>=g.expires_at OR g.extension_id<>reg.id OR g.tenant_id<>c.tenant_id OR g.rooftop_id<>c.rooftop_id OR g.instance_id<>c.instance_id OR g.episode_id<>c.episode_id OR g.receipt_ref<>d->>'receipt_ref' OR g.source_event<>d->>'source_event' OR g.revision<>(d->>'revision')::bigint OR g.raw_sha256<>h OR g.facts IS DISTINCT FROM d->'facts' OR g.purpose<>reg.purpose THEN RETURN jsonb_build_object('decision','held','reason','registered receipt ACL evidence');END IF;
 -- Per ordering lane only, no global lock. All permission rows locked through effect/receipt transaction.
 INSERT INTO gw_extension_state(tenant_id,extension_id,rooftop_id,instance_id,episode_id) VALUES(c.tenant_id,reg.id,c.rooftop_id,c.instance_id,c.episode_id) ON CONFLICT DO NOTHING;
 SELECT * INTO st FROM gw_extension_state WHERE tenant_id=c.tenant_id AND extension_id=reg.id AND instance_id=c.instance_id AND episode_id=c.episode_id FOR UPDATE;
 IF EXISTS(SELECT 1 FROM gw_extension_receipts WHERE key_id=_key AND nonce=_nonce) THEN RETURN jsonb_build_object('decision','denied','reason','nonce replay');END IF;
 SELECT * INTO old FROM gw_extension_receipts WHERE tenant_id=c.tenant_id AND extension_id=reg.id AND instance_id=c.instance_id AND episode_id=c.episode_id AND source_event=g.source_event AND decision='applied';
 IF (reg.id='labels->frame' AND (d->'facts'->>'status'<>c.status OR (d->'facts'?'advertised_price_cents' AND NOT g.price_authorized))) OR (reg.id<>'labels->frame' AND c.status<>'active') OR (reg.id='frame->curb' AND g.media_revoked) OR (reg.id='curb->frame' AND (c.prior_instance_id IS DISTINCT FROM d->'facts'->>'prior_instance' OR c.prior_episode_id IS DISTINCT FROM d->'facts'->>'prior_episode' OR NOT EXISTS(SELECT 1 FROM gw_vehicle_instances i JOIN gw_vehicle_identities vi ON vi.id=i.identity_id JOIN gw_listing_episodes ep ON ep.instance_id=i.id WHERE i.id=c.prior_instance_id AND i.tenant_id=c.tenant_id AND vi.tenant_id=c.tenant_id AND vi.vin=c.vin AND ep.id=c.prior_episode_id AND ep.tenant_id=c.tenant_id))) THEN decision:='held';
 ELSIF old.key_id IS NOT NULL THEN decision:=CASE WHEN old.raw_sha256=h AND old.revision=g.revision THEN 'duplicate' ELSE 'conflict' END;
 ELSIF g.revision<=st.revision THEN decision:='stale';
 ELSE
  UPDATE gw_extension_state SET revision=g.revision,source_event=g.source_event,raw_sha256=h,facts=g.facts,apply_count=apply_count+1 WHERE tenant_id=c.tenant_id AND extension_id=reg.id AND instance_id=c.instance_id AND episode_id=c.episode_id;
  decision:='applied';
 END IF;
 INSERT INTO gw_extension_receipts(key_id,nonce,tenant_id,extension_id,instance_id,episode_id,source_event,revision,raw_sha256,decision) VALUES(_key,_nonce,c.tenant_id,reg.id,c.instance_id,c.episode_id,g.source_event,g.revision,h,decision);
 RETURN jsonb_build_object('decision',decision,'local_only',true);
END $$;
REVOKE ALL ON FUNCTION public.gw_extension_apply_local(text,jsonb,text,text,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.gw_extension_apply_local(text,jsonb,text,text,timestamptz) TO service_role;
CREATE FUNCTION public.gw_extension_read_local(_key text,_acl text,_tenant text,_rooftop text,_instance text,_episode text,_purpose text) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE g gw_extension_grants; c gw_extension_custody; k gw_extension_keys; st gw_extension_state; reg gw_extension_registry;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM gw_settings WHERE environment='DEV' AND external_delivery_enabled=false) THEN RETURN NULL;END IF;
 SELECT * INTO k FROM gw_extension_keys WHERE key_id=_key FOR SHARE;
 SELECT * INTO g FROM gw_extension_grants WHERE acl_ref=_acl AND key_id=_key FOR SHARE;
 SELECT * INTO reg FROM gw_extension_registry WHERE id=g.extension_id;
 SELECT * INTO c FROM gw_extension_custody WHERE tenant_id=_tenant AND instance_id=_instance FOR SHARE;
 IF k.key_id IS NULL OR k.revoked_at IS NOT NULL OR clock_timestamp()<k.not_before OR clock_timestamp()>=k.not_after OR k.tenant_id IS DISTINCT FROM _tenant OR k.rooftop_id IS DISTINCT FROM _rooftop OR g.acl_ref IS NULL OR NOT g.read_allowed OR g.revoked_at IS NOT NULL OR clock_timestamp()>=g.expires_at OR reg.id IS NULL OR g.extension_id IS DISTINCT FROM k.extension_id OR g.purpose IS DISTINCT FROM _purpose OR reg.purpose IS DISTINCT FROM _purpose OR g.tenant_id IS DISTINCT FROM _tenant OR g.rooftop_id IS DISTINCT FROM _rooftop OR g.instance_id IS DISTINCT FROM _instance OR g.episode_id IS DISTINCT FROM _episode OR c.instance_id IS NULL OR c.rooftop_id IS DISTINCT FROM _rooftop OR c.episode_id IS DISTINCT FROM _episode OR c.status IS DISTINCT FROM 'active' OR (reg.id='frame->curb' AND g.media_revoked) THEN RETURN NULL;END IF;
 SELECT * INTO st FROM gw_extension_state WHERE tenant_id=_tenant AND extension_id=reg.id AND instance_id=_instance AND episode_id=_episode;
 IF st.revision IS DISTINCT FROM g.revision OR st.raw_sha256 IS DISTINCT FROM g.raw_sha256 OR st.facts IS DISTINCT FROM g.facts OR (reg.id='labels->frame' AND st.facts?'advertised_price_cents' AND NOT g.price_authorized) THEN RETURN NULL;END IF;
 RETURN st.facts;
END $$;
REVOKE ALL ON FUNCTION public.gw_extension_read_local(text,text,text,text,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.gw_extension_read_local(text,text,text,text,text,text,text) TO service_role;
CREATE FUNCTION public.gw_extension_delivery() RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$ SELECT '{"decision":"disabled","external_delivery":false,"status":"WAITING_SIGNED_STAGING"}'::jsonb $$;
REVOKE ALL ON FUNCTION public.gw_extension_delivery() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.gw_extension_delivery() TO service_role;