-- READ ONLY. H postcondition: no package public table is writable by sandbox_exec. One row; t is the pass.
SELECT NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sandbox_exec')
    OR NOT EXISTS (
      SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r'
        AND c.relname ~ '^(acquisition_records|inspection_evidence|integration_connection_keys|integration_connections|integration_direction_flags|integration_inbox|integration_outbox|integration_source_versions|repair_item_status_history|repair_items|service_visits|vehicle_access_grants|vehicle_custody_milestones|vehicle_external_refs|vehicle_history_audit|vehicle_history_setting_keys|vehicle_history_settings|vehicle_identity_corrections|vehicle_identity_quarantine|vehicle_instances|vehicle_reappearance_reviews|vehicles)$'
        AND has_table_privilege((SELECT oid FROM pg_roles WHERE rolname = 'sandbox_exec'), c.oid, 'INSERT,UPDATE,DELETE,TRUNCATE')
    ) AS h_sandbox_exec_closed;
