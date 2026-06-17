-- Let platform admins save ANY tenant's dealer profile.
--
-- dealer_profiles RLS only allowed a tenant_members row of the target tenant to
-- read/write. A platform super-admin operating inside a dealer's tenant (e.g.
-- configuring Harte's inventory-scrape URLs, branding, doc fee) is NOT a member
-- of that tenant, so the upsert was denied and the edits only survived in local
-- cache — appearing to "not save" after a reload.
--
-- Add a has_role(uid,'admin') bypass to select/insert/update (membership path
-- preserved for normal dealer users). Same canonical (SELECT auth.uid()) wrap.

DROP POLICY IF EXISTS "dealer_profiles_select" ON public.dealer_profiles;
CREATE POLICY "dealer_profiles_select"
  ON public.dealer_profiles FOR SELECT
  TO authenticated
  USING (
    public.has_role((SELECT auth.uid()), 'admin')
    OR tenant_id IN (
      SELECT tenant_id FROM public.tenant_members
      WHERE user_id = (SELECT auth.uid())
    )
  );

DROP POLICY IF EXISTS "dealer_profiles_insert" ON public.dealer_profiles;
CREATE POLICY "dealer_profiles_insert"
  ON public.dealer_profiles FOR INSERT
  TO authenticated
  WITH CHECK (
    public.has_role((SELECT auth.uid()), 'admin')
    OR tenant_id IN (
      SELECT tenant_id FROM public.tenant_members
      WHERE user_id = (SELECT auth.uid())
    )
  );

DROP POLICY IF EXISTS "dealer_profiles_update" ON public.dealer_profiles;
CREATE POLICY "dealer_profiles_update"
  ON public.dealer_profiles FOR UPDATE
  TO authenticated
  USING (
    public.has_role((SELECT auth.uid()), 'admin')
    OR tenant_id IN (
      SELECT tenant_id FROM public.tenant_members
      WHERE user_id = (SELECT auth.uid())
    )
  )
  WITH CHECK (
    public.has_role((SELECT auth.uid()), 'admin')
    OR tenant_id IN (
      SELECT tenant_id FROM public.tenant_members
      WHERE user_id = (SELECT auth.uid())
    )
  );
