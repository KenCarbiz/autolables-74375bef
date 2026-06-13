-- Wave 17 — accessory-install-photos bucket RLS
-- Path convention: <tenant_id>/<vin>/<filename>
-- First path segment = tenant_id; enforced via tenant_members lookup.

CREATE POLICY "accessory_install_photos_tenant_select"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'accessory-install-photos'
    AND (
      (storage.foldername(name))[1]::uuid IN (
        SELECT tenant_id FROM public.tenant_members
        WHERE user_id = (SELECT auth.uid())
          AND accepted_at IS NOT NULL
      )
    )
  );

CREATE POLICY "accessory_install_photos_tenant_insert"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'accessory-install-photos'
    AND (
      (storage.foldername(name))[1]::uuid IN (
        SELECT tenant_id FROM public.tenant_members
        WHERE user_id = (SELECT auth.uid())
          AND accepted_at IS NOT NULL
      )
    )
  );

CREATE POLICY "accessory_install_photos_tenant_update"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'accessory-install-photos'
    AND (
      (storage.foldername(name))[1]::uuid IN (
        SELECT tenant_id FROM public.tenant_members
        WHERE user_id = (SELECT auth.uid())
          AND accepted_at IS NOT NULL
      )
    )
  )
  WITH CHECK (
    bucket_id = 'accessory-install-photos'
    AND (
      (storage.foldername(name))[1]::uuid IN (
        SELECT tenant_id FROM public.tenant_members
        WHERE user_id = (SELECT auth.uid())
          AND accepted_at IS NOT NULL
      )
    )
  );

CREATE POLICY "accessory_install_photos_tenant_delete"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'accessory-install-photos'
    AND (
      (storage.foldername(name))[1]::uuid IN (
        SELECT tenant_id FROM public.tenant_members
        WHERE user_id = (SELECT auth.uid())
          AND accepted_at IS NOT NULL
      )
    )
  );
