
-- installer_contacts
DROP POLICY IF EXISTS "installer contacts readable by tenant" ON public.installer_contacts;
CREATE POLICY "installer contacts readable by tenant" ON public.installer_contacts
  FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT tenant_id FROM public.tenant_members WHERE user_id = (SELECT auth.uid()) AND accepted_at IS NOT NULL));

-- price_watchers
DROP POLICY IF EXISTS "watchers readable by tenant" ON public.price_watchers;
CREATE POLICY "watchers readable by tenant" ON public.price_watchers
  FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT tenant_id FROM public.tenant_members WHERE user_id = (SELECT auth.uid()) AND accepted_at IS NOT NULL));

-- recon_estimates
DROP POLICY IF EXISTS "recon estimates readable by tenant" ON public.recon_estimates;
CREATE POLICY "recon estimates readable by tenant" ON public.recon_estimates
  FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT tenant_id FROM public.tenant_members WHERE user_id = (SELECT auth.uid()) AND accepted_at IS NOT NULL));

-- recon_estimate_lines
DROP POLICY IF EXISTS "recon lines readable by tenant" ON public.recon_estimate_lines;
CREATE POLICY "recon lines readable by tenant" ON public.recon_estimate_lines
  FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT tenant_id FROM public.tenant_members WHERE user_id = (SELECT auth.uid()) AND accepted_at IS NOT NULL));

-- recon_estimate_messages
DROP POLICY IF EXISTS "recon messages readable by tenant" ON public.recon_estimate_messages;
CREATE POLICY "recon messages readable by tenant" ON public.recon_estimate_messages
  FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT tenant_id FROM public.tenant_members WHERE user_id = (SELECT auth.uid()) AND accepted_at IS NOT NULL));

-- recall_service_tasks
DROP POLICY IF EXISTS "recall tasks readable by tenant" ON public.recall_service_tasks;
CREATE POLICY "recall tasks readable by tenant" ON public.recall_service_tasks
  FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT tenant_id FROM public.tenant_members WHERE user_id = (SELECT auth.uid()) AND accepted_at IS NOT NULL));

-- pdi_signoffs
DROP POLICY IF EXISTS "pdi readable by tenant" ON public.pdi_signoffs;
CREATE POLICY "pdi readable by tenant" ON public.pdi_signoffs
  FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT tenant_id FROM public.tenant_members WHERE user_id = (SELECT auth.uid()) AND accepted_at IS NOT NULL));

-- passport_engagement
DROP POLICY IF EXISTS "engagement readable by tenant" ON public.passport_engagement;
CREATE POLICY "engagement readable by tenant" ON public.passport_engagement
  FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT tenant_id FROM public.tenant_members WHERE user_id = (SELECT auth.uid()) AND accepted_at IS NOT NULL));

-- get_ready_invoices
DROP POLICY IF EXISTS "Tenant members manage get-ready invoices" ON public.get_ready_invoices;
CREATE POLICY "Tenant members manage get-ready invoices" ON public.get_ready_invoices
  FOR ALL TO authenticated
  USING (tenant_id IN (SELECT tenant_id FROM public.tenant_members WHERE user_id = (SELECT auth.uid()) AND accepted_at IS NOT NULL))
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM public.tenant_members WHERE user_id = (SELECT auth.uid()) AND accepted_at IS NOT NULL));

-- vehicle_work_events
DROP POLICY IF EXISTS "Tenant members manage vehicle work events" ON public.vehicle_work_events;
CREATE POLICY "Tenant members manage vehicle work events" ON public.vehicle_work_events
  FOR ALL TO authenticated
  USING (tenant_id IN (SELECT tenant_id FROM public.tenant_members WHERE user_id = (SELECT auth.uid()) AND accepted_at IS NOT NULL))
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM public.tenant_members WHERE user_id = (SELECT auth.uid()) AND accepted_at IS NOT NULL));

-- inventory_sync_runs
DROP POLICY IF EXISTS "Tenant members read own sync runs" ON public.inventory_sync_runs;
CREATE POLICY "Tenant members read own sync runs" ON public.inventory_sync_runs
  FOR SELECT TO authenticated
  USING (
    (tenant_id IN (SELECT tenant_id FROM public.tenant_members WHERE user_id = (SELECT auth.uid()) AND accepted_at IS NOT NULL))
    OR public.has_role((SELECT auth.uid()), 'admin'::app_role)
  );

-- inventory_sync_errors
DROP POLICY IF EXISTS "Tenant members read own sync errors" ON public.inventory_sync_errors;
CREATE POLICY "Tenant members read own sync errors" ON public.inventory_sync_errors
  FOR SELECT TO authenticated
  USING (
    (tenant_id IN (SELECT tenant_id FROM public.tenant_members WHERE user_id = (SELECT auth.uid()) AND accepted_at IS NOT NULL))
    OR public.has_role((SELECT auth.uid()), 'admin'::app_role)
  );
