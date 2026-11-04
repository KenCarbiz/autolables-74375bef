-- 0020: DEV-only allowlist of signed source connections (synthetic, privileged seed, owner-authorised). No endpoint, URL or secret stored.
create table public.gw_source_connections (
  connection_id text primary key,
  source_app gw_app not null,
  signing_key_id text not null,
  tenant_id text not null references public.gw_tenants(id),
  rooftop_ids text[] not null check (cardinality(rooftop_ids) > 0),
  source_project text not null,
  source_commit text not null check (source_commit ~ '^[0-9a-f]{40}$'),
  corpus_sha256 text not null check (corpus_sha256 ~ '^[0-9a-f]{64}$'),
  status text not null check (status in ('SOURCE_CONTRACT_TESTED / WAITING_SIGNED_STAGING')),
  synthetic boolean not null check (synthetic),
  physical_sender boolean not null default false check (physical_sender = false),
  authorized_by text not null,
  created_at timestamptz not null default now());
grant select on public.gw_source_connections to authenticated;
grant all on public.gw_source_connections to service_role;
alter table public.gw_source_connections enable row level security;
create policy "tenant members read source connections" on public.gw_source_connections for select to authenticated using (gw_is_member(tenant_id));
revoke insert, update, delete, truncate, references, trigger on public.gw_source_connections from anon, authenticated;
revoke select on public.gw_source_connections from anon;
insert into public.gw_source_connections(connection_id, source_app, signing_key_id, tenant_id, rooftop_ids, source_project, source_commit, corpus_sha256, status, synthetic, authorized_by) values
 ('conn-dev-autoframe-studio-nw01','autoframe','autoframe:dev-fixture-1','grp-syn-northwind','{rt-syn-nw-01}','35a60998-fb7f-43c0-a785-15bf563c34b9',
  '6068c57d90a360320621c491a0d2d793cbc4c21d','a2d28038f56ff6ee9766eb95e7c41bd63ab09d79453d67cb662ffe5eb1f78e60',
  'SOURCE_CONTRACT_TESTED / WAITING_SIGNED_STAGING', true, 'owner DEV directive 2026-11-01 (synthetic pair registration)');