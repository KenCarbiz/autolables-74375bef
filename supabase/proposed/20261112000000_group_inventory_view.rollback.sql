-- Rollback for 20261112000000_group_inventory_view.sql.
-- Drops the two read functions and the grants table. No inventory, listing or
-- conflict row is touched. The screens then fall back to the primary dealership
-- only, because a missing access function is treated as "group view unavailable".

DROP FUNCTION IF EXISTS public.inventory_group_view_rows(uuid, uuid[], integer, integer);
DROP FUNCTION IF EXISTS public.inventory_group_view_access(uuid);
DROP TABLE IF EXISTS public.inventory_group_view_grants;
