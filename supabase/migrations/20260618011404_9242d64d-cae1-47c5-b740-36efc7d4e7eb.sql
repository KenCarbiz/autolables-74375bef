ALTER TABLE public.advertised_prices
  ADD COLUMN IF NOT EXISTS screenshot_url    text,
  ADD COLUMN IF NOT EXISTS screenshot_bucket text NOT NULL DEFAULT 'price-evidence',
  ADD COLUMN IF NOT EXISTS screenshot_sha256 text;

COMMENT ON COLUMN public.advertised_prices.screenshot_url IS
  'Storage path (within screenshot_bucket) to the captured screenshot of the advertised page at snapshot time.';

DROP POLICY IF EXISTS price_evidence_view ON storage.objects;
CREATE POLICY price_evidence_view ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'price-evidence'
    AND (
      EXISTS (
        SELECT 1 FROM public.tenant_members tm
        WHERE tm.tenant_id::text = (storage.foldername(name))[1]
          AND tm.user_id = (SELECT auth.uid())
          AND tm.accepted_at IS NOT NULL
      )
      OR public.has_role((SELECT auth.uid()), 'admin'::public.app_role)
    )
  );

DROP POLICY IF EXISTS price_evidence_upload ON storage.objects;
CREATE POLICY price_evidence_upload ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'price-evidence'
    AND (
      EXISTS (
        SELECT 1 FROM public.tenant_members tm
        WHERE tm.tenant_id::text = (storage.foldername(name))[1]
          AND tm.user_id = (SELECT auth.uid())
          AND tm.accepted_at IS NOT NULL
      )
      OR public.has_role((SELECT auth.uid()), 'admin'::public.app_role)
    )
  );