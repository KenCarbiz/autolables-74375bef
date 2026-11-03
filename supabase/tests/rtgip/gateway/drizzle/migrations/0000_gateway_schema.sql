create extension if not exists pgcrypto;

create type public.gw_app as enum ('autolabels','autofilm','autocurb','autoframe');
create type public.gw_role as enum ('admin','operator','viewer');

-- Tenancy -----------------------------------------------------------------
create table public.gw_tenants (
  id text primary key,
  name text not null,
  is_synthetic boolean not null default true check (is_synthetic = true),
  created_at timestamptz not null default now()
);
create table public.gw_rooftops (
  id text primary key,
  tenant_id text not null references public.gw_tenants(id),
  name text not null,
  city text not null,
  state text not null
);
create table public.gw_tenant_members (
  user_id uuid not null,
  tenant_id text not null references public.gw_tenants(id),
  role public.gw_role not null default 'viewer',
  created_at timestamptz not null default now(),
  primary key (user_id, tenant_id)
);

-- Vehicle identity (VIN persists across instances & episodes; NOT unique per rooftop/episode)
create table public.gw_vehicle_identities (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null references public.gw_tenants(id),
  vin text not null check (vin ~ '^[A-HJ-NPR-Z0-9]{17}$'),
  year int, make text, model text,
  created_at timestamptz not null default now(),
  unique (tenant_id, vin)
);
create table public.gw_vehicle_instances (
  id text primary key,
  tenant_id text not null references public.gw_tenants(id),
  rooftop_id text not null references public.gw_rooftops(id),
  identity_id uuid not null references public.gw_vehicle_identities(id),
  kind text not null default 'inventory', -- inventory | service | acquisition
  created_at timestamptz not null default now()
);
create table public.gw_listing_episodes (
  id text primary key,
  tenant_id text not null references public.gw_tenants(id),
  instance_id text not null references public.gw_vehicle_instances(id),
  opened_at timestamptz not null default now()
);

-- Contract registry ---------------------------------------------------------
create table public.gw_source_allowlist (
  source_app public.gw_app not null,
  event_type text not null,
  aggregate_type text not null,
  authority text not null,
  classification text not null default 'internal', -- internal | pii | media_meta
  schema_versions int[] not null default '{1}',
  primary key (source_app, event_type)
);
create table public.gw_routes (
  id text primary key,
  source_app public.gw_app not null,
  target_app public.gw_app not null,
  event_types text[] not null,
  enabled boolean not null default true,
  description text not null default '',
  unique (source_app, target_app)
);
create table public.gw_settings (
  id int primary key check (id = 1),
  environment text not null default 'DEV' check (environment = 'DEV'),
  external_delivery_enabled boolean not null default false check (external_delivery_enabled = false),
  global_kill boolean not null default false,
  max_attempts int not null default 5,
  updated_at timestamptz not null default now()
);
create table public.gw_route_controls (
  tenant_id text not null references public.gw_tenants(id),
  route_id text not null references public.gw_routes(id),
  enabled boolean not null default true,
  dry_run boolean not null default false,
  killed boolean not null default false,
  pii_consent_route boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  primary key (tenant_id, route_id)
);
create table public.gw_tenant_quotas (
  tenant_id text primary key references public.gw_tenants(id),
  max_inflight int not null default 20000,
  max_events_per_min int not null default 30000
);
create table public.gw_circuit_breakers (
  tenant_id text not null references public.gw_tenants(id),
  target_app public.gw_app not null,
  state text not null default 'closed' check (state in ('closed','open','half_open')),
  consecutive_failures int not null default 0,
  opened_at timestamptz,
  forced_open boolean not null default false,
  primary key (tenant_id, target_app)
);

-- Engine ------------------------------------------------------------------
create table public.gw_source_revisions (
  tenant_id text not null,
  source_app public.gw_app not null,
  aggregate_type text not null,
  aggregate_id text not null,
  revision bigint not null,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, source_app, aggregate_type, aggregate_id)
);
create table public.gw_outbox (
  seq bigserial primary key,
  event_id uuid not null unique,
  tenant_id text not null references public.gw_tenants(id),
  rooftop_id text not null references public.gw_rooftops(id),
  source_app public.gw_app not null,
  event_type text not null,
  schema_version int not null,
  aggregate_type text not null,
  aggregate_id text not null,
  aggregate_revision bigint not null,
  vin text,
  instance_id text,
  episode_id text,
  correlation_id uuid,
  causation_id uuid,
  trace_id text,
  classification text not null,
  payload_hash text not null,
  envelope jsonb not null,
  bench_run_id uuid,
  occurred_at timestamptz not null,
  emitted_at timestamptz not null,
  accepted_at timestamptz not null default clock_timestamp()
);
create index on public.gw_outbox (tenant_id, accepted_at desc);
create index on public.gw_outbox (tenant_id, vin);
create index on public.gw_outbox (bench_run_id);

create table public.gw_queue (
  id bigserial primary key,
  event_id uuid not null references public.gw_outbox(event_id),
  outbox_seq bigint not null,
  route_id text not null references public.gw_routes(id),
  tenant_id text not null,
  target_app public.gw_app not null,
  lane_key text not null,
  status text not null default 'pending'
    check (status in ('pending','retry','leased','held','delivered','duplicate','stale','dry_run','skipped','dead')),
  attempts int not null default 0,
  available_at timestamptz not null default clock_timestamp(),
  lease_until timestamptz,
  leased_by text,
  accepted_at timestamptz not null default clock_timestamp(),
  delivered_at timestamptz,
  last_error text,
  bench_run_id uuid,
  unique (event_id, route_id)
);
create index gw_queue_active_idx on public.gw_queue (lane_key, outbox_seq)
  where status in ('pending','retry','leased','held');
