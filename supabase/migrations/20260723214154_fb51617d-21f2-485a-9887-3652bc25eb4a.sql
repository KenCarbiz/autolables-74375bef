
DROP POLICY IF EXISTS "Users can accept their own membership" ON public.tenant_members;

CREATE POLICY "Users can accept their own membership"
  ON public.tenant_members
  FOR UPDATE
  TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (
    user_id = (SELECT auth.uid())
    AND role = (SELECT tm.role FROM public.tenant_members tm WHERE tm.id = tenant_members.id)
    AND tenant_id = (SELECT tm.tenant_id FROM public.tenant_members tm WHERE tm.id = tenant_members.id)
    AND user_id = (SELECT tm.user_id FROM public.tenant_members tm WHERE tm.id = tenant_members.id)
  );
