-- ===================== PUBLISH (producer outbox) =====================
create or replace function public.gw_publish_internal(_env jsonb, _bench uuid default null)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  v_event uuid; v_tenant text; v_rooftop text; v_src gw_app; v_type text; v_ver int;
  v_agg_type text; v_agg_id text; v_rev bigint; v_allow gw_source_allowlist%rowtype;
  v_payload jsonb; v_hash text; v_cur bigint; v_seq bigint; v_fan int := 0;
  v_quota gw_tenant_quotas%rowtype; v_inflight int; v_recent int;
  v_vin text; v_inst text; v_epi text; v_ident uuid; v_occ timestamptz; v_emit timestamptz;
begin
  begin
    v_event := (_env->>'event_id')::uuid;
    v_ver := (_env->>'schema_version')::int;
    v_src := (_env->>'source_app')::gw_app;
    v_rev := (_env->'aggregate'->>'revision')::bigint;
    v_occ := coalesce((_env->>'occurred_at')::timestamptz, now());
    v_emit := coalesce((_env->>'emitted_at')::timestamptz, now());
  exception when others then
    return jsonb_build_object('status','rejected','reason','malformed envelope field types');
  end;
  v_tenant := _env->>'tenant_id'; v_rooftop := _env->>'rooftop_id'; v_type := _env->>'event_type';
  v_agg_type := _env->'aggregate'->>'type'; v_agg_id := _env->'aggregate'->>'id';
  v_payload := _env->'payload';
  v_vin := _env->'vehicle'->>'vin'; v_inst := _env->'vehicle'->>'instance_id'; v_epi := _env->'vehicle'->>'episode_id';

  if v_event is null or v_ver is null or v_src is null or v_rev is null or v_tenant is null or v_rooftop is null
     or v_type is null or v_agg_type is null or v_agg_id is null or v_payload is null or jsonb_typeof(v_payload) <> 'object' then
    return jsonb_build_object('status','rejected','reason','missing required envelope field');
  end if;
  if v_rev < 1 then return jsonb_build_object('status','rejected','reason','aggregate_revision must be >= 1'); end if;

  select * into v_allow from gw_source_allowlist where source_app = v_src and event_type = v_type;
  if not found then
    return jsonb_build_object('status','rejected','reason','source not on positive allowlist for event_type');
  end if;
  if not (v_ver = any(v_allow.schema_versions)) then
    return jsonb_build_object('status','rejected','reason','unsupported schema_version');
  end if;
  if v_allow.aggregate_type <> v_agg_type then
    return jsonb_build_object('status','rejected','reason','aggregate_type not valid for event_type');
  end if;
  if coalesce(_env->>'classification', v_allow.classification) <> v_allow.classification then
    return jsonb_build_object('status','rejected','reason','classification mismatch');
  end if;
  if v_allow.classification = 'pii' and coalesce(v_payload->>'consent_id','') = '' then
    return jsonb_build_object('status','rejected','reason','pii event without explicit consent_id');
  end if;
  if v_payload ?| array['binary','bytes','data_base64','blob'] or length(v_payload::text) > 16384 then
    return jsonb_build_object('status','rejected','reason','binary/oversized payload not permitted');
  end if;
  if v_vin is not null and v_vin !~ '^[A-HJ-NPR-Z0-9]{17}$' then
    return jsonb_build_object('status','rejected','reason','invalid VIN');
  end if;
  if not exists (select 1 from gw_rooftops where id = v_rooftop and tenant_id = v_tenant) then
    return jsonb_build_object('status','rejected','reason','rooftop does not belong to tenant');
  end if;

  v_hash := encode(digest(v_payload::text, 'sha256'), 'hex');
  if _env ? 'payload_hash' and (_env->>'payload_hash') <> v_hash then
    return jsonb_build_object('status','rejected','reason','payload_hash mismatch');
  end if;

  if exists (select 1 from gw_outbox where event_id = v_event) then
    return jsonb_build_object('status','duplicate','event_id',v_event);
  end if;

  select * into v_quota from gw_tenant_quotas where tenant_id = v_tenant;
  if found then
    select count(*) into v_inflight from gw_queue where tenant_id = v_tenant and status in ('pending','retry','leased','held');
    if v_inflight >= v_quota.max_inflight then
      return jsonb_build_object('status','backpressure','reason','tenant inflight quota reached');
    end if;
    select count(*) into v_recent from gw_outbox where tenant_id = v_tenant and accepted_at > now() - interval '1 minute';
    if v_recent >= v_quota.max_events_per_min then
      return jsonb_build_object('status','rate_limited','reason','tenant events/min quota reached');
    end if;
  end if;

  insert into gw_source_revisions(tenant_id, source_app, aggregate_type, aggregate_id, revision)
    values (v_tenant, v_src, v_agg_type, v_agg_id, 0) on conflict do nothing;
  select revision into v_cur from gw_source_revisions
    where tenant_id = v_tenant and source_app = v_src and aggregate_type = v_agg_type and aggregate_id = v_agg_id for update;
  if v_rev <= v_cur then
    return jsonb_build_object('status','stale','reason','aggregate_revision not greater than accepted revision','current',v_cur);
  end if;

  -- identity bookkeeping (VIN identity persists per tenant across instances/episodes)
  if v_vin is not null then
    insert into gw_vehicle_identities(tenant_id, vin) values (v_tenant, v_vin) on conflict (tenant_id, vin) do nothing;
    select id into v_ident from gw_vehicle_identities where tenant_id = v_tenant and vin = v_vin;
    if v_inst is not null then
      insert into gw_vehicle_instances(id, tenant_id, rooftop_id, identity_id) values (v_inst, v_tenant, v_rooftop, v_ident)
        on conflict (id) do nothing;
      if exists (select 1 from gw_vehicle_instances where id = v_inst and (tenant_id <> v_tenant or identity_id <> v_ident)) then
        return jsonb_build_object('status','rejected','reason','instance belongs to another tenant or VIN');
      end if;
      if v_epi is not null then
        insert into gw_listing_episodes(id, tenant_id, instance_id) values (v_epi, v_tenant, v_inst) on conflict (id) do nothing;
      end if;
    end if;
  end if;

  insert into gw_outbox(event_id, tenant_id, rooftop_id, source_app, event_type, schema_version, aggregate_type, aggregate_id,
    aggregate_revision, vin, instance_id, episode_id, correlation_id, causation_id, trace_id, classification, payload_hash,
    envelope, bench_run_id, occurred_at, emitted_at)
  values (v_event, v_tenant, v_rooftop, v_src, v_type, v_ver, v_agg_type, v_agg_id, v_rev, v_vin, v_inst, v_epi,
    nullif(_env->>'correlation_id','')::uuid, nullif(_env->>'causation_id','')::uuid, _env->>'trace_id', v_allow.classification,
    v_hash, _env || jsonb_build_object('payload_hash', v_hash, 'authority', v_allow.authority, 'classification', v_allow.classification),
    _bench, v_occ, v_emit)
  on conflict (event_id) do nothing
  returning seq into v_seq;
  if v_seq is null then return jsonb_build_object('status','duplicate','event_id',v_event); end if;

  update gw_source_revisions set revision = v_rev, updated_at = now()
    where tenant_id = v_tenant and source_app = v_src and aggregate_type = v_agg_type and aggregate_id = v_agg_id;

  insert into gw_queue(event_id, outbox_seq, route_id, tenant_id, target_app, lane_key, bench_run_id)
  select v_event, v_seq, r.id, v_tenant, r.target_app,
         r.target_app::text || '|' || v_tenant || '|' || v_agg_type || ':' || v_agg_id, _bench
  from gw_routes r
  where r.source_app = v_src and v_type = any(r.event_types)
    and (_env->>'target_app' is null or r.target_app::text = _env->>'target_app');
  get diagnostics v_fan = row_count;

  return jsonb_build_object('status','accepted','event_id',v_event,'seq',v_seq,'fanout',v_fan,'payload_hash',v_hash);
