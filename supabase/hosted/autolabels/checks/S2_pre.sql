-- S2 precondition. READ ONLY. One 'label|t/f' row per prerequisite, then 'component_state|missing|installed|partial'.
-- Apply only when every prerequisite is t and the state is missing; installed means skip; partial means stop and inspect.
SELECT 'prereq:dealer_stores|' || CASE WHEN to_regclass('public.dealer_stores') IS NOT NULL THEN 't' ELSE 'f' END
UNION ALL
SELECT 'prereq:estimator_settings|' || CASE WHEN to_regclass('public.passport_payment_estimator_settings') IS NOT NULL THEN 't' ELSE 'f' END
UNION ALL
SELECT 'prereq:estimator_versions|' || CASE WHEN to_regclass('public.passport_payment_estimator_versions') IS NOT NULL THEN 't' ELSE 'f' END
UNION ALL
SELECT 'prereq:onboarding_profiles|' || CASE WHEN to_regclass('public.onboarding_profiles') IS NOT NULL THEN 't' ELSE 'f' END
UNION ALL
SELECT 'prereq:audit_log|' || CASE WHEN to_regclass('public.audit_log') IS NOT NULL THEN 't' ELSE 'f' END
UNION ALL
SELECT 'prereq:tenant_members|' || CASE WHEN to_regclass('public.tenant_members') IS NOT NULL THEN 't' ELSE 'f' END
UNION ALL
SELECT 'prereq:apply_function_present|' || CASE WHEN EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = to_regnamespace('public') AND p.proname = 'apply_payment_estimator_settings') THEN 't' ELSE 'f' END
UNION ALL
SELECT 'prereq:has_role|' || CASE WHEN EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = to_regnamespace('public') AND p.proname = 'has_role') THEN 't' ELSE 'f' END
UNION ALL
SELECT 'prereq:tenant_role_in|' || CASE WHEN EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = to_regnamespace('public') AND p.proname = 'tenant_role_in') THEN 't' ELSE 'f' END
UNION ALL
SELECT 'component_state|' || (SELECT CASE WHEN bool_and(x) THEN 'installed' WHEN bool_or(x) THEN 'partial' ELSE 'missing' END FROM (VALUES
    (EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = to_regnamespace('public') AND p.proname = 'tenant_store_registry')),
    (EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = to_regnamespace('public') AND p.proname = 'apply_payment_estimator_settings' AND position('dealer_stores' IN p.prosrc) > 0))
  ) o(x));
