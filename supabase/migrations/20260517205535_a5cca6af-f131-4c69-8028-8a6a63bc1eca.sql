CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS public.product_rules (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  product_id    UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  year_min      TEXT NOT NULL DEFAULT '',
  year_max      TEXT NOT NULL DEFAULT '',
  makes         TEXT[] NOT NULL DEFAULT '{}',
  models        TEXT[] NOT NULL DEFAULT '{}',
  trims         TEXT[] NOT NULL DEFAULT '{}',
  body_styles   TEXT[] NOT NULL DEFAULT '{}',
  condition     TEXT NOT NULL DEFAULT 'all' CHECK (condition IN ('new','used','all')),
  mileage_max   INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_product_rules_tenant ON public.product_rules (tenant_id);
CREATE INDEX IF NOT EXISTS idx_product_rules_product ON public.product_rules (product_id);

ALTER TABLE public.product_rules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Tenant members read product_rules" ON public.product_rules;
CREATE POLICY "Tenant members read product_rules" ON public.product_rules FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT tenant_id FROM public.tenant_members WHERE user_id = (SELECT auth.uid())));

DROP POLICY IF EXISTS "Tenant members write product_rules" ON public.product_rules;
CREATE POLICY "Tenant members write product_rules" ON public.product_rules FOR ALL TO authenticated
  USING (tenant_id IN (SELECT tenant_id FROM public.tenant_members WHERE user_id = (SELECT auth.uid())))
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM public.tenant_members WHERE user_id = (SELECT auth.uid())));

DROP TRIGGER IF EXISTS set_tenant_id_product_rules ON public.product_rules;
CREATE TRIGGER set_tenant_id_product_rules BEFORE INSERT ON public.product_rules
  FOR EACH ROW EXECUTE FUNCTION public.set_tenant_id_on_insert();

DROP TRIGGER IF EXISTS update_product_rules_updated_at ON public.product_rules;
CREATE TRIGGER update_product_rules_updated_at BEFORE UPDATE ON public.product_rules
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();