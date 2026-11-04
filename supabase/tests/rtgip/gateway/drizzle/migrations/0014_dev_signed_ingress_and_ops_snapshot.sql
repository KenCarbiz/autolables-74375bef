-- 0014: DEV-only signed ingress (key METADATA only, never key material), transactional nonce replay cache,
-- durable receipts, and an RLS-scoped operations snapshot. Additive. gw_dev_ingest is SERVICE-ROLE ONLY.

create table public.gw_ingest_keys (
  key_id text primary key,
  source_app gw_app not null,
  tenant_id text not null references public.gw_tenants(id),
  rooftop_ids text[] not null,
  key_fingerprint text not null check (key_fingerprint ~ '^[0-9a-f]{64}$'),
  not_before timestamptz not null,
  not_after timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  check (not_after > not_before)
);
grant select on public.gw_ingest_keys to authenticated;
grant all on public.gw_ingest_keys to service_role;
alter table public.gw_ingest_keys enable row level security;
create policy "tenant members read key metadata" on public.gw_ingest_keys for select to authenticated using (gw_is_member(tenant_id));

create table public.gw_ingest_nonces (
  key_id text not null,
  nonce text not null,
  received_at timestamptz not null default clock_timestamp(),
  primary key (key_id, nonce)
);
grant all on public.gw_ingest_nonces to service_role;
alter table public.gw_ingest_nonces enable row level security;

create table public.gw_ingest_receipts (
  id bigserial primary key,
  key_id text,
  tenant_id text,
  source_app text,
  event_id uuid,
  body_sha256 text,
  decision text not null,
  reason text,
  http_status int not null,
  correlation_id uuid,
  causation_id uuid,
  trace_id text,
  received_at timestamptz not null default clock_timestamp()
);
create index gw_ingest_receipts_recent on public.gw_ingest_receipts (received_at desc);
grant select on public.gw_ingest_receipts to authenticated;
grant all on public.gw_ingest_receipts to service_role;
grant usage on sequence public.gw_ingest_receipts_id_seq to service_role;
alter table public.gw_ingest_receipts enable row level security;
create policy "tenant members read receipts" on public.gw_ingest_receipts for select to authenticated using (tenant_id is not null and gw_is_member(tenant_id));

-- DEV test keyring metadata. Fingerprint = sha256 of a PUBLIC, non-secret DEV test key held only in server code.
insert into public.gw_ingest_keys(key_id, source_app, tenant_id, rooftop_ids, key_fingerprint, not_before, not_after, revoked_at) values
 ('labels-nw-k1','autolabels','grp-syn-northwind','{rt-syn-nw-01,rt-syn-nw-02}','f1e581d8229989ab5f0fd325dac1697af61fff1d729934290fcb936ac333a021', now() - interval '1 day', now() + interval '90 days', null),
 ('labels-nw-k2','autolabels','grp-syn-northwind','{rt-syn-nw-01,rt-syn-nw-02}','5ae2da2a1f11a3b993267ab8a6d3b3df6daf5770f932dfed8b0740e5acb14981', now() - interval '1 hour', now() + interval '180 days', null),
 ('film-ls-k1','autofilm','grp-syn-lakeshore','{rt-syn-ls-01,rt-syn-ls-02,rt-syn-ls-03}','2b56d6ef52e7a721e9a92e774a4b431498a79cf8db72699609e6945cda10aa59', now() - interval '1 day', now() + interval '90 days', null),
 ('curb-nw-k1','autocurb','grp-syn-northwind','{rt-syn-nw-01,rt-syn-nw-02}','55fee789dac582c29f231163996093cf579d5ec1560c0f76e90328bb3345bdbf', now() - interval '1 day', now() + interval '90 days', null),
 ('frame-nw-k1','autoframe','grp-syn-northwind','{rt-syn-nw-01}','3bf1612fb748eec94e4a7ef32c15d349acccf69a8f78354d90dcefe907012b42', now() - interval '1 day', now() + interval '90 days', null),
 ('labels-nw-revoked','autolabels','grp-syn-northwind','{rt-syn-nw-01}','4a7149704212f6c3cf874ad1da57115434b7c51f5492c1f0720c10ac888af9c2', now() - interval '2 days', now() + interval '90 days', now() - interval '1 day'),
 ('film-ls-expired','autofilm','grp-syn-lakeshore','{rt-syn-ls-01}','4c9f32e721c4f71245a696f707d319dfaa37bdec0e7305fc41e6362c683d766f', now() - interval '30 days', now() - interval '1 day', null);

create or replace function public.gw_dev_ingest(_key_id text, _nonce text, _ts timestamptz, _body_sha256 text, _env jsonb)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare k gw_ingest_keys%rowtype; v_res jsonb; v_status int; v_dec text; v_reason text; v_hash text; v_event uuid;
begin
  begin v_event := (_env->>'event_id')::uuid; exception when others then v_event := null; end;
  select * into k from gw_ingest_keys where key_id = _key_id;
  if not found then v_dec := 'denied'; v_reason := 'unknown key'; v_status := 401;
  elsif k.revoked_at is not null and k.revoked_at <= clock_timestamp() then v_dec := 'denied'; v_reason := 'revoked key'; v_status := 401;
  elsif clock_timestamp() < k.not_before or clock_timestamp() > k.not_after then v_dec := 'denied'; v_reason := 'key outside validity window'; v_status := 401;
  elsif _ts is null or abs(extract(epoch from (clock_timestamp() - _ts))) > 300 then v_dec := 'denied'; v_reason := 'timestamp outside +/-300s'; v_status := 401;
  elsif _nonce is null or _nonce !~ '^[A-Za-z0-9_-]{16,64}$' then v_dec := 'denied'; v_reason := 'bad nonce'; v_status := 400;
  elsif (_env->>'source_app') is distinct from k.source_app::text then v_dec := 'denied'; v_reason := 'key not bound to source_app'; v_status := 403;
  elsif (_env->>'tenant_id') is distinct from k.tenant_id then v_dec := 'denied'; v_reason := 'key not bound to tenant'; v_status := 403;
  elsif not ((_env->>'rooftop_id') = any(k.rooftop_ids))
     or not exists (select 1 from gw_rooftops where id = _env->>'rooftop_id' and tenant_id = k.tenant_id) then
    v_dec := 'denied'; v_reason := 'key not bound to rooftop (or rooftop mapping missing)'; v_status := 403;
  end if;
  if v_dec is null then
    delete from gw_ingest_nonces where key_id = _key_id and received_at < clock_timestamp() - interval '15 minutes';
    insert into gw_ingest_nonces(key_id, nonce) values (_key_id, _nonce) on conflict do nothing;
    if not found then v_dec := 'denied'; v_reason := 'nonce replay'; v_status := 409; end if;
  end if;
  if v_dec is null and v_event is not null then
    select payload_hash into v_hash from gw_outbox where event_id = v_event;
    if found and v_hash <> encode(digest((_env->'payload')::text, 'sha256'), 'hex') then
      v_dec := 'conflict'; v_reason := 'event_id reused with different canonical payload hash'; v_status := 409;
    end if;
  end if;
  if v_dec is null then
    v_res := gw_publish_internal(_env, null);
    v_dec := v_res->>'status'; v_reason := v_res->>'reason';
    v_status := case v_dec when 'accepted' then 202 when 'duplicate' then 200 when 'stale' then 409
      when 'backpressure' then 429 when 'rate_limited' then 429 else 422 end;
  end if;
  insert into gw_ingest_receipts(key_id, tenant_id, source_app, event_id, body_sha256, decision, reason, http_status, correlation_id, causation_id, trace_id)
  values (_key_id, case when k.key_id is not null then k.tenant_id end, case when k.key_id is not null then k.source_app::text end, v_event,
    left(_body_sha256, 64), v_dec, left(v_reason, 200), v_status,
    case when (_env->>'correlation_id') ~ '^[0-9a-f-]{36}$' then (_env->>'correlation_id')::uuid end,
    case when (_env->>'causation_id') ~ '^[0-9a-f-]{36}$' then (_env->>'causation_id')::uuid end,
    left(_env->>'trace_id', 64));
  return jsonb_build_object('decision', v_dec, 'reason', v_reason, 'http_status', v_status, 'event_id', v_event);
end $$;
revoke all on function public.gw_dev_ingest(text, text, timestamptz, text, jsonb) from public, anon, authenticated;
grant execute on function public.gw_dev_ingest(text, text, timestamptz, text, jsonb) to service_role;

-- Operations snapshot. SECURITY INVOKER: RLS limits every count to the caller's member tenants (no cross-tenant leakage).
create or replace function public.gw_ops_snapshot()
returns jsonb language sql stable security invoker set search_path = public as $$
  select jsonb_build_object(
    'db_time', clock_timestamp(),
    'queue', coalesce((select jsonb_object_agg(status, n) from (select status, count(*) n from gw_queue where status in ('pending','retry','leased','held') group by status) s), '{}'::jsonb),
    'oldest_ready_age_s', coalesce((select extract(epoch from clock_timestamp() - min(accepted_at)) from gw_queue where status in ('pending','retry') and available_at <= clock_timestamp()), 0),
    'expired_leases', (select count(*) from gw_queue where status = 'leased' and lease_until < clock_timestamp()),
    'lag_p95_ms', (select percentile_cont(0.95) within group (order by extract(epoch from delivered_at - accepted_at) * 1000) from gw_queue where status = 'delivered' and delivered_at > clock_timestamp() - interval '15 minutes'),
    'lag_p99_ms', (select percentile_cont(0.99) within group (order by extract(epoch from delivered_at - accepted_at) * 1000) from gw_queue where status = 'delivered' and delivered_at > clock_timestamp() - interval '15 minutes'),
    'delivered_15m', (select count(*) from gw_queue where status = 'delivered' and delivered_at > clock_timestamp() - interval '15 minutes'),
    'retry_now', (select count(*) from gw_queue where status = 'retry'),
    'last_delivered_at', (select max(delivered_at) from gw_queue where status = 'delivered'),
    'dlq_unresolved', (select count(*) from gw_dead_letters where resolved_at is null),
    'dlq_1h', (select count(*) from gw_dead_letters where created_at > clock_timestamp() - interval '1 hour'),
    'breakers_open', (select count(*) from gw_circuit_breakers where state = 'open' or forced_open),
    'global_kill', (select global_kill from gw_settings where id = 1),
    'external_delivery_enabled', (select external_delivery_enabled from gw_settings where id = 1),
    'ingest_denied_15m', (select count(*) from gw_ingest_receipts where decision in ('denied','conflict') and received_at > clock_timestamp() - interval '15 minutes'),
    'ingest_total_15m', (select count(*) from gw_ingest_receipts where received_at > clock_timestamp() - interval '15 minutes'),
    'keys_expiring_7d', (select count(*) from gw_ingest_keys where revoked_at is null and not_after between clock_timestamp() and clock_timestamp() + interval '7 days')
  )
$$;
revoke all on function public.gw_ops_snapshot() from public, anon;
grant execute on function public.gw_ops_snapshot() to authenticated, service_role;