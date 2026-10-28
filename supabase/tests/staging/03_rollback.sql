-- RooftopOS staging: roll the spine back. Drops the 6 spine functions and the 12
-- spine tables in dependency order, then asserts every one is gone.
-- Paste-safe: plain SQL, no psql meta-commands. Idempotent (IF EXISTS throughout).
--
-- Left in place on purpose: 01_dependencies.sql objects (tenants, tenant_members,
-- user_roles, audit_log and their functions), the synthetic users, tenants and
-- members from 02_seed_synthetic.sql, and the rooftopos-staging-* Vault secrets.
-- Optional Vault cleanup after the run (SQL editor, as postgres):
--   DELETE FROM vault.secrets WHERE name LIKE 'rooftopos-staging-%';
--
-- Re-apply after a rollback, in this order:
--   1. supabase/migrations/20261030000000_rooftopos_spine.sql   (unchanged file)
--   2. supabase/tests/staging/00_isolation_check.sql             (must PASS)
--   3. supabase/tests/staging/04_verify_schema.sql               (must PASS)
--   4. supabase/tests/staging/02_seed_synthetic.sql              (recreates the
--      connections, flags and key rows; existing Vault secrets are reused)

DROP FUNCTION IF EXISTS public.integration_apply_event(uuid, jsonb);
DROP FUNCTION IF EXISTS public.integration_fail_inbox(uuid, text, integer, boolean);
DROP FUNCTION IF EXISTS public.integration_claim_inbox(integer, integer);
DROP FUNCTION IF EXISTS public.integration_connection_secrets(uuid);
DROP FUNCTION IF EXISTS public.integration_record_source_version(uuid, text, bigint);
DROP FUNCTION IF EXISTS public.integration_key_secret(text);

DROP TABLE IF EXISTS public.acquisition_records;
DROP TABLE IF EXISTS public.repair_items;
DROP TABLE IF EXISTS public.inspection_evidence;
DROP TABLE IF EXISTS public.integration_direction_flags;
DROP TABLE IF EXISTS public.integration_outbox;
DROP TABLE IF EXISTS public.integration_source_versions;
DROP TABLE IF EXISTS public.integration_inbox;
DROP TABLE IF EXISTS public.integration_connection_keys;
DROP TABLE IF EXISTS public.integration_connections;
DROP TABLE IF EXISTS public.vehicle_external_refs;
DROP TABLE IF EXISTS public.vehicle_instances;
DROP TABLE IF EXISTS public.vehicles;

DO $$
DECLARE
  v_left text;
BEGIN
  SELECT string_agg(c.relname, ', ') INTO v_left
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND c.relname IN (
       'vehicles','vehicle_instances','vehicle_external_refs','integration_connections',
       'integration_connection_keys','integration_inbox','integration_source_versions',
       'integration_outbox','integration_direction_flags','inspection_evidence','repair_items',
       'acquisition_records');
  IF v_left IS NOT NULL THEN
    RAISE EXCEPTION 'rollback: spine tables still present: %', v_left;
  END IF;

  SELECT string_agg(p.oid::regprocedure::text, ', ') INTO v_left
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname IN (
       'integration_key_secret','integration_record_source_version','integration_connection_secrets',
       'integration_claim_inbox','integration_apply_event','integration_fail_inbox');
  IF v_left IS NOT NULL THEN
    RAISE EXCEPTION 'rollback: spine functions still present: %', v_left;
  END IF;

  IF to_regclass('public.tenants') IS NULL OR to_regclass('public.tenant_members') IS NULL THEN
    RAISE EXCEPTION 'rollback: a dependency table was removed; only the spine may be dropped';
  END IF;
END $$;

SELECT 'PASS' AS rollback_check, current_database() AS database, now() AS checked_at;
