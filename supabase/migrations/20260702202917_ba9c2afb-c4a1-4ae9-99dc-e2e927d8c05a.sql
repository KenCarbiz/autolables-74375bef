-- Reconcile leads timestamp: functions expect created_at; table has captured_at.
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
UPDATE public.leads SET created_at = captured_at WHERE created_at <> captured_at AND captured_at IS NOT NULL;

-- 20260702120000_passport_lead_routing.sql
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS sub_source text;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS routing jsonb;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS routed_agent_id text;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS first_response_at timestamptz;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS escalated_at timestamptz;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS escalation_level integer NOT NULL DEFAULT 0;
ALTER TABLE public.vehicle_listings ADD COLUMN IF NOT EXISTS assigned_agent_id text;
CREATE INDEX IF NOT EXISTS idx_leads_routing_sla
  ON public.leads (store_id, created_at)
  WHERE routing IS NOT NULL AND first_response_at IS NULL;

-- 20260702210000_products_tenant_scope.sql
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS tenant_id uuid;
CREATE INDEX IF NOT EXISTS idx_products_tenant_id ON public.products (tenant_id);

DO $$
DECLARE v_tenant uuid;
BEGIN
  IF (SELECT count(*) FROM public.tenants) = 1 THEN
    SELECT id INTO v_tenant FROM public.tenants;
    UPDATE public.products SET tenant_id = v_tenant WHERE tenant_id IS NULL;
  END IF;
END $$;

DROP POLICY IF EXISTS "Anyone can view active products" ON public.products;
DROP POLICY IF EXISTS "Admins can manage products" ON public.products;
DROP POLICY IF EXISTS "products tenant members read" ON public.products;
DROP POLICY IF EXISTS "products tenant members write" ON public.products;

CREATE POLICY "products tenant members read"
  ON public.products FOR SELECT
  TO authenticated
  USING (
    tenant_id IS NULL
    OR tenant_id IN (
      SELECT tenant_id FROM public.tenant_members
      WHERE user_id = (SELECT auth.uid())
    )
  );

CREATE POLICY "products tenant members write"
  ON public.products FOR ALL
  TO authenticated
  USING (
    tenant_id IN (
      SELECT tenant_id FROM public.tenant_members
      WHERE user_id = (SELECT auth.uid())
    )
  )
  WITH CHECK (
    tenant_id IN (
      SELECT tenant_id FROM public.tenant_members
      WHERE user_id = (SELECT auth.uid())
    )
  );