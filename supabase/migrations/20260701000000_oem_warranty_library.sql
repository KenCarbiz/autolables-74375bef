-- ─────────────────────────────────────────────────────────────────────────────
-- OEM Factory Warranty Library — persistence foundation (Phase 1)
--
-- Rule-driven warranty storage: programs are keyed by make / model-year range /
-- model / market / powertrain; each program owns coverages + sources. Per-VIN
-- state lives in snapshots (calculated) and overrides (dealer confirmations).
-- We never store warranty rows per raw VIN.
--
-- NOTE: This migration is the storage foundation. The app currently reads the
-- seeded library from TypeScript (src/data/oemWarrantyPrograms.ts); wiring the
-- runtime to these tables is a later phase (needs an edge-function read path).
-- Reference tables (programs/coverages/sources) are curated data written by
-- platform admins via the service role; the per-vehicle tables are tenant-scoped.
-- ─────────────────────────────────────────────────────────────────────────────

-- A. OEM warranty programs ----------------------------------------------------
CREATE TABLE IF NOT EXISTS public.oem_warranty_programs (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  oem_make             text NOT NULL,
  brand                text,
  country              text NOT NULL DEFAULT 'US',
  model_year_start     int  NOT NULL,
  model_year_end       int  NOT NULL,
  model                text,
  trim                 text,
  powertrain_type      text,
  fuel_type            text,
  vehicle_type         text,
  program_name         text NOT NULL,
  applies_to_new       boolean NOT NULL DEFAULT true,
  applies_to_used      boolean NOT NULL DEFAULT true,
  applies_to_cpo       boolean NOT NULL DEFAULT true,
  effective_start_date date,
  effective_end_date   date,
  -- 'verified' | 'needs_review' — only verified programs may be shown as fact.
  confidence_status    text NOT NULL DEFAULT 'needs_review',
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_oem_prog_match
  ON public.oem_warranty_programs (oem_make, country, model_year_start, model_year_end);

-- B. OEM warranty coverages ---------------------------------------------------
CREATE TABLE IF NOT EXISTS public.oem_warranty_coverages (
  id                            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  warranty_program_id           uuid NOT NULL REFERENCES public.oem_warranty_programs(id) ON DELETE CASCADE,
  coverage_type                 text NOT NULL,
  display_name                  text NOT NULL,
  subtitle                      text,
  description                   text,
  term_months                   int,
  term_years                    int,
  mileage_limit                 int,
  unlimited_miles               boolean NOT NULL DEFAULT false,
  -- Reduced second-owner terms (e.g. Hyundai powertrain 10/100k → 5/60k).
  subsequent_owner_term_months  int,
  subsequent_owner_mileage_limit int,
  subsequent_owner_unlimited_miles boolean NOT NULL DEFAULT false,
  -- 'delivery_date' | 'in_service_date' | 'original_sale_date'
  starts_at                     text NOT NULL DEFAULT 'in_service_date',
  sort_order                    int NOT NULL DEFAULT 0,
  icon_key                      text,
  accent_color                  text,
  created_at                    timestamptz NOT NULL DEFAULT now(),
  updated_at                    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_oem_cov_program ON public.oem_warranty_coverages (warranty_program_id);

-- C. OEM warranty sources -----------------------------------------------------
CREATE TABLE IF NOT EXISTS public.oem_warranty_sources (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  warranty_program_id    uuid NOT NULL REFERENCES public.oem_warranty_programs(id) ON DELETE CASCADE,
  coverage_id            uuid REFERENCES public.oem_warranty_coverages(id) ON DELETE CASCADE,
  source_title           text NOT NULL,
  source_url             text,
  source_document_name   text,
  source_effective_date  date,
  source_last_verified_at timestamptz,
  verified_by            text,
  notes                  text,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_oem_src_program ON public.oem_warranty_sources (warranty_program_id);

-- D. Vehicle warranty snapshots (per-VIN, tenant-scoped) ----------------------
CREATE TABLE IF NOT EXISTS public.vehicle_warranty_snapshots (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               uuid NOT NULL,
  vin                     text NOT NULL,
  vehicle_id              uuid,
  warranty_program_id     uuid REFERENCES public.oem_warranty_programs(id) ON DELETE SET NULL,
  display_mode            text NOT NULL,           -- 'new' | 'used' | 'cpo'
  matched_make            text,
  matched_model           text,
  matched_year            int,
  matched_trim            text,
  matched_powertrain      text,
  in_service_date         date,
  current_mileage         int,
  calculated_at           timestamptz NOT NULL DEFAULT now(),
  source_last_verified_at timestamptz,
  needs_dealer_confirmation boolean NOT NULL DEFAULT false,
  snapshot_json           jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_warr_snap_tenant_vin
  ON public.vehicle_warranty_snapshots (tenant_id, vin);

-- E. Warranty overrides / dealer confirmations (tenant-scoped) ----------------
CREATE TABLE IF NOT EXISTS public.warranty_overrides (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL,
  vin           text NOT NULL,
  vehicle_id    uuid,
  field_name    text NOT NULL,
  old_value     text,
  new_value     text,
  reason        text,
  confirmed_by  uuid,
  confirmed_at  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_warr_override_tenant_vin
  ON public.warranty_overrides (tenant_id, vin);

-- ── RLS ──────────────────────────────────────────────────────────────────────
-- Reference tables: curated global data. Readable by any authenticated user;
-- writes happen through the service role (no write policy = denied to clients).
ALTER TABLE public.oem_warranty_programs  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.oem_warranty_coverages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.oem_warranty_sources   ENABLE ROW LEVEL SECURITY;

CREATE POLICY "oem_programs_read"  ON public.oem_warranty_programs  FOR SELECT TO authenticated USING (true);
CREATE POLICY "oem_coverages_read" ON public.oem_warranty_coverages FOR SELECT TO authenticated USING (true);
CREATE POLICY "oem_sources_read"   ON public.oem_warranty_sources   FOR SELECT TO authenticated USING (true);

-- Per-vehicle tables: tenant-scoped via tenant_members (canonical initPlan wrap).
ALTER TABLE public.vehicle_warranty_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.warranty_overrides         ENABLE ROW LEVEL SECURITY;

CREATE POLICY "warr_snap_tenant_all"
  ON public.vehicle_warranty_snapshots FOR ALL
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

CREATE POLICY "warr_override_tenant_all"
  ON public.warranty_overrides FOR ALL
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
