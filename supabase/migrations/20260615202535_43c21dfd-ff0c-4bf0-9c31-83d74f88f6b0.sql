drop policy if exists "product_docs_read"   on storage.objects;
drop policy if exists "product_docs_write"  on storage.objects;
drop policy if exists "product_docs_update" on storage.objects;
drop policy if exists "product_docs_delete" on storage.objects;

create policy "product_docs_read" on storage.objects for select to authenticated
  using (bucket_id = 'product-docs'
    and (storage.foldername(name))[1] in (
      select tenant_id::text from public.tenant_members where user_id = (select auth.uid())));

create policy "product_docs_write" on storage.objects for insert to authenticated
  with check (bucket_id = 'product-docs'
    and (storage.foldername(name))[1] in (
      select tenant_id::text from public.tenant_members where user_id = (select auth.uid())));

create policy "product_docs_update" on storage.objects for update to authenticated
  using (bucket_id = 'product-docs'
    and (storage.foldername(name))[1] in (
      select tenant_id::text from public.tenant_members where user_id = (select auth.uid())));

create policy "product_docs_delete" on storage.objects for delete to authenticated
  using (bucket_id = 'product-docs'
    and (storage.foldername(name))[1] in (
      select tenant_id::text from public.tenant_members where user_id = (select auth.uid())));
