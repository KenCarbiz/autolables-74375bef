-- 1. Fix dealer_profiles RLS to be membership-based
alter table public.dealer_profiles enable row level security;

drop policy if exists "Tenant members read dealer profile" on public.dealer_profiles;
drop policy if exists "Owners upsert dealer profile" on public.dealer_profiles;
drop policy if exists "Owners update dealer profile" on public.dealer_profiles;
drop policy if exists "dealer_profiles_select" on public.dealer_profiles;
drop policy if exists "dealer_profiles_insert" on public.dealer_profiles;
drop policy if exists "dealer_profiles_update" on public.dealer_profiles;

create policy "dealer_profiles_select"
  on public.dealer_profiles for select to authenticated
  using (
    tenant_id in (
      select tenant_id from public.tenant_members
      where user_id = (select auth.uid())
    )
  );

create policy "dealer_profiles_insert"
  on public.dealer_profiles for insert to authenticated
  with check (
    tenant_id in (
      select tenant_id from public.tenant_members
      where user_id = (select auth.uid())
    )
  );

create policy "dealer_profiles_update"
  on public.dealer_profiles for update to authenticated
  using (
    tenant_id in (
      select tenant_id from public.tenant_members
      where user_id = (select auth.uid())
    )
  )
  with check (
    tenant_id in (
      select tenant_id from public.tenant_members
      where user_id = (select auth.uid())
    )
  );

-- 3. Storage object policies for product-docs and dealer-logos
drop policy if exists "product_docs_read" on storage.objects;
create policy "product_docs_read"
  on storage.objects for select to authenticated
  using (bucket_id = 'product-docs');

drop policy if exists "product_docs_write" on storage.objects;
create policy "product_docs_write"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'product-docs');

drop policy if exists "product_docs_update" on storage.objects;
create policy "product_docs_update"
  on storage.objects for update to authenticated
  using (bucket_id = 'product-docs');

drop policy if exists "product_docs_delete" on storage.objects;
create policy "product_docs_delete"
  on storage.objects for delete to authenticated
  using (bucket_id = 'product-docs');

drop policy if exists "dealer_logos_read" on storage.objects;
create policy "dealer_logos_read"
  on storage.objects for select to public
  using (bucket_id = 'dealer-logos');

drop policy if exists "dealer_logos_write" on storage.objects;
create policy "dealer_logos_write"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'dealer-logos');
