-- ──────────────────────────────────────────────────────────────
-- Wave 13a — drain three localStorage shadows to Supabase.
--
-- zebra_print_jobs:  thin append-only log of Zebra label prints
--                    (queued/printing/printed/failed). Lets the
--                    print queue follow the dealer cross-device
--                    instead of living in one browser's storage.
--
-- warranty_records:  dealer-owned product warranty registrations,
--                    used by Admin > Warranty for expiry reports
--                    and per-vehicle history.
--
-- get_ready_records: full reconditioning workflow — timeline,
--                    items, accessories, inspection, RO/check
--                    requests. Mirrors Wave 10's vehicle_files
--                    pattern: parent row + JSONB nested arrays.
--
-- Trigger functions reused from prior migrations:
--   public.set_tenant_id_on_insert()    (20260418000000_hardening.sql)
--   public.update_updated_at_column()   (20260410142244_*.sql)
-- ──────────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ──────────────────────────────────────────────────────────────
-- zebra_print_jobs
-- ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.zebra_print_jobs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  store_id      TEXT,
  vin           TEXT NOT NULL,
  stock_number  TEXT NOT NULL DEFAULT '',
  ymm           TEXT NOT NULL DEFAULT '',
  label_type    TEXT NOT NULL CHECK (label_type IN ('stock_number','vin_barcode','key_tag')),
  printer_name  TEXT NOT NULL DEFAULT 'Default',
  status        TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','printing','printed','failed')),
  zpl_content   TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_zebra_print_jobs_tenant_created
  ON public.zebra_print_jobs (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_zebra_print_jobs_vin
  ON public.zebra_print_jobs (tenant_id, vin);

ALTER TABLE public.zebra_print_jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Tenant members read print jobs" ON public.zebra_print_jobs;
CREATE POLICY "Tenant members read print jobs"
  ON public.zebra_print_jobs FOR SELECT TO authenticated
  USING (
    tenant_id IN (
      SELECT tenant_id FROM public.tenant_members WHERE user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Tenant members write print jobs" ON public.zebra_print_jobs;
CREATE POLICY "Tenant members write print jobs"
  ON public.zebra_print_jobs FOR ALL TO authenticated
  USING (
    tenant_id IN (
      SELECT tenant_id FROM public.tenant_members WHERE user_id = auth.uid()
    )
  )
  WITH CHECK (
    tenant_id IN (
      SELECT tenant_id FROM public.tenant_members WHERE user_id = auth.uid()
    )
  );

DROP TRIGGER IF EXISTS set_tenant_id_zebra ON public.zebra_print_jobs;
CREATE TRIGGER set_tenant_id_zebra
  BEFORE INSERT ON public.zebra_print_jobs
  FOR EACH ROW EXECUTE FUNCTION public.set_tenant_id_on_insert();

-- ──────────────────────────────────────────────────────────────
-- warranty_records
-- ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.warranty_records (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  store_id              TEXT,
  vehicle_vin           TEXT NOT NULL,
  vehicle_ymm           TEXT NOT NULL DEFAULT '',
  customer_name         TEXT NOT NULL DEFAULT '',
  product_name          TEXT NOT NULL DEFAULT '',
  product_id            TEXT NOT NULL DEFAULT '',
  provider              TEXT NOT NULL DEFAULT '',
  warranty_start        DATE,
  warranty_end          DATE,
  coverage_type         TEXT NOT NULL DEFAULT '',
  registration_number   TEXT NOT NULL DEFAULT '',
  status                TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','expired','claimed','void')),
  notes                 TEXT NOT NULL DEFAULT '',
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_warranty_records_tenant
  ON public.warranty_records (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_warranty_records_vin
  ON public.warranty_records (tenant_id, vehicle_vin);
-- Partial index on the expiry watch — most dealers care about
-- active warranties expiring in the next 30/60/90 days.
CREATE INDEX IF NOT EXISTS idx_warranty_records_expiring
  ON public.warranty_records (tenant_id, warranty_end)
  WHERE status = 'active';

ALTER TABLE public.warranty_records ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Tenant members read warranties" ON public.warranty_records;
CREATE POLICY "Tenant members read warranties"
  ON public.warranty_records FOR SELECT TO authenticated
  USING (
    tenant_id IN (
      SELECT tenant_id FROM public.tenant_members WHERE user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Tenant members write warranties" ON public.warranty_records;
CREATE POLICY "Tenant members write warranties"
  ON public.warranty_records FOR ALL TO authenticated
  USING (
    tenant_id IN (
      SELECT tenant_id FROM public.tenant_members WHERE user_id = auth.uid()
    )
  )
  WITH CHECK (
    tenant_id IN (
      SELECT tenant_id FROM public.tenant_members WHERE user_id = auth.uid()
    )
  );

DROP TRIGGER IF EXISTS set_tenant_id_warranty ON public.warranty_records;
CREATE TRIGGER set_tenant_id_warranty
  BEFORE INSERT ON public.warranty_records
  FOR EACH ROW EXECUTE FUNCTION public.set_tenant_id_on_insert();

DROP TRIGGER IF EXISTS update_warranty_updated_at ON public.warranty_records;
CREATE TRIGGER update_warranty_updated_at
  BEFORE UPDATE ON public.warranty_records
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ──────────────────────────────────────────────────────────────
-- get_ready_records
-- ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.get_ready_records (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                 UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  store_id                  TEXT,
  vin                       TEXT NOT NULL,
  stock_number              TEXT NOT NULL DEFAULT '',
  ymm                       TEXT NOT NULL DEFAULT '',
  condition                 TEXT NOT NULL DEFAULT 'used' CHECK (condition IN ('new','used')),

  -- Timeline — the compliance chain. Accessories must install
  -- BEFORE inventory_date for state-aligned disclosure rules.
  acquired_date             DATE,
  get_ready_start_date      TIMESTAMPTZ,
  get_ready_complete_date   TIMESTAMPTZ,
  inventory_date            TIMESTAMPTZ,

  -- Nested arrays. Mirrors Wave 10 (vehicle_files) pattern —
  -- the workflow is read whole and edited locally; keeping it
  -- as JSONB on the parent avoids N+1 trips for the timeline
  -- panel and lets the API stay close to the old client shape.
  items                     JSONB NOT NULL DEFAULT '[]'::jsonb,
  accessories_to_install    JSONB NOT NULL DEFAULT '[]'::jsonb,

  -- Inspection
  inspection_required       BOOLEAN NOT NULL DEFAULT false,
  inspection_form_type      TEXT,
  inspection_complete       BOOLEAN NOT NULL DEFAULT false,
  inspection_date           TIMESTAMPTZ,
  inspection_by             TEXT,
  inspection_signature_data TEXT,
  autocurb_inspection_id    TEXT,

  -- Assignment
  assigned_technician       TEXT NOT NULL DEFAULT '',
  service_advisor           TEXT NOT NULL DEFAULT '',
  ro_number                 TEXT NOT NULL DEFAULT '',

  -- Status
  status                    TEXT NOT NULL DEFAULT 'pending'
                            CHECK (status IN ('pending','in_progress','inspection','detail','photo','ready','inventory')),

  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by                TEXT NOT NULL DEFAULT '',
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One get-ready record per (tenant, store, VIN). store_id may
-- be null for tenants without multi-store rollup; coalesce keeps
-- the index usable in both shapes.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_get_ready_tenant_store_vin
  ON public.get_ready_records (tenant_id, COALESCE(store_id, ''), vin);
CREATE INDEX IF NOT EXISTS idx_get_ready_status
  ON public.get_ready_records (tenant_id, status, updated_at DESC);

ALTER TABLE public.get_ready_records ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Tenant members read get_ready" ON public.get_ready_records;
CREATE POLICY "Tenant members read get_ready"
  ON public.get_ready_records FOR SELECT TO authenticated
  USING (
    tenant_id IN (
      SELECT tenant_id FROM public.tenant_members WHERE user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Tenant members write get_ready" ON public.get_ready_records;
CREATE POLICY "Tenant members write get_ready"
  ON public.get_ready_records FOR ALL TO authenticated
  USING (
    tenant_id IN (
      SELECT tenant_id FROM public.tenant_members WHERE user_id = auth.uid()
    )
  )
  WITH CHECK (
    tenant_id IN (
      SELECT tenant_id FROM public.tenant_members WHERE user_id = auth.uid()
    )
  );

DROP TRIGGER IF EXISTS set_tenant_id_get_ready ON public.get_ready_records;
CREATE TRIGGER set_tenant_id_get_ready
  BEFORE INSERT ON public.get_ready_records
  FOR EACH ROW EXECUTE FUNCTION public.set_tenant_id_on_insert();

DROP TRIGGER IF EXISTS update_get_ready_updated_at ON public.get_ready_records;
CREATE TRIGGER update_get_ready_updated_at
  BEFORE UPDATE ON public.get_ready_records
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
