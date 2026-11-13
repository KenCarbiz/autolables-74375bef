-- R postcondition. READ ONLY. One 'label|t/f' row per check; every row must be t.
SELECT 'component_installed|' || CASE WHEN (SELECT CASE WHEN bool_and(x) THEN 'installed' WHEN bool_or(x) THEN 'partial' ELSE 'missing' END FROM (VALUES
    (EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = to_regnamespace('rtgip_src') AND p.proname = 'labels_authority')),
    (EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = to_regnamespace('rtgip_src') AND p.proname = 'labels_episode_history')),
    (EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = to_regnamespace('rtgip_src') AND p.proname = 'labels_episode_json')),
    (EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = to_regnamespace('rtgip_src') AND p.proname = 'labels_episode_milestones')),
    (EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = to_regnamespace('rtgip_src') AND p.proname = 'labels_listing_state')),
    (EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = to_regnamespace('rtgip_src') AND p.proname = 'labels_milestone_json')),
    (to_regclass('rtgip_src.rooftop_stores') IS NOT NULL),
    (to_regnamespace('rtgip_src') IS NOT NULL),
    (EXISTS (SELECT 1 FROM pg_roles r WHERE r.rolname = 'rtgip_source_reader'))
  ) o(x)) = 'installed' THEN 't' ELSE 'f' END
UNION ALL
SELECT 'anon_has_no_table_privilege|' || CASE WHEN NOT EXISTS (SELECT 1 FROM unnest(ARRAY['rtgip_src.rooftop_stores']::text[]) t, LATERAL (VALUES ('SELECT'),('INSERT'),('UPDATE'),('DELETE'),('TRUNCATE'),('REFERENCES'),('TRIGGER')) pv(p) WHERE to_regclass(t) IS NOT NULL AND has_table_privilege('anon', to_regclass(t), pv.p)) THEN 't' ELSE 'f' END
UNION ALL
SELECT 'authenticated_has_no_table_privilege|' || CASE WHEN NOT EXISTS (SELECT 1 FROM unnest(ARRAY['rtgip_src.rooftop_stores']::text[]) t, LATERAL (VALUES ('SELECT'),('INSERT'),('UPDATE'),('DELETE'),('TRUNCATE'),('REFERENCES'),('TRIGGER')) pv(p) WHERE to_regclass(t) IS NOT NULL AND has_table_privilege('authenticated', to_regclass(t), pv.p)) THEN 't' ELSE 'f' END
UNION ALL
SELECT 'service_role_has_no_table_privilege|' || CASE WHEN NOT EXISTS (SELECT 1 FROM unnest(ARRAY['rtgip_src.rooftop_stores']::text[]) t, LATERAL (VALUES ('SELECT'),('INSERT'),('UPDATE'),('DELETE'),('TRUNCATE')) pv(p) WHERE to_regclass(t) IS NOT NULL AND has_table_privilege('service_role', to_regclass(t), pv.p)) THEN 't' ELSE 'f' END
UNION ALL
SELECT 'security_definer_functions_pin_search_path|' || CASE WHEN NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname || '.' || p.proname = ANY (ARRAY['rtgip_src.labels_authority','rtgip_src.labels_episode_history','rtgip_src.labels_episode_json','rtgip_src.labels_episode_milestones','rtgip_src.labels_listing_state','rtgip_src.labels_milestone_json']::text[]) AND p.prosecdef AND coalesce(array_to_string(p.proconfig, ','), '') NOT LIKE '%search_path=%') THEN 't' ELSE 'f' END
UNION ALL
SELECT 'anon_cannot_execute_non_trigger_functions|' || CASE WHEN NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname || '.' || p.proname = ANY (ARRAY['rtgip_src.labels_authority','rtgip_src.labels_episode_history','rtgip_src.labels_episode_json','rtgip_src.labels_episode_milestones','rtgip_src.labels_listing_state','rtgip_src.labels_milestone_json']::text[]) AND p.prorettype <> 'trigger'::regtype AND has_function_privilege('anon', p.oid, 'EXECUTE')) THEN 't' ELSE 'f' END
UNION ALL
SELECT 'authenticated_cannot_execute_non_trigger_functions|' || CASE WHEN NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname || '.' || p.proname = ANY (ARRAY['rtgip_src.labels_authority','rtgip_src.labels_episode_history','rtgip_src.labels_episode_json','rtgip_src.labels_episode_milestones','rtgip_src.labels_listing_state','rtgip_src.labels_milestone_json']::text[]) AND p.prorettype <> 'trigger'::regtype AND has_function_privilege('authenticated', p.oid, 'EXECUTE')) THEN 't' ELSE 'f' END
UNION ALL
SELECT 'service_role_cannot_execute_functions|' || CASE WHEN NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname || '.' || p.proname = ANY (ARRAY['rtgip_src.labels_authority','rtgip_src.labels_episode_history','rtgip_src.labels_episode_json','rtgip_src.labels_episode_milestones','rtgip_src.labels_listing_state','rtgip_src.labels_milestone_json']::text[]) AND has_function_privilege('service_role', p.oid, 'EXECUTE')) THEN 't' ELSE 'f' END
UNION ALL
SELECT 'source_reader_executes_the_three_entry_points_only|' || CASE WHEN has_function_privilege('rtgip_source_reader', 'rtgip_src.labels_episode_history(uuid,text,uuid)', 'EXECUTE') AND has_function_privilege('rtgip_source_reader', 'rtgip_src.labels_episode_milestones(uuid,text,uuid)', 'EXECUTE') AND has_function_privilege('rtgip_source_reader', 'rtgip_src.labels_listing_state(uuid,text,uuid)', 'EXECUTE') AND NOT has_function_privilege('rtgip_source_reader', 'rtgip_src.labels_authority(uuid,text,uuid)', 'EXECUTE') THEN 't' ELSE 'f' END
UNION ALL
SELECT 'reader_role_nologin|' || CASE WHEN NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rtgip_source_reader' AND (rolcanlogin OR rolinherit OR rolsuper)) THEN 't' ELSE 'f' END;
