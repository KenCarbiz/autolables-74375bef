
-- Tighten addendum_events policies to tenant members
DROP POLICY IF EXISTS addendum_events_read ON public.addendum_events;
DROP POLICY IF EXISTS addendum_events_insert ON public.addendum_events;

CREATE POLICY addendum_events_read ON public.addendum_events
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.addendums a
      JOIN public.tenant_members tm ON tm.tenant_id = a.tenant_id
      WHERE a.id = addendum_events.addendum_id
        AND tm.user_id = (SELECT auth.uid())
        AND tm.accepted_at IS NOT NULL
    )
    OR public.has_role((SELECT auth.uid()), 'admin'::public.app_role)
  );

CREATE POLICY addendum_events_insert ON public.addendum_events
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.addendums a
      JOIN public.tenant_members tm ON tm.tenant_id = a.tenant_id
      WHERE a.id = addendum_events.addendum_id
        AND tm.user_id = (SELECT auth.uid())
        AND tm.accepted_at IS NOT NULL
    )
    OR public.has_role((SELECT auth.uid()), 'admin'::public.app_role)
  );

-- install-proofs bucket: scope to valid install tokens, reads only by tenant members
DROP POLICY IF EXISTS install_proofs_upload ON storage.objects;
DROP POLICY IF EXISTS install_proofs_view ON storage.objects;

CREATE POLICY install_proofs_upload ON storage.objects
  FOR INSERT TO anon, authenticated
  WITH CHECK (
    bucket_id = 'install-proofs'
    AND EXISTS (
      SELECT 1 FROM public.vehicle_listings vl
      WHERE vl.install_token::text = (storage.foldername(name))[1]
    )
  );

CREATE POLICY install_proofs_view ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'install-proofs'
    AND (
      EXISTS (
        SELECT 1 FROM public.vehicle_listings vl
        JOIN public.tenant_members tm ON tm.tenant_id = vl.tenant_id
        WHERE vl.install_token::text = (storage.foldername(name))[1]
          AND tm.user_id = (SELECT auth.uid())
          AND tm.accepted_at IS NOT NULL
      )
      OR public.has_role((SELECT auth.uid()), 'admin'::public.app_role)
    )
  );

-- product-docs: remove overly broad bucket-only policies; tenant-scoped policies remain
DROP POLICY IF EXISTS "Auth read product-docs" ON storage.objects;
DROP POLICY IF EXISTS "Auth users upload product-docs" ON storage.objects;
DROP POLICY IF EXISTS "Auth users update product-docs" ON storage.objects;
DROP POLICY IF EXISTS "Auth users delete product-docs" ON storage.objects;
DROP POLICY IF EXISTS "Public read product-docs" ON storage.objects;

-- listing-photos: add anon read so public listing pages can display photos
CREATE POLICY listing_photos_public_read ON storage.objects
  FOR SELECT TO anon
  USING (bucket_id = 'listing-photos');

-- prep-photos: add anon read (bucket is public and used in customer-facing docs)
CREATE POLICY prep_photos_public_read ON storage.objects
  FOR SELECT TO anon
  USING (bucket_id = 'prep-photos');
