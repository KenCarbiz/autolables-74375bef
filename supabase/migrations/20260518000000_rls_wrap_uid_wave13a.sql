-- ──────────────────────────────────────────────────────────────
-- Wave 14.2 — RLS performance fix for the Wave 13a tables.
--
-- Supabase's canonical pattern (mid-2026 docs) is to wrap
-- `auth.uid()` in `(SELECT auth.uid())` so Postgres caches the
-- value once per statement as an initPlan instead of evaluating
-- it on every row. Without the wrap, RLS scans on tenant-scoped
-- tables degrade to O(n) `auth.uid()` calls per query.
--
-- Source: https://supabase.com/docs/guides/troubleshooting/rls-performance-and-best-practices-Z5Jjwv
--
-- Scope of THIS migration: only the three tables shipped in Wave
-- 13a (zebra_print_jobs, warranty_records, get_ready_records).
-- A broader sweep across all 17 historic migrations is left for
-- Wave 14.2.1 once we have a proper RLS regression test harness.
--
-- The migration also adds `TO authenticated` clauses (also a
-- canonical requirement so the planner can skip the policy for
-- anon connections entirely).
-- ──────────────────────────────────────────────────────────────

-- zebra_print_jobs ────────────────────────────────────────────
DROP POLICY IF EXISTS "Tenant members read print jobs"  ON public.zebra_print_jobs;
DROP POLICY IF EXISTS "Tenant members write print jobs" ON public.zebra_print_jobs;

CREATE POLICY "Tenant members read print jobs"
  ON public.zebra_print_jobs FOR SELECT TO authenticated
  USING (
    tenant_id IN (
      SELECT tenant_id FROM public.tenant_members
      WHERE user_id = (SELECT auth.uid())
    )
  );

CREATE POLICY "Tenant members write print jobs"
  ON public.zebra_print_jobs FOR ALL TO authenticated
  USING (
    tenant_id IN (
      SELECT tenant_id FROM public.tenant_members
      WHERE user_id = (SELECT auth.uid())
    )
  )
  WITH CHECK (
    tenant_id IN (
      SELECT tenant_id FROM public.tenant_members
      WHERE user_id = (SELECT auth.uid())
    )
  );

-- warranty_records ────────────────────────────────────────────
DROP POLICY IF EXISTS "Tenant members read warranties"  ON public.warranty_records;
DROP POLICY IF EXISTS "Tenant members write warranties" ON public.warranty_records;

CREATE POLICY "Tenant members read warranties"
  ON public.warranty_records FOR SELECT TO authenticated
  USING (
    tenant_id IN (
      SELECT tenant_id FROM public.tenant_members
      WHERE user_id = (SELECT auth.uid())
    )
  );

CREATE POLICY "Tenant members write warranties"
  ON public.warranty_records FOR ALL TO authenticated
  USING (
    tenant_id IN (
      SELECT tenant_id FROM public.tenant_members
      WHERE user_id = (SELECT auth.uid())
    )
  )
  WITH CHECK (
    tenant_id IN (
      SELECT tenant_id FROM public.tenant_members
      WHERE user_id = (SELECT auth.uid())
    )
  );

-- get_ready_records ───────────────────────────────────────────
DROP POLICY IF EXISTS "Tenant members read get_ready"  ON public.get_ready_records;
DROP POLICY IF EXISTS "Tenant members write get_ready" ON public.get_ready_records;

CREATE POLICY "Tenant members read get_ready"
  ON public.get_ready_records FOR SELECT TO authenticated
  USING (
    tenant_id IN (
      SELECT tenant_id FROM public.tenant_members
      WHERE user_id = (SELECT auth.uid())
    )
  );

CREATE POLICY "Tenant members write get_ready"
  ON public.get_ready_records FOR ALL TO authenticated
  USING (
    tenant_id IN (
      SELECT tenant_id FROM public.tenant_members
      WHERE user_id = (SELECT auth.uid())
    )
  )
  WITH CHECK (
    tenant_id IN (
      SELECT tenant_id FROM public.tenant_members
      WHERE user_id = (SELECT auth.uid())
    )
  );

-- Helpful composite indexes on tenant_members so the IN-subquery
-- planner can use an index-only scan. Idempotent.
CREATE INDEX IF NOT EXISTS idx_tenant_members_user_tenant
  ON public.tenant_members (user_id, tenant_id);
