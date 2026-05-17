-- ──────────────────────────────────────────────────────────────
-- Wave 14.6 — opt the tenant-scoped tables into Supabase Realtime
-- so the client can subscribe to postgres_changes events and the
-- TanStack Query caches invalidate cross-device.
--
-- Scope: the high-traffic, cross-device-meaningful tables. These
-- are the surfaces where a dealer on desktop expects the lot
-- tablet to update without a manual refresh:
--   - vehicle_files          (Wave 10 — stickers / signings)
--   - vin_queue              (Wave 9  — scanner staging)
--   - leads                  (Wave 8  — capture funnel)
--   - product_rules          (Wave 13b — addendum rules)
--   - prep_sign_offs         (foreman sign-off, gates publish)
--
-- The Supabase docs name Broadcast-from-Database as the
-- preferred high-scale primitive; postgres_changes is the
-- simpler primitive and is documented as fine for "most use
-- cases that aren't at 80k concurrent". We start with
-- postgres_changes here and leave a note to migrate to
-- broadcast triggers if/when the concurrency curve demands it.
--
-- REPLICA IDENTITY FULL on each table is required so the
-- realtime payload for UPDATE/DELETE includes the OLD row.
-- Without it, clients can't reconcile the cache when a row's
-- tenant filter changes (e.g. a row is deleted — the change
-- event would only carry the row id, not its tenant_id, and
-- the client wouldn't know to evict the cached entry).
-- ──────────────────────────────────────────────────────────────

DO $$
DECLARE
  _table TEXT;
  _tables TEXT[] := ARRAY[
    'vehicle_files',
    'vin_queue',
    'leads',
    'product_rules',
    'prep_sign_offs'
  ];
BEGIN
  FOREACH _table IN ARRAY _tables LOOP
    -- Skip tables that don't exist yet (defensive — keeps the
    -- migration idempotent if a downstream env hasn't applied
    -- the table-creation migration for a given object).
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = _table
    ) THEN
      EXECUTE format('ALTER TABLE public.%I REPLICA IDENTITY FULL', _table);

      -- ALTER PUBLICATION ... ADD TABLE errors if the table is
      -- already in the publication. Guard with a catalog check.
      IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime'
          AND schemaname = 'public'
          AND tablename = _table
      ) THEN
        EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', _table);
      END IF;
    END IF;
  END LOOP;
END $$;
