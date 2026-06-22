create table if not exists public.customer_engagement_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id text,
  store_id text,
  vehicle_id text,
  vin text,
  stock text,
  session_id text not null,
  visitor_id text,
  source text not null default 'unknown' check (source in ('passport','window_sticker_qr','website','email','sms','direct','unknown')),
  surface text not null default 'unknown' check (surface in ('vehicle_passport','window_sticker','public_listing','document_packet','document_viewer','lead_form','unknown')),
  event_type text not null check (event_type in (
    'passport_opened',
    'window_sticker_scanned',
    'public_listing_opened',
    'packet_opened',
    'document_opened',
    'document_downloaded',
    'document_printed',
    'photo_viewed',
    'video_played',
    'cta_clicked',
    'lead_form_opened',
    'lead_submitted',
    'share_clicked',
    'call_clicked',
    'text_clicked',
    'directions_clicked',
    'finance_clicked',
    'trade_clicked',
    'scroll_depth',
    'time_on_page',
    'engagement_ping'
  )),
  document_type text,
  document_id text,
  document_title text,
  packet_id text,
  qr_token text,
  referrer text,
  landing_url text,
  user_agent text,
  ip_address inet,
  device_type text,
  browser text,
  os text,
  country text,
  region text,
  city text,
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists customer_engagement_events_tenant_time_idx
  on public.customer_engagement_events (tenant_id, occurred_at desc);

create index if not exists customer_engagement_events_vehicle_time_idx
  on public.customer_engagement_events (vehicle_id, occurred_at desc);

create index if not exists customer_engagement_events_vin_time_idx
  on public.customer_engagement_events (vin, occurred_at desc);

create index if not exists customer_engagement_events_session_idx
  on public.customer_engagement_events (session_id, occurred_at desc);

create index if not exists customer_engagement_events_event_type_idx
  on public.customer_engagement_events (event_type, occurred_at desc);

create index if not exists customer_engagement_events_document_idx
  on public.customer_engagement_events (document_type, document_id, occurred_at desc);

create index if not exists customer_engagement_events_metadata_gin_idx
  on public.customer_engagement_events using gin (metadata);

alter table public.customer_engagement_events enable row level security;

create policy if not exists "customer_engagement_events_service_role_all"
  on public.customer_engagement_events
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

create policy if not exists "customer_engagement_events_authenticated_read"
  on public.customer_engagement_events
  for select
  using (auth.role() = 'authenticated');

create or replace view public.customer_engagement_vehicle_summary as
select
  tenant_id,
  vehicle_id,
  vin,
  stock,
  count(*) as total_events,
  count(distinct session_id) as unique_sessions,
  count(*) filter (where event_type = 'passport_opened') as passport_opens,
  count(*) filter (where event_type = 'window_sticker_scanned') as sticker_scans,
  count(*) filter (where event_type = 'packet_opened') as packet_opens,
  count(*) filter (where event_type = 'document_opened') as document_opens,
  count(*) filter (where event_type = 'cta_clicked') as cta_clicks,
  count(*) filter (where event_type = 'lead_submitted') as leads,
  max(occurred_at) as last_engaged_at,
  min(occurred_at) as first_engaged_at
from public.customer_engagement_events
group by tenant_id, vehicle_id, vin, stock;

create or replace view public.customer_engagement_document_summary as
select
  tenant_id,
  vehicle_id,
  vin,
  document_type,
  document_id,
  document_title,
  count(*) as total_events,
  count(distinct session_id) as unique_sessions,
  count(*) filter (where event_type = 'document_opened') as opens,
  count(*) filter (where event_type = 'document_downloaded') as downloads,
  count(*) filter (where event_type = 'document_printed') as prints,
  max(occurred_at) as last_opened_at
from public.customer_engagement_events
where document_type is not null or document_id is not null
group by tenant_id, vehicle_id, vin, document_type, document_id, document_title;
