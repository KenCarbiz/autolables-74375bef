-- Admin bypass for dealer_profiles RLS so platform/super-admins can configure any tenant
DROP POLICY IF EXISTS dealer_profiles_select ON public.dealer_profiles;
DROP POLICY IF EXISTS dealer_profiles_insert ON public.dealer_profiles;
DROP POLICY IF EXISTS dealer_profiles_update ON public.dealer_profiles;

CREATE POLICY dealer_profiles_select
  ON public.dealer_profiles FOR SELECT
  TO authenticated
  USING (
    public.has_role((SELECT auth.uid()), 'admin'::public.app_role)
    OR tenant_id IN (
      SELECT tenant_id FROM public.tenant_members
      WHERE user_id = (SELECT auth.uid())
    )
  );

CREATE POLICY dealer_profiles_insert
  ON public.dealer_profiles FOR INSERT
  TO authenticated
  WITH CHECK (
    public.has_role((SELECT auth.uid()), 'admin'::public.app_role)
    OR tenant_id IN (
      SELECT tenant_id FROM public.tenant_members
      WHERE user_id = (SELECT auth.uid())
    )
  );

CREATE POLICY dealer_profiles_update
  ON public.dealer_profiles FOR UPDATE
  TO authenticated
  USING (
    public.has_role((SELECT auth.uid()), 'admin'::public.app_role)
    OR tenant_id IN (
      SELECT tenant_id FROM public.tenant_members
      WHERE user_id = (SELECT auth.uid())
    )
  )
  WITH CHECK (
    public.has_role((SELECT auth.uid()), 'admin'::public.app_role)
    OR tenant_id IN (
      SELECT tenant_id FROM public.tenant_members
      WHERE user_id = (SELECT auth.uid())
    )
  );

NOTIFY pgrst, 'reload schema';
