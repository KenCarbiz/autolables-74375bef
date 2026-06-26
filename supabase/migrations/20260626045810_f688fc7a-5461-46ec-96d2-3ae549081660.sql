
-- 1. Restrict marketcheck_vehicle_cache reads to tenant members
DROP POLICY IF EXISTS "Public can read marketcheck cache" ON public.marketcheck_vehicle_cache;
CREATE POLICY "Tenant members can read marketcheck cache"
  ON public.marketcheck_vehicle_cache FOR SELECT TO authenticated
  USING (tenant_id IN (
    SELECT tenant_id FROM public.tenant_members
    WHERE user_id = (SELECT auth.uid()) AND accepted_at IS NOT NULL
  ));
REVOKE SELECT ON public.marketcheck_vehicle_cache FROM anon;

-- 2. marketcheck_vehicle_cache write policies require accepted_at IS NOT NULL
DROP POLICY IF EXISTS "Tenant members can insert marketcheck cache" ON public.marketcheck_vehicle_cache;
DROP POLICY IF EXISTS "Tenant members can update marketcheck cache" ON public.marketcheck_vehicle_cache;
DROP POLICY IF EXISTS "Tenant members can delete marketcheck cache" ON public.marketcheck_vehicle_cache;

CREATE POLICY "Tenant members can insert marketcheck cache"
  ON public.marketcheck_vehicle_cache FOR INSERT TO authenticated
  WITH CHECK (tenant_id IN (
    SELECT tenant_id FROM public.tenant_members
    WHERE user_id = (SELECT auth.uid()) AND accepted_at IS NOT NULL
  ));
CREATE POLICY "Tenant members can update marketcheck cache"
  ON public.marketcheck_vehicle_cache FOR UPDATE TO authenticated
  USING (tenant_id IN (
    SELECT tenant_id FROM public.tenant_members
    WHERE user_id = (SELECT auth.uid()) AND accepted_at IS NOT NULL
  ))
  WITH CHECK (tenant_id IN (
    SELECT tenant_id FROM public.tenant_members
    WHERE user_id = (SELECT auth.uid()) AND accepted_at IS NOT NULL
  ));
CREATE POLICY "Tenant members can delete marketcheck cache"
  ON public.marketcheck_vehicle_cache FOR DELETE TO authenticated
  USING (tenant_id IN (
    SELECT tenant_id FROM public.tenant_members
    WHERE user_id = (SELECT auth.uid()) AND accepted_at IS NOT NULL
  ));

-- 3. Restrict tenant_incentive_settings reads to tenant members
DROP POLICY IF EXISTS "Public can read incentive settings" ON public.tenant_incentive_settings;
CREATE POLICY "Tenant members can read incentive settings"
  ON public.tenant_incentive_settings FOR SELECT TO authenticated
  USING (tenant_id IN (
    SELECT tenant_id FROM public.tenant_members
    WHERE user_id = (SELECT auth.uid()) AND accepted_at IS NOT NULL
  ));
REVOKE SELECT ON public.tenant_incentive_settings FROM anon;

-- 4. vehicle_value_history read requires accepted_at IS NOT NULL
DROP POLICY IF EXISTS "tenant members read value history" ON public.vehicle_value_history;
CREATE POLICY "tenant members read value history"
  ON public.vehicle_value_history FOR SELECT TO authenticated
  USING (tenant_id::text IN (
    SELECT tenant_id::text FROM public.tenant_members
    WHERE user_id = (SELECT auth.uid()) AND accepted_at IS NOT NULL
  ));

-- 5. Tighten leads anon INSERT (SUPA_rls_policy_always_true): scope to public-facing sources
DROP POLICY IF EXISTS "Public can submit leads" ON public.leads;
CREATE POLICY "Public can submit leads"
  ON public.leads FOR INSERT TO anon
  WITH CHECK (
    tenant_id IS NOT NULL
    AND source IN ('website', 'qr_scan', 'signing_link')
    AND status = 'new'
  );
