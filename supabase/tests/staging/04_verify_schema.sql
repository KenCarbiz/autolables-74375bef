-- RooftopOS staging: schema verification. READ-ONLY. Run after the spine is applied
-- (and again after a rollback + re-apply). Every failed assertion raises an
-- exception naming what is wrong; the last two statements return the evidence rows.
-- Paste-safe: plain SQL, no psql meta-commands.

DO $$
DECLARE
  spine_tables text[] := ARRAY[
    'vehicles','vehicle_instances','vehicle_external_refs','integration_connections',
    'integration_connection_keys','integration_inbox','integration_source_versions',
    'integration_outbox','integration_direction_flags','inspection_evidence','repair_items',
    'acquisition_records'];
  tenant_read_tables text[] := ARRAY[
    'vehicle_instances','vehicle_external_refs','integration_connections','integration_inbox',
    'integration_outbox','integration_direction_flags','inspection_evidence','repair_items'];
  spine_functions text[] := ARRAY[
    'public.integration_key_secret(text)',
    'public.integration_record_source_version(uuid,text,bigint)',
    'public.integration_connection_secrets(uuid)',
    'public.integration_claim_inbox(integer,integer)',
    'public.integration_apply_event(uuid,jsonb)',
    'public.integration_fail_inbox(uuid,text,integer,boolean)'];
  dep_tables text[] := ARRAY['tenants','tenant_members','user_roles','audit_log'];
  dep_functions text[] := ARRAY[
    'public.has_role(uuid,public.app_role)',
    'public.is_tenant_manager(uuid,uuid)',
    'public.update_updated_at_column()'];
  t text;
  f text;
  v_bad text;
  v_n int;
BEGIN
  -- Objects exist, and RLS is on everywhere.
  FOREACH t IN ARRAY spine_tables || dep_tables LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      RAISE EXCEPTION 'verify: table public.% is missing', t;
    END IF;
    IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = ('public.' || t)::regclass) THEN
      RAISE EXCEPTION 'verify: RLS is not enabled on public.%', t;
    END IF;
  END LOOP;
  IF to_regtype('public.app_role') IS NULL THEN
    RAISE EXCEPTION 'verify: type public.app_role is missing';
  END IF;
  FOREACH f IN ARRAY spine_functions || dep_functions LOOP
    IF to_regprocedure(f) IS NULL THEN
      RAISE EXCEPTION 'verify: function % is missing', f;
    END IF;
  END LOOP;

  -- Spine functions: SECURITY DEFINER, pinned search_path, service_role only.
  FOREACH f IN ARRAY spine_functions LOOP
    IF NOT (SELECT prosecdef FROM pg_proc WHERE oid = to_regprocedure(f)) THEN
      RAISE EXCEPTION 'verify: % is not SECURITY DEFINER', f;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid = to_regprocedure(f)
                    AND EXISTS (SELECT 1 FROM unnest(proconfig) c WHERE c LIKE 'search_path=%')) THEN
      RAISE EXCEPTION 'verify: % has no pinned search_path', f;
    END IF;
    IF has_function_privilege('anon', f, 'EXECUTE') OR has_function_privilege('authenticated', f, 'EXECUTE') THEN
      RAISE EXCEPTION 'verify: % is executable by anon or authenticated', f;
    END IF;
    IF NOT has_function_privilege('service_role', f, 'EXECUTE') THEN
      RAISE EXCEPTION 'verify: % is not executable by service_role', f;
    END IF;
  END LOOP;
  IF has_function_privilege('anon', 'public.is_tenant_manager(uuid,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'verify: is_tenant_manager is executable by anon';
  END IF;

  -- Client grants on the spine: anon nothing at all; authenticated SELECT on the
  -- eight tenant-scoped tables only; nobody but service_role can write.
  FOREACH t IN ARRAY spine_tables LOOP
    IF has_table_privilege('anon', 'public.' || t, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') THEN
      RAISE EXCEPTION 'verify: anon holds a privilege on public.%', t;
    END IF;
    IF has_table_privilege('authenticated', 'public.' || t, 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') THEN
      RAISE EXCEPTION 'verify: authenticated holds a write privilege on public.%', t;
    END IF;
    IF has_table_privilege('authenticated', 'public.' || t, 'SELECT') <> (t = ANY (tenant_read_tables)) THEN
      RAISE EXCEPTION 'verify: authenticated SELECT on public.% is %, expected %',
        t, has_table_privilege('authenticated', 'public.' || t, 'SELECT'), (t = ANY (tenant_read_tables));
    END IF;
    IF NOT has_table_privilege('service_role', 'public.' || t, 'SELECT,INSERT,UPDATE,DELETE') THEN
      RAISE EXCEPTION 'verify: service_role cannot read/write public.%', t;
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.column_privileges
                WHERE table_schema = 'public' AND table_name = t AND grantee IN ('anon', 'PUBLIC')) THEN
      RAISE EXCEPTION 'verify: a column-level grant exposes public.% to anon/PUBLIC', t;
    END IF;
  END LOOP;

  -- Spine policies: exactly one SELECT policy per tenant-scoped table, TO
  -- authenticated, wrapped auth.uid(); no policy of any other command.
  SELECT string_agg(tablename || ':' || policyname, ', ') INTO v_bad
    FROM pg_policies
   WHERE schemaname = 'public' AND tablename = ANY (spine_tables)
     AND (cmd <> 'SELECT' OR roles <> ARRAY['authenticated']::name[]
          OR qual !~ '\(\s*SELECT\s+auth\.uid\(\)' OR NOT (tablename = ANY (tenant_read_tables)));
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'verify: unexpected spine policies: %', v_bad;
  END IF;
  SELECT count(*) INTO v_n FROM pg_policies WHERE schemaname = 'public' AND tablename = ANY (tenant_read_tables);
  IF v_n <> 8 THEN
    RAISE EXCEPTION 'verify: expected 8 spine SELECT policies, found %', v_n;
  END IF;

  -- Dependency policies: the final production set.
  SELECT count(*) INTO v_n FROM pg_policies WHERE schemaname = 'public' AND tablename = 'tenant_members'
     AND policyname IN ('Admins delete members','Admins insert members','Admins read all members',
       'Admins update all members','Members see their own memberships','Owners can invite members',
       'Users can accept their own membership');
  IF v_n <> 7 OR (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'tenant_members') <> 7 THEN
    RAISE EXCEPTION 'verify: tenant_members does not carry exactly the 7 production policies';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'tenant_members'
                  AND policyname = 'Members see their own memberships' AND qual ~ 'is_tenant_manager') THEN
    RAISE EXCEPTION 'verify: tenant_members self-read policy does not use is_tenant_manager (recursion risk)';
  END IF;
  SELECT string_agg(tablename || ':' || policyname, ', ') INTO v_bad
    FROM pg_policies
   WHERE schemaname = 'public' AND tablename = ANY (dep_tables)
     AND (coalesce(qual, '') || coalesce(with_check, '')) ~ 'auth\.uid\(\)'
     AND NOT ((coalesce(qual, '') || coalesce(with_check, '')) ~ '\(\s*SELECT\s+auth\.uid\(\)');
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'verify: dependency policies with an unwrapped auth.uid(): %', v_bad;
  END IF;

  -- No view or materialized view anywhere reads a spine table.
  SELECT string_agg(DISTINCT v.oid::regclass::text || ' -> ' || d.refobjid::regclass::text, ', ') INTO v_bad
    FROM pg_depend d
    JOIN pg_rewrite rw ON rw.oid = d.objid AND d.classid = 'pg_rewrite'::regclass
    JOIN pg_class v ON v.oid = rw.ev_class AND v.relkind IN ('v', 'm')
    JOIN pg_class s ON s.oid = d.refobjid
    JOIN pg_namespace sn ON sn.oid = s.relnamespace
   WHERE sn.nspname = 'public' AND s.relname = ANY (spine_tables) AND v.oid <> s.oid;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'verify: views expose spine tables: %', v_bad;
  END IF;

  -- Stored visibility can never be customer_public on the inbox.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.integration_inbox'::regclass AND contype = 'c'
                    AND pg_get_constraintdef(oid) ~ 'visibility' AND pg_get_constraintdef(oid) !~ 'requested_visibility'
                    AND pg_get_constraintdef(oid) !~ 'customer_public') THEN
    RAISE EXCEPTION 'verify: integration_inbox.visibility check does not exclude customer_public';
  END IF;
END $$;

SELECT 'PASS' AS verify_schema, current_database() AS database,
  (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname IN (
      'vehicles','vehicle_instances','vehicle_external_refs','integration_connections',
      'integration_connection_keys','integration_inbox','integration_source_versions',
      'integration_outbox','integration_direction_flags','inspection_evidence','repair_items',
      'acquisition_records'))                                                        AS spine_tables,
  (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname LIKE 'integration\_%')                  AS spine_functions,
  (SELECT count(*) FROM pg_policies WHERE schemaname = 'public'
    AND tablename IN ('tenants','tenant_members','user_roles','audit_log'))          AS dependency_policies,
  (SELECT count(*) FROM pg_policies WHERE schemaname = 'public'
    AND policyname LIKE '%\_tenant\_select')                                         AS spine_policies,
  (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p'))                          AS public_tables,
  now() AS checked_at;

SELECT 'table' AS kind, c.relname AS object,
       c.relrowsecurity AS rls_or_security_definer,
       has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE') AS anon_access,
       has_table_privilege('authenticated', c.oid, 'SELECT') AS authenticated_read_or_execute,
       has_table_privilege('authenticated', c.oid, 'INSERT,UPDATE,DELETE') AS authenticated_write,
       has_table_privilege('service_role', c.oid, 'SELECT,INSERT,UPDATE,DELETE') AS service_role_access,
       (SELECT count(*) FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = c.relname) AS policies
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public' AND c.relkind = 'r'
   AND c.relname IN ('tenants','tenant_members','user_roles','audit_log',
     'vehicles','vehicle_instances','vehicle_external_refs','integration_connections',
     'integration_connection_keys','integration_inbox','integration_source_versions',
     'integration_outbox','integration_direction_flags','inspection_evidence','repair_items',
     'acquisition_records')
 UNION ALL
SELECT 'function', p.oid::regprocedure::text,
       p.prosecdef,
       has_function_privilege('anon', p.oid, 'EXECUTE'),
       has_function_privilege('authenticated', p.oid, 'EXECUTE'),
       NULL,
       has_function_privilege('service_role', p.oid, 'EXECUTE'),
       NULL
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public'
   AND p.proname IN ('integration_key_secret','integration_record_source_version','integration_connection_secrets',
     'integration_claim_inbox','integration_apply_event','integration_fail_inbox',
     'has_role','is_tenant_manager','update_updated_at_column')
 ORDER BY 1, 2;
