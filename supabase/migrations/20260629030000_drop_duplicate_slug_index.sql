-- ──────────────────────────────────────────────────────────────────────
-- Drop a redundant unique index on vehicle_listings(slug).
--
-- The table carried TWO unique indexes on slug: the constraint-backed
-- `vehicle_listings_slug_key` (UNIQUE (slug)) and a standalone duplicate
-- `idx_vehicle_listings_slug`. Both enforce the same uniqueness, so the
-- standalone index is pure write overhead on every listing insert/update.
-- Dropping it is behavior-neutral — uniqueness on slug stays enforced by
-- the `vehicle_listings_slug_key` constraint.
-- ──────────────────────────────────────────────────────────────────────

DROP INDEX IF EXISTS public.idx_vehicle_listings_slug;
