create table if not exists public.passport_delivery_settings (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null unique,
  enabled boolean not null default false,
  require_customer_name boolean not null default true,
  require_sms_verification boolean not null default false,
  require_phone boolean not null default false,
  create_lead boolean not null default true,
  notify_sales_team boolean not null default true,
  allow_trade_value_cta boolean not null default true,
  autocurb_trade_enabled boolean not null default false,
  autocurb_trade_url text,
  email_subject_template text not null default 'Your vehicle information packet from {{dealer_name}}',
  email_intro_template text not null default 'Here is the vehicle information packet you requested.',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.passport_document_delivery_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id text,
  store_id text,
  vehicle_id text,
  vin text,
  stock text,
  packet_id text,
  qr_token text,
  customer_name text,
  customer_email text not null,
  customer_phone text,
  verification_required boolean not null default false,
  verification_status text not null default 'not_required' check (verification_status in ('not_required','pending','verified','failed','expired')),
  delivery_status text not null default 'requested' check (delivery_status in ('requested','queued','sent','failed','cancelled')),
  lead_status text not null default 'new' check (lead_status in ('new','created','sent_to_crm','failed','suppressed')),
  source text not null default 'passport' check (source in ('passport','window_sticker_qr','website','email','sms','direct','unknown')),
  vehicle_of_interest jsonb not null default '{}'::jsonb,
  requested_documents jsonb not null default '[]'::jsonb,
  customer_trade_intent jsonb not null default '{}'::jsonb,
  autocurb_handoff jsonb not null default '{}'::jsonb,
  session_id text,
  visitor_id text,
  referrer text,
  landing_url text,
  user_agent text,
  ip_address inet,
  metadata jsonb not null default '{}'::jsonb,
  requested_at timestamptz not null default now(),
  verified_at timestamptz,
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.passport_sms_verifications (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.passport_document_delivery_requests(id) on delete cascade,
  tenant_id text,
  phone text not null,
  code_hash text not null,
  status text not null default 'pending' check (status in ('pending','verified','failed','expired')),
  attempts integer not null default 0,
  max_attempts integer not null default 5,
  sent_at timestamptz not null default now(),
  verified_at timestamptz,
  expires_at timestamptz not null default now() + interval '10 minutes',
  provider text,
  provider_message_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.passport_document_delivery_outbox (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.passport_document_delivery_requests(id) on delete cascade,
  tenant_id text,
  channel text not null default 'email' check (channel in ('email','sms','crm','sales_notification','autocurb_trade')),
  status text not null default 'queued' check (status in ('queued','sent','failed','cancelled')),
  recipient text,
  subject text,
  payload jsonb not null default '{}'::jsonb,
  provider text,
  provider_message_id text,
  error text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists passport_delivery_settings_tenant_idx on public.passport_delivery_settings (tenant_id);
create index if not exists passport_delivery_requests_tenant_time_idx on public.passport_document_delivery_requests (tenant_id, requested_at desc);
create index if not exists passport_delivery_requests_vehicle_time_idx on public.passport_document_delivery_requests (vehicle_id, requested_at desc);
create index if not exists passport_delivery_requests_vin_time_idx on public.passport_document_delivery_requests (vin, requested_at desc);
create index if not exists passport_delivery_requests_email_idx on public.passport_document_delivery_requests (customer_email, requested_at desc);
create index if not exists passport_sms_verifications_request_idx on public.passport_sms_verifications (request_id, created_at desc);
create index if not exists passport_delivery_outbox_status_idx on public.passport_document_delivery_outbox (status, created_at asc);
create index if not exists passport_delivery_outbox_request_idx on public.passport_document_delivery_outbox (request_id, created_at desc);

alter table public.passport_delivery_settings enable row level security;
alter table public.passport_document_delivery_requests enable row level security;
alter table public.passport_sms_verifications enable row level security;
alter table public.passport_document_delivery_outbox enable row level security;

create policy if not exists "passport_delivery_settings_service_role_all"
  on public.passport_delivery_settings for all
  using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

create policy if not exists "passport_delivery_settings_authenticated_read"
  on public.passport_delivery_settings for select
  using (auth.role() = 'authenticated');

create policy if not exists "passport_document_delivery_requests_service_role_all"
  on public.passport_document_delivery_requests for all
  using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

create policy if not exists "passport_document_delivery_requests_authenticated_read"
  on public.passport_document_delivery_requests for select
  using (auth.role() = 'authenticated');

create policy if not exists "passport_sms_verifications_service_role_all"
  on public.passport_sms_verifications for all
  using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

create policy if not exists "passport_delivery_outbox_service_role_all"
  on public.passport_document_delivery_outbox for all
  using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

create policy if not exists "passport_delivery_outbox_authenticated_read"
  on public.passport_document_delivery_outbox for select
  using (auth.role() = 'authenticated');

create or replace function public.touch_passport_delivery_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_touch_passport_delivery_settings on public.passport_delivery_settings;
create trigger trg_touch_passport_delivery_settings
before update on public.passport_delivery_settings
for each row execute function public.touch_passport_delivery_updated_at();

drop trigger if exists trg_touch_passport_document_delivery_requests on public.passport_document_delivery_requests;
create trigger trg_touch_passport_document_delivery_requests
before update on public.passport_document_delivery_requests
for each row execute function public.touch_passport_delivery_updated_at();

drop trigger if exists trg_touch_passport_document_delivery_outbox on public.passport_document_delivery_outbox;
create trigger trg_touch_passport_document_delivery_outbox
before update on public.passport_document_delivery_outbox
for each row execute function public.touch_passport_delivery_updated_at();

create or replace view public.passport_delivery_request_summary as
select
  tenant_id,
  vehicle_id,
  vin,
  stock,
  count(*) as total_requests,
  count(*) filter (where verification_status = 'verified') as verified_requests,
  count(*) filter (where delivery_status = 'sent') as delivered_requests,
  count(*) filter (where lead_status in ('created','sent_to_crm')) as leads_created,
  count(*) filter (where nullif(customer_phone, '') is not null) as phone_captured,
  count(*) filter (where coalesce(customer_trade_intent, '{}'::jsonb) <> '{}'::jsonb) as trade_intent_count,
  max(requested_at) as last_requested_at
from public.passport_document_delivery_requests
group by tenant_id, vehicle_id, vin, stock;
