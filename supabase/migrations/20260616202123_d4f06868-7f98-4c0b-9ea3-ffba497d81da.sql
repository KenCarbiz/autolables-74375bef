
DROP POLICY IF EXISTS dealer_profiles_select ON public.dealer_profiles;
DROP POLICY IF EXISTS dealer_profiles_insert ON public.dealer_profiles;
DROP POLICY IF EXISTS dealer_profiles_update ON public.dealer_profiles;
CREATE POLICY dealer_profiles_select ON public.dealer_profiles FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT tenant_id FROM public.tenant_members
    WHERE user_id = (SELECT auth.uid()) AND accepted_at IS NOT NULL));
CREATE POLICY dealer_profiles_insert ON public.dealer_profiles FOR INSERT TO authenticated
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM public.tenant_members
    WHERE user_id = (SELECT auth.uid()) AND accepted_at IS NOT NULL));
CREATE POLICY dealer_profiles_update ON public.dealer_profiles FOR UPDATE TO authenticated
  USING (tenant_id IN (SELECT tenant_id FROM public.tenant_members
    WHERE user_id = (SELECT auth.uid()) AND accepted_at IS NOT NULL))
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM public.tenant_members
    WHERE user_id = (SELECT auth.uid()) AND accepted_at IS NOT NULL));

DROP POLICY IF EXISTS install_proofs_tenant_read ON public.install_proofs;
CREATE POLICY install_proofs_tenant_read ON public.install_proofs FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT tenant_id FROM public.tenant_members
    WHERE user_id = (SELECT auth.uid()) AND accepted_at IS NOT NULL));

DROP POLICY IF EXISTS "Tenant members read get_ready" ON public.get_ready_records;
DROP POLICY IF EXISTS "Tenant members write get_ready" ON public.get_ready_records;
CREATE POLICY "Tenant members read get_ready" ON public.get_ready_records FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT tenant_id FROM public.tenant_members
    WHERE user_id = (SELECT auth.uid()) AND accepted_at IS NOT NULL));
CREATE POLICY "Tenant members write get_ready" ON public.get_ready_records FOR ALL TO authenticated
  USING (tenant_id IN (SELECT tenant_id FROM public.tenant_members
    WHERE user_id = (SELECT auth.uid()) AND accepted_at IS NOT NULL))
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM public.tenant_members
    WHERE user_id = (SELECT auth.uid()) AND accepted_at IS NOT NULL));

DROP POLICY IF EXISTS prep_sign_offs_tenant_read ON public.prep_sign_offs;
CREATE POLICY prep_sign_offs_tenant_read ON public.prep_sign_offs FOR SELECT TO authenticated
  USING (store_id IN (SELECT (tenant_id)::text FROM public.tenant_members
    WHERE user_id = (SELECT auth.uid()) AND accepted_at IS NOT NULL));

DROP POLICY IF EXISTS "Tenant members read print jobs" ON public.zebra_print_jobs;
DROP POLICY IF EXISTS "Tenant members write print jobs" ON public.zebra_print_jobs;
CREATE POLICY "Tenant members read print jobs" ON public.zebra_print_jobs FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT tenant_id FROM public.tenant_members
    WHERE user_id = (SELECT auth.uid()) AND accepted_at IS NOT NULL));
CREATE POLICY "Tenant members write print jobs" ON public.zebra_print_jobs FOR ALL TO authenticated
  USING (tenant_id IN (SELECT tenant_id FROM public.tenant_members
    WHERE user_id = (SELECT auth.uid()) AND accepted_at IS NOT NULL))
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM public.tenant_members
    WHERE user_id = (SELECT auth.uid()) AND accepted_at IS NOT NULL));

DROP POLICY IF EXISTS "Tenant members read warranties" ON public.warranty_records;
DROP POLICY IF EXISTS "Tenant members write warranties" ON public.warranty_records;
CREATE POLICY "Tenant members read warranties" ON public.warranty_records FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT tenant_id FROM public.tenant_members
    WHERE user_id = (SELECT auth.uid()) AND accepted_at IS NOT NULL));
CREATE POLICY "Tenant members write warranties" ON public.warranty_records FOR ALL TO authenticated
  USING (tenant_id IN (SELECT tenant_id FROM public.tenant_members
    WHERE user_id = (SELECT auth.uid()) AND accepted_at IS NOT NULL))
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM public.tenant_members
    WHERE user_id = (SELECT auth.uid()) AND accepted_at IS NOT NULL));

DROP POLICY IF EXISTS psmc_tenant_read ON public.product_sale_mode_changes;
DROP POLICY IF EXISTS psmc_tenant_insert ON public.product_sale_mode_changes;
CREATE POLICY psmc_tenant_read ON public.product_sale_mode_changes FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT tenant_id FROM public.tenant_members
    WHERE user_id = (SELECT auth.uid()) AND accepted_at IS NOT NULL));
CREATE POLICY psmc_tenant_insert ON public.product_sale_mode_changes FOR INSERT TO authenticated
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM public.tenant_members
    WHERE user_id = (SELECT auth.uid()) AND accepted_at IS NOT NULL));

DROP POLICY IF EXISTS "Tenant members read product_rules" ON public.product_rules;
DROP POLICY IF EXISTS "Tenant members write product_rules" ON public.product_rules;
CREATE POLICY "Tenant members read product_rules" ON public.product_rules FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT tenant_id FROM public.tenant_members
    WHERE user_id = (SELECT auth.uid()) AND accepted_at IS NOT NULL));
CREATE POLICY "Tenant members write product_rules" ON public.product_rules FOR ALL TO authenticated
  USING (tenant_id IN (SELECT tenant_id FROM public.tenant_members
    WHERE user_id = (SELECT auth.uid()) AND accepted_at IS NOT NULL))
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM public.tenant_members
    WHERE user_id = (SELECT auth.uid()) AND accepted_at IS NOT NULL));
