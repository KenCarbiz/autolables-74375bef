CREATE TABLE public.tenant_incentive_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL UNIQUE REFERENCES public.tenants(id) ON DELETE CASCADE,
  incentives_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  incentive_zip_mode TEXT NOT NULL DEFAULT 'dealer' CHECK (incentive_zip_mode IN ('dealer', 'customer', 'both')),
  dealer_zip_override TEXT,
  incentives_disclaimer TEXT NOT NULL DEFAULT 'Incentive offers are subject to change. See dealer for complete details and eligibility requirements.',
  updated_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT ON public.tenant_incentive_settings TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tenant_incentive_settings TO authenticated;
GRANT ALL ON public.tenant_incentive_settings TO service_role;

ALTER TABLE public.tenant_incentive_settings ENABLE ROW LEVEL SECURITY;

-- Public read (passport page needs to check settings without auth)
CREATE POLICY "Public can read incentive settings"
  ON public.tenant_incentive_settings FOR SELECT
  TO anon, authenticated
  USING (TRUE);

-- Tenant admins/managers/owners can manage settings (uses tenant_members in this schema)
CREATE POLICY "Tenant admins can insert incentive settings"
  ON public.tenant_incentive_settings FOR INSERT
  TO authenticated
  WITH CHECK (
    tenant_id IN (
      SELECT tenant_id FROM public.tenant_members
      WHERE user_id = (SELECT auth.uid())
        AND role IN ('owner', 'admin', 'manager')
    )
  );

CREATE POLICY "Tenant admins can update incentive settings"
  ON public.tenant_incentive_settings FOR UPDATE
  TO authenticated
  USING (
    tenant_id IN (
      SELECT tenant_id FROM public.tenant_members
      WHERE user_id = (SELECT auth.uid())
        AND role IN ('owner', 'admin', 'manager')
    )
  )
  WITH CHECK (
    tenant_id IN (
      SELECT tenant_id FROM public.tenant_members
      WHERE user_id = (SELECT auth.uid())
        AND role IN ('owner', 'admin', 'manager')
    )
  );

CREATE POLICY "Tenant admins can delete incentive settings"
  ON public.tenant_incentive_settings FOR DELETE
  TO authenticated
  USING (
    tenant_id IN (
      SELECT tenant_id FROM public.tenant_members
      WHERE user_id = (SELECT auth.uid())
        AND role IN ('owner', 'admin', 'manager')
    )
  );

CREATE TRIGGER tenant_incentive_settings_set_updated_at
  BEFORE UPDATE ON public.tenant_incentive_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
