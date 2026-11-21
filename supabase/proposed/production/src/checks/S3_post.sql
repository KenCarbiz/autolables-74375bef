-- S3 postcondition. READ ONLY. One 'label|t/f' row per check; every row must be t.
SELECT 'component_installed|' || CASE WHEN (SELECT CASE WHEN bool_and(x) THEN 'installed' WHEN bool_or(x) THEN 'partial' ELSE 'missing' END FROM (VALUES
    (EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = to_regnamespace('public') AND p.proname = 'integration_claim_inbox' AND position('vehicle_history_flag' IN p.prosrc) > 0)),
    (EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = to_regnamespace('public') AND p.proname = 'integration_apply_event' AND position('vehicle_history_flag' IN p.prosrc) > 0)),
    (EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = to_regnamespace('public') AND p.proname = 'integration_delivery_allowed')),
    (EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = to_regnamespace('public') AND p.proname = 'integration_quarantine')),
    (EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = to_regnamespace('public') AND p.proname = 'integration_replay_inbox')),
    (EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = to_regnamespace('public') AND p.proname = 'repair_items_record_status')),
    (EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = to_regnamespace('public') AND p.proname = 'vehicle_history_append_only')),
    (EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = to_regnamespace('public') AND p.proname = 'vehicle_history_apply_identity_correction')),
    (EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = to_regnamespace('public') AND p.proname = 'vehicle_history_audit_write')),
    (EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = to_regnamespace('public') AND p.proname = 'vehicle_history_backfill_tenant')),
    (EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = to_regnamespace('public') AND p.proname = 'vehicle_history_can_read')),
    (EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = to_regnamespace('public') AND p.proname = 'vehicle_history_effective_setting')),
    (EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = to_regnamespace('public') AND p.proname = 'vehicle_history_end_access')),
    (EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = to_regnamespace('public') AND p.proname = 'vehicle_history_flag')),
    (EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = to_regnamespace('public') AND p.proname = 'vehicle_history_flag_reappearance')),
    (EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = to_regnamespace('public') AND p.proname = 'vehicle_history_grant_access')),
    (EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = to_regnamespace('public') AND p.proname = 'vehicle_history_is_manager')),
    (EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = to_regnamespace('public') AND p.proname = 'vehicle_history_is_platform_admin')),
    (EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = to_regnamespace('public') AND p.proname = 'vehicle_history_is_service')),
    (EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = to_regnamespace('public') AND p.proname = 'vehicle_history_next_state')),
    (EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = to_regnamespace('public') AND p.proname = 'vehicle_history_owner_view')),
    (EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = to_regnamespace('public') AND p.proname = 'vehicle_history_record_milestone')),
    (EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = to_regnamespace('public') AND p.proname = 'vehicle_history_resolve_reappearance')),
    (EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = to_regnamespace('public') AND p.proname = 'vehicle_history_set_setting')),
    (EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = to_regnamespace('public') AND p.proname = 'vehicle_history_set_transaction_retention')),
    (EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = to_regnamespace('public') AND p.proname = 'vehicle_instances_custody_guard')),
    (to_regclass('public.vehicle_identity_quarantine') IS NOT NULL),
    (to_regclass('public.vehicle_identity_corrections') IS NOT NULL),
    (to_regclass('public.vehicle_custody_milestones') IS NOT NULL),
    (to_regclass('public.service_visits') IS NOT NULL),
    (to_regclass('public.repair_item_status_history') IS NOT NULL),
    (to_regclass('public.vehicle_reappearance_reviews') IS NOT NULL),
    (to_regclass('public.vehicle_access_grants') IS NOT NULL),
    (to_regclass('public.vehicle_history_setting_keys') IS NOT NULL),
    (to_regclass('public.vehicle_history_settings') IS NOT NULL),
    (to_regclass('public.vehicle_history_audit') IS NOT NULL),
    (EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = to_regclass('public.vehicles') AND a.attname = 'id' AND NOT a.attisdropped)),
    (EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = to_regclass('public.vehicle_instances') AND a.attname = 'listing_id' AND NOT a.attisdropped)),
    (EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = to_regclass('public.vehicle_instances') AND a.attname = 'opened_reason' AND NOT a.attisdropped)),
    (EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = to_regclass('public.vehicle_instances') AND a.attname = 'previous_instance_id' AND NOT a.attisdropped)),
    (EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = to_regclass('public.vehicle_instances') AND a.attname = 'custody_state' AND NOT a.attisdropped)),
    (EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = to_regclass('public.vehicle_custody_milestones') AND a.attname = 'seq' AND NOT a.attisdropped)),
    (EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = to_regclass('public.vehicle_access_grants') AND a.attname = 'transaction_access_until' AND NOT a.attisdropped)),
    (EXISTS (SELECT 1 FROM pg_trigger g WHERE g.tgrelid = to_regclass('public.vehicle_instances') AND g.tgname = 'vehicle_instances_custody_guard' AND NOT g.tgisinternal)),
    (EXISTS (SELECT 1 FROM pg_trigger g WHERE g.tgrelid = to_regclass('public.vehicle_custody_milestones') AND g.tgname = 'vehicle_custody_milestones_append_only' AND NOT g.tgisinternal)),
    (EXISTS (SELECT 1 FROM pg_trigger g WHERE g.tgrelid = to_regclass('public.vehicle_history_audit') AND g.tgname = 'vehicle_history_audit_append_only' AND NOT g.tgisinternal)),
    (EXISTS (SELECT 1 FROM pg_trigger g WHERE g.tgrelid = to_regclass('public.vehicle_history_settings') AND g.tgname = 'vehicle_history_settings_append_only' AND NOT g.tgisinternal)),
    (EXISTS (SELECT 1 FROM pg_trigger g WHERE g.tgrelid = to_regclass('public.repair_items') AND g.tgname = 'repair_items_status_history' AND NOT g.tgisinternal)),
    (EXISTS (SELECT 1 FROM pg_trigger g WHERE g.tgrelid = to_regclass('public.repair_item_status_history') AND g.tgname = 'repair_item_status_history_append_only' AND NOT g.tgisinternal))
  ) o(x)) = 'installed' THEN 't' ELSE 'f' END
