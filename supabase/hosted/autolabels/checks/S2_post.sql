-- S2 postcondition. READ ONLY. One 'label|t/f' row per check; every row must be t.
SELECT 'component_installed|' || CASE WHEN (SELECT CASE WHEN bool_and(x) THEN 'installed' WHEN bool_or(x) THEN 'partial' ELSE 'missing' END FROM (VALUES
    (EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = to_regnamespace('public') AND p.proname = 'tenant_store_registry')),
    (EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = to_regnamespace('public') AND p.proname = 'apply_payment_estimator_settings' AND position('dealer_stores' IN p.prosrc) > 0))
  ) o(x)) = 'installed' THEN 't' ELSE 'f' END
UNION ALL
SELECT 'security_definer_functions_pin_search_path|' || CASE WHEN NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname || '.' || p.proname = ANY (ARRAY['public.apply_payment_estimator_settings','public.tenant_store_registry']::text[]) AND p.prosecdef AND coalesce(array_to_string(p.proconfig, ','), '') NOT LIKE '%search_path=%') THEN 't' ELSE 'f' END
UNION ALL
SELECT 'anon_cannot_execute_non_trigger_functions|' || CASE WHEN NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname || '.' || p.proname = ANY (ARRAY['public.apply_payment_estimator_settings','public.tenant_store_registry']::text[]) AND p.prorettype <> 'trigger'::regtype AND has_function_privilege('anon', p.oid, 'EXECUTE')) THEN 't' ELSE 'f' END
UNION ALL
SELECT 'registry_reader_is_authenticated_only|' || CASE WHEN has_function_privilege('authenticated', 'public.tenant_store_registry(uuid)', 'EXECUTE') AND NOT has_function_privilege('anon', 'public.tenant_store_registry(uuid)', 'EXECUTE') THEN 't' ELSE 'f' END
UNION ALL
SELECT 'estimator_apply_not_anon|' || CASE WHEN NOT has_function_privilege('anon', 'public.apply_payment_estimator_settings(uuid,text,integer,jsonb,uuid)', 'EXECUTE') THEN 't' ELSE 'f' END
UNION ALL
SELECT 'estimator_apply_pins_search_path|' || CASE WHEN EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = 'public.apply_payment_estimator_settings(uuid,text,integer,jsonb,uuid)'::regprocedure AND coalesce(array_to_string(p.proconfig, ','), '') LIKE '%search_path=%') THEN 't' ELSE 'f' END;
