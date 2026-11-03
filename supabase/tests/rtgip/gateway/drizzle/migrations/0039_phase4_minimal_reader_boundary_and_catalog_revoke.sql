-- Catalog metadata is member-only, including managed default grants.
REVOKE ALL ON public.gw_extension_registry FROM PUBLIC,anon;
CREATE TABLE public.gw_extension_readers (
 key_id text PRIMARY KEY, extension_id text NOT NULL REFERENCES public.gw_extension_registry(id), app public.gw_app NOT NULL,
 tenant_id text NOT NULL REFERENCES public.gw_tenants(id), rooftop_id text NOT NULL REFERENCES public.gw_rooftops(id), provisioned_by uuid NOT NULL,
 not_before timestamptz NOT NULL, not_after timestamptz NOT NULL, revoked_at timestamptz,
 role text NOT NULL DEFAULT 'fact_reader' CHECK(role='fact_reader'), CHECK(not_after>not_before AND not_after-not_before<=interval '24 hours')
);
GRANT SELECT,INSERT,UPDATE ON public.gw_extension_readers TO service_role;
ALTER TABLE public.gw_extension_readers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.gw_extension_readers FROM PUBLIC,anon,authenticated;
ALTER TABLE public.gw_extension_grants ADD COLUMN reader_key_id text REFERENCES public.gw_extension_readers(key_id);
CREATE OR REPLACE FUNCTION public.gw_extension_read_local(_key text,_acl text,_tenant text,_rooftop text,_instance text,_episode text,_purpose text) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE g gw_extension_grants; c gw_extension_custody; k gw_extension_keys; reader gw_extension_readers; st gw_extension_state; reg gw_extension_registry; d jsonb;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM gw_settings WHERE environment='DEV' AND external_delivery_enabled=false) THEN RETURN NULL;END IF;
 SELECT * INTO reader FROM gw_extension_readers WHERE key_id=_key FOR SHARE;
 SELECT * INTO g FROM gw_extension_grants WHERE acl_ref=_acl AND reader_key_id=_key FOR SHARE;
 SELECT * INTO k FROM gw_extension_keys WHERE key_id=g.key_id FOR SHARE;
 SELECT * INTO reg FROM gw_extension_registry WHERE id=g.extension_id;
 SELECT * INTO c FROM gw_extension_custody WHERE tenant_id=_tenant AND instance_id=_instance FOR SHARE;
 IF reader.key_id IS NULL OR reader.revoked_at IS NOT NULL OR clock_timestamp()<reader.not_before OR clock_timestamp()>=reader.not_after OR reader.tenant_id IS DISTINCT FROM _tenant OR reader.rooftop_id IS DISTINCT FROM _rooftop OR reader.extension_id IS DISTINCT FROM reg.id OR reader.app IS DISTINCT FROM reg.target_app OR NOT EXISTS(SELECT 1 FROM gw_tenant_members m JOIN auth.users u ON u.id=m.user_id WHERE m.user_id=reader.provisioned_by AND m.tenant_id=reader.tenant_id AND m.role IN('admin','operator') AND u.email_confirmed_at IS NOT NULL AND NOT coalesce(u.is_anonymous,false)) THEN RETURN NULL;END IF;
 IF k.key_id IS NULL OR k.revoked_at IS NOT NULL OR clock_timestamp()<k.not_before OR clock_timestamp()>=k.not_after OR k.source_app IS DISTINCT FROM reg.source_app OR k.tenant_id IS DISTINCT FROM _tenant OR k.rooftop_id IS DISTINCT FROM _rooftop OR NOT EXISTS(SELECT 1 FROM gw_tenant_members m JOIN auth.users u ON u.id=m.user_id WHERE m.user_id=k.provisioned_by AND m.tenant_id=k.tenant_id AND m.role IN('admin','operator') AND u.email_confirmed_at IS NOT NULL AND NOT coalesce(u.is_anonymous,false)) OR g.acl_ref IS NULL OR NOT g.read_allowed OR g.revoked_at IS NOT NULL OR clock_timestamp()>=g.expires_at OR reg.id IS NULL OR g.extension_id IS DISTINCT FROM k.extension_id OR g.purpose IS DISTINCT FROM _purpose OR reg.purpose IS DISTINCT FROM _purpose OR g.tenant_id IS DISTINCT FROM _tenant OR g.rooftop_id IS DISTINCT FROM _rooftop OR g.instance_id IS DISTINCT FROM _instance OR g.episode_id IS DISTINCT FROM _episode OR c.instance_id IS NULL OR c.rooftop_id IS DISTINCT FROM _rooftop OR c.episode_id IS DISTINCT FROM _episode OR c.status IS DISTINCT FROM 'active' OR (reg.id='frame->curb' AND g.media_revoked) THEN RETURN NULL;END IF;
 IF NOT EXISTS(SELECT 1 FROM gw_tenants WHERE id=_tenant AND is_synthetic) OR NOT EXISTS(SELECT 1 FROM gw_vehicle_instances i JOIN gw_vehicle_identities vi ON vi.id=i.identity_id JOIN gw_listing_episodes ep ON ep.instance_id=i.id WHERE i.id=_instance AND i.tenant_id=_tenant AND i.rooftop_id=_rooftop AND vi.tenant_id=_tenant AND vi.vin=c.vin AND ep.id=_episode AND ep.tenant_id=_tenant) THEN RETURN NULL;END IF;
 SELECT * INTO st FROM gw_extension_state WHERE tenant_id=_tenant AND extension_id=reg.id AND instance_id=_instance AND episode_id=_episode;
 IF st.revision IS DISTINCT FROM g.revision OR st.raw_sha256 IS DISTINCT FROM g.raw_sha256 OR st.facts IS DISTINCT FROM g.facts OR (reg.id='labels->frame' AND st.facts?'advertised_price_cents' AND NOT g.price_authorized) THEN RETURN NULL;END IF;
 d:=jsonb_build_object('protocol','gw.extension/1','extension',reg.id,'source',reg.source_app,'target',reg.target_app,'event',reg.event_type,'tenant',_tenant,'rooftop',_rooftop,'vehicle',jsonb_build_object('vin',c.vin,'instance',_instance,'episode',_episode),'source_event',g.source_event,'revision',g.revision,'receipt_ref',g.receipt_ref,'acl_ref',g.acl_ref,'occurred_at','2026-11-02T00:00:00Z','facts',st.facts);
 IF gw_extension_contract_violation(d) IS NOT NULL THEN RETURN NULL;END IF;
 RETURN st.facts;
END $$;
REVOKE ALL ON FUNCTION public.gw_extension_read_local(text,text,text,text,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.gw_extension_read_local(text,text,text,text,text,text,text) TO service_role;