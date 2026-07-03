-- Installer invoices derived from completed get-ready work (accessory
-- installs + internal services). One invoice per get-ready record. The line
-- items and total are frozen at invoice time so the invoice stays a stable
-- billing document even if the record or product pricing changes later.

CREATE TABLE IF NOT EXISTS public.get_ready_invoices (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  get_ready_record_id   UUID NOT NULL REFERENCES public.get_ready_records(id) ON DELETE CASCADE,
  vin                   TEXT NOT NULL,
  ymm                   TEXT NOT NULL DEFAULT '',
  stock_number          TEXT NOT NULL DEFAULT '',
  ro_number             TEXT NOT NULL DEFAULT '',
  invoice_number        TEXT NOT NULL,
  line_items            JSONB NOT NULL DEFAULT '[]'::jsonb,
  total                 NUMERIC(10,2) NOT NULL DEFAULT 0,
  status                TEXT NOT NULL DEFAULT 'invoiced' CHECK (status IN ('invoiced','paid')),
  invoiced_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  paid_at               TIMESTAMPTZ,
  created_by            UUID REFERENCES auth.users(id),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_get_ready_invoices_record
  ON public.get_ready_invoices (tenant_id, get_ready_record_id);
CREATE INDEX IF NOT EXISTS idx_get_ready_invoices_tenant_created
  ON public.get_ready_invoices (tenant_id, created_at DESC);

DROP TRIGGER IF EXISTS update_get_ready_invoices_updated_at ON public.get_ready_invoices;
CREATE TRIGGER update_get_ready_invoices_updated_at
  BEFORE UPDATE ON public.get_ready_invoices
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.get_ready_invoices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Tenant members manage get-ready invoices" ON public.get_ready_invoices;
CREATE POLICY "Tenant members manage get-ready invoices"
  ON public.get_ready_invoices FOR ALL
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
