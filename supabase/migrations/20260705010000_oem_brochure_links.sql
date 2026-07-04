-- Global cache of official OEM brochure links, keyed by make/model/year.
-- Harvested from the manufacturers' own sites (allowlisted domains only) and
-- shared across tenants; we link to the OEM's hosted document, never rehost.

CREATE TABLE IF NOT EXISTS public.oem_brochure_links (
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

CREATE UNIQUE INDEX IF NOT EXISTS uq_oem_brochure_links_ymm
  ON public.oem_brochure_links (lower(make), lower(model), COALESCE(year, 0));

DROP TRIGGER IF EXISTS update_oem_brochure_links_updated_at ON public.oem_brochure_links;
CREATE TRIGGER update_oem_brochure_links_updated_at
  BEFORE UPDATE ON public.oem_brochure_links
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.oem_brochure_links ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated read brochure links" ON public.oem_brochure_links;
CREATE POLICY "Authenticated read brochure links"
  ON public.oem_brochure_links FOR SELECT
  TO authenticated
  USING (true);
