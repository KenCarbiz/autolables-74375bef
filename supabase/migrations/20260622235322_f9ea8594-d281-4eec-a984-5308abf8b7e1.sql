
create table if not exists public.used_vehicle_inspections (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid null,
  store_id uuid null,
  vehicle_id uuid null,
  vin text null,
  stock text null,
  qr_token text null,
  inspection_status text not null default 'draft',
  manager_approval_status text not null default 'pending',
  technician_name text null,
  advisor_name text null,
  mileage integer null,
  inspection_date timestamptz not null default now(),
  tires_front_left text null,
  tires_front_right text null,
  tires_rear_left text null,
  tires_rear_right text null,
  front_brakes text null,
  rear_brakes text null,
  battery_status text null,
  fluids_status text null,
  alignment_status text null,
  warning_lights_status text null,
  road_test_status text null,
  recon_summary text null,
  technician_notes text null,
  customer_visible_notes text null,
  show_on_passport boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.used_vehicle_investment_items (
  id uuid primary key default gen_random_uuid(),
  inspection_id uuid not null references public.used_vehicle_inspections(id) on delete cascade,
  tenant_id uuid null,
  vehicle_id uuid null,
  vin text null,
  stock text null,
  label text not null,
  amount numeric(12,2) null,
  detail text null,
  source text not null default 'service_qr_manual',
  show_on_passport boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.used_vehicle_inspection_photos (
  id uuid primary key default gen_random_uuid(),
  inspection_id uuid not null references public.used_vehicle_inspections(id) on delete cascade,
  tenant_id uuid null,
  vehicle_id uuid null,
  vin text null,
  stock text null,
  photo_url text not null,
  caption text null,
  category text null,
  show_on_passport boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists used_vehicle_inspections_tenant_idx on public.used_vehicle_inspections(tenant_id);
create index if not exists used_vehicle_inspections_vehicle_idx on public.used_vehicle_inspections(vehicle_id);
create index if not exists used_vehicle_inspections_vin_idx on public.used_vehicle_inspections(vin);
create index if not exists used_vehicle_inspections_qr_idx on public.used_vehicle_inspections(qr_token);
create index if not exists used_vehicle_investment_items_inspection_idx on public.used_vehicle_investment_items(inspection_id);
create index if not exists used_vehicle_inspection_photos_inspection_idx on public.used_vehicle_inspection_photos(inspection_id);

grant select, insert, update, delete on public.used_vehicle_inspections to authenticated;
grant all on public.used_vehicle_inspections to service_role;
grant select, insert, update, delete on public.used_vehicle_investment_items to authenticated;
grant all on public.used_vehicle_investment_items to service_role;
grant select, insert, update, delete on public.used_vehicle_inspection_photos to authenticated;
grant all on public.used_vehicle_inspection_photos to service_role;

alter table public.used_vehicle_inspections enable row level security;
alter table public.used_vehicle_investment_items enable row level security;
alter table public.used_vehicle_inspection_photos enable row level security;

drop policy if exists "Members manage tenant inspections" on public.used_vehicle_inspections;
create policy "Members manage tenant inspections"
  on public.used_vehicle_inspections for all
  to authenticated
  using (
    tenant_id is not null and tenant_id in (
      select tm.tenant_id from public.tenant_members tm
      where tm.user_id = (select auth.uid()) and tm.accepted_at is not null
    )
  )
  with check (
    tenant_id is not null and tenant_id in (
      select tm.tenant_id from public.tenant_members tm
      where tm.user_id = (select auth.uid()) and tm.accepted_at is not null
    )
  );

drop policy if exists "Members manage tenant investment items" on public.used_vehicle_investment_items;
create policy "Members manage tenant investment items"
  on public.used_vehicle_investment_items for all
  to authenticated
  using (
    tenant_id is not null and tenant_id in (
      select tm.tenant_id from public.tenant_members tm
      where tm.user_id = (select auth.uid()) and tm.accepted_at is not null
    )
  )
  with check (
    tenant_id is not null and tenant_id in (
      select tm.tenant_id from public.tenant_members tm
      where tm.user_id = (select auth.uid()) and tm.accepted_at is not null
    )
  );

drop policy if exists "Members manage tenant inspection photos" on public.used_vehicle_inspection_photos;
create policy "Members manage tenant inspection photos"
  on public.used_vehicle_inspection_photos for all
  to authenticated
  using (
    tenant_id is not null and tenant_id in (
      select tm.tenant_id from public.tenant_members tm
      where tm.user_id = (select auth.uid()) and tm.accepted_at is not null
    )
  )
  with check (
    tenant_id is not null and tenant_id in (
      select tm.tenant_id from public.tenant_members tm
      where tm.user_id = (select auth.uid()) and tm.accepted_at is not null
    )
  );

drop trigger if exists used_vehicle_inspections_set_updated_at on public.used_vehicle_inspections;
create trigger used_vehicle_inspections_set_updated_at
  before update on public.used_vehicle_inspections
  for each row execute function public.set_updated_at();
