-- PROPOSED, NOT APPLIED. Reconciles the 2026-10-28 fee-preview fix with the
-- migration ledger without rewriting history.
--
-- On 2026-10-28 at about 16:03 UTC, on the owner's approval,
-- public.admin_doc_fee_change_preview was replaced directly in the hosted
-- database with the definition in
-- supabase/migrations/20261029120000_fix_fee_preview_warnings.sql
-- (recorded in commit 3ea14a4). No row for 20261029120000 was written to
-- supabase_migrations.schema_migrations, so the ledger understates what is
-- live.
--
-- This migration does NOT insert a row for 20261029120000 and does NOT
-- redefine the function. Applied through the normal process, it is recorded
-- under its own version (20261105000000). It:
--   1. verifies that the live definition is exactly the 20261029120000 one,
--      by the md5 of pg_get_functiondef (2a1468b9a62a9177b20193a345c77ce6,
--      read from production on 2026-10-29 and reproduced locally by applying
--      the 20261029120000 file); any other definition stops the migration
--      and nothing is recorded;
--   2. records the provenance on the function (COMMENT, which does not change
--      its definition) and in audit_log.
--
-- Policy B (supabase/proposed/20261031000000) is separate and still pending;
-- it replaces this function, and this check is expected to fail after it.

DO $$
DECLARE
  v_md5 text := md5(pg_get_functiondef('public.admin_doc_fee_change_preview(uuid,boolean,numeric,boolean)'::regprocedure));
BEGIN
  IF v_md5 IS DISTINCT FROM '2a1468b9a62a9177b20193a345c77ce6' THEN
    RAISE EXCEPTION 'admin_doc_fee_change_preview is not the 20261029120000 definition (md5 %); nothing recorded', v_md5;
  END IF;
END $$;

COMMENT ON FUNCTION public.admin_doc_fee_change_preview(uuid, boolean, numeric, boolean) IS
  'Definition from supabase/migrations/20261029120000_fix_fee_preview_warnings.sql, applied directly on 2026-10-28 ~16:03 UTC on the owner''s approval (commit 3ea14a4); verified by reconciliation migration 20261105000000 (pg_get_functiondef md5 2a1468b9a62a9177b20193a345c77ce6).';

INSERT INTO public.audit_log (action, entity_type, entity_id, details)
VALUES ('migration_reconciled', 'function', 'public.admin_doc_fee_change_preview', jsonb_build_object(
  'reconciliation_migration', '20261105000000',
  'definition_source', 'supabase/migrations/20261029120000_fix_fee_preview_warnings.sql',
  'applied_directly', '2026-10-28 ~16:03 UTC (owner approval; commit 3ea14a4)',
  'functiondef_md5', '2a1468b9a62a9177b20193a345c77ce6',
  'ledger_row_for_20261029120000', 'not inserted: the ledger records this reconciliation, not a historical apply'));
