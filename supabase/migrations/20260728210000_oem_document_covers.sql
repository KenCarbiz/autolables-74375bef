-- Page-1 cover artifacts for the harvested OEM brochure / owner's-manual links.
--
-- The customer Documents page had nothing to picture these records with, so it
-- fell back to a drawn cover for every one of them. The link tables stored only
-- a URL, and hotlinking a page-1 render off the manufacturer's CDN is not an
-- option (no such endpoint exists, and we do not hotlink OEM assets). So we
-- derive our own copy of page 1 once, at harvest time, and store it.
--
-- IMPORTANT — what the artifact actually is:
--   There is no reliable PDF rasterizer in the Supabase edge runtime (no
--   canvas, no native bindings). The generator therefore uses pdf-lib to copy
--   PAGE 1 ONLY into a new single-page PDF, and stores THAT. The cover is
--   normally `application/pdf`, not an image, and an <img src> cannot render
--   it -- the consumer needs <object>/<embed> or a client-side pdf.js render.
--   The one exception: when page 1 is a single full-bleed JPEG (common on
--   design-led OEM brochure covers) the generator lifts that JPEG out and
--   stores it as image/jpeg, which IS <img>-renderable. `cover_mime` is
--   therefore load-bearing and must be read alongside the path -- never
--   assume the artifact is an image.
--
-- cover_status: pending  -- link harvested, cover not attempted yet
--               ready    -- cover_storage_path holds a usable artifact
--               unsupported -- the link is not a PDF at all (an OEM "manuals
--                              and guides" portal page, an HTML brochure), or
--                              the PDF is encrypted. Retrying will not help.
--               failed   -- fetch/parse/upload error. Safe to retry later.

-- ── Cover columns on both link tables ────────────────────────────────────
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

-- Sweep index: "which harvested links still owe a cover".
CREATE INDEX IF NOT EXISTS idx_oem_brochure_links_cover_pending
  ON public.oem_brochure_links (cover_status)
  WHERE cover_status IS DISTINCT FROM 'ready';
CREATE INDEX IF NOT EXISTS idx_oem_owners_manual_links_cover_pending
  ON public.oem_owners_manual_links (cover_status)
  WHERE cover_status IS DISTINCT FROM 'ready';

-- Existing rows predate the pipeline; mark them so a sweep can pick them up.
UPDATE public.oem_brochure_links      SET cover_status = 'pending' WHERE cover_status IS NULL;
UPDATE public.oem_owners_manual_links SET cover_status = 'pending' WHERE cover_status IS NULL;

-- ── Storage for the derived covers ───────────────────────────────────────
-- Private on purpose. These are derivative copies of manufacturer-copyrighted
-- documents; we store our own copy rather than hotlink, but we do not
-- re-publish them at a permanent public address. The customer passport reads
-- them through a short-lived signed URL minted by public-listing-view.
--
-- 8 MB ceiling: a single extracted page (or its cover JPEG) is well under a
-- megabyte in practice, and the cap keeps a pathological page from filling the
-- bucket. The generator enforces its own, tighter, limits before upload.
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('oem-covers', 'oem-covers', false, 8388608)
ON CONFLICT (id) DO NOTHING;

-- These are shared reference data, not tenant data, so the policy shape
-- matches the link tables themselves: unconditional read for signed-in dealer
-- staff, no anon policy, and all writes go through the edge function on the
-- service-role key (which bypasses RLS). The (SELECT auth.uid()) wrap is moot
-- for an unconditional predicate, but TO authenticated still lets the planner
-- skip the policy entirely on anon connections.
DROP POLICY IF EXISTS "oem-covers authenticated read" ON storage.objects;
CREATE POLICY "oem-covers authenticated read"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'oem-covers');
