-- Rollback for drizzle/migrations/0016_feed_completeness_hold.sql. Restores the 0014 apply function
-- by re-running its definition; held snapshots become rejected first.
UPDATE public.inventory_store_snapshots SET status = 'rejected', reason = 'hold_rolled_back' WHERE status = 'held';
DROP FUNCTION IF EXISTS public.inv_admin_resolve_held_snapshot(uuid, text, text);
DROP FUNCTION IF EXISTS public.inv_admin_set_feed_completeness(uuid, jsonb, text);
-- Then re-apply the inventory_apply_store_snapshot definition from
-- drizzle/migrations/0014_inventory_duplicate_reconciliation.sql and:
-- DROP FUNCTION IF EXISTS public.inventory_apply_store_snapshot_mode(uuid, text);
-- Columns are left in place (harmless, NULL or default).
