DROP POLICY IF EXISTS "Authenticated users can create tenants" ON public.tenants;
DROP POLICY IF EXISTS "provider_call_budgets read" ON public.provider_call_budgets;
CREATE POLICY "provider_call_budgets read" ON public.provider_call_budgets
  FOR SELECT TO authenticated
  USING (public.has_role((SELECT auth.uid()), 'admin'::public.app_role));