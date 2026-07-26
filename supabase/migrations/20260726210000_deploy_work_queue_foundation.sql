-- Deploy the Work Queue foundation to environments where 20260622182000
-- never applied (the live project had no dealer_work_items /
-- dealer_automation_settings, so /work-queue error-toasted "the newest
-- migration may still be deploying" and showed zero work while every other
-- surface counted real backlog).
--
-- Re-declares the three tables idempotently and REPLACES the original
-- any-authenticated-user policies with the canonical tenant-scoped shape
-- (tenant_members + (SELECT auth.uid()), TO authenticated). Service-role
-- automation bypasses RLS as always.

create table if not exists public.dealer_work_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid null,
  store_id uuid null,
  vehicle_id uuid null,
  vin text null,
  stock text null,
  vehicle_title text null,
  condition text null,
  work_type text not null,
  title text not null,
  description text null,
  status text not null default 'open',
  priority text not null default 'normal',
  department text not null default 'inventory',
  source text not null default 'automation',
  assigned_to uuid null,
  due_at timestamptz null,
  completed_at timestamptz null,
  completed_by uuid null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.dealer_automation_settings (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null unique,
  auto_create_work_from_scraper boolean not null default true,
  auto_create_print_tasks boolean not null default true,
  auto_send_used_to_get_ready boolean not null default false,
  auto_send_new_to_get_ready boolean not null default false,
  auto_check_standard_prep boolean not null default true,
  require_manager_approval_before_print boolean not null default false,
  require_manager_approval_before_passport_publish boolean not null default true,
  enable_cpo_detection boolean not null default true,
  enable_demo_detection boolean not null default true,
  enable_ev_detection boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.standard_prep_templates (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid null,
  name text not null,
  condition text not null default 'used',
  department text not null default 'service',
  items jsonb not null default '[]'::jsonb,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists dealer_work_items_tenant_idx on public.dealer_work_items(tenant_id);
create index if not exists dealer_work_items_vehicle_idx on public.dealer_work_items(vehicle_id);
create index if not exists dealer_work_items_status_idx on public.dealer_work_items(status);
create index if not exists dealer_work_items_type_idx on public.dealer_work_items(work_type);
create index if not exists dealer_work_items_vin_idx on public.dealer_work_items(vin);

alter table public.dealer_work_items enable row level security;
alter table public.dealer_automation_settings enable row level security;
alter table public.standard_prep_templates enable row level security;

drop policy if exists "Authenticated users can manage dealer work items" on public.dealer_work_items;
drop policy if exists "Authenticated users can manage dealer automation settings" on public.dealer_automation_settings;
drop policy if exists "Authenticated users can manage standard prep templates" on public.standard_prep_templates;

drop policy if exists "work_items_tenant_rw" on public.dealer_work_items;
create policy "work_items_tenant_rw"
  on public.dealer_work_items for all
  to authenticated
  using (
    tenant_id in (
      select tenant_id from public.tenant_members
      where user_id = (select auth.uid()) and accepted_at is not null
    )
  )
  with check (
    tenant_id in (
      select tenant_id from public.tenant_members
      where user_id = (select auth.uid()) and accepted_at is not null
    )
  );

drop policy if exists "automation_settings_tenant_rw" on public.dealer_automation_settings;
create policy "automation_settings_tenant_rw"
  on public.dealer_automation_settings for all
  to authenticated
  using (
    tenant_id in (
      select tenant_id from public.tenant_members
      where user_id = (select auth.uid()) and accepted_at is not null
    )
  )
  with check (
    tenant_id in (
      select tenant_id from public.tenant_members
      where user_id = (select auth.uid()) and accepted_at is not null
    )
  );

drop policy if exists "prep_templates_tenant_rw" on public.standard_prep_templates;
create policy "prep_templates_tenant_rw"
  on public.standard_prep_templates for all
  to authenticated
  using (
    tenant_id is null or tenant_id in (
      select tenant_id from public.tenant_members
      where user_id = (select auth.uid()) and accepted_at is not null
    )
  )
  with check (
    tenant_id in (
      select tenant_id from public.tenant_members
      where user_id = (select auth.uid()) and accepted_at is not null
    )
  );
