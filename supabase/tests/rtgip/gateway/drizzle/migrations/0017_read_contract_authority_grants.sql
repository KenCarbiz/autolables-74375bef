-- 0017 Phase 3B: source-authority registry, app-identity read grants, read audit, service-only scoped read fetch.
create table public.gw_source_authority (
  domain text not null, field text not null, owner_app gw_app not null,
  shareable boolean not null, classification text not null check (classification in ('internal','finance','pii')),
  primary key (domain, field));
grant select on public.gw_source_authority to authenticated;
grant all on public.gw_source_authority to service_role;
alter table public.gw_source_authority enable row level security;
create policy "authenticated read authority registry" on public.gw_source_authority for select to authenticated using (true);
insert into public.gw_source_authority(domain, field, owner_app, shareable, classification) values
 ('identity','vin','autolabels',true,'internal'),('identity','instance_id','autolabels',true,'internal'),('identity','episode_id','autolabels',true,'internal'),
 ('listing','status','autolabels',true,'internal'),('listing','mileage','autolabels',true,'internal'),('listing','passport_id','autolabels',true,'internal'),
 ('listing','price_cents','autolabels',true,'internal'),('listing','sold_at','autolabels',true,'internal'),('listing','archived','autolabels',true,'internal'),
 ('listing','sale_voided','autolabels',true,'internal'),('listing','lifecycle','autolabels',true,'internal'),('listing','rev','autolabels',true,'internal'),
 ('media','media_id','autoframe',true,'internal'),('media','content_sha256','autoframe',true,'internal'),('media','object_ref','autoframe',true,'internal'),
 ('media','mime','autoframe',true,'internal'),('media','width','autoframe',true,'internal'),('media','height','autoframe',true,'internal'),
 ('media','preset_version','autoframe',true,'internal'),('media','preset_order','autoframe',true,'internal'),('media','approval','autoframe',true,'internal'),
 ('media','rev','autoframe',true,'internal'),
 ('service','mpi_id','autofilm',true,'internal'),('service','items_green','autofilm',true,'internal'),('service','evidence_ref','autofilm',true,'internal'),
 ('service','service_visit_ref','autofilm',true,'internal'),('service','evidence_refs','autofilm',true,'internal'),('service','rev','autofilm',true,'internal'),
 ('video','views','autofilm',true,'internal'),('video','watch_seconds','autofilm',true,'internal'),('video','rev','autofilm',true,'internal'),
 ('acquisition','appraisal_completed','autocurb',true,'internal'),('acquisition','acquired','autocurb',true,'internal'),('acquisition','rev','autocurb',true,'internal'),
 ('acquisition','appraisal_cents','autocurb',false,'finance'),
 ('crm','consent_id','autocurb',false,'pii'),('crm','contact_ref','autocurb',false,'pii');

-- Reader app identities (PUBLIC non-secret DEV test keys; fingerprint = sha256('dev-public-ingest-key:'||key_id)).
insert into public.gw_ingest_keys(key_id, source_app, tenant_id, rooftop_ids, key_fingerprint, not_before, not_after, revoked_at) values
 ('film-nw-r1','autofilm','grp-syn-northwind','{rt-syn-nw-01,rt-syn-nw-02}','df7654845d41ab45d1218b4a4e87d7d09c76d3469a65596e16d8064b36f05bd0', now() - interval '1 day', now() + interval '90 days', null),
 ('frame-nw-r1','autoframe','grp-syn-northwind','{rt-syn-nw-01}','d774a1f696f6d7eca1c9c8b69375eff518cf7f62fb7838998b98a7dbb48d2b88', now() - interval '1 day', now() + interval '90 days', null)
on conflict (key_id) do nothing;

create table public.gw_read_grants (
  key_id text not null references public.gw_ingest_keys(key_id),
  read_model text not null check (read_model = 'vehicle_360'),
  sections text[] not null check (sections <@ array['identity','listing','sold_history','media','service','video','acquisition']),
  purposes text[] not null,
  budget_per_min int not null check (budget_per_min between 1 and 10000),
  max_limit int not null check (max_limit between 1 and 100),
  ttl_s int not null check (ttl_s between 1 and 300),
  not_after timestamptz not null,
  revoked_at timestamptz,
  primary key (key_id, read_model));
grant select on public.gw_read_grants to authenticated;
grant all on public.gw_read_grants to service_role;
alter table public.gw_read_grants enable row level security;
create policy "tenant members read grants" on public.gw_read_grants for select to authenticated
  using (exists (select 1 from public.gw_ingest_keys k where k.key_id = gw_read_grants.key_id and gw_is_member(k.tenant_id)));
insert into public.gw_read_grants values
 ('film-nw-r1','vehicle_360','{identity,listing,sold_history,media,service,video,acquisition}','{service_lane,video_merchandising}',6000,100,30, now() + interval '90 days', null),
 ('labels-nw-k1','vehicle_360','{identity,listing,sold_history,media,service,video,acquisition}','{listing_display}',600,100,30, now() + interval '90 days', null),
 ('curb-nw-k1','vehicle_360','{identity,listing,sold_history,service}','{appraisal_context}',120,25,60, now() + interval '90 days', null);
-- frame-nw-r1 deliberately has NO read grant (fail-closed fixture).

create table public.gw_read_audit (
  id bigserial primary key, key_id text, tenant_id text, rooftop_id text, read_model text not null default 'vehicle_360',
  purpose text, mode text, decision text not null, http_status int not null, reason text,
  rows int not null default 0, stale_rows int not null default 0, duration_ms numeric, created_at timestamptz not null default now());
create index gw_read_audit_key_time on public.gw_read_audit(key_id, created_at);
create index gw_read_audit_time on public.gw_read_audit(created_at);
grant select on public.gw_read_audit to authenticated;
grant all on public.gw_read_audit to service_role;
grant usage, select on sequence public.gw_read_audit_id_seq to service_role;
alter table public.gw_read_audit enable row level security;
create policy "tenant members read read-audit" on public.gw_read_audit for select to authenticated using (tenant_id is not null and gw_is_member(tenant_id));
create trigger gw_read_audit_immutable before update or delete on public.gw_read_audit for each row execute function gw_forbid_mutation();

create or replace function public.gw_read_fetch(_key_id text, _nonce text, _ts timestamptz, _tenant text, _rooftop text,
  _purpose text, _vin text default null, _limit int default 25, _cursor text default null, _origin_event uuid default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  k gw_ingest_keys%rowtype; g gw_read_grants%rowtype; v_dec text; v_reason text; v_status int; t0 timestamptz := clock_timestamp();
  v_used int; v_items jsonb := '[]'; v_rows int := 0; v_stale int := 0; v_mode text := case when _vin is null then 'list' else 'vehicle' end;
  v_origin jsonb; r record; v_br record; v_secs jsonb; v_is_stale boolean; v_sreason text; v_last text; v_o gw_outbox%rowtype;
begin
  select * into k from gw_ingest_keys where key_id = _key_id;
  if not found then v_dec := 'denied'; v_reason := 'no app identity'; v_status := 401;
  elsif k.revoked_at is not null and k.revoked_at <= clock_timestamp() then v_dec := 'denied'; v_reason := 'revoked key'; v_status := 401;
  elsif clock_timestamp() < k.not_before or clock_timestamp() > k.not_after then v_dec := 'denied'; v_reason := 'key outside validity window'; v_status := 401;
  elsif _ts is null or abs(extract(epoch from (clock_timestamp() - _ts))) > 300 then v_dec := 'denied'; v_reason := 'timestamp outside +/-300s'; v_status := 401;
  elsif _nonce is null or _nonce !~ '^[A-Za-z0-9_-]{16,64}$' then v_dec := 'denied'; v_reason := 'bad nonce'; v_status := 400;
  end if;
  if v_dec is null then
    select * into g from gw_read_grants where key_id = _key_id and read_model = 'vehicle_360';
    if not found or g.revoked_at is not null or g.not_after < clock_timestamp() then v_dec := 'denied'; v_reason := 'no read grant for app identity'; v_status := 403;
    elsif _purpose is null or not (_purpose = any(g.purposes)) then v_dec := 'denied'; v_reason := 'purpose not granted'; v_status := 403;
    elsif _tenant is distinct from k.tenant_id then v_dec := 'denied'; v_reason := 'identity not bound to tenant'; v_status := 403;
    elsif _rooftop is null or not (_rooftop = any(k.rooftop_ids)) then v_dec := 'denied'; v_reason := 'identity not bound to rooftop'; v_status := 403;
    elsif _limit is null or _limit < 1 or _limit > g.max_limit then v_dec := 'denied'; v_reason := 'limit outside grant cap'; v_status := 400;
    elsif _vin is not null and _vin !~ '^[A-HJ-NPR-Z0-9]{17}$' then v_dec := 'denied'; v_reason := 'invalid VIN'; v_status := 400;
    end if;
  end if;
  if v_dec is null then
    select count(*) into v_used from gw_read_audit where key_id = _key_id and created_at > clock_timestamp() - interval '60 seconds';
    if v_used >= g.budget_per_min then v_dec := 'denied'; v_reason := 'read budget exhausted'; v_status := 429; end if;
  end if;
  if v_dec is null then
    insert into gw_ingest_nonces(key_id, nonce) values (_key_id, 'r:' || _nonce) on conflict do nothing;
    if not found then v_dec := 'denied'; v_reason := 'nonce replay'; v_status := 409; end if;
  end if;

  if v_dec is null then
    v_dec := 'ok'; v_status := 200;
    select state, forced_open into v_br from gw_circuit_breakers where tenant_id = _tenant and target_app = k.source_app;
    for r in
      select vi.id inst, vid.vin, vi.rooftop_id,
        (select e.id from gw_listing_episodes e where e.instance_id = vi.id order by e.opened_at desc limit 1) cur_epi,
        (select coalesce(jsonb_agg(e.id order by e.opened_at), '[]'::jsonb) from gw_listing_episodes e where e.instance_id = vi.id) epis,
        p.state, p.source_revisions, p.updated_at, lg.n lag_n, lg.oldest lag_oldest,
        (select coalesce(jsonb_object_agg(sr.aggregate_type, jsonb_build_object('revision', sr.revision, 'updated_at', sr.updated_at)), '{}'::jsonb)
           from gw_source_revisions sr where sr.tenant_id = _tenant and sr.aggregate_id = vi.id and sr.source_app = k.source_app) own
      from gw_vehicle_instances vi join gw_vehicle_identities vid on vid.id = vi.identity_id
      left join gw_projections p on p.tenant_id = _tenant and p.target_app = k.source_app and p.aggregate_type = 'vehicle_instance' and p.aggregate_id = vi.id
      left join lateral (select count(*) n, min(q.accepted_at) oldest from gw_queue q
        where q.lane_key = k.source_app::text || '|' || _tenant || '|vehicle_instance:' || vi.id
          and q.status in ('pending','retry','leased','held')) lg on true
      where vi.tenant_id = _tenant and vi.rooftop_id = _rooftop and (_vin is null or vid.vin = _vin) and (_cursor is null or vi.id > _cursor)
      order by vi.id limit _limit
    loop
      v_is_stale := false; v_sreason := null;
      if r.lag_n > 0 then v_is_stale := true; v_sreason := 'undelivered copies in lane'; end if;
      if v_br.forced_open or v_br.state in ('open','half_open') then v_is_stale := true; v_sreason := coalesce(v_sreason || '; ', '') || 'destination breaker ' || case when v_br.forced_open then 'forced_open' else v_br.state end; end if;
      if r.state ? 'listing' and (r.state->'listing'->>'episode_id') is distinct from r.cur_epi then
        v_is_stale := true; v_sreason := coalesce(v_sreason || '; ', '') || 'projection not at current episode';
      end if;
      v_secs := null;
      if v_mode = 'vehicle' then
        v_secs := jsonb_strip_nulls(jsonb_build_object(
          'listing', case when 'listing' = any(g.sections) then r.state->'listing' end,
          'listing_history', case when 'sold_history' = any(g.sections) then r.state->'listing_history' end,
          'media', case when 'media' = any(g.sections) then r.state->'media' end,
          'mpi', case when 'service' = any(g.sections) then r.state->'mpi' end,
          'repair', case when 'service' = any(g.sections) then r.state->'repair' end,
          'video', case when 'video' = any(g.sections) then r.state->'video' end,
          'appraisal', case when 'acquisition' = any(g.sections) then (r.state->'appraisal') - 'appraisal_cents' end));
      end if;
      v_items := v_items || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
        'instance_id', r.inst, 'vin', r.vin, 'rooftop_id', r.rooftop_id, 'current_episode_id', r.cur_epi, 'episodes', r.epis,
        'projection_updated_at', r.updated_at, 'source_revisions', coalesce(r.source_revisions, '{}'::jsonb),
        'lag_copies', r.lag_n, 'lag_oldest_at', r.lag_oldest, 'stale', v_is_stale, 'stale_reason', v_sreason,
        'own_revisions', r.own, 'sections', v_secs)));
      v_rows := v_rows + 1; if v_is_stale then v_stale := v_stale + 1; end if; v_last := r.inst;
    end loop;
    if _origin_event is not null then
      select * into v_o from gw_outbox where event_id = _origin_event and tenant_id = _tenant;
      if not found then v_origin := jsonb_build_object('committed', false, 'reason', 'origin receipt not found');
      elsif v_o.source_app <> k.source_app then v_origin := jsonb_build_object('committed', false, 'reason', 'origin receipt not owned by caller');
      else v_origin := jsonb_build_object('committed', true, 'aggregate_id', v_o.aggregate_id, 'revision', v_o.aggregate_revision, 'accepted_at', v_o.accepted_at, 'payload_hash', v_o.payload_hash);
      end if;
    end if;
  end if;

  insert into gw_read_audit(key_id, tenant_id, rooftop_id, purpose, mode, decision, http_status, reason, rows, stale_rows, duration_ms)
    values (left(_key_id, 64), case when k.key_id is not null then k.tenant_id end, left(_rooftop, 64), left(_purpose, 64), v_mode, v_dec, v_status, v_reason,
      v_rows, v_stale, round((extract(epoch from clock_timestamp() - t0) * 1000)::numeric, 3));
  if v_dec <> 'ok' then return jsonb_build_object('decision', v_dec, 'reason', v_reason, 'http_status', v_status); end if;
  return jsonb_strip_nulls(jsonb_build_object('decision', 'ok', 'http_status', 200, 'requester', k.source_app, 'tenant_id', _tenant, 'rooftop_id', _rooftop,
    'mode', v_mode, 'purpose', _purpose, 'sections_granted', to_jsonb(g.sections), 'ttl_s', g.ttl_s, 'db_time', clock_timestamp(),
    'items', v_items, 'next_cursor', case when v_rows = _limit then v_last end, 'origin', v_origin));
