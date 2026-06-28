CREATE TABLE IF NOT EXISTS public.marketcheck_vehicle_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  vin TEXT NOT NULL,
  incentives_dealer_zip JSONB NOT NULL DEFAULT '[]'::jsonb,
  incentives_customer_zip JSONB NOT NULL DEFAULT '[]'::jsonb,
  incentives_customer_zip_code TEXT,
  incentives_customer_zip_pulled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, vin)
);

CREATE INDEX marketcheck_vehicle_cache_vin_idx ON public.marketcheck_vehicle_cache (vin);

GRANT SELECT ON public.marketcheck_vehicle_cache TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.marketcheck_vehicle_cache TO authenticated;
GRANT ALL ON public.marketcheck_vehicle_cache TO service_role;

ALTER TABLE public.marketcheck_vehicle_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public can read marketcheck cache"
  ON public.marketcheck_vehicle_cache FOR SELECT
  TO anon, authenticated
  USING (TRUE);

CREATE POLICY "Tenant members can insert marketcheck cache"
  ON public.marketcheck_vehicle_cache FOR INSERT
  TO authenticated
  WITH CHECK (
    tenant_id IN (
      SELECT tenant_id FROM public.tenant_members
      WHERE user_id = (SELECT auth.uid())
    )
  );

CREATE POLICY "Tenant members can update marketcheck cache"
  ON public.marketcheck_vehicle_cache FOR UPDATE
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

CREATE POLICY "Tenant members can delete marketcheck cache"
  ON public.marketcheck_vehicle_cache FOR DELETE
  TO authenticated
  USING (
    tenant_id IN (
      SELECT tenant_id FROM public.tenant_members
      WHERE user_id = (SELECT auth.uid())
    )
  );

CREATE TRIGGER marketcheck_vehicle_cache_set_updated_at
  BEFORE UPDATE ON public.marketcheck_vehicle_cache
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
