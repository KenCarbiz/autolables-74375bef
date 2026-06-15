CREATE OR REPLACE FUNCTION public.is_tenant_manager(_tenant_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.tenant_members tm
    WHERE tm.tenant_id = _tenant_id
      AND tm.user_id = _user_id
      AND tm.role = ANY (ARRAY['owner'::text, 'admin'::text])
      AND tm.accepted_at IS NOT NULL
  );
$$;

DROP POLICY IF EXISTS "Members see their own memberships" ON public.tenant_members;
CREATE POLICY "Members see their own memberships"
  ON public.tenant_members FOR SELECT
  TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    OR public.is_tenant_manager(tenant_id, (SELECT auth.uid()))
  );

GRANT SELECT ON public.products TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.products TO authenticated;
GRANT ALL ON public.products TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.product_rules TO authenticated;
GRANT ALL ON public.product_rules TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.audit_log TO authenticated;
GRANT INSERT ON public.audit_log TO anon;
GRANT ALL ON public.audit_log TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.email_recipients TO authenticated;
GRANT ALL ON public.email_recipients TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.vehicle_files TO authenticated;
GRANT ALL ON public.vehicle_files TO service_role;

GRANT SELECT ON public.tenant_members TO authenticated;
GRANT ALL ON public.tenant_members TO service_role;