end $$;
revoke all on function public.gw_read_fetch(text,text,timestamptz,text,text,text,text,int,text,uuid) from public, anon, authenticated;
grant execute on function public.gw_read_fetch(text,text,timestamptz,text,text,text,text,int,text,uuid) to service_role;

create or replace function public.gw_ops_snapshot()
 returns jsonb language sql stable set search_path to 'public' as $function$
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
    'keys_expiring_7d', (select count(*) from gw_ingest_keys where revoked_at is null and not_after between clock_timestamp() and clock_timestamp() + interval '7 days'),
    'reads_15m', (select count(*) from gw_read_audit where created_at > clock_timestamp() - interval '15 minutes'),
    'read_denied_15m', (select count(*) from gw_read_audit where decision = 'denied' and created_at > clock_timestamp() - interval '15 minutes'),
    'read_rows_15m', (select coalesce(sum(rows), 0) from gw_read_audit where decision = 'ok' and created_at > clock_timestamp() - interval '15 minutes'),
    'read_stale_rows_15m', (select coalesce(sum(stale_rows), 0) from gw_read_audit where decision = 'ok' and created_at > clock_timestamp() - interval '15 minutes'),
    'read_db_p95_ms', (select percentile_cont(0.95) within group (order by duration_ms) from gw_read_audit where decision = 'ok' and created_at > clock_timestamp() - interval '15 minutes')
  )
$function$;