create index on public.gw_queue (tenant_id, status);
create index on public.gw_queue (bench_run_id);

create table public.gw_inbox (
  target_app public.gw_app not null,
  event_id uuid not null,
  tenant_id text not null,
  result text not null,
  applied_at timestamptz not null default clock_timestamp(),
  primary key (target_app, event_id)
);
create table public.gw_projections (
  tenant_id text not null,
  target_app public.gw_app not null,
  aggregate_type text not null,
  aggregate_id text not null,
  vin text,
  state jsonb not null default '{}'::jsonb,
  source_revisions jsonb not null default '{}'::jsonb,
  apply_count int not null default 0,
  updated_at timestamptz not null default clock_timestamp(),
  primary key (tenant_id, target_app, aggregate_type, aggregate_id)
);
create index on public.gw_projections (tenant_id, vin);
create table public.gw_evidence (
  id bigserial primary key,
  tenant_id text not null,
  target_app public.gw_app not null,
  event_id uuid not null,
  route_id text not null,
  kind text not null,
  detail jsonb not null default '{}'::jsonb,
  payload_hash text not null,
  created_at timestamptz not null default clock_timestamp()
);
create index on public.gw_evidence (tenant_id, event_id);
create table public.gw_dead_letters (
  id bigserial primary key,
  queue_id bigint not null references public.gw_queue(id),
  event_id uuid not null,
  tenant_id text not null,
  route_id text not null,
  reason text not null,
  attempts int not null,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolution text
);
create table public.gw_replay_audit (
  id bigserial primary key,
  tenant_id text not null,
  actor uuid,
  scope jsonb not null,
  requeued int not null,
  created_at timestamptz not null default now()
);
create table public.gw_reconciliation_runs (
  id bigserial primary key,
  tenant_id text not null,
  actor uuid,
  checked int not null,
  mismatches int not null,
  details jsonb not null,
  created_at timestamptz not null default now()
);
create table public.gw_bench_runs (
  id uuid primary key default gen_random_uuid(),
  tenant_scope text[] not null,
  requested_events int not null,
  workers int not null,
  status text not null default 'running',
  results jsonb,
  created_by uuid,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
create table public.gw_app_identities (
  id uuid primary key default gen_random_uuid(),
  app public.gw_app not null,
  tenant_id text not null references public.gw_tenants(id),
  key_id text not null,
  scopes text[] not null,
  status text not null default 'active' check (status in ('active','next','retired')),
  not_before timestamptz not null default now(),
  rotate_after timestamptz not null default now() + interval '30 days',
  unique (app, tenant_id, key_id)
);
create table public.gw_audit_log (
  id bigserial primary key,
  tenant_id text,
  actor uuid,
  action text not null,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- Immutability ------------------------------------------------------------
create or replace function public.gw_forbid_mutation() returns trigger language plpgsql as $$
begin raise exception 'immutable table %: % not allowed', tg_table_name, tg_op; end $$;
create trigger gw_evidence_immutable before update or delete on public.gw_evidence for each row execute function public.gw_forbid_mutation();
create trigger gw_outbox_immutable before update or delete on public.gw_outbox for each row execute function public.gw_forbid_mutation();
create trigger gw_replay_audit_immutable before update or delete on public.gw_replay_audit for each row execute function public.gw_forbid_mutation();

-- Membership helpers ------------------------------------------------------
create or replace function public.gw_is_member(_tenant text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from gw_tenant_members where user_id = auth.uid() and tenant_id = _tenant)
$$;
create or replace function public.gw_has_role(_tenant text, _roles public.gw_role[]) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from gw_tenant_members where user_id = auth.uid() and tenant_id = _tenant and role = any(_roles))
$$;

-- Grants (read-only to authenticated; all writes go through SECURITY DEFINER functions)
do $$
declare t text;
begin
  foreach t in array array['gw_tenants','gw_rooftops','gw_tenant_members','gw_vehicle_identities','gw_vehicle_instances',
    'gw_listing_episodes','gw_source_allowlist','gw_routes','gw_settings','gw_route_controls','gw_tenant_quotas',
    'gw_circuit_breakers','gw_source_revisions','gw_outbox','gw_queue','gw_inbox','gw_projections','gw_evidence',
    'gw_dead_letters','gw_replay_audit','gw_reconciliation_runs','gw_bench_runs','gw_app_identities','gw_audit_log']
  loop
    execute format('grant select on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- Tenant-scoped read policies
create policy "members read tenants" on public.gw_tenants for select to authenticated using (public.gw_is_member(id));
create policy "own memberships" on public.gw_tenant_members for select to authenticated using (user_id = auth.uid());
do $$
declare t text;
begin
  foreach t in array array['gw_rooftops','gw_vehicle_identities','gw_vehicle_instances','gw_listing_episodes',
    'gw_route_controls','gw_tenant_quotas','gw_circuit_breakers','gw_source_revisions','gw_outbox','gw_queue','gw_inbox',
    'gw_projections','gw_evidence','gw_dead_letters','gw_replay_audit','gw_reconciliation_runs','gw_app_identities']
  loop
    execute format('create policy "tenant members read" on public.%I for select to authenticated using (public.gw_is_member(tenant_id))', t);
  end loop;
end $$;
create policy "audit read" on public.gw_audit_log for select to authenticated using (tenant_id is null or public.gw_is_member(tenant_id));
create policy "registry read" on public.gw_source_allowlist for select to authenticated using (true);
create policy "routes read" on public.gw_routes for select to authenticated using (true);
create policy "settings read" on public.gw_settings for select to authenticated using (true);
create policy "bench read own" on public.gw_bench_runs for select to authenticated using (created_by = auth.uid());
