drop policy if exists "Tenant members view prep sign-offs" on public.prep_sign_offs;

create policy "prep_sign_offs_tenant_read"
on public.prep_sign_offs for select to authenticated
using (store_id in (
  select tenant_id::text from public.tenant_members
  where user_id = (select auth.uid())
));