create table if not exists public.ct_mvp_compliance_digest_outbox (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null,
  subject text not null,
  summary_text text not null,
  digest jsonb not null default '{}'::jsonb,
  status text not null default 'queued' check (status in ('queued','sent','failed','dismissed')),
  channel text not null default 'manager_digest' check (channel in ('manager_digest','email','in_app')),
  recipient_email text,
  sent_at timestamptz,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists ct_mvp_digest_outbox_tenant_status_idx
  on public.ct_mvp_compliance_digest_outbox (tenant_id, status, created_at desc);

create index if not exists ct_mvp_digest_outbox_created_idx
  on public.ct_mvp_compliance_digest_outbox (created_at desc);

alter table public.ct_mvp_compliance_digest_outbox enable row level security;

create policy if not exists "ct_mvp_digest_outbox_service_role_all"
  on public.ct_mvp_compliance_digest_outbox
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

create policy if not exists "ct_mvp_digest_outbox_authenticated_read"
  on public.ct_mvp_compliance_digest_outbox
  for select
  using (auth.role() = 'authenticated');

create or replace function public.touch_ct_mvp_compliance_digest_outbox()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_touch_ct_mvp_compliance_digest_outbox on public.ct_mvp_compliance_digest_outbox;
create trigger trg_touch_ct_mvp_compliance_digest_outbox
before update on public.ct_mvp_compliance_digest_outbox
for each row execute function public.touch_ct_mvp_compliance_digest_outbox();
