-- Actual verified owner is read from membership; nothing in auth is modified. All provisioning rolls back.
DO $$ DECLARE actor uuid;viewer uuid:=gen_random_uuid();run text:=replace(gen_random_uuid()::text,'-','');r jsonb;passed int:=0;
BEGIN
 SELECT m.user_id INTO actor FROM gw_tenant_members m JOIN auth.users u ON u.id=m.user_id WHERE m.tenant_id='grp-syn-northwind' AND m.role='admin' AND u.email_confirmed_at IS NOT NULL AND NOT coalesce(u.is_anonymous,false) LIMIT 1;
 IF actor IS NULL THEN RAISE EXCEPTION 'VERIFIED_OWNER_REQUIRED';END IF;
 r:=gw_service_provision(actor,'sp-'||run,'autolabels','grp-syn-northwind',ARRAY['rt-syn-nw-01'],ARRAY['127.0.0.1'::inet],'spk-'||run,repeat('a',64),'event_publisher',ARRAY['inventory.updated'],ARRAY['autofilm','autocurb']::gw_app[],'{}'::gw_app[],'{}'::text[],clock_timestamp(),clock_timestamp()+interval '1 hour',30);
 IF r->>'decision' IS DISTINCT FROM 'provisioned_disabled' OR EXISTS(SELECT 1 FROM gw_service_connections WHERE connection_id='sp-'||run AND enabled) THEN RAISE EXCEPTION 'PROVISION_NOT_DISABLED';END IF;passed:=passed+1;
 BEGIN PERFORM gw_service_provision(viewer,'sv-'||run,'autolabels','grp-syn-northwind',ARRAY['rt-syn-nw-01'],ARRAY['127.0.0.1'::inet],'svk-'||run,repeat('b',64),'event_publisher',ARRAY['inventory.updated'],ARRAY['autofilm','autocurb']::gw_app[],'{}'::gw_app[],'{}'::text[],clock_timestamp(),clock_timestamp()+interval '1 hour',30);RAISE EXCEPTION 'UNVERIFIED_PROVISION';EXCEPTION WHEN others THEN IF sqlerrm IS DISTINCT FROM 'verified DEV operator required' THEN RAISE;END IF;END;passed:=passed+1;
 IF has_function_privilege('authenticated','public.gw_service_provision(uuid,text,public.gw_app,text,text[],inet[],text,text,text,text[],public.gw_app[],public.gw_app[],text[],timestamptz,timestamptz,integer)','EXECUTE') THEN RAISE EXCEPTION 'PUBLIC_PROVISION';END IF;passed:=passed+1;
 RAISE EXCEPTION 'GW_TESTS_PASSED: %',passed;
END $$;