DROP POLICY IF EXISTS "Dealers can view own subscription" ON public.dealer_subscriptions;

CREATE POLICY "Tenant members can view their subscription"
  ON public.dealer_subscriptions FOR SELECT
  TO authenticated
  USING (
    dealer_id IN (
      SELECT tenant_id FROM public.tenant_members
      WHERE user_id = (SELECT auth.uid())
    )
  );