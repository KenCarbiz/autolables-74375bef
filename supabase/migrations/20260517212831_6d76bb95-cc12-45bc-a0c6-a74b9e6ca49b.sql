-- Wave 8: leads + trade_in_records (off localStorage)
CREATE TABLE IF NOT EXISTS public.leads (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID REFERENCES public.tenants(id) ON DELETE CASCADE,
  store_id         UUID,
  name             TEXT NOT NULL DEFAULT '',
  phone            TEXT NOT NULL DEFAULT '',
  email            TEXT NOT NULL DEFAULT '',
  vehicle_interest TEXT NOT NULL DEFAULT '',
  vehicle_vin      TEXT NOT NULL DEFAULT '',
  source           TEXT NOT NULL DEFAULT 'manual'
                     CHECK (source IN ('qr_scan', 'signing_link', 'manual', 'website')),
  signing_url      TEXT NOT NULL DEFAULT '',
  status           TEXT NOT NULL DEFAULT 'new'
                     CHECK (status IN ('new', 'contacted', 'converted', 'lost')),
  notes            TEXT NOT NULL DEFAULT '',
  captured_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_leads_tenant   ON public.leads (tenant_id);
CREATE INDEX IF NOT EXISTS idx_leads_store    ON public.leads (store_id);
CREATE INDEX IF NOT EXISTS idx_leads_captured ON public.leads (captured_at DESC);

CREATE OR REPLACE FUNCTION public.set_tenant_id_leads()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.tenant_id IS NULL THEN
    NEW.tenant_id := public.current_tenant_id();
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_tenant_id_leads ON public.leads;
CREATE TRIGGER set_tenant_id_leads
  BEFORE INSERT OR UPDATE ON public.leads
  FOR EACH ROW EXECUTE FUNCTION public.set_tenant_id_leads();

ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant members view leads"
  ON public.leads FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id());
CREATE POLICY "Tenant members insert leads"
  ON public.leads FOR INSERT TO authenticated
  WITH CHECK (tenant_id IS NULL OR tenant_id = public.current_tenant_id());
CREATE POLICY "Tenant members update leads"
  ON public.leads FOR UPDATE TO authenticated
  USING (tenant_id = public.current_tenant_id());
CREATE POLICY "Tenant members delete leads"
  ON public.leads FOR DELETE TO authenticated
  USING (tenant_id = public.current_tenant_id());

CREATE TABLE IF NOT EXISTS public.trade_in_records (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID REFERENCES public.tenants(id) ON DELETE CASCADE,
  store_id        UUID,
  trade_vin       TEXT NOT NULL,
  trade_ymm       TEXT NOT NULL DEFAULT '',
  trade_mileage   INTEGER NOT NULL DEFAULT 0,
  trade_value     NUMERIC(12,2) NOT NULL DEFAULT 0,
  customer_name   TEXT NOT NULL DEFAULT '',
  deal_vin        TEXT NOT NULL DEFAULT '',
  deal_ymm        TEXT NOT NULL DEFAULT '',
  received_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  status          TEXT NOT NULL DEFAULT 'received'
                    CHECK (status IN ('received','inspected','stickered','listed','sold')),
  vehicle_file_id UUID,
  notes           TEXT NOT NULL DEFAULT '',
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_trade_ins_tenant   ON public.trade_in_records (tenant_id);
CREATE INDEX IF NOT EXISTS idx_trade_ins_status   ON public.trade_in_records (status);
CREATE INDEX IF NOT EXISTS idx_trade_ins_vin      ON public.trade_in_records (trade_vin);

CREATE OR REPLACE FUNCTION public.set_tenant_id_trade_ins()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.tenant_id IS NULL THEN
    NEW.tenant_id := public.current_tenant_id();
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_tenant_id_trade_ins ON public.trade_in_records;
CREATE TRIGGER set_tenant_id_trade_ins
  BEFORE INSERT OR UPDATE ON public.trade_in_records
  FOR EACH ROW EXECUTE FUNCTION public.set_tenant_id_trade_ins();

ALTER TABLE public.trade_in_records ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant members view trade-ins"
  ON public.trade_in_records FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id());
CREATE POLICY "Tenant members insert trade-ins"
  ON public.trade_in_records FOR INSERT TO authenticated
  WITH CHECK (tenant_id IS NULL OR tenant_id = public.current_tenant_id());
CREATE POLICY "Tenant members update trade-ins"
  ON public.trade_in_records FOR UPDATE TO authenticated
  USING (tenant_id = public.current_tenant_id());