-- R precondition. READ ONLY. One 'label|t/f' row per prerequisite, then 'component_state|missing|installed|partial'.
-- Apply only when every prerequisite is t and the state is missing; installed means skip; partial means stop and inspect.
SELECT 'prereq:spine_S1_installed|' || CASE WHEN (SELECT CASE WHEN bool_and(x) THEN 'installed' WHEN bool_or(x) THEN 'partial' ELSE 'missing' END FROM (VALUES
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
SELECT 'prereq:history_S3_installed|' || CASE WHEN (SELECT CASE WHEN bool_and(x) THEN 'installed' WHEN bool_or(x) THEN 'partial' ELSE 'missing' END FROM (VALUES
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
SELECT 'prereq:dealer_stores_status|' || CASE WHEN EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = to_regclass('public.dealer_stores') AND a.attname = 'status' AND NOT a.attisdropped) THEN 't' ELSE 'f' END
UNION ALL
SELECT 'prereq:dealer_stores_tenant_id|' || CASE WHEN EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = to_regclass('public.dealer_stores') AND a.attname = 'tenant_id' AND NOT a.attisdropped) THEN 't' ELSE 'f' END
UNION ALL
SELECT 'prereq:listings_owning_store_id|' || CASE WHEN EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = to_regclass('public.vehicle_listings') AND a.attname = 'owning_store_id' AND NOT a.attisdropped) THEN 't' ELSE 'f' END
UNION ALL
SELECT 'prereq:vehicle_files|' || CASE WHEN to_regclass('public.vehicle_files') IS NOT NULL THEN 't' ELSE 'f' END
UNION ALL
SELECT 'prereq:dealer_profiles_settings|' || CASE WHEN EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = to_regclass('public.dealer_profiles') AND a.attname = 'settings' AND NOT a.attisdropped) THEN 't' ELSE 'f' END
UNION ALL
SELECT 'prereq:listing_price_columns|' || CASE WHEN (SELECT count(*) = 9 FROM pg_attribute a WHERE a.attrelid = to_regclass('public.vehicle_listings') AND a.attname IN ('vin','slug','status','price','doc_fee','advertised_price_before_doc','website_sale_price','vehicle_file_id','updated_at') AND NOT a.attisdropped) THEN 't' ELSE 'f' END
UNION ALL
SELECT 'prereq:tenants|' || CASE WHEN to_regclass('public.tenants') IS NOT NULL THEN 't' ELSE 'f' END
UNION ALL
SELECT 'component_state|' || (SELECT CASE WHEN bool_and(x) THEN 'installed' WHEN bool_or(x) THEN 'partial' ELSE 'missing' END FROM (VALUES
    (EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = to_regnamespace('rtgip_src') AND p.proname = 'labels_authority')),
    (EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = to_regnamespace('rtgip_src') AND p.proname = 'labels_episode_history')),
    (EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = to_regnamespace('rtgip_src') AND p.proname = 'labels_episode_json')),
    (EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = to_regnamespace('rtgip_src') AND p.proname = 'labels_episode_milestones')),
    (EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = to_regnamespace('rtgip_src') AND p.proname = 'labels_listing_state')),
    (EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = to_regnamespace('rtgip_src') AND p.proname = 'labels_milestone_json')),
    (to_regclass('rtgip_src.rooftop_stores') IS NOT NULL),
    (to_regnamespace('rtgip_src') IS NOT NULL),
    (EXISTS (SELECT 1 FROM pg_roles r WHERE r.rolname = 'rtgip_source_reader'))
  ) o(x));
