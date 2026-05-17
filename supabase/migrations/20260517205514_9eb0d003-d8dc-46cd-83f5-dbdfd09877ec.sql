DROP POLICY IF EXISTS "Tenant members read print jobs"  ON public.zebra_print_jobs;
DROP POLICY IF EXISTS "Tenant members write print jobs" ON public.zebra_print_jobs;
CREATE POLICY "Tenant members read print jobs" ON public.zebra_print_jobs FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT tenant_id FROM public.tenant_members WHERE user_id = (SELECT auth.uid())));
CREATE POLICY "Tenant members write print jobs" ON public.zebra_print_jobs FOR ALL TO authenticated
  USING (tenant_id IN (SELECT tenant_id FROM public.tenant_members WHERE user_id = (SELECT auth.uid())))
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM public.tenant_members WHERE user_id = (SELECT auth.uid())));

DROP POLICY IF EXISTS "Tenant members read warranties"  ON public.warranty_records;
DROP POLICY IF EXISTS "Tenant members write warranties" ON public.warranty_records;
CREATE POLICY "Tenant members read warranties" ON public.warranty_records FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT tenant_id FROM public.tenant_members WHERE user_id = (SELECT auth.uid())));
CREATE POLICY "Tenant members write warranties" ON public.warranty_records FOR ALL TO authenticated
  USING (tenant_id IN (SELECT tenant_id FROM public.tenant_members WHERE user_id = (SELECT auth.uid())))
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM public.tenant_members WHERE user_id = (SELECT auth.uid())));

DROP POLICY IF EXISTS "Tenant members read get_ready"  ON public.get_ready_records;
DROP POLICY IF EXISTS "Tenant members write get_ready" ON public.get_ready_records;
CREATE POLICY "Tenant members read get_ready" ON public.get_ready_records FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT tenant_id FROM public.tenant_members WHERE user_id = (SELECT auth.uid())));
CREATE POLICY "Tenant members write get_ready" ON public.get_ready_records FOR ALL TO authenticated
  USING (tenant_id IN (SELECT tenant_id FROM public.tenant_members WHERE user_id = (SELECT auth.uid())))
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM public.tenant_members WHERE user_id = (SELECT auth.uid())));

CREATE INDEX IF NOT EXISTS idx_tenant_members_user_tenant
  ON public.tenant_members (user_id, tenant_id);