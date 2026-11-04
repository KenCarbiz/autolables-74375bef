-- Separate persisted roles are the only administrator authority. All fixtures roll back.
DO $$ DECLARE actor uuid:=gen_random_uuid();r jsonb;passed int:=0;
BEGIN
 -- The managed auth.users.role is a platform database role, never a Gateway business role.
 IF EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name IN('users','profiles') AND column_name IN('role','roles','is_admin')) OR position('gw_tenant_members' IN pg_get_functiondef('public.gw_has_role(text,public.gw_role[])'::regprocedure))=0 THEN RAISE EXCEPTION 'ROLE_ON_USER_PROFILE';END IF;passed:=passed+1;
 IF has_table_privilege('authenticated','public.gw_tenant_members','INSERT') OR has_table_privilege('authenticated','public.gw_tenant_members','UPDATE') OR has_table_privilege('authenticated','public.gw_tenant_members','DELETE') THEN RAISE EXCEPTION 'BROWSER_ROLE_MUTATION';END IF;passed:=passed+1;
 INSERT INTO gw_tenant_members(user_id,tenant_id,role) VALUES(actor,'grp-syn-northwind','viewer');
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated','user_metadata',jsonb_build_object('role','admin','is_admin',true))::text,true);
 IF gw_has_role('grp-syn-northwind',ARRAY['admin']::gw_role[]) THEN RAISE EXCEPTION 'USER_METADATA_ADMIN';END IF;passed:=passed+1;
 r:=gw_privileged_audit('grp-syn-northwind','outbox',gen_random_uuid()::text,'source_authority_audit','case-role-test');
 IF r->>'decision' IS DISTINCT FROM 'denied' THEN RAISE EXCEPTION 'VIEWER_AUDIT_ACCESS';END IF;passed:=passed+1;
 UPDATE gw_tenant_members SET role='admin' WHERE user_id=actor AND tenant_id='grp-syn-northwind';
 IF NOT gw_has_role('grp-syn-northwind',ARRAY['admin']::gw_role[]) OR gw_has_role('grp-syn-lakeshore',ARRAY['admin']::gw_role[]) THEN RAISE EXCEPTION 'TENANT_ROLE_BINDING';END IF;passed:=passed+1;
 PERFORM set_config('request.jwt.claims','{}',true);
 IF gw_has_role('grp-syn-northwind',ARRAY['admin']::gw_role[]) THEN RAISE EXCEPTION 'NULL_IDENTITY_ADMIN';END IF;passed:=passed+1;
 RAISE EXCEPTION 'GW_TESTS_PASSED: %',passed;
END $$;