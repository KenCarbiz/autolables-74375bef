-- ──────────────────────────────────────────────────────────────
-- Wave 17 — Supabase Storage bucket + RLS policies for installer
-- proof photos. Each accessory install can carry zero-to-many
-- timestamped photos; uploaded URLs are stored on
-- get_ready_records.accessories_to_install[].install_photos
-- (Wave 13a schema, JSONB nested array).
--
-- Bucket is private — reads require an authenticated tenant
-- member; the public /v/:slug receipt fetches via a signed URL
-- the edge function generates per request, not direct
-- bucket-public access.
--
-- Storage paths follow the convention:
--   {tenant_id}/{vehicle_vin}/{accessory_product_id}/{filename}
-- so RLS can scope by the first path segment (tenant_id).
-- ──────────────────────────────────────────────────────────────

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'accessory-install-photos',
  'accessory-install-photos',
  false,
  10 * 1024 * 1024,  -- 10 MB per photo (typical service-lane phone capture)
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/heic']
)
ON CONFLICT (id) DO UPDATE
  SET file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

-- ──────────────────────────────────────────────────────────────
-- RLS — tenant members can read + write their own tenant's
-- folder. Path: {tenant_id}/...
-- Wraps auth.uid() in (SELECT ...) per the canonical Supabase
-- 2026 pattern (CLAUDE.md). TO authenticated so the planner
-- skips for anon.
-- ──────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "Tenant members read install photos" ON storage.objects;
CREATE POLICY "Tenant members read install photos"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'accessory-install-photos'
    AND (storage.foldername(name))[1]::uuid IN (
      SELECT tenant_id
      FROM public.tenant_members
      WHERE user_id = (SELECT auth.uid())
    )
  );

DROP POLICY IF EXISTS "Tenant members upload install photos" ON storage.objects;
CREATE POLICY "Tenant members upload install photos"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'accessory-install-photos'
    AND (storage.foldername(name))[1]::uuid IN (
      SELECT tenant_id
      FROM public.tenant_members
      WHERE user_id = (SELECT auth.uid())
    )
  );

DROP POLICY IF EXISTS "Tenant members update install photos" ON storage.objects;
CREATE POLICY "Tenant members update install photos"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'accessory-install-photos'
    AND (storage.foldername(name))[1]::uuid IN (
      SELECT tenant_id
      FROM public.tenant_members
      WHERE user_id = (SELECT auth.uid())
    )
  );

DROP POLICY IF EXISTS "Tenant members delete install photos" ON storage.objects;
CREATE POLICY "Tenant members delete install photos"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'accessory-install-photos'
    AND (storage.foldername(name))[1]::uuid IN (
      SELECT tenant_id
      FROM public.tenant_members
      WHERE user_id = (SELECT auth.uid())
    )
  );
