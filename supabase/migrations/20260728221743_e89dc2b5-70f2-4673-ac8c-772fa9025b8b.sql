CREATE TABLE IF NOT EXISTS public.oem_owners_manual_links (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  make         TEXT NOT NULL,
  model        TEXT NOT NULL,
  year         INTEGER,
  url          TEXT NOT NULL,
  title        TEXT,
  source       TEXT NOT NULL DEFAULT 'oem_site',
  verified_at  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT ON public.oem_owners_manual_links TO authenticated;
GRANT ALL ON public.oem_owners_manual_links TO service_role;

ALTER TABLE public.oem_owners_manual_links ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated read owners manual links" ON public.oem_owners_manual_links;
CREATE POLICY "Authenticated read owners manual links"
  ON public.oem_owners_manual_links FOR SELECT
  TO authenticated
  USING (true);

CREATE UNIQUE INDEX IF NOT EXISTS uq_oem_owners_manual_links_ymm
  ON public.oem_owners_manual_links (lower(make), lower(model), COALESCE(year, 0));

DROP TRIGGER IF EXISTS update_oem_owners_manual_links_updated_at ON public.oem_owners_manual_links;
CREATE TRIGGER update_oem_owners_manual_links_updated_at
  BEFORE UPDATE ON public.oem_owners_manual_links
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.oem_brochure_links
  ADD COLUMN IF NOT EXISTS cover_storage_path   TEXT,
  ADD COLUMN IF NOT EXISTS cover_storage_bucket TEXT,
  ADD COLUMN IF NOT EXISTS cover_generated_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cover_page_count     INTEGER,
  ADD COLUMN IF NOT EXISTS cover_status         TEXT,
  ADD COLUMN IF NOT EXISTS cover_mime           TEXT;

ALTER TABLE public.oem_owners_manual_links
  ADD COLUMN IF NOT EXISTS cover_storage_path   TEXT,
  ADD COLUMN IF NOT EXISTS cover_storage_bucket TEXT,
  ADD COLUMN IF NOT EXISTS cover_generated_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cover_page_count     INTEGER,
  ADD COLUMN IF NOT EXISTS cover_status         TEXT,
  ADD COLUMN IF NOT EXISTS cover_mime           TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'oem_brochure_links_cover_status_chk'
  ) THEN
    ALTER TABLE public.oem_brochure_links
      ADD CONSTRAINT oem_brochure_links_cover_status_chk
      CHECK (cover_status IS NULL OR cover_status IN ('pending','ready','unsupported','failed'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'oem_owners_manual_links_cover_status_chk'
  ) THEN
    ALTER TABLE public.oem_owners_manual_links
      ADD CONSTRAINT oem_owners_manual_links_cover_status_chk
      CHECK (cover_status IS NULL OR cover_status IN ('pending','ready','unsupported','failed'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_oem_brochure_links_cover_pending
  ON public.oem_brochure_links (cover_status)
  WHERE cover_status IS DISTINCT FROM 'ready';
CREATE INDEX IF NOT EXISTS idx_oem_owners_manual_links_cover_pending
  ON public.oem_owners_manual_links (cover_status)
  WHERE cover_status IS DISTINCT FROM 'ready';

UPDATE public.oem_brochure_links      SET cover_status = 'pending' WHERE cover_status IS NULL;
UPDATE public.oem_owners_manual_links SET cover_status = 'pending' WHERE cover_status IS NULL;

DROP POLICY IF EXISTS "oem-covers authenticated read" ON storage.objects;
CREATE POLICY "oem-covers authenticated read"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'oem-covers');

CREATE OR REPLACE FUNCTION public.append_vehicle_document(
  _vehicle_id UUID,
  _doc JSONB
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_docs JSONB;
  v_role TEXT := COALESCE(
    NULLIF(current_setting('request.jwt.claim.role', true), ''),
    NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role');
BEGIN
  IF _doc IS NULL OR jsonb_typeof(_doc) <> 'object' THEN
    RAISE EXCEPTION 'document must be a json object';
  END IF;

  IF v_role IS DISTINCT FROM 'service_role' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.vehicle_listings vl
       WHERE vl.id = _vehicle_id
         AND vl.tenant_id IN (
           SELECT tenant_id FROM public.tenant_members
            WHERE user_id = (SELECT auth.uid()) AND accepted_at IS NOT NULL)
    ) AND NOT EXISTS (
      SELECT 1 FROM public.user_roles WHERE user_id = (SELECT auth.uid()) AND role = 'admin'
    ) THEN
      RAISE EXCEPTION 'not authorized for this vehicle';
    END IF;
  END IF;

  UPDATE public.vehicle_listings
     SET documents = COALESCE(documents, '[]'::jsonb) || jsonb_build_array(_doc)
   WHERE id = _vehicle_id
  RETURNING documents INTO v_docs;

  RETURN COALESCE(v_docs, '[]'::jsonb);
END $$;

CREATE OR REPLACE FUNCTION public.remove_vehicle_document(
  _vehicle_id UUID,
  _name TEXT,
  _url TEXT,
  _type TEXT
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_docs JSONB;
  v_role TEXT := COALESCE(
    NULLIF(current_setting('request.jwt.claim.role', true), ''),
    NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role');
BEGIN
  IF v_role IS DISTINCT FROM 'service_role' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.vehicle_listings vl
       WHERE vl.id = _vehicle_id
         AND vl.tenant_id IN (
           SELECT tenant_id FROM public.tenant_members
            WHERE user_id = (SELECT auth.uid()) AND accepted_at IS NOT NULL)
    ) AND NOT EXISTS (
      SELECT 1 FROM public.user_roles WHERE user_id = (SELECT auth.uid()) AND role = 'admin'
    ) THEN
      RAISE EXCEPTION 'not authorized for this vehicle';
    END IF;
  END IF;

  UPDATE public.vehicle_listings
     SET documents = COALESCE((
           SELECT jsonb_agg(d)
             FROM jsonb_array_elements(COALESCE(documents, '[]'::jsonb)) d
            WHERE NOT (d->>'url' IS NOT DISTINCT FROM _url
                   AND d->>'name' IS NOT DISTINCT FROM _name
                   AND d->>'type' IS NOT DISTINCT FROM _type)
         ), '[]'::jsonb)
   WHERE id = _vehicle_id
  RETURNING documents INTO v_docs;

  RETURN COALESCE(v_docs, '[]'::jsonb);
END $$;

GRANT EXECUTE ON FUNCTION public.append_vehicle_document(UUID, JSONB) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.remove_vehicle_document(UUID, TEXT, TEXT, TEXT) TO authenticated, service_role;