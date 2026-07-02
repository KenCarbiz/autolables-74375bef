-- Tenant-scope the addendum product catalog.
--
-- products was created global (no tenant column, SELECT USING (true),
-- writes gated by the global admin role): every tenant saw and printed
-- every other tenant's catalog, and the four seeded demo products printed
-- on brand-new tenants' addendums with prices no dealer approved.
--
-- Backfill: when exactly ONE tenant exists (the current single-rooftop
-- reality), legacy rows are assigned to it. With multiple tenants we can't
-- know an owner, so legacy NULL rows stay readable by all tenants (never
-- writable) rather than locking anyone out of a catalog they may be
-- actively printing — flagged for manual assignment.

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
