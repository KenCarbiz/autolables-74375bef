CREATE POLICY "Public read oem-stickers"
  ON storage.objects FOR SELECT
  TO anon, authenticated
  USING (bucket_id = 'oem-stickers');

CREATE POLICY "Service role manages oem-stickers"
  ON storage.objects FOR ALL
  TO service_role
  USING (bucket_id = 'oem-stickers')
  WITH CHECK (bucket_id = 'oem-stickers');