-- S1 postcondition. READ ONLY. One 'label|t/f' row per check; every row must be t.
SELECT 'component_installed|' || CASE WHEN (SELECT CASE WHEN bool_and(x) THEN 'installed' WHEN bool_or(x) THEN 'partial' ELSE 'missing' END FROM (VALUES
    (EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = to_regnamespace('public') AND p.proname = 'integration_key_secret')),
    (EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = to_regnamespace('public') AND p.proname = 'integration_record_source_version')),
    (EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = to_regnamespace('public') AND p.proname = 'integration_connection_secrets')),
    (EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = to_regnamespace('public') AND p.proname = 'integration_fail_inbox')),
    (to_regclass('public.vehicles') IS NOT NULL),
    (to_regclass('public.vehicle_instances') IS NOT NULL),
    (to_regclass('public.vehicle_external_refs') IS NOT NULL),
    (to_regclass('public.integration_connections') IS NOT NULL),
    (to_regclass('public.integration_connection_keys') IS NOT NULL),
    (to_regclass('public.integration_inbox') IS NOT NULL),
    (to_regclass('public.integration_source_versions') IS NOT NULL),
    (to_regclass('public.integration_outbox') IS NOT NULL),
    (to_regclass('public.integration_direction_flags') IS NOT NULL),
    (to_regclass('public.inspection_evidence') IS NOT NULL),
    (to_regclass('public.repair_items') IS NOT NULL),
    (to_regclass('public.acquisition_records') IS NOT NULL),
    (EXISTS (SELECT 1 FROM pg_trigger g WHERE g.tgrelid = to_regclass('public.vehicle_instances') AND g.tgname = 'vehicle_instances_set_updated_at' AND NOT g.tgisinternal)),
    (EXISTS (SELECT 1 FROM pg_trigger g WHERE g.tgrelid = to_regclass('public.integration_connections') AND g.tgname = 'integration_connections_set_updated_at' AND NOT g.tgisinternal)),
    (EXISTS (SELECT 1 FROM pg_trigger g WHERE g.tgrelid = to_regclass('public.repair_items') AND g.tgname = 'repair_items_set_updated_at' AND NOT g.tgisinternal))
  ) o(x)) = 'installed' THEN 't' ELSE 'f' END
UNION ALL
SELECT 'anon_has_no_table_privilege|' || CASE WHEN NOT EXISTS (SELECT 1 FROM unnest(ARRAY['public.vehicles','public.vehicle_instances','public.vehicle_external_refs','public.integration_connections','public.integration_connection_keys','public.integration_inbox','public.integration_source_versions','public.integration_outbox','public.integration_direction_flags','public.inspection_evidence','public.repair_items','public.acquisition_records']::text[]) t, LATERAL (VALUES ('SELECT'),('INSERT'),('UPDATE'),('DELETE'),('TRUNCATE'),('REFERENCES'),('TRIGGER')) pv(p) WHERE to_regclass(t) IS NOT NULL AND has_table_privilege('anon', to_regclass(t), pv.p)) THEN 't' ELSE 'f' END
UNION ALL
SELECT 'authenticated_cannot_write|' || CASE WHEN NOT EXISTS (SELECT 1 FROM unnest(ARRAY['public.vehicles','public.vehicle_instances','public.vehicle_external_refs','public.integration_connections','public.integration_connection_keys','public.integration_inbox','public.integration_source_versions','public.integration_outbox','public.integration_direction_flags','public.inspection_evidence','public.repair_items','public.acquisition_records']::text[]) t, LATERAL (VALUES ('INSERT'),('UPDATE'),('DELETE'),('TRUNCATE')) pv(p) WHERE to_regclass(t) IS NOT NULL AND has_table_privilege('authenticated', to_regclass(t), pv.p)) THEN 't' ELSE 'f' END
UNION ALL
SELECT 'rls_enabled_on_every_table|' || CASE WHEN NOT EXISTS (SELECT 1 FROM unnest(ARRAY['public.vehicles','public.vehicle_instances','public.vehicle_external_refs','public.integration_connections','public.integration_connection_keys','public.integration_inbox','public.integration_source_versions','public.integration_outbox','public.integration_direction_flags','public.inspection_evidence','public.repair_items','public.acquisition_records']::text[]) t WHERE to_regclass(t) IS NOT NULL AND NOT (SELECT relrowsecurity FROM pg_class WHERE oid = to_regclass(t))) THEN 't' ELSE 'f' END
UNION ALL
SELECT 'security_definer_functions_pin_search_path|' || CASE WHEN NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname || '.' || p.proname = ANY (ARRAY['public.integration_connection_secrets','public.integration_fail_inbox','public.integration_key_secret','public.integration_record_source_version']::text[]) AND p.prosecdef AND coalesce(array_to_string(p.proconfig, ','), '') NOT LIKE '%search_path=%') THEN 't' ELSE 'f' END
UNION ALL
SELECT 'anon_cannot_execute_non_trigger_functions|' || CASE WHEN NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname || '.' || p.proname = ANY (ARRAY['public.integration_connection_secrets','public.integration_fail_inbox','public.integration_key_secret','public.integration_record_source_version']::text[]) AND p.prorettype <> 'trigger'::regtype AND has_function_privilege('anon', p.oid, 'EXECUTE')) THEN 't' ELSE 'f' END
UNION ALL
SELECT 'authenticated_cannot_execute_non_trigger_functions|' || CASE WHEN NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname || '.' || p.proname = ANY (ARRAY['public.integration_connection_secrets','public.integration_fail_inbox','public.integration_key_secret','public.integration_record_source_version']::text[]) AND p.prorettype <> 'trigger'::regtype AND has_function_privilege('authenticated', p.oid, 'EXECUTE')) THEN 't' ELSE 'f' END
UNION ALL
SELECT 'service_role_executes_spine_functions|' || CASE WHEN has_function_privilege('service_role', 'public.integration_key_secret(text)', 'EXECUTE') AND has_function_privilege('service_role', 'public.integration_connection_secrets(uuid)', 'EXECUTE') THEN 't' ELSE 'f' END;
