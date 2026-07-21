-- Owner's-manual link cache — mirrors oem_brochure_links (20260705010000).
-- The oem-owners-manual edge function harvests the official OEM owner's-manual
-- link per make/model/year and caches it here. We store only the LINK to the
-- manufacturer's hosted document; a copy is fetched into the vehicle's passport
-- documents only on demand (admin or customer "save to passport").

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

CREATE UNIQUE INDEX IF NOT EXISTS uq_oem_owners_manual_links_ymm
  ON public.oem_owners_manual_links (lower(make), lower(model), COALESCE(year, 0));

DROP TRIGGER IF EXISTS update_oem_owners_manual_links_updated_at ON public.oem_owners_manual_links;
CREATE TRIGGER update_oem_owners_manual_links_updated_at
  BEFORE UPDATE ON public.oem_owners_manual_links
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.oem_owners_manual_links ENABLE ROW LEVEL SECURITY;

-- Read-only to signed-in dealer users; all writes go through the edge function
-- on the service-role key (which bypasses RLS). Wrapped-uid pattern is moot
-- here since the policy is an unconditional true, but TO authenticated keeps
-- the planner from evaluating it for anon connections.
DROP POLICY IF EXISTS "Authenticated read owners manual links" ON public.oem_owners_manual_links;
CREATE POLICY "Authenticated read owners manual links"
  ON public.oem_owners_manual_links FOR SELECT
  TO authenticated
  USING (true);
