CREATE TABLE IF NOT EXISTS public.vehicle_files (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             UUID REFERENCES public.tenants(id) ON DELETE CASCADE,
  store_id              UUID,
  vin                   TEXT NOT NULL,
  year                  TEXT NOT NULL DEFAULT '',
  make                  TEXT NOT NULL DEFAULT '',
  model                 TEXT NOT NULL DEFAULT '',
  trim                  TEXT NOT NULL DEFAULT '',
  stock_number          TEXT NOT NULL DEFAULT '',
  condition             TEXT NOT NULL DEFAULT 'used'
                          CHECK (condition IN ('new','used','cpo')),
  mileage               INTEGER NOT NULL DEFAULT 0,
  msrp                  NUMERIC(12,2) NOT NULL DEFAULT 0,
  market_value          NUMERIC(12,2) NOT NULL DEFAULT 0,
  factory_equipment     JSONB NOT NULL DEFAULT '[]'::jsonb,
  aftermarket_installs  JSONB NOT NULL DEFAULT '[]'::jsonb,
  stickers              JSONB NOT NULL DEFAULT '[]'::jsonb,
  signings              JSONB NOT NULL DEFAULT '[]'::jsonb,
  attached_documents    JSONB NOT NULL DEFAULT '[]'::jsonb,
  deal_qr_token         UUID NOT NULL DEFAULT gen_random_uuid(),
  deal_status           TEXT NOT NULL DEFAULT 'stickered'
                          CHECK (deal_status IN
                            ('stickered','presented','pending_sign',
                             'signed','delivered','unwound')),
  customer_name         TEXT NOT NULL DEFAULT '',
  customer_phone        TEXT NOT NULL DEFAULT '',
  customer_email        TEXT NOT NULL DEFAULT '',
  cobuyer_name          TEXT NOT NULL DEFAULT '',
  cobuyer_phone         TEXT NOT NULL DEFAULT '',
  cobuyer_email         TEXT NOT NULL DEFAULT '',
  created_by            UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, vin)
);

CREATE INDEX IF NOT EXISTS idx_vehicle_files_tenant      ON public.vehicle_files (tenant_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_files_store       ON public.vehicle_files (store_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_files_vin         ON public.vehicle_files (vin);
CREATE INDEX IF NOT EXISTS idx_vehicle_files_deal_status ON public.vehicle_files (deal_status);
CREATE INDEX IF NOT EXISTS idx_vehicle_files_deal_qr     ON public.vehicle_files (deal_qr_token);
CREATE INDEX IF NOT EXISTS idx_vehicle_files_updated     ON public.vehicle_files (updated_at DESC);

CREATE OR REPLACE FUNCTION public.set_tenant_id_vehicle_files()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.tenant_id IS NULL THEN
    NEW.tenant_id := public.current_tenant_id();
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_tenant_id_vehicle_files ON public.vehicle_files;
CREATE TRIGGER set_tenant_id_vehicle_files
  BEFORE INSERT OR UPDATE ON public.vehicle_files
  FOR EACH ROW EXECUTE FUNCTION public.set_tenant_id_vehicle_files();

ALTER TABLE public.vehicle_files ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant members view vehicle_files"
  ON public.vehicle_files FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id());
CREATE POLICY "Tenant members insert vehicle_files"
  ON public.vehicle_files FOR INSERT TO authenticated
  WITH CHECK (tenant_id IS NULL OR tenant_id = public.current_tenant_id());
CREATE POLICY "Tenant members update vehicle_files"
  ON public.vehicle_files FOR UPDATE TO authenticated
  USING (tenant_id = public.current_tenant_id());
CREATE POLICY "Tenant members delete vehicle_files"
  ON public.vehicle_files FOR DELETE TO authenticated
  USING (tenant_id = public.current_tenant_id());

CREATE OR REPLACE FUNCTION public.get_vehicle_file_by_deal_token(_token UUID)
RETURNS SETOF public.vehicle_files
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT * FROM public.vehicle_files WHERE deal_qr_token = _token LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.get_vehicle_file_by_deal_token(UUID)
  TO anon, authenticated, service_role;