-- Sticker Studio production data model. Builds on the template archive
-- (20260620050000): adds immutable generated-document history, dealer print
-- calibration, safe per-dealer template customizations, and structured
-- per-vehicle addendum state (installed / included / available items).
--
-- Naming: the spec calls the owner "dealer_id"; in this shared-tenant app the
-- dealership IS the tenant, so every owner column is tenant_id and RLS follows
-- the canonical tenant_members initPlan pattern. Compliance auditing reuses the
-- existing public.audit_log table rather than a second audit store.

-- ── Generated documents (immutable history) ────────────────────────────────
CREATE TABLE IF NOT EXISTS public.generated_documents (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL,
  vehicle_id      uuid,
  template_id     text NOT NULL,                       -- config.id / template_key
  document_type   text NOT NULL CHECK (document_type IN ('window','addendum','passport')),
  document_status text NOT NULL DEFAULT 'draft' CHECK (document_status IN ('draft','approved','printed','published','archived')),
  version         integer NOT NULL DEFAULT 1,
  label_mode      text NOT NULL DEFAULT 'white' CHECK (label_mode IN ('white','black')),
  pdf_url         text,
  png_url         text,
  online_url      text,
  data_snapshot   jsonb NOT NULL DEFAULT '{}',         -- frozen template+data+branding
  generated_by    uuid REFERENCES auth.users(id),
  approved_by     uuid REFERENCES auth.users(id),
  approved_at     timestamptz,
  printed_at      timestamptz,
  published_at    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_generated_documents_vehicle ON public.generated_documents (vehicle_id, document_type, version DESC);
CREATE INDEX IF NOT EXISTS idx_generated_documents_tenant  ON public.generated_documents (tenant_id, created_at DESC);

-- ── Dealer print calibration ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.dealer_print_settings (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL,
  location_id         uuid,
  window_label_size   text NOT NULL DEFAULT '8.5x11',
  addendum_label_size text NOT NULL DEFAULT '4.5x11',
  label_mode          text NOT NULL DEFAULT 'white' CHECK (label_mode IN ('white','black')),
  x_offset_inches     numeric NOT NULL DEFAULT 0,
  y_offset_inches     numeric NOT NULL DEFAULT 0,
  scale_percentage    numeric NOT NULL DEFAULT 100,
  printer_name        text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, location_id)
);

-- ── Safe per-dealer template customizations (no layout edits) ───────────────
CREATE TABLE IF NOT EXISTS public.dealer_template_customizations (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               uuid NOT NULL,
  template_id             text NOT NULL,               -- config.id / template_key
  accent_color            text,
  secondary_color         text,
  logo_enabled            boolean NOT NULL DEFAULT true,
  qr_enabled              boolean NOT NULL DEFAULT true,
  disclaimer_override     text,
  value_prop_override     text,
  section_label_overrides jsonb NOT NULL DEFAULT '{}',
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, template_id)
);

-- ── Per-vehicle addendum state ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.vehicle_addendums (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               uuid NOT NULL,
  vehicle_id              uuid NOT NULL,
  base_msrp               numeric NOT NULL DEFAULT 0,
  installed_total         numeric NOT NULL DEFAULT 0,
  available_upgrades_total numeric NOT NULL DEFAULT 0,
  selected_upgrades_total numeric NOT NULL DEFAULT 0,
  total_msrp              numeric NOT NULL DEFAULT 0,
  status                  text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','finalized','published')),
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, vehicle_id)
);
CREATE INDEX IF NOT EXISTS idx_vehicle_addendums_vehicle ON public.vehicle_addendums (vehicle_id);

CREATE TABLE IF NOT EXISTS public.vehicle_addendum_items (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_addendum_id uuid NOT NULL REFERENCES public.vehicle_addendums(id) ON DELETE CASCADE,
  item_type           text NOT NULL CHECK (item_type IN ('installed','benefit','available_upgrade')),
  name                text NOT NULL,
  description         text,
  price               numeric NOT NULL DEFAULT 0,
  is_installed        boolean NOT NULL DEFAULT false,
  is_selected         boolean NOT NULL DEFAULT false,
  is_included         boolean NOT NULL DEFAULT false,
  disclosure_text     text,
  display_order       integer NOT NULL DEFAULT 0,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_vehicle_addendum_items_parent ON public.vehicle_addendum_items (vehicle_addendum_id, display_order);

-- ── updated_at triggers (reuses public.set_updated_at from 20260620050000) ───
DROP TRIGGER IF EXISTS trg_generated_documents_updated ON public.generated_documents;
CREATE TRIGGER trg_generated_documents_updated BEFORE UPDATE ON public.generated_documents
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS trg_dealer_print_settings_updated ON public.dealer_print_settings;
CREATE TRIGGER trg_dealer_print_settings_updated BEFORE UPDATE ON public.dealer_print_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS trg_dealer_template_customizations_updated ON public.dealer_template_customizations;
CREATE TRIGGER trg_dealer_template_customizations_updated BEFORE UPDATE ON public.dealer_template_customizations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS trg_vehicle_addendums_updated ON public.vehicle_addendums;
CREATE TRIGGER trg_vehicle_addendums_updated BEFORE UPDATE ON public.vehicle_addendums
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS trg_vehicle_addendum_items_updated ON public.vehicle_addendum_items;
CREATE TRIGGER trg_vehicle_addendum_items_updated BEFORE UPDATE ON public.vehicle_addendum_items
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── RLS — canonical tenant_members initPlan pattern ─────────────────────────
ALTER TABLE public.generated_documents            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dealer_print_settings          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dealer_template_customizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vehicle_addendums              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vehicle_addendum_items         ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant generated_documents" ON public.generated_documents FOR ALL TO authenticated
  USING (tenant_id IN (SELECT tenant_id FROM public.tenant_members WHERE user_id = (SELECT auth.uid())))
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM public.tenant_members WHERE user_id = (SELECT auth.uid())));

CREATE POLICY "tenant dealer_print_settings" ON public.dealer_print_settings FOR ALL TO authenticated
  USING (tenant_id IN (SELECT tenant_id FROM public.tenant_members WHERE user_id = (SELECT auth.uid())))
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM public.tenant_members WHERE user_id = (SELECT auth.uid())));

CREATE POLICY "tenant dealer_template_customizations" ON public.dealer_template_customizations FOR ALL TO authenticated
  USING (tenant_id IN (SELECT tenant_id FROM public.tenant_members WHERE user_id = (SELECT auth.uid())))
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM public.tenant_members WHERE user_id = (SELECT auth.uid())));

CREATE POLICY "tenant vehicle_addendums" ON public.vehicle_addendums FOR ALL TO authenticated
  USING (tenant_id IN (SELECT tenant_id FROM public.tenant_members WHERE user_id = (SELECT auth.uid())))
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM public.tenant_members WHERE user_id = (SELECT auth.uid())));

-- Items inherit their parent addendum's tenant scope.
CREATE POLICY "tenant vehicle_addendum_items" ON public.vehicle_addendum_items FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.vehicle_addendums a
    WHERE a.id = vehicle_addendum_id
      AND a.tenant_id IN (SELECT tenant_id FROM public.tenant_members WHERE user_id = (SELECT auth.uid()))
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.vehicle_addendums a
    WHERE a.id = vehicle_addendum_id
      AND a.tenant_id IN (SELECT tenant_id FROM public.tenant_members WHERE user_id = (SELECT auth.uid()))
  ));
