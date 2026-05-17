-- ──────────────────────────────────────────────────────────────
-- Wave 13b — drain useProductRules from localStorage to Supabase.
--
-- Product rules decide which products appear on an addendum for
-- a given vehicle (Y/M/M/Trim/body-style/condition/mileage). The
-- previous localStorage version was per-browser, so a dealer
-- editing rules on desktop wouldn't see them on tablet, and lot
-- staff using the scanner saw a different rule set than the F&I
-- desk. The feature_product_rules toggle was honest about the
-- feature existing but dishonest about the sync story.
--
-- This migration creates public.product_rules, tenant-scoped via
-- RLS, with the canonical Supabase 2026 wrapped-uid pattern
-- (Wave 14.2 / CLAUDE.md).
-- ──────────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS public.product_rules (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  -- product_id is a FK into products(id) with cascade delete so
  -- a deleted product can't leave dangling rules behind.
  product_id    UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,

  -- Vehicle predicate. Empty arrays mean "any".
  year_min      TEXT NOT NULL DEFAULT '',
  year_max      TEXT NOT NULL DEFAULT '',
  makes         TEXT[] NOT NULL DEFAULT '{}',
  models        TEXT[] NOT NULL DEFAULT '{}',
  trims         TEXT[] NOT NULL DEFAULT '{}',
  body_styles   TEXT[] NOT NULL DEFAULT '{}',
  condition     TEXT NOT NULL DEFAULT 'all'
                CHECK (condition IN ('new', 'used', 'all')),
  mileage_max   INTEGER NOT NULL DEFAULT 0,

  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The hot read is "every rule for the current tenant" — a
-- single index on tenant_id covers it. Add product_id for the
-- cascading delete path.
CREATE INDEX IF NOT EXISTS idx_product_rules_tenant
  ON public.product_rules (tenant_id);
CREATE INDEX IF NOT EXISTS idx_product_rules_product
  ON public.product_rules (product_id);

ALTER TABLE public.product_rules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Tenant members read product_rules" ON public.product_rules;
CREATE POLICY "Tenant members read product_rules"
  ON public.product_rules FOR SELECT TO authenticated
  USING (
    tenant_id IN (
      SELECT tenant_id FROM public.tenant_members
      WHERE user_id = (SELECT auth.uid())
    )
  );

DROP POLICY IF EXISTS "Tenant members write product_rules" ON public.product_rules;
CREATE POLICY "Tenant members write product_rules"
  ON public.product_rules FOR ALL TO authenticated
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

DROP TRIGGER IF EXISTS set_tenant_id_product_rules ON public.product_rules;
CREATE TRIGGER set_tenant_id_product_rules
  BEFORE INSERT ON public.product_rules
  FOR EACH ROW EXECUTE FUNCTION public.set_tenant_id_on_insert();

DROP TRIGGER IF EXISTS update_product_rules_updated_at ON public.product_rules;
CREATE TRIGGER update_product_rules_updated_at
  BEFORE UPDATE ON public.product_rules
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
