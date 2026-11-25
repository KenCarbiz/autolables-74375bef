-- S1 precondition. READ ONLY. One 'label|t/f' row per prerequisite, then 'component_state|missing|installed|partial'.
-- Apply only when every prerequisite is t and the state is missing; installed means skip; partial means stop and inspect.
SELECT 'prereq:tenants|' || CASE WHEN to_regclass('public.tenants') IS NOT NULL THEN 't' ELSE 'f' END
UNION ALL
SELECT 'prereq:tenant_members|' || CASE WHEN to_regclass('public.tenant_members') IS NOT NULL THEN 't' ELSE 'f' END
UNION ALL
SELECT 'prereq:update_updated_at_column|' || CASE WHEN to_regprocedure('public.update_updated_at_column()') IS NOT NULL THEN 't' ELSE 'f' END
UNION ALL
SELECT 'prereq:vault_decrypted_secrets|' || CASE WHEN to_regclass('vault.decrypted_secrets') IS NOT NULL THEN 't' ELSE 'f' END
UNION ALL
SELECT 'prereq:api_roles|' || CASE WHEN (SELECT count(*) = 3 FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role')) THEN 't' ELSE 'f' END
UNION ALL
SELECT 'component_state|' || (SELECT CASE WHEN bool_and(x) THEN 'installed' WHEN bool_or(x) THEN 'partial' ELSE 'missing' END FROM (VALUES
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
  ) o(x));
