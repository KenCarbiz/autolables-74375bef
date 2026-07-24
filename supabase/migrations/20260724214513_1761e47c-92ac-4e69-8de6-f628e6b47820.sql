
DROP POLICY IF EXISTS "products tenant members read" ON public.products;
CREATE POLICY "products tenant members read"
  ON public.products FOR SELECT
  TO authenticated
  USING (
    tenant_id IS NULL
    OR tenant_id IN (
      SELECT tenant_id FROM public.tenant_members
      WHERE user_id = (SELECT auth.uid()) AND accepted_at IS NOT NULL
    )
  );

DROP POLICY IF EXISTS "service_docs_tenant_read" ON storage.objects;
CREATE POLICY "service_docs_tenant_read"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'service-docs'
    AND ((storage.foldername(name))[1])::uuid IN (
      SELECT tenant_id FROM public.tenant_members
      WHERE user_id = (SELECT auth.uid()) AND accepted_at IS NOT NULL
    )
  );
