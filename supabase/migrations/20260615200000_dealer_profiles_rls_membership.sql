-- Fix dealer_profiles RLS so dealer settings (doc fee, operating state,
-- dealership details) can actually be saved.
--
-- The original policies gated INSERT/UPDATE on public.current_tenant_id(),
-- which resolves to a SINGLE tenant (LIMIT 1) and additionally required an
-- owner/admin tenant_members row. For the active UI tenant — or any user
-- whose current_tenant_id() pick differs from the tenant being written —
-- the upsert failed with HTTP 400, so settings only survived in local cache.
--
-- Replace them with the canonical membership-based shape (auth.uid() wrapped
-- as an initPlan, scoped TO authenticated). See CLAUDE.md.

ALTER TABLE public.dealer_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Tenant members read dealer profile" ON public.dealer_profiles;
DROP POLICY IF EXISTS "Owners upsert dealer profile" ON public.dealer_profiles;
DROP POLICY IF EXISTS "Owners update dealer profile" ON public.dealer_profiles;

CREATE POLICY "dealer_profiles_select"
  ON public.dealer_profiles FOR SELECT
  TO authenticated
  USING (
    tenant_id IN (
      SELECT tenant_id FROM public.tenant_members
      WHERE user_id = (SELECT auth.uid())
    )
  );

CREATE POLICY "dealer_profiles_insert"
  ON public.dealer_profiles FOR INSERT
  TO authenticated
  WITH CHECK (
    tenant_id IN (
      SELECT tenant_id FROM public.tenant_members
      WHERE user_id = (SELECT auth.uid())
    )
  );

CREATE POLICY "dealer_profiles_update"
  ON public.dealer_profiles FOR UPDATE
  TO authenticated
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
