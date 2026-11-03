-- Pre-apply backup facts. READ ONLY. Run as postgres on hosted AutoLabels before the first apply and keep the output
-- with the operator's backup record (see apply-plan.sh gate). Every component only creates new objects except S2, which
-- replaces public.apply_payment_estimator_settings; its current definition is captured here so it can be restored.
SELECT 'server_version|' || current_setting('server_version')
UNION ALL SELECT 'database|' || current_database()
UNION ALL SELECT 'database_bytes|' || pg_database_size(current_database())
UNION ALL SELECT 'wal_level|' || current_setting('wal_level')
UNION ALL SELECT 'archive_mode|' || current_setting('archive_mode')
UNION ALL SELECT 'pg_now|' || now()::text
UNION ALL SELECT 'existing_objects_in_package_schemas|' || (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname IN ('rtgip','rtgip_src','rtgip_fx'))
UNION ALL SELECT 'apply_payment_estimator_settings_md5|' || md5(p.prosrc) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'apply_payment_estimator_settings'
UNION ALL SELECT 'apply_payment_estimator_settings_acl|' || coalesce(p.proacl::text, 'default') FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'apply_payment_estimator_settings'
UNION ALL SELECT 'apply_payment_estimator_settings_definition|' || pg_get_functiondef(p.oid) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'apply_payment_estimator_settings';
