-- ──────────────────────────────────────────────────────────────────────
-- Factory Window Sticker Generator — persistence foundation.
--
--   * Widen the generated_documents / signed_document_archive type CHECKs
--     with 'factory_sticker' so the orchestrator can file its output
--     through the existing document lifecycle (20260620090000 statuses,
--     fileForm supersede loop in generate-vehicle-forms).
--   * neovin_snapshots — COMPLETE raw provider capture. The full NeoVIN
--     decode response is persisted untouched on every pull, BEFORE any
--     extraction runs, so no field is ever lost regardless of extractor
--     coverage (option codes, base MSRP, destination charge, and color
--     codes were historically discarded by marketcheck-specs). The
--     curated extraction lives in vehicle_listings.mc_attributes.build_sheet.
--   * factory_sticker_records — one operational record per (tenant,
--     vehicle), modeled on description_cases: server-owned state machine,
--     SELECT-only for tenant members, all writes via service role.
--   * Transition guard + listing-archive trigger mirror the
--     vehicle_lifecycle precedent (20260726220000): terminal states are
--     enforced in SQL and lifecycle bookkeeping never breaks a listing
--     write.
-- ──────────────────────────────────────────────────────────────────────

-- ── 1. Document type CHECK widenings ──────────────────────────────────
ALTER TABLE public.generated_documents
  DROP CONSTRAINT IF EXISTS generated_documents_document_type_check;
ALTER TABLE public.generated_documents
  ADD CONSTRAINT generated_documents_document_type_check
  CHECK (document_type IN ('window','addendum','passport','cpo_sheet','buyers_guide','k208','factory_sticker'));

ALTER TABLE public.signed_document_archive
  DROP CONSTRAINT IF EXISTS signed_document_archive_doc_type_check;
ALTER TABLE public.signed_document_archive
  ADD CONSTRAINT signed_document_archive_doc_type_check
  CHECK (doc_type IN ('addendum','deal','sticker','buyers_guide','prep_signoff','disclosure','k208','factory_sticker'));

