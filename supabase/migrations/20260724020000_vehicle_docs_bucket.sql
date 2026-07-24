-- Create the private `vehicle-docs` storage bucket + tenant-scoped access.
--
-- The Documents tab uploads (window sticker, brochure, Carfax, etc.), the
-- owner's-manual "save to documents", the title/MCO office upload, and the
-- department sign-off uploads all target the `vehicle-docs` bucket — but it was
-- never created (the app tries to createBucket() client-side, which the browser
-- isn't allowed to do), so every upload failed with "Bucket not found".
--
-- Objects are stored under `${tenant_id}/…`, so authenticated dealer staff may
-- read/write only within their own tenant's folder. The customer passport opens
-- these via long-lived signed URLs, which bypass RLS, so no anon policy needed.

INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('vehicle-docs', 'vehicle-docs', false, 26214400)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "vehicle-docs tenant access" ON storage.objects;
CREATE POLICY "vehicle-docs tenant access"
  ON storage.objects
  FOR ALL
  TO authenticated
  USING (
    bucket_id = 'vehicle-docs'
    AND (
      (storage.foldername(name))[1] IN (
        SELECT tenant_id::text FROM public.tenant_members WHERE user_id = (SELECT auth.uid())
      )
      OR EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = (SELECT auth.uid()) AND role = 'admin')
    )
  )
  WITH CHECK (
    bucket_id = 'vehicle-docs'
    AND (
      (storage.foldername(name))[1] IN (
        SELECT tenant_id::text FROM public.tenant_members WHERE user_id = (SELECT auth.uid())
      )
      OR EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = (SELECT auth.uid()) AND role = 'admin')
    )
  );