end $$;

create or replace function public.gw_publish(_env jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not gw_has_role(_env->>'tenant_id', array['admin','operator']::gw_role[]) then
    return jsonb_build_object('status','rejected','reason','caller not authorised for tenant');
  end if;
  return gw_publish_internal(_env, null);
end $$;

-- ===================== CLAIM (lane heads, fairness, leases) =====================
create or replace function public.gw_claim_internal(_worker text, _tenants text[], _batch int, _lease_s int, _per_tenant int)
returns setof bigint language plpgsql security definer set search_path = public as $$
begin
  return query
  with heads as (
    select distinct on (lane_key) id, tenant_id, status, available_at, lease_until, outbox_seq
    from gw_queue
    where status in ('pending','retry','leased','held') and tenant_id = any(_tenants)
    order by lane_key, outbox_seq
  ), ready as (
    select h.id, row_number() over (partition by h.tenant_id order by h.outbox_seq) as rn, h.outbox_seq
    from heads h
    where (h.status in ('pending','retry') and h.available_at <= clock_timestamp())
       or (h.status = 'leased' and h.lease_until < clock_timestamp())
  ), pick as (
    select q.id from gw_queue q join ready r on r.id = q.id
    where r.rn <= _per_tenant
    order by r.rn, r.outbox_seq
    limit _batch
    for update of q skip locked
  )
  update gw_queue q set status = 'leased', leased_by = _worker, attempts = q.attempts + 1,
    lease_until = clock_timestamp() + make_interval(secs => _lease_s)
  from pick where q.id = pick.id
  returning q.id;
end $$;

create or replace function public.gw_member_tenants(_roles gw_role[]) returns text[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(tenant_id), '{}') from gw_tenant_members where user_id = auth.uid() and role = any(_roles)
$$;

create or replace function public.gw_claim(_worker text, _batch int default 50, _lease_s int default 30, _per_tenant int default 25)
returns setof bigint language plpgsql security definer set search_path = public as $$
begin
  return query select * from gw_claim_internal(_worker, gw_member_tenants(array['admin','operator']::gw_role[]),
    least(_batch, 500), least(_lease_s, 300), least(_per_tenant, 500));
end $$;

-- ===================== APPLY (atomic projection + inbox + ack) =====================
create or replace function public.gw_apply_internal(_id bigint, _worker text)
returns text language plpgsql security definer set search_path = public as $$
declare
  q gw_queue%rowtype; o gw_outbox%rowtype; s gw_settings%rowtype; c gw_route_controls%rowtype;
  b gw_circuit_breakers%rowtype; p gw_projections%rowtype; r_enabled boolean;
  v_key text; v_cur bigint; v_section text; v_state jsonb; v_payload jsonb; v_err text; v_ins int;
  v_sold_guard boolean := false; v_backoff numeric;
begin
  select * into q from gw_queue where id = _id for update;
  if not found or q.status <> 'leased' or q.leased_by is distinct from _worker then return 'lost_lease'; end if;
  select * into o from gw_outbox where event_id = q.event_id;
  select * into s from gw_settings where id = 1;
  select enabled into r_enabled from gw_routes where id = q.route_id;
  select * into c from gw_route_controls where tenant_id = q.tenant_id and route_id = q.route_id;
  if not found then c.enabled := true; c.dry_run := false; c.killed := false; c.pii_consent_route := false; end if;

  if s.global_kill or c.killed or not c.enabled or not r_enabled then
    update gw_queue set status = 'held', lease_until = null, leased_by = null, attempts = greatest(attempts - 1, 0) where id = _id;
    return 'held';
  end if;

  insert into gw_circuit_breakers(tenant_id, target_app) values (q.tenant_id, q.target_app) on conflict do nothing;
  select * into b from gw_circuit_breakers where tenant_id = q.tenant_id and target_app = q.target_app for update;
  if b.forced_open or (b.state = 'open' and b.opened_at > clock_timestamp() - interval '30 seconds') then
    update gw_queue set status = 'retry', lease_until = null, leased_by = null, attempts = greatest(attempts - 1, 0),
      available_at = clock_timestamp() + interval '5 seconds', last_error = 'circuit open' where id = _id;
    return 'breaker_open';
  elsif b.state = 'open' then
    update gw_circuit_breakers set state = 'half_open' where tenant_id = q.tenant_id and target_app = q.target_app;
  end if;

  if o.classification = 'pii' and not c.pii_consent_route then
    insert into gw_evidence(tenant_id, target_app, event_id, route_id, kind, detail, payload_hash)
      values (q.tenant_id, q.target_app, q.event_id, q.route_id, 'pii_blocked', jsonb_build_object('reason','route lacks pii consent flag'), o.payload_hash);
    update gw_queue set status = 'skipped', delivered_at = clock_timestamp(), lease_until = null where id = _id;
    return 'skipped';
  end if;

  if c.dry_run then
    insert into gw_evidence(tenant_id, target_app, event_id, route_id, kind, detail, payload_hash)
      values (q.tenant_id, q.target_app, q.event_id, q.route_id, 'dry_run', jsonb_build_object('would_apply', o.event_type), o.payload_hash);
    update gw_queue set status = 'dry_run', delivered_at = clock_timestamp(), lease_until = null where id = _id;
    return 'dry_run';
  end if;

  v_payload := o.envelope->'payload';
  begin
    if v_payload->>'_synthetic_fault' = 'poison' then raise exception 'POISON: synthetic undeliverable payload'; end if;
    if v_payload->>'_synthetic_fault' = 'transient' and q.attempts < 3 then raise exception 'synthetic transient fault (attempt %)', q.attempts; end if;

    insert into gw_inbox(target_app, event_id, tenant_id, result) values (q.target_app, q.event_id, q.tenant_id, 'applied')
      on conflict do nothing;
    get diagnostics v_ins = row_count;
    if v_ins = 0 then
      update gw_queue set status = 'duplicate', delivered_at = clock_timestamp(), lease_until = null where id = _id;
      return 'duplicate';
    end if;

    v_key := o.source_app::text || ':' || o.aggregate_type;
    select * into p from gw_projections where tenant_id = q.tenant_id and target_app = q.target_app
      and aggregate_type = o.aggregate_type and aggregate_id = o.aggregate_id for update;
    v_cur := coalesce((p.source_revisions->>v_key)::bigint, 0);
    if found and v_cur >= o.aggregate_revision then
      update gw_inbox set result = 'stale' where target_app = q.target_app and event_id = q.event_id;
      insert into gw_evidence(tenant_id, target_app, event_id, route_id, kind, detail, payload_hash)
        values (q.tenant_id, q.target_app, q.event_id, q.route_id, 'stale_ignored',
          jsonb_build_object('revision', o.aggregate_revision, 'projection_revision', v_cur), o.payload_hash);
      update gw_queue set status = 'stale', delivered_at = clock_timestamp(), lease_until = null where id = _id;
      return 'stale';
    end if;

    v_section := case
      when o.event_type in ('inventory.updated','price.changed','listing.sold') then 'listing'
      when o.event_type = 'video.engagement' then 'video'
      when o.event_type = 'service.mpi_verified' then 'mpi'
      when o.event_type in ('appraisal.completed','acquisition.closed') then 'appraisal'
      when o.event_type = 'lead.consented' then 'crm_consent'
      when o.event_type = 'media.approved' then 'media'
      else 'other' end;
    v_state := coalesce(p.state, '{}'::jsonb);
    v_payload := v_payload - '_synthetic_fault';
    if v_section = 'crm_consent' then
      v_payload := jsonb_build_object('consent_id', v_payload->>'consent_id', 'contact_ref', encode(digest(coalesce(v_payload->>'contact_ref',''),'sha256'),'hex'));
    end if;
    if v_section = 'listing' then
      if v_state->'listing'->>'status' = 'sold' and v_state->'listing'->>'episode_id' = o.episode_id
         and o.event_type <> 'listing.sold' then
        v_sold_guard := true;
        v_payload := v_payload - 'status';
      end if;
      if o.event_type = 'listing.sold' then v_payload := v_payload || '{"status":"sold"}'; end if;
      v_payload := v_payload || jsonb_build_object('episode_id', o.episode_id);
      if v_state->'listing'->>'episode_id' is distinct from o.episode_id then
        v_state := v_state || jsonb_build_object('listing', '{}'::jsonb);
      end if;
    end if;
    v_state := v_state || jsonb_build_object(v_section, coalesce(v_state->v_section, '{}'::jsonb) || v_payload
      || jsonb_build_object('rev', o.aggregate_revision, 'source', o.source_app), 'last_event', o.event_type);

    insert into gw_projections(tenant_id, target_app, aggregate_type, aggregate_id, vin, state, source_revisions, apply_count, updated_at)
    values (q.tenant_id, q.target_app, o.aggregate_type, o.aggregate_id, o.vin, v_state, jsonb_build_object(v_key, o.aggregate_revision), 1, clock_timestamp())
    on conflict (tenant_id, target_app, aggregate_type, aggregate_id) do update
      set state = excluded.state, source_revisions = gw_projections.source_revisions || excluded.source_revisions,
          apply_count = gw_projections.apply_count + 1, updated_at = clock_timestamp(), vin = coalesce(excluded.vin, gw_projections.vin);

    insert into gw_evidence(tenant_id, target_app, event_id, route_id, kind, detail, payload_hash)
      values (q.tenant_id, q.target_app, q.event_id, q.route_id, case when v_sold_guard then 'applied_sold_guard' else 'applied' end,
        jsonb_build_object('section', v_section, 'revision', o.aggregate_revision, 'worker', _worker), o.payload_hash);
    update gw_queue set status = 'delivered', delivered_at = clock_timestamp(), lease_until = null, last_error = null where id = _id;
    update gw_circuit_breakers set state = 'closed', consecutive_failures = 0, opened_at = null
      where tenant_id = q.tenant_id and target_app = q.target_app and (state <> 'closed' or consecutive_failures <> 0);
    return 'delivered';
  exception when others then
    v_err := left(sqlerrm, 300);
  end;

  -- failure path (projection sub-transaction was rolled back)
  update gw_circuit_breakers set consecutive_failures = consecutive_failures + 1,
    state = case when consecutive_failures + 1 >= 5 then 'open' else state end,
    opened_at = case when consecutive_failures + 1 >= 5 then clock_timestamp() else opened_at end
    where tenant_id = q.tenant_id and target_app = q.target_app;
  if v_err like 'POISON:%' or q.attempts >= s.max_attempts then
    update gw_queue set status = 'dead', lease_until = null, last_error = v_err where id = _id;
    insert into gw_dead_letters(queue_id, event_id, tenant_id, route_id, reason, attempts)
      values (_id, q.event_id, q.tenant_id, q.route_id, v_err, q.attempts);
    insert into gw_evidence(tenant_id, target_app, event_id, route_id, kind, detail, payload_hash)
      values (q.tenant_id, q.target_app, q.event_id, q.route_id, 'dead_lettered', jsonb_build_object('error', v_err, 'attempts', q.attempts), o.payload_hash);
    return 'dead';
  end if;
  -- exponential backoff with full jitter, base 100ms, cap 30s (short for DEV harness)
  v_backoff := least(30.0, 0.1 * power(2, q.attempts)) * (0.5 + random() * 0.5);
  update gw_queue set status = 'retry', lease_until = null, leased_by = null, last_error = v_err,
    available_at = clock_timestamp() + make_interval(secs => v_backoff) where id = _id;
  return 'retry';
end $$;

create or replace function public.gw_ack(_id bigint, _worker text)
returns text language plpgsql security definer set search_path = public as $$
declare v_t text;
begin
  select tenant_id into v_t from gw_queue where id = _id;
  if v_t is null or not gw_has_role(v_t, array['admin','operator']::gw_role[]) then return 'forbidden'; end if;
  return gw_apply_internal(_id, _worker);
end $$;

-- One worker step: claim a fair batch of lane heads and apply them (short transaction).
create or replace function public.gw_worker_step(_worker text, _batch int default 100, _per_tenant int default 50)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id bigint; v_res text; v_out jsonb := '{}'::jsonb; v_n int := 0;
  v_tenants text[] := gw_member_tenants(array['admin','operator']::gw_role[]);
begin
  for v_id in select * from gw_claim_internal(_worker, v_tenants, least(_batch, 500), 30, least(_per_tenant, 500)) loop
    v_res := gw_apply_internal(v_id, _worker);
    v_out := v_out || jsonb_build_object(v_res, coalesce((v_out->>v_res)::int, 0) + 1);
    v_n := v_n + 1;
  end loop;
  return v_out || jsonb_build_object('claimed', v_n);
end $$;

-- ===================== CONTROLS =====================
create or replace function public.gw_set_route_control(_tenant text, _route text, _enabled boolean, _dry_run boolean, _killed boolean, _pii boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not gw_has_role(_tenant, array['admin']::gw_role[]) then raise exception 'forbidden'; end if;
  insert into gw_route_controls(tenant_id, route_id, enabled, dry_run, killed, pii_consent_route, updated_at, updated_by)
  values (_tenant, _route, _enabled, _dry_run, _killed, _pii, now(), auth.uid())
  on conflict (tenant_id, route_id) do update set enabled = excluded.enabled, dry_run = excluded.dry_run,
    killed = excluded.killed, pii_consent_route = excluded.pii_consent_route, updated_at = now(), updated_by = auth.uid();
  insert into gw_audit_log(tenant_id, actor, action, detail) values (_tenant, auth.uid(), 'route_control',
    jsonb_build_object('route', _route, 'enabled', _enabled, 'dry_run', _dry_run, 'killed', _killed, 'pii', _pii));
end $$;

create or replace function public.gw_set_breaker(_tenant text, _target gw_app, _forced_open boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not gw_has_role(_tenant, array['admin']::gw_role[]) then raise exception 'forbidden'; end if;
  insert into gw_circuit_breakers(tenant_id, target_app, forced_open, state, opened_at)
    values (_tenant, _target, _forced_open, case when _forced_open then 'open' else 'closed' end, case when _forced_open then now() end)
  on conflict (tenant_id, target_app) do update set forced_open = _forced_open,
    state = case when _forced_open then 'open' else 'closed' end, consecutive_failures = 0,
    opened_at = case when _forced_open then now() else null end;
  insert into gw_audit_log(tenant_id, actor, action, detail) values (_tenant, auth.uid(), 'breaker', jsonb_build_object('target', _target, 'forced_open', _forced_open));
end $$;

create or replace function public.gw_set_global_kill(_on boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from gw_tenants t where not gw_has_role(t.id, array['admin']::gw_role[])) then
    raise exception 'global kill requires admin on every tenant';
  end if;
  update gw_settings set global_kill = _on, updated_at = now() where id = 1;
  insert into gw_audit_log(actor, action, detail) values (auth.uid(), 'global_kill', jsonb_build_object('on', _on));
end $$;

create or replace function public.gw_release_held(_tenant text)
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not gw_has_role(_tenant, array['admin','operator']::gw_role[]) then raise exception 'forbidden'; end if;
  update gw_queue set status = 'pending', available_at = clock_timestamp() where tenant_id = _tenant and status = 'held';
  get diagnostics n = row_count;
  insert into gw_audit_log(tenant_id, actor, action, detail) values (_tenant, auth.uid(), 'release_held', jsonb_build_object('count', n));
  return n;
end $$;

-- ===================== REPLAY (idempotent) =====================
create or replace function public.gw_replay(_tenant text, _queue_ids bigint[], _reason text default 'operator replay')
returns jsonb language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not gw_has_role(_tenant, array['admin','operator']::gw_role[]) then raise exception 'forbidden'; end if;
  update gw_queue set status = 'pending', attempts = 0, available_at = clock_timestamp(), lease_until = null, leased_by = null
   where tenant_id = _tenant and id = any(_queue_ids) and status in ('dead','delivered','duplicate','stale','skipped','dry_run');
  get diagnostics n = row_count;
  update gw_dead_letters set resolved_at = now(), resolution = 'replayed' where tenant_id = _tenant and queue_id = any(_queue_ids) and resolved_at is null;
  insert into gw_replay_audit(tenant_id, actor, scope, requeued) values (_tenant, auth.uid(), jsonb_build_object('queue_ids', _queue_ids, 'reason', _reason), n);
  return jsonb_build_object('requeued', n);
end $$;

-- ===================== RECONCILIATION =====================
create or replace function public.gw_reconcile(_tenant text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_missing int; v_no_inbox int; v_lag int; v_stuck int; v_checked int; v_details jsonb;
begin
  if not gw_is_member(_tenant) then raise exception 'forbidden'; end if;
  select count(*) into v_checked from gw_outbox where tenant_id = _tenant;
  select count(*) into v_missing from gw_outbox o join gw_routes r on r.source_app = o.source_app and o.event_type = any(r.event_types)
    where o.tenant_id = _tenant and not exists (select 1 from gw_queue q where q.event_id = o.event_id and q.route_id = r.id);
  select count(*) into v_no_inbox from gw_queue q where q.tenant_id = _tenant and q.status = 'delivered'
    and not exists (select 1 from gw_inbox i where i.target_app = q.target_app and i.event_id = q.event_id);
  select count(*) into v_lag from (
    select q.target_app, o.source_app, o.aggregate_type, o.aggregate_id, max(o.aggregate_revision) mx
    from gw_queue q join gw_outbox o on o.event_id = q.event_id
    where q.tenant_id = _tenant and q.status = 'delivered'
    group by 1,2,3,4) d
    left join gw_projections p on p.tenant_id = _tenant and p.target_app = d.target_app and p.aggregate_type = d.aggregate_type and p.aggregate_id = d.aggregate_id
    where coalesce((p.source_revisions->>(d.source_app::text || ':' || d.aggregate_type))::bigint, 0) < d.mx;
  select count(*) into v_stuck from gw_queue where tenant_id = _tenant
    and ((status = 'leased' and lease_until < now()) or (status in ('pending','retry') and accepted_at < now() - interval '15 minutes'));
  v_details := jsonb_build_object('missing_fanout', v_missing, 'delivered_without_inbox', v_no_inbox,
    'projection_behind_delivered', v_lag, 'stuck_messages', v_stuck);
  insert into gw_reconciliation_runs(tenant_id, actor, checked, mismatches, details)
    values (_tenant, auth.uid(), v_checked, v_missing + v_no_inbox + v_lag + v_stuck, v_details);
  return v_details || jsonb_build_object('checked', v_checked);
end $$;

-- ===================== SYNTHETIC GENERATOR & BENCH =====================
create or replace function public.gw_generate_synthetic(_n int, _bench uuid default null, _fault_pct numeric default 1.0, _dup_pct numeric default 3.0, _stale_pct numeric default 2.0)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_tenants text[] := gw_member_tenants(array['admin','operator']::gw_role[]);
  i int; inst record; v_src text; v_type text; v_agg_type text; v_agg_id text; v_payload jsonb; v_env jsonb; v_res jsonb;
  v_out jsonb := '{}'::jsonb; v_last jsonb; v_rev bigint; r numeric; v_st text; v_t0 timestamptz := clock_timestamp();
begin
  if array_length(v_tenants, 1) is null then raise exception 'no operator tenants'; end if;
  if _n > 5000 then raise exception 'max 5000 events per call in DEV'; end if;
  for i in 1.._n loop
    r := random() * 100;
    if v_last is not null and r < _dup_pct then
      v_res := gw_publish_internal(v_last, _bench);           -- exact duplicate delivery from producer
    else
      select vi.id, vi.tenant_id, vi.rooftop_id, vid.vin, (select e.id from gw_listing_episodes e where e.instance_id = vi.id order by e.opened_at desc limit 1) epi
        into inst from gw_vehicle_instances vi join gw_vehicle_identities vid on vid.id = vi.identity_id
        where vi.tenant_id = any(v_tenants) order by random() limit 1;
      case floor(random() * 10)::int
        when 0,1,2 then v_src := 'autolabels'; v_type := (array['inventory.updated','inventory.updated','price.changed','listing.sold'])[1 + floor(random()*4)::int];
        when 3,4,5 then v_src := 'autofilm'; v_type := (array['video.engagement','video.engagement','service.mpi_verified'])[1 + floor(random()*3)::int];
        when 6,7 then v_src := 'autocurb'; v_type := (array['appraisal.completed','acquisition.closed','lead.consented'])[1 + floor(random()*3)::int];
        else v_src := 'autoframe'; v_type := 'media.approved';
      end case;
      v_agg_type := case when v_type = 'lead.consented' then 'crm_lead' else 'vehicle_instance' end;
      v_agg_id := case when v_type = 'lead.consented' then 'lead-' || inst.id else inst.id end;
      v_payload := case v_type
        when 'inventory.updated' then jsonb_build_object('status', 'active', 'mileage', 1000 + floor(random()*90000)::int, 'passport_id', 'PSP-SYN-' || inst.id)
        when 'price.changed' then jsonb_build_object('price_cents', (15000 + floor(random()*40000)::int) * 100)
        when 'listing.sold' then jsonb_build_object('sold_at', now())
        when 'video.engagement' then jsonb_build_object('views', floor(random()*500)::int, 'watch_seconds', floor(random()*9000)::int)
        when 'service.mpi_verified' then jsonb_build_object('mpi_id', 'MPI-SYN-' || floor(random()*99999)::int, 'items_green', floor(random()*40)::int, 'evidence_ref', 'ev-syn-' || md5(random()::text))
        when 'appraisal.completed' then jsonb_build_object('appraisal_cents', (9000 + floor(random()*30000)::int) * 100)
        when 'acquisition.closed' then jsonb_build_object('acquired', true)
        when 'lead.consented' then jsonb_build_object('consent_id', 'CNS-SYN-' || floor(random()*99999)::int, 'contact_ref', 'synthetic-contact-' || floor(random()*99999)::int)
        else jsonb_build_object('asset_id', 'IMG-SYN-' || floor(random()*99999)::int, 'width', 1920, 'height', 1080, 'sha256', md5(random()::text), 'approved', true)
      end;
      if random() * 100 < _fault_pct then
        v_payload := v_payload || jsonb_build_object('_synthetic_fault', case when random() < 0.5 then 'poison' else 'transient' end);
      end if;
      select coalesce(max(revision), 0) into v_rev from gw_source_revisions
        where tenant_id = inst.tenant_id and source_app = v_src::gw_app and aggregate_type = v_agg_type and aggregate_id = v_agg_id;
      if random() * 100 < _stale_pct and v_rev > 1 then v_rev := v_rev - 1; else v_rev := v_rev + 1; end if;
      v_env := jsonb_build_object(
        'event_id', gen_random_uuid(), 'schema_version', 1, 'tenant_id', inst.tenant_id, 'rooftop_id', inst.rooftop_id,
        'vehicle', jsonb_build_object('vin', inst.vin, 'instance_id', inst.id, 'episode_id', inst.epi),
        'source_app', v_src, 'event_type', v_type,
        'aggregate', jsonb_build_object('type', v_agg_type, 'id', v_agg_id, 'revision', v_rev),
        'correlation_id', gen_random_uuid(), 'trace_id', replace(gen_random_uuid()::text, '-', ''),
        'occurred_at', clock_timestamp(), 'emitted_at', clock_timestamp(), 'payload', v_payload);
      v_res := gw_publish_internal(v_env, _bench);
      v_last := v_env;
    end if;
    v_st := v_res->>'status';
    v_out := v_out || jsonb_build_object(v_st, coalesce((v_out->>v_st)::int, 0) + 1);
  end loop;
  return v_out || jsonb_build_object('ingest_ms', round(extract(epoch from clock_timestamp() - v_t0) * 1000, 2), 'requested', _n);
end $$;

create or replace function public.gw_bench_start(_n int, _workers int)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  insert into gw_bench_runs(tenant_scope, requested_events, workers, created_by)
    values (gw_member_tenants(array['admin','operator']::gw_role[]), _n, _workers, auth.uid()) returning id into v_id;
  return v_id;
end $$;

create or replace function public.gw_bench_stats(_bench uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  if not exists (select 1 from gw_bench_runs where id = _bench and created_by = auth.uid()) then raise exception 'forbidden'; end if;
  with q as (select * from gw_queue where bench_run_id = _bench),
  lat as (select extract(epoch from delivered_at - accepted_at) * 1000 ms from q where status = 'delivered'),
  ob as (select * from gw_outbox where bench_run_id = _bench)
  select jsonb_build_object(
    'events_accepted', (select count(*) from ob),
    'queue_rows', (select count(*) from q),
    'by_status', (select coalesce(jsonb_object_agg(status, n), '{}') from (select status, count(*) n from q group by 1) s),
    'latency_ms', (select jsonb_build_object(
        'p50', round(percentile_cont(0.5) within group (order by ms)::numeric, 2),
        'p95', round(percentile_cont(0.95) within group (order by ms)::numeric, 2),
        'p99', round(percentile_cont(0.99) within group (order by ms)::numeric, 2),
        'max', round(max(ms)::numeric, 2), 'samples', count(*)) from lat),
    'ingest_window_ms', (select round(extract(epoch from max(accepted_at) - min(accepted_at))::numeric * 1000, 2) from ob),
    'drain_window_ms', (select round(extract(epoch from max(delivered_at) - min(accepted_at))::numeric * 1000, 2) from q),
    'per_tenant', (select coalesce(jsonb_object_agg(tenant_id, n), '{}') from (select tenant_id, count(*) n from q group by 1) t),
    'lanes', (select count(distinct lane_key) from q),
    'workers_seen', (select count(distinct leased_by) from q)
  ) into v;
  return v;
end $$;

create or replace function public.gw_bench_finish(_bench uuid, _results jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  v := gw_bench_stats(_bench) || jsonb_build_object('client', _results);
  update gw_bench_runs set status = 'finished', results = v, finished_at = now() where id = _bench and created_by = auth.uid();
  return v;
end $$;

-- ===================== DEV membership bootstrap =====================
create or replace function public.gw_dev_join()
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'sign in required'; end if;
  insert into gw_tenant_members(user_id, tenant_id, role)
    select auth.uid(), id, 'admin' from gw_tenants where is_synthetic on conflict do nothing;
end $$;

-- lock down execute
do $$
declare f text;
begin
  foreach f in array array['gw_publish_internal(jsonb,uuid)','gw_claim_internal(text,text[],integer,integer,integer)','gw_apply_internal(bigint,text)']
  loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
  end loop;
end $$;
revoke execute on function public.gw_publish(jsonb), public.gw_claim(text,int,int,int), public.gw_ack(bigint,text),
  public.gw_worker_step(text,int,int), public.gw_set_route_control(text,text,boolean,boolean,boolean,boolean),
  public.gw_set_breaker(text,gw_app,boolean), public.gw_set_global_kill(boolean), public.gw_release_held(text),
  public.gw_replay(text,bigint[],text), public.gw_reconcile(text), public.gw_generate_synthetic(int,uuid,numeric,numeric,numeric),
  public.gw_bench_start(int,int), public.gw_bench_stats(uuid), public.gw_bench_finish(uuid,jsonb), public.gw_dev_join(),
  public.gw_member_tenants(gw_role[]) from public, anon;
grant execute on function public.gw_publish(jsonb), public.gw_claim(text,int,int,int), public.gw_ack(bigint,text),
  public.gw_worker_step(text,int,int), public.gw_set_route_control(text,text,boolean,boolean,boolean,boolean),
  public.gw_set_breaker(text,gw_app,boolean), public.gw_set_global_kill(boolean), public.gw_release_held(text),
  public.gw_replay(text,bigint[],text), public.gw_reconcile(text), public.gw_generate_synthetic(int,uuid,numeric,numeric,numeric),
  public.gw_bench_start(int,int), public.gw_bench_stats(uuid), public.gw_bench_finish(uuid,jsonb), public.gw_dev_join(),
  public.gw_member_tenants(gw_role[]) to authenticated;
