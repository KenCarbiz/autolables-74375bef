-- Required product document — every product must carry a copy of its
-- contract or, when there is no contract, its warranty card. The document
-- is the substantiation behind the product's benefit claims (FTC §5) and
-- can be delivered with the signed packet / shown on the scan page.

-- Public bucket for the uploaded PDFs / cards (mirrors the photo buckets:
-- public read for the shopper-facing surfaces, authenticated write).
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'product-docs', 'product-docs', true, 15728640,
  ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Public read product-docs" ON storage.objects;
CREATE POLICY "Public read product-docs"
  ON storage.objects FOR SELECT TO public
  USING (bucket_id = 'product-docs');

DROP POLICY IF EXISTS "Auth users upload product-docs" ON storage.objects;
CREATE POLICY "Auth users upload product-docs"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'product-docs');

DROP POLICY IF EXISTS "Auth users update product-docs" ON storage.objects;
CREATE POLICY "Auth users update product-docs"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'product-docs');

DROP POLICY IF EXISTS "Auth users delete product-docs" ON storage.objects;
CREATE POLICY "Auth users delete product-docs"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'product-docs');

-- contract_url      — public URL of the uploaded document.
-- contract_doc_type — 'contract' or 'warranty' (what was attached).
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS contract_url text,
  ADD COLUMN IF NOT EXISTS contract_doc_type text;
