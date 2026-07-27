-- ──────────────────────────────────────────────────────────────────────
-- Permanent document asset references.
--
-- generated_documents.pdf_url / png_url historically held SEVEN-DAY signed
-- storage URLs. A vehicle published longer than a week therefore ended up
-- with a broken "View Window Sticker" button and a broken passport
-- thumbnail, with no signal that anything had failed — the row still
-- looked published.
--
-- The fix is to stop treating a temporary URL as a location. This table
-- records the durable coordinates of every filed asset (bucket, object
-- path, checksum, MIME type, byte size, version). Signed URLs are minted
-- at request time by the public-document-asset edge function, which
-- re-checks publishability on every call. The legacy *_url columns stay
-- populated as a cache and a fallback, but they are no longer the source
-- of truth.
-- ──────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.document_assets (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  vehicle_id     uuid REFERENCES public.vehicle_listings(id) ON DELETE CASCADE,
  document_id    uuid NOT NULL REFERENCES public.generated_documents(id) ON DELETE CASCADE,
  document_type  text NOT NULL,
  document_version integer NOT NULL DEFAULT 1,
  asset_type     text NOT NULL CHECK (asset_type IN ('pdf', 'thumbnail', 'preview')),
  storage_bucket text NOT NULL,
  storage_path   text NOT NULL,
  mime_type      text NOT NULL,
  checksum       text,
  byte_size      bigint,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT document_assets_document_asset_key UNIQUE (document_id, asset_type)
);

COMMENT ON TABLE public.document_assets IS
  'Durable storage coordinates for generated document assets. Signed URLs are minted per request against these rows; never store a temporary signed URL as an asset location.';

CREATE INDEX IF NOT EXISTS idx_document_assets_tenant_vehicle
  ON public.document_assets (tenant_id, vehicle_id, document_type);
CREATE INDEX IF NOT EXISTS idx_document_assets_document
  ON public.document_assets (document_id);

ALTER TABLE public.document_assets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "document_assets_read" ON public.document_assets;
CREATE POLICY "document_assets_read"
  ON public.document_assets FOR SELECT
  TO authenticated
  USING (
    tenant_id IN (
      SELECT tenant_id FROM public.tenant_members
      WHERE user_id = (SELECT auth.uid()) AND accepted_at IS NOT NULL
    )
  );
-- No client write policies: the orchestrator (service role) is the only writer.

-- ── Public resolver ───────────────────────────────────────────────────
-- Returns the storage coordinates for ONE asset of ONE currently
-- published document on ONE public slug. It never returns a draft, never
-- returns a superseded version, and takes no identifier a caller could
-- enumerate: the slug is the only key, exactly as the passport already
-- uses it. The caller (an edge function holding the service role) turns
-- the coordinates into a short-lived signed URL.
CREATE OR REPLACE FUNCTION public.get_published_document_asset(
  _slug          text,
  _document_type text,
  _asset_type    text
)
RETURNS TABLE (
  document_id      uuid,
  document_version integer,
  storage_bucket   text,
  storage_path     text,
  mime_type        text,
  checksum         text,
  published_at     timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT da.document_id, gd.version, da.storage_bucket, da.storage_path,
         da.mime_type, da.checksum, gd.published_at
  FROM public.document_assets da
  JOIN public.generated_documents gd ON gd.id = da.document_id
  JOIN public.vehicle_listings v ON v.id = gd.vehicle_id
  WHERE v.slug = _slug
    AND gd.document_type = _document_type
    AND da.asset_type = _asset_type
    AND gd.document_status = 'published'
  ORDER BY gd.version DESC
  LIMIT 1;
$$;

-- Only the service role calls this; the public edge function is the seam.
REVOKE ALL ON FUNCTION public.get_published_document_asset(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_published_document_asset(text, text, text) TO service_role;

-- ── Backfill from what filing already recorded ────────────────────────
-- Every factory sticker filed so far stored its durable path inside
-- data_snapshot; the rows below lift that into the new table so existing
-- published vehicles start working immediately rather than only after
-- their next regeneration.
INSERT INTO public.document_assets (
  tenant_id, vehicle_id, document_id, document_type, document_version,
  asset_type, storage_bucket, storage_path, mime_type, checksum
)
SELECT gd.tenant_id, gd.vehicle_id, gd.id, gd.document_type, gd.version,
       'pdf',
       COALESCE(gd.data_snapshot->>'storage_bucket', 'vehicle-docs'),
       gd.data_snapshot->>'storage_path',
       'application/pdf',
       gd.data_snapshot->>'content_hash'
FROM public.generated_documents gd
WHERE gd.document_type = 'factory_sticker'
  AND gd.tenant_id IS NOT NULL
  AND COALESCE(gd.data_snapshot->>'storage_path', '') <> ''
ON CONFLICT (document_id, asset_type) DO NOTHING;

INSERT INTO public.document_assets (
  tenant_id, vehicle_id, document_id, document_type, document_version,
  asset_type, storage_bucket, storage_path, mime_type, checksum
)
SELECT gd.tenant_id, gd.vehicle_id, gd.id, gd.document_type, gd.version,
       'thumbnail',
       COALESCE(gd.data_snapshot->>'storage_bucket', 'vehicle-docs'),
       gd.data_snapshot->>'preview_path',
       'image/svg+xml',
       gd.data_snapshot->>'content_hash'
FROM public.generated_documents gd
WHERE gd.document_type = 'factory_sticker'
  AND gd.tenant_id IS NOT NULL
  AND COALESCE(gd.data_snapshot->>'preview_path', '') <> ''
ON CONFLICT (document_id, asset_type) DO NOTHING;

CREATE OR REPLACE FUNCTION public.touch_document_assets()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_touch_document_assets ON public.document_assets;
CREATE TRIGGER trg_touch_document_assets
  BEFORE UPDATE ON public.document_assets
  FOR EACH ROW EXECUTE FUNCTION public.touch_document_assets();
