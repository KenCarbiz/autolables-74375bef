-- E postcondition. READ ONLY. One 'label|t/f' row per check; every row must be t.
SELECT 'component_installed|' || CASE WHEN (SELECT CASE WHEN bool_and(x) THEN 'installed' WHEN bool_or(x) THEN 'partial' ELSE 'missing' END FROM (VALUES
    (EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = to_regnamespace('rtgip_fx') AND p.proname = 'append_only')),
    (EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = to_regnamespace('rtgip_fx') AND p.proname = 'envelope_sha')),
    (EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = to_regnamespace('rtgip_fx') AND p.proname = 'labels_apply')),
    (EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = to_regnamespace('rtgip_fx') AND p.proname = 'labels_effect')),
    (EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = to_regnamespace('rtgip') AND p.proname = 'consumer_effect' AND position('labels_apply' IN p.prosrc) > 0)),
    (to_regclass('rtgip_fx.applied') IS NOT NULL),
    (to_regclass('rtgip_fx.acquisition_evidence') IS NOT NULL),
    (to_regclass('rtgip_fx.reconciliation_reviews') IS NOT NULL),
    (to_regclass('rtgip_fx.media_refs') IS NOT NULL),
    (to_regclass('rtgip_fx.media_revocations') IS NOT NULL),
    (to_regclass('rtgip_fx.media_reinstatements') IS NOT NULL),
    (to_regnamespace('rtgip_fx') IS NOT NULL),
    (EXISTS (SELECT 1 FROM pg_roles r WHERE r.rolname = 'rtgip_labels_consumer'))
  ) o(x)) = 'installed' THEN 't' ELSE 'f' END
UNION ALL
SELECT 'anon_has_no_table_privilege|' || CASE WHEN NOT EXISTS (SELECT 1 FROM unnest(ARRAY['rtgip_fx.applied','rtgip_fx.acquisition_evidence','rtgip_fx.reconciliation_reviews','rtgip_fx.media_refs','rtgip_fx.media_revocations','rtgip_fx.media_reinstatements']::text[]) t, LATERAL (VALUES ('SELECT'),('INSERT'),('UPDATE'),('DELETE'),('TRUNCATE'),('REFERENCES'),('TRIGGER')) pv(p) WHERE to_regclass(t) IS NOT NULL AND has_table_privilege('anon', to_regclass(t), pv.p)) THEN 't' ELSE 'f' END
UNION ALL
SELECT 'authenticated_has_no_table_privilege|' || CASE WHEN NOT EXISTS (SELECT 1 FROM unnest(ARRAY['rtgip_fx.applied','rtgip_fx.acquisition_evidence','rtgip_fx.reconciliation_reviews','rtgip_fx.media_refs','rtgip_fx.media_revocations','rtgip_fx.media_reinstatements']::text[]) t, LATERAL (VALUES ('SELECT'),('INSERT'),('UPDATE'),('DELETE'),('TRUNCATE'),('REFERENCES'),('TRIGGER')) pv(p) WHERE to_regclass(t) IS NOT NULL AND has_table_privilege('authenticated', to_regclass(t), pv.p)) THEN 't' ELSE 'f' END
UNION ALL
SELECT 'service_role_has_no_table_privilege|' || CASE WHEN NOT EXISTS (SELECT 1 FROM unnest(ARRAY['rtgip_fx.applied','rtgip_fx.acquisition_evidence','rtgip_fx.reconciliation_reviews','rtgip_fx.media_refs','rtgip_fx.media_revocations','rtgip_fx.media_reinstatements']::text[]) t, LATERAL (VALUES ('SELECT'),('INSERT'),('UPDATE'),('DELETE'),('TRUNCATE')) pv(p) WHERE to_regclass(t) IS NOT NULL AND has_table_privilege('service_role', to_regclass(t), pv.p)) THEN 't' ELSE 'f' END
UNION ALL
SELECT 'security_definer_functions_pin_search_path|' || CASE WHEN NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname || '.' || p.proname = ANY (ARRAY['rtgip.consumer_effect','rtgip_fx.append_only','rtgip_fx.envelope_sha','rtgip_fx.labels_apply','rtgip_fx.labels_effect']::text[]) AND p.prosecdef AND coalesce(array_to_string(p.proconfig, ','), '') NOT LIKE '%search_path=%') THEN 't' ELSE 'f' END
UNION ALL
SELECT 'anon_cannot_execute_non_trigger_functions|' || CASE WHEN NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname || '.' || p.proname = ANY (ARRAY['rtgip.consumer_effect','rtgip_fx.append_only','rtgip_fx.envelope_sha','rtgip_fx.labels_apply','rtgip_fx.labels_effect']::text[]) AND p.prorettype <> 'trigger'::regtype AND has_function_privilege('anon', p.oid, 'EXECUTE')) THEN 't' ELSE 'f' END
UNION ALL
SELECT 'authenticated_cannot_execute_non_trigger_functions|' || CASE WHEN NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname || '.' || p.proname = ANY (ARRAY['rtgip.consumer_effect','rtgip_fx.append_only','rtgip_fx.envelope_sha','rtgip_fx.labels_apply','rtgip_fx.labels_effect']::text[]) AND p.prorettype <> 'trigger'::regtype AND has_function_privilege('authenticated', p.oid, 'EXECUTE')) THEN 't' ELSE 'f' END
UNION ALL
SELECT 'service_role_cannot_execute_functions|' || CASE WHEN NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname || '.' || p.proname = ANY (ARRAY['rtgip.consumer_effect','rtgip_fx.append_only','rtgip_fx.envelope_sha','rtgip_fx.labels_apply','rtgip_fx.labels_effect']::text[]) AND has_function_privilege('service_role', p.oid, 'EXECUTE')) THEN 't' ELSE 'f' END
UNION ALL
SELECT 'only_consumer_executes_labels_apply|' || CASE WHEN has_function_privilege('rtgip_labels_consumer', 'rtgip_fx.labels_apply(jsonb)', 'EXECUTE') AND NOT has_function_privilege('rtgip_inbox_receiver', 'rtgip_fx.labels_effect(jsonb,text)', 'EXECUTE') THEN 't' ELSE 'f' END
UNION ALL
SELECT 'inbox_receiver_assumes_consumer_only|' || CASE WHEN pg_has_role('rtgip_inbox_receiver', 'rtgip_labels_consumer', 'MEMBER') THEN 't' ELSE 'f' END
UNION ALL
SELECT 'shared_inbox_runs_labels_effect|' || CASE WHEN (SELECT prosrc FROM pg_proc WHERE oid = to_regprocedure('rtgip.consumer_effect(jsonb)')) LIKE '%rtgip_fx.labels_apply%' THEN 't' ELSE 'f' END
UNION ALL
SELECT 'consumer_role_nologin|' || CASE WHEN NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rtgip_labels_consumer' AND (rolcanlogin OR rolinherit OR rolsuper)) THEN 't' ELSE 'f' END;
