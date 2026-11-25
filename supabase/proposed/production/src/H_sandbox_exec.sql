-- H. Close the package's public tables to sandbox_exec writes (same defect as Gateway GW-F11).
-- Lovable Cloud's sandbox_exec role (LOGIN, BYPASSRLS) receives SELECT and INSERT on every new public
-- table through the postgres default privileges. RLS does not stop it, so S1 and S3 tables, including
-- the integration inbox and outbox and the append-only history, would accept its inserts. Run after E.
-- A no-op where the role does not exist. Revokes only; grants nothing, drops nothing, changes no row.
DO $$
DECLARE t text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sandbox_exec') THEN
    FOREACH t IN ARRAY ARRAY['acquisition_records','inspection_evidence','integration_connection_keys',
      'integration_connections','integration_direction_flags','integration_inbox','integration_outbox',
      'integration_source_versions','repair_item_status_history','repair_items','service_visits',
      'vehicle_access_grants','vehicle_custody_milestones','vehicle_external_refs','vehicle_history_audit',
      'vehicle_history_setting_keys','vehicle_history_settings','vehicle_identity_corrections',
      'vehicle_identity_quarantine','vehicle_instances','vehicle_reappearance_reviews','vehicles'] LOOP
      IF to_regclass('public.' || t) IS NOT NULL THEN
        EXECUTE format('REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.%I FROM sandbox_exec', t);
      END IF;
    END LOOP;
  END IF;
END $$;