UNION ALL
SELECT 'anon_has_no_table_privilege|' || CASE WHEN NOT EXISTS (SELECT 1 FROM unnest(ARRAY['public.vehicle_identity_quarantine','public.vehicle_identity_corrections','public.vehicle_custody_milestones','public.service_visits','public.repair_item_status_history','public.vehicle_reappearance_reviews','public.vehicle_access_grants','public.vehicle_history_setting_keys','public.vehicle_history_settings','public.vehicle_history_audit']::text[]) t, LATERAL (VALUES ('SELECT'),('INSERT'),('UPDATE'),('DELETE'),('TRUNCATE'),('REFERENCES'),('TRIGGER')) pv(p) WHERE to_regclass(t) IS NOT NULL AND has_table_privilege('anon', to_regclass(t), pv.p)) THEN 't' ELSE 'f' END
UNION ALL
SELECT 'authenticated_cannot_write|' || CASE WHEN NOT EXISTS (SELECT 1 FROM unnest(ARRAY['public.vehicle_identity_quarantine','public.vehicle_identity_corrections','public.vehicle_custody_milestones','public.service_visits','public.repair_item_status_history','public.vehicle_reappearance_reviews','public.vehicle_access_grants','public.vehicle_history_setting_keys','public.vehicle_history_settings','public.vehicle_history_audit']::text[]) t, LATERAL (VALUES ('INSERT'),('UPDATE'),('DELETE'),('TRUNCATE')) pv(p) WHERE to_regclass(t) IS NOT NULL AND has_table_privilege('authenticated', to_regclass(t), pv.p)) THEN 't' ELSE 'f' END
UNION ALL
SELECT 'rls_enabled_on_every_table|' || CASE WHEN NOT EXISTS (SELECT 1 FROM unnest(ARRAY['public.vehicle_identity_quarantine','public.vehicle_identity_corrections','public.vehicle_custody_milestones','public.service_visits','public.repair_item_status_history','public.vehicle_reappearance_reviews','public.vehicle_access_grants','public.vehicle_history_setting_keys','public.vehicle_history_settings','public.vehicle_history_audit']::text[]) t WHERE to_regclass(t) IS NOT NULL AND NOT (SELECT relrowsecurity FROM pg_class WHERE oid = to_regclass(t))) THEN 't' ELSE 'f' END
UNION ALL
SELECT 'security_definer_functions_pin_search_path|' || CASE WHEN NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname || '.' || p.proname = ANY (ARRAY['public.integration_apply_event','public.integration_claim_inbox','public.integration_delivery_allowed','public.integration_quarantine','public.integration_replay_inbox','public.repair_items_record_status','public.vehicle_history_append_only','public.vehicle_history_apply_identity_correction','public.vehicle_history_audit_write','public.vehicle_history_backfill_tenant','public.vehicle_history_can_read','public.vehicle_history_effective_setting','public.vehicle_history_end_access','public.vehicle_history_flag','public.vehicle_history_flag_reappearance','public.vehicle_history_grant_access','public.vehicle_history_is_manager','public.vehicle_history_is_platform_admin','public.vehicle_history_is_service','public.vehicle_history_next_state','public.vehicle_history_owner_view','public.vehicle_history_record_milestone','public.vehicle_history_resolve_reappearance','public.vehicle_history_set_setting','public.vehicle_history_set_transaction_retention','public.vehicle_instances_custody_guard']::text[]) AND p.prosecdef AND coalesce(array_to_string(p.proconfig, ','), '') NOT LIKE '%search_path=%') THEN 't' ELSE 'f' END
UNION ALL
SELECT 'anon_cannot_execute_non_trigger_functions|' || CASE WHEN NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname || '.' || p.proname = ANY (ARRAY['public.integration_apply_event','public.integration_claim_inbox','public.integration_delivery_allowed','public.integration_quarantine','public.integration_replay_inbox','public.repair_items_record_status','public.vehicle_history_append_only','public.vehicle_history_apply_identity_correction','public.vehicle_history_audit_write','public.vehicle_history_backfill_tenant','public.vehicle_history_can_read','public.vehicle_history_effective_setting','public.vehicle_history_end_access','public.vehicle_history_flag','public.vehicle_history_flag_reappearance','public.vehicle_history_grant_access','public.vehicle_history_is_manager','public.vehicle_history_is_platform_admin','public.vehicle_history_is_service','public.vehicle_history_next_state','public.vehicle_history_owner_view','public.vehicle_history_record_milestone','public.vehicle_history_resolve_reappearance','public.vehicle_history_set_setting','public.vehicle_history_set_transaction_retention','public.vehicle_instances_custody_guard']::text[]) AND p.prorettype <> 'trigger'::regtype AND has_function_privilege('anon', p.oid, 'EXECUTE')) THEN 't' ELSE 'f' END;
