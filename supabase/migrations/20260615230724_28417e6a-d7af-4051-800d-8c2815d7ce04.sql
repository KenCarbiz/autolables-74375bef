CREATE TABLE public.product_sale_mode_changes (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL,
  addendum_id   uuid,
  signing_token uuid,
  vehicle_vin   text,
  product_id    uuid,
  product_name  text NOT NULL,
  from_mode     text,
  to_mode       text NOT NULL CHECK (to_mode IN ('pre_installed','customer_elected','upgrade')),
  changed_by    uuid NOT NULL DEFAULT auth.uid(),
  changed_by_name text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.product_sale_mode_changes TO authenticated;
GRANT ALL ON public.product_sale_mode_changes TO service_role;

ALTER TABLE public.product_sale_mode_changes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "psmc_tenant_insert" ON public.product_sale_mode_changes
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id IN (
    SELECT tenant_id FROM public.tenant_members WHERE user_id = (SELECT auth.uid())));

CREATE POLICY "psmc_tenant_read" ON public.product_sale_mode_changes
  FOR SELECT TO authenticated
  USING (tenant_id IN (
    SELECT tenant_id FROM public.tenant_members WHERE user_id = (SELECT auth.uid())));

REVOKE UPDATE, DELETE, TRUNCATE ON public.product_sale_mode_changes FROM authenticated, anon;

CREATE INDEX idx_psmc_addendum ON public.product_sale_mode_changes (addendum_id);
CREATE INDEX idx_psmc_tenant_created ON public.product_sale_mode_changes (tenant_id, created_at DESC);