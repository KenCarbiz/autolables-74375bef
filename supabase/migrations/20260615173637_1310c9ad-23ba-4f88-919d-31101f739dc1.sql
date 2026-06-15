
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS available_preinstalled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS upgrade jsonb,
  ADD COLUMN IF NOT EXISTS contract_url text,
  ADD COLUMN IF NOT EXISTS contract_doc_type text;

DROP POLICY IF EXISTS "Auth read product-docs" ON storage.objects;
CREATE POLICY "Auth read product-docs" ON storage.objects FOR SELECT TO authenticated USING (bucket_id = 'product-docs');

DROP POLICY IF EXISTS "Auth users upload product-docs" ON storage.objects;
CREATE POLICY "Auth users upload product-docs" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'product-docs');

DROP POLICY IF EXISTS "Auth users update product-docs" ON storage.objects;
CREATE POLICY "Auth users update product-docs" ON storage.objects FOR UPDATE TO authenticated USING (bucket_id = 'product-docs');

DROP POLICY IF EXISTS "Auth users delete product-docs" ON storage.objects;
CREATE POLICY "Auth users delete product-docs" ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'product-docs');