-- ── 2. Complete raw provider capture ──────────────────────────────────
-- Append-only, service-role only. The raw provider payload is not client
-- data: RLS is enabled with NO policies at all, so authenticated and anon
-- roles can neither read nor write it. Identical re-pulls dedupe on
-- (tenant_id, vin, payload_hash).
CREATE TABLE IF NOT EXISTS public.neovin_snapshots (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid REFERENCES public.tenants(id) ON DELETE CASCADE,
  vehicle_id    uuid REFERENCES public.vehicle_listings(id) ON DELETE SET NULL,
  vin           text NOT NULL,
  endpoint      text,
  payload       jsonb NOT NULL,
  payload_hash  text,
  http_status   integer,
  raw_key_count integer,
  fetched_at    timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.neovin_snapshots IS
  'Complete raw NeoVIN/MarketCheck decode responses, captured before any extraction so no provider field is ever lost regardless of extractor coverage. Extraction lives in vehicle_listings.mc_attributes.build_sheet. Service-role only; append-only.';

CREATE INDEX IF NOT EXISTS idx_neovin_snapshots_tenant_vin
  ON public.neovin_snapshots (tenant_id, vin, fetched_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS ux_neovin_snapshots_dedupe
  ON public.neovin_snapshots (tenant_id, vin, payload_hash);

ALTER TABLE public.neovin_snapshots ENABLE ROW LEVEL SECURITY;
-- No client policies on purpose: reads and writes are service-role only,
-- and there are no UPDATE/DELETE paths — the capture is append-only.

-- ── 3. Factory sticker operational records ────────────────────────────
CREATE TABLE IF NOT EXISTS public.factory_sticker_records (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                   uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  vehicle_id                  uuid NOT NULL REFERENCES public.vehicle_listings(id) ON DELETE CASCADE,
  vin                         text NOT NULL,
  generation_status           text NOT NULL DEFAULT 'PENDING_DATA'
                                CHECK (generation_status IN (
                                  'PENDING_DATA','NORMALIZING','VALIDATING','REVIEW_REQUIRED',
                                  'READY_TO_GENERATE','GENERATING','RUNNING_QA','APPROVED',
                                  'PUBLISHED','FAILED_RETRYABLE','FAILED_PERMANENT',
                                  'SUPERSEDED','ARCHIVED')),
  source_provider             text,
  source_classification       text,
  confidence_level            text,
  verification_status         text,
  reconciliation_status       text,
  reconciliation_difference   numeric,
  review_required             boolean NOT NULL DEFAULT false,
  review_reason               text,
  normalized_data_json        jsonb,
  canonical_oem_id            text,
  detected_make_value         text,
  oem_resolution_confidence   text,
  oem_theme_id                text,
  oem_theme_version           text,
  template_family_id          text,
  template_version            text,
  renderer_version            text,
  logo_asset_id               text,
  logo_asset_version          text,
  passport_slug               text,
  canonical_passport_url      text,
  qr_payload                  text,
  qr_identity_qa_status       text,
  barcode_payload             text,
  barcode_identity_qa_status  text,
  visual_qa_status            text,
  qa_metadata                 jsonb,
  generation_fingerprint      text,
  current_document_id         uuid REFERENCES public.generated_documents(id) ON DELETE SET NULL,
  attempt_count               integer NOT NULL DEFAULT 0,
  last_error                  text,
  reviewed_by                 uuid REFERENCES auth.users(id),
  reviewed_at                 timestamptz,
  approved_by                 uuid REFERENCES auth.users(id),
  approved_at                 timestamptz,
  published_at                timestamptz,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT factory_sticker_records_tenant_vehicle_key UNIQUE (tenant_id, vehicle_id)
);

CREATE INDEX IF NOT EXISTS idx_factory_sticker_records_tenant_status
  ON public.factory_sticker_records (tenant_id, generation_status);
CREATE INDEX IF NOT EXISTS idx_factory_sticker_records_tenant_vin
  ON public.factory_sticker_records (tenant_id, vin);

ALTER TABLE public.factory_sticker_records ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "factory_sticker_records_read" ON public.factory_sticker_records;
CREATE POLICY "factory_sticker_records_read"
  ON public.factory_sticker_records FOR SELECT
  TO authenticated
  USING (
    tenant_id IN (
      SELECT tenant_id FROM public.tenant_members
      WHERE user_id = (SELECT auth.uid()) AND accepted_at IS NOT NULL
    )
  );
-- No client write policies: all writes go through the orchestrator edge
-- function (service role) or SECURITY DEFINER functions.

-- ── 4. Transition guard ───────────────────────────────────────────────
-- FAILED_PERMANENT only exits to ARCHIVED or back to PENDING_DATA (an
-- explicit reingest). SUPERSEDED is terminal. ARCHIVED only revives to
-- PENDING_DATA (a delisted vehicle returning to inventory).
CREATE OR REPLACE FUNCTION public.factory_sticker_transition_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.generation_status = OLD.generation_status THEN
    NEW.updated_at := now();
    RETURN NEW;
  END IF;
  IF OLD.generation_status = 'FAILED_PERMANENT'
     AND NEW.generation_status NOT IN ('ARCHIVED','PENDING_DATA') THEN
    RAISE EXCEPTION 'invalid factory sticker transition % -> %',
      OLD.generation_status, NEW.generation_status;
  END IF;
  IF OLD.generation_status = 'SUPERSEDED' THEN
    RAISE EXCEPTION 'invalid factory sticker transition % -> %',
      OLD.generation_status, NEW.generation_status;
  END IF;
  IF OLD.generation_status = 'ARCHIVED' AND NEW.generation_status <> 'PENDING_DATA' THEN
    RAISE EXCEPTION 'invalid factory sticker transition % -> %',
      OLD.generation_status, NEW.generation_status;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_factory_sticker_guard ON public.factory_sticker_records;
CREATE TRIGGER trg_factory_sticker_guard
  BEFORE UPDATE ON public.factory_sticker_records
  FOR EACH ROW EXECUTE FUNCTION public.factory_sticker_transition_guard();

-- ── 5. Listing archive / delete → record ARCHIVED ─────────────────────
-- Mirrors lifecycle_on_listing_delete (20260726220000): bookkeeping must
-- NEVER break a listing write, so the trigger swallows its own errors.
-- SUPERSEDED rows are skipped (terminal); the DELETE cascade clears rows
-- afterwards, but marking first preserves the audit-visible state change
-- for triggers/replication that observe the UPDATE.
CREATE OR REPLACE FUNCTION public.factory_sticker_on_listing_archive()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  BEGIN
    IF TG_OP = 'DELETE' THEN
      UPDATE public.factory_sticker_records
      SET generation_status = 'ARCHIVED'
      WHERE tenant_id = OLD.tenant_id AND vehicle_id = OLD.id
        AND generation_status NOT IN ('ARCHIVED','SUPERSEDED');
      RETURN OLD;
    END IF;
    IF NEW.status = 'archived' AND OLD.status IS DISTINCT FROM 'archived' THEN
      UPDATE public.factory_sticker_records
      SET generation_status = 'ARCHIVED'
      WHERE tenant_id = NEW.tenant_id AND vehicle_id = NEW.id
        AND generation_status NOT IN ('ARCHIVED','SUPERSEDED');
    END IF;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  RETURN COALESCE(NEW, OLD);
END; $$;

DROP TRIGGER IF EXISTS trg_factory_sticker_on_listing_archive ON public.vehicle_listings;
CREATE TRIGGER trg_factory_sticker_on_listing_archive
  AFTER UPDATE OF status ON public.vehicle_listings
  FOR EACH ROW EXECUTE FUNCTION public.factory_sticker_on_listing_archive();

DROP TRIGGER IF EXISTS trg_factory_sticker_on_listing_delete ON public.vehicle_listings;
CREATE TRIGGER trg_factory_sticker_on_listing_delete
  BEFORE DELETE ON public.vehicle_listings
  FOR EACH ROW EXECUTE FUNCTION public.factory_sticker_on_listing_archive();
