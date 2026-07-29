-- Our copies of manufacturer documents, and where they live.
--
-- Only a franchised dealer's own brand is ever stored here, which
-- tenant_may_host_oem_documents decides and oem_distribution_events records.
-- A Honda store selling a used Toyota links out, and it links out even when a
-- Toyota store's copy of that exact PDF is already sitting in this table.
-- Possession is not permission, so the storage is TENANT-SCOPED: the platform
-- never gets one shared library that any dealer can read from.
--
-- That is deliberately the expensive choice. A global cache would hold one
-- Camry manual for every dealer; this holds one per franchised dealer. At
-- roughly 23 MB per model-year and a few hundred model-years per store, that
-- is single-digit dollars a month, and the alternative is a shared library
-- that would be very hard to explain to a manufacturer's lawyer.

INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('oem-documents', 'oem-documents', false, 62914560)
ON CONFLICT (id) DO UPDATE SET file_size_limit = EXCLUDED.file_size_limit;

-- Objects live under {tenant_id}/..., so a dealer reads only their own folder.
-- The shopper reaches these through a short-lived signed URL, which bypasses
-- RLS, so there is no anon policy here.
DROP POLICY IF EXISTS "oem-documents tenant read" ON storage.objects;
CREATE POLICY "oem-documents tenant read"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'oem-documents'
    AND (
      (storage.foldername(name))[1] IN (
        SELECT tenant_id::text FROM public.tenant_members
         WHERE user_id = (SELECT auth.uid())
      )
      OR EXISTS (
        SELECT 1 FROM public.user_roles
         WHERE user_id = (SELECT auth.uid()) AND role = 'admin'
      )
    )
  );

-- Writes are service-role only: storing a byte requires the gate to have said
-- yes and the decision to have been recorded, and neither is something a
-- browser can be trusted to have done.

CREATE TABLE IF NOT EXISTS public.oem_hosted_documents (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  brand           TEXT NOT NULL,
  model           TEXT NOT NULL,
  model_year      INTEGER,
  document_kind   TEXT NOT NULL CHECK (document_kind IN ('owners_manual', 'brochure')),
  storage_path    TEXT NOT NULL,
  source_url      TEXT NOT NULL,
  byte_size       BIGINT,
  content_type    TEXT,
  -- The distribution decision that authorised this copy. Without it the file
  -- is an orphan we cannot account for, so nothing writes one without it.
  authorised_by   UUID NOT NULL REFERENCES public.oem_distribution_events(id),
  stored_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.oem_hosted_documents IS
  'Tenant-scoped copies of manufacturer documents for brands that tenant is franchised for. Every row cites the distribution event that authorised it.';

CREATE UNIQUE INDEX IF NOT EXISTS uq_oem_hosted_documents
  ON public.oem_hosted_documents
     (tenant_id, lower(brand), lower(model), COALESCE(model_year, 0), document_kind);

CREATE INDEX IF NOT EXISTS idx_oem_hosted_documents_lookup
  ON public.oem_hosted_documents (tenant_id, lower(brand), lower(model));

ALTER TABLE public.oem_hosted_documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "oem hosted documents readable by tenant" ON public.oem_hosted_documents;
CREATE POLICY "oem hosted documents readable by tenant"
  ON public.oem_hosted_documents FOR SELECT
  TO authenticated
  USING (
    tenant_id IN (
      SELECT tenant_id FROM public.tenant_members
       WHERE user_id = (SELECT auth.uid())
    )
    OR EXISTS (
      SELECT 1 FROM public.user_roles
       WHERE user_id = (SELECT auth.uid()) AND role = 'admin'
    )
  );

-- Claim the right to store one document, or refuse.
--
-- This is the ONLY door to hosting. It asks the gate, writes the evidence row,
-- and hands back the event id the copy must cite. A caller that gets 'link'
-- has no event id to cite, and the NOT NULL foreign key on authorised_by means
-- it cannot insert a row anyway -- the refusal is enforced by the schema, not
-- by the caller remembering to check.
CREATE OR REPLACE FUNCTION public.claim_oem_document_hosting(
  _tenant_id UUID,
  _vin TEXT,
  _brand TEXT,
  _document_kind TEXT,
  _source_url TEXT,
  _model TEXT,
  _model_year INTEGER DEFAULT NULL,
  _store_id TEXT DEFAULT NULL,
  _vehicle_listing_id UUID DEFAULT NULL
)
RETURNS TABLE (decision TEXT, event_id UUID, already_stored_path TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_decision TEXT;
  v_event UUID;
  v_existing TEXT;
BEGIN
  SELECT r.decision, r.event_id INTO v_decision, v_event
    FROM public.record_oem_distribution(
      _tenant_id, _vin, _brand, _document_kind, _source_url, _store_id, _vehicle_listing_id, NULL) r;

  IF v_decision <> 'host' THEN
    RETURN QUERY SELECT v_decision, NULL::UUID, NULL::TEXT;
    RETURN;
  END IF;

  -- Already held for this tenant and model-year: no second fetch, no second
  -- copy. The decision is still recorded above, because every distribution is
  -- worth a row even when no bytes move.
  SELECT h.storage_path INTO v_existing
    FROM public.oem_hosted_documents h
   WHERE h.tenant_id = _tenant_id
     AND lower(h.brand) = lower(btrim(_brand))
     AND lower(h.model) = lower(btrim(coalesce(_model, '')))
     AND COALESCE(h.model_year, 0) = COALESCE(_model_year, 0)
     AND h.document_kind = _document_kind
   LIMIT 1;

  RETURN QUERY SELECT v_decision, v_event, v_existing;
END $$;

GRANT EXECUTE ON FUNCTION public.claim_oem_document_hosting(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER, TEXT, UUID) TO service_role;
