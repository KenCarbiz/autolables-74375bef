CREATE TABLE IF NOT EXISTS public.vin_queue (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID REFERENCES public.tenants(id) ON DELETE CASCADE,
  store_id      UUID,
  user_id       UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  vin           TEXT NOT NULL,
  stock_number  TEXT NOT NULL DEFAULT '',
  mileage       TEXT NOT NULL DEFAULT '',
  notes         TEXT NOT NULL DEFAULT '',
  status        TEXT NOT NULL DEFAULT 'queued'
                  CHECK (status IN ('queued', 'processing', 'completed', 'error')),
  condition     TEXT
                  CHECK (condition IS NULL OR condition IN ('new', 'used', 'cpo')),
  decoded_data  JSONB NOT NULL DEFAULT '{}'::jsonb,
  scanned_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_vin_queue_tenant  ON public.vin_queue (tenant_id);
CREATE INDEX IF NOT EXISTS idx_vin_queue_store   ON public.vin_queue (store_id);
CREATE INDEX IF NOT EXISTS idx_vin_queue_status  ON public.vin_queue (status);
CREATE INDEX IF NOT EXISTS idx_vin_queue_scanned ON public.vin_queue (scanned_at DESC);
CREATE INDEX IF NOT EXISTS idx_vin_queue_vin     ON public.vin_queue (vin);

CREATE OR REPLACE FUNCTION public.set_tenant_id_vin_queue()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.tenant_id IS NULL THEN
    NEW.tenant_id := public.current_tenant_id();
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_tenant_id_vin_queue ON public.vin_queue;
CREATE TRIGGER set_tenant_id_vin_queue
  BEFORE INSERT OR UPDATE ON public.vin_queue
  FOR EACH ROW EXECUTE FUNCTION public.set_tenant_id_vin_queue();

ALTER TABLE public.vin_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant members view vin_queue"
  ON public.vin_queue FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id());
CREATE POLICY "Tenant members insert vin_queue"
  ON public.vin_queue FOR INSERT TO authenticated
  WITH CHECK (tenant_id IS NULL OR tenant_id = public.current_tenant_id());
CREATE POLICY "Tenant members update vin_queue"
  ON public.vin_queue FOR UPDATE TO authenticated
  USING (tenant_id = public.current_tenant_id());
CREATE POLICY "Tenant members delete vin_queue"
  ON public.vin_queue FOR DELETE TO authenticated
  USING (tenant_id = public.current_tenant_id());