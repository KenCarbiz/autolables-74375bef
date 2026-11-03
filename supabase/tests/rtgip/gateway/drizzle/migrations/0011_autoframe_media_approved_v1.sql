-- 0011: AutoFrame media.approved v1 metadata contract (DEV). Additive, no new grants.
create or replace function public.gw_semantic_violation(_env jsonb) returns text
language plpgsql immutable set search_path = public as $$
declare t text := _env->>'event_type'; refs jsonb := _env->'refs'; p jsonb := _env->'payload'; e jsonb; k text;
begin
  if refs is not null then
    if jsonb_typeof(refs) <> 'object' then return 'refs must be an object'; end if;
    for k in select jsonb_object_keys(refs) loop
      if k not in ('service_visit_ref','evidence_refs','source_receipt') then return 'refs: unknown key ' || left(k, 40); end if;
    end loop;
    if refs ? 'service_visit_ref' and (jsonb_typeof(refs->'service_visit_ref') <> 'string'
       or length(refs->>'service_visit_ref') not between 1 and 128) then
      return 'refs.service_visit_ref must be a non-empty string';
    end if;
    if refs ? 'evidence_refs' then
      if jsonb_typeof(refs->'evidence_refs') <> 'array' or jsonb_array_length(refs->'evidence_refs') > 32 then
        return 'refs.evidence_refs must be an array of at most 32 strings';
      end if;
      for e in select value from jsonb_array_elements(refs->'evidence_refs') loop
        if jsonb_typeof(e) <> 'string' or length(e #>> '{}') not between 1 and 128 then
          return 'refs.evidence_refs must be an array of at most 32 strings';
        end if;
      end loop;
    end if;
    if refs ? 'source_receipt' and jsonb_typeof(refs->'source_receipt') <> 'object' then
      return 'refs.source_receipt must be an object';
    end if;
  end if;
  if t in ('listing.delivered','listing.archived','sale.voided')
     and (coalesce(_env->'vehicle'->>'vin','') = '' or coalesce(_env->'vehicle'->>'episode_id','') = '') then
    return 'lifecycle event ' || t || ' requires vehicle.vin and vehicle.episode_id';
  end if;
  if t = 'sale.voided' and coalesce(p->>'void_reason','') = '' then
    return 'sale.voided requires payload.void_reason';
  end if;
  if t = 'service.repair_verified' then
    if coalesce(_env->'vehicle'->>'vin','') = '' then return 'service.repair_verified requires vehicle.vin'; end if;
    if coalesce(refs->>'service_visit_ref','') = '' then return 'service.repair_verified requires refs.service_visit_ref'; end if;
    if jsonb_typeof(refs->'evidence_refs') is distinct from 'array' or jsonb_array_length(refs->'evidence_refs') = 0 then
      return 'service.repair_verified requires non-empty refs.evidence_refs';
    end if;
    if p->'technician_verified' is distinct from 'true'::jsonb then
      return 'service.repair_verified requires payload.technician_verified=true';
    end if;
  end if;
  if t = 'service.mpi_verified' and p ? 'technician_verified' and p->'technician_verified' <> 'true'::jsonb then
    return 'service.mpi_verified with technician_verified other than true is not verified work';
  end if;
  if t = 'media.approved' then
    if coalesce(_env->'vehicle'->>'vin','') = '' or coalesce(_env->'vehicle'->>'instance_id','') = ''
       or coalesce(_env->'vehicle'->>'episode_id','') = '' then
      return 'media.approved requires vehicle.vin, vehicle.instance_id and vehicle.episode_id';
    end if;
    if p is null or jsonb_typeof(p) <> 'object' then return 'media.approved requires a payload object'; end if;
    for k in select jsonb_object_keys(p) loop
      if k not in ('media_id','content_sha256','object_ref','mime','width','height','preset_version','preset_order','approval','_synthetic_fault') then
        return 'media.approved payload: key ' || left(k, 40) || ' not allowed (metadata only)';
      end if;
    end loop;
    if (p - '_synthetic_fault')::text ~* '(https?:|data:|;base64|x-amz-|signature=|token=|expires=)' then
      return 'media.approved payload must not carry URLs, signed links or binary';
    end if;
    if coalesce(p->>'media_id','') !~ '^[A-Za-z0-9._:-]{1,128}$' then return 'media.approved requires payload.media_id'; end if;
    if coalesce(p->>'content_sha256','') !~ '^[0-9a-f]{64}$' then return 'media.approved requires payload.content_sha256 (64 hex)'; end if;
    if coalesce(p->>'object_ref','') !~ '^objref:[a-z0-9-]{1,64}/[A-Za-z0-9._/-]{1,256}$' then
      return 'media.approved requires opaque payload.object_ref (objref:bucket/key, no URL)';
    end if;
    if coalesce(p->>'mime','') not in ('image/jpeg','image/png','image/webp') then return 'media.approved unsupported mime'; end if;
    if jsonb_typeof(p->'width') is distinct from 'number' or jsonb_typeof(p->'height') is distinct from 'number'
       or (p->>'width')::numeric <> trunc((p->>'width')::numeric) or (p->>'height')::numeric <> trunc((p->>'height')::numeric)
       or (p->>'width')::numeric not between 1 and 20000 or (p->>'height')::numeric not between 1 and 20000 then
      return 'media.approved requires integer width/height 1..20000';
    end if;
    if coalesce(p->>'preset_version','') !~ '^[A-Za-z0-9._-]{1,32}$' then return 'media.approved requires payload.preset_version'; end if;
    if jsonb_typeof(p->'preset_order') is distinct from 'number' or (p->>'preset_order')::numeric <> trunc((p->>'preset_order')::numeric)
       or (p->>'preset_order')::numeric not between 0 and 999 then
      return 'media.approved requires integer payload.preset_order 0..999';
    end if;
    if jsonb_typeof(p->'approval') is distinct from 'object'
       or coalesce(p->'approval'->>'role','') not in ('sales_manager','inventory_manager','general_manager')
       or coalesce(p->'approval'->>'approval_id','') !~ '^[A-Za-z0-9._:-]{1,128}$'
       or coalesce(p->'approval'->>'approved_at','') = '' then
      return 'media.approved requires manager approval {role, approval_id, approved_at}';
    end if;
    for k in select jsonb_object_keys(p->'approval') loop
      if k not in ('role','approval_id','approved_at') then return 'media.approved approval: key ' || left(k, 40) || ' not allowed'; end if;
    end loop;
  end if;
  return null;
end $$;
revoke all on function public.gw_semantic_violation(jsonb) from public, anon;
grant execute on function public.gw_semantic_violation(jsonb) to authenticated;

create or replace function public.gw_apply_internal(_id bigint, _worker text) returns text
language plpgsql security definer set search_path = public, extensions as $$
declare
  q gw_queue%rowtype; o gw_outbox%rowtype; s gw_settings%rowtype; c gw_route_controls%rowtype;
  b gw_circuit_breakers%rowtype; p gw_projections%rowtype; r_enabled boolean;
  v_key text; v_cur bigint; v_section text; v_state jsonb; v_payload jsonb; v_err text; v_ins int;
  v_sold_guard boolean := false; v_backoff numeric; v_listing jsonb; v_status text; v_archived boolean;
  v_refs jsonb;
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
  v_refs := o.envelope->'refs';
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
      when o.event_type in ('inventory.updated','price.changed','listing.sold','listing.delivered','listing.archived','sale.voided') then 'listing'
      when o.event_type = 'video.engagement' then 'video'
      when o.event_type = 'service.mpi_verified' then 'mpi'
      when o.event_type = 'service.repair_verified' then 'repair'
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
      v_listing := coalesce(v_state->'listing', '{}'::jsonb);
      if v_listing->>'episode_id' is distinct from o.episode_id then
        if v_listing ? 'episode_id' then
          v_state := v_state || jsonb_build_object('listing_history', coalesce(v_state->'listing_history', '[]'::jsonb) || jsonb_build_array(v_listing));
        end if;
        v_listing := '{}'::jsonb;
        v_state := v_state || jsonb_build_object('listing', '{}'::jsonb);
      end if;
      v_status := v_listing->>'status';
      v_archived := coalesce((v_listing->>'archived')::boolean, false);
      if o.event_type = 'listing.sold' then
        if v_status = 'delivered' or v_archived then
          raise exception 'INVARIANT: listing.sold after % in same episode', case when v_archived then 'archived' else 'delivered' end;
        end if;
        v_payload := v_payload || '{"status":"sold"}';
      elsif o.event_type = 'listing.delivered' then
        if v_status is distinct from 'sold' then
          raise exception 'INVARIANT: listing.delivered requires sold in same episode (status %)', coalesce(v_status, 'none');
        end if;
        v_payload := v_payload || '{"status":"delivered"}';
      elsif o.event_type = 'sale.voided' then
        if v_status is distinct from 'sold' then
          raise exception 'INVARIANT: sale.voided requires an undelivered sold listing in same episode (status %)', coalesce(v_status, 'none');
        end if;
        v_payload := v_payload || '{"status":"active","sale_voided":true}';
      elsif o.event_type = 'listing.archived' then
        if v_status in ('sold','delivered') then
          v_payload := (v_payload - 'status') || '{"archived":true}';
        else
          v_payload := v_payload || '{"status":"archived","archived":true}';
        end if;
      elsif v_status in ('sold','delivered','archived') or v_archived then
        v_sold_guard := true;
        v_payload := v_payload - 'status' - 'archived';
      end if;
      if o.event_type in ('listing.sold','listing.delivered','sale.voided','listing.archived') then
        v_payload := v_payload || jsonb_build_object('lifecycle', coalesce(v_listing->'lifecycle', '[]'::jsonb)
          || jsonb_build_array(jsonb_build_object('event', o.event_type, 'rev', o.aggregate_revision)));
      end if;
      v_payload := v_payload || jsonb_build_object('episode_id', o.episode_id);
    end if;

    if v_section in ('mpi','repair') and v_refs is not null then
      v_payload := v_payload || jsonb_strip_nulls(jsonb_build_object('service_visit_ref', v_refs->'service_visit_ref', 'evidence_refs', v_refs->'evidence_refs'));
    end if;
    if v_section = 'repair' then
      v_payload := jsonb_build_object(v_refs->>'service_visit_ref', v_payload || jsonb_build_object('rev', o.aggregate_revision));
    end if;

    if v_section = 'media' then
      v_payload := jsonb_build_object('assets', coalesce(v_state->'media'->'assets', '{}'::jsonb)
        || jsonb_build_object(v_payload->>'media_id', v_payload || jsonb_build_object('rev', o.aggregate_revision, 'episode_id', o.episode_id)));
    end if;
    v_state := v_state || jsonb_build_object(v_section, coalesce(v_state->v_section, '{}'::jsonb) || v_payload
      || case when v_section = 'repair' then '{}'::jsonb else jsonb_build_object('rev', o.aggregate_revision, 'source', o.source_app) end,
      'last_event', o.event_type);

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

  if v_err like 'INVARIANT:%' then
    update gw_queue set status = 'dead', lease_until = null, last_error = v_err where id = _id;
    insert into gw_dead_letters(queue_id, event_id, tenant_id, route_id, reason, attempts)
      values (_id, q.event_id, q.tenant_id, q.route_id, v_err, q.attempts);
    insert into gw_evidence(tenant_id, target_app, event_id, route_id, kind, detail, payload_hash)
      values (q.tenant_id, q.target_app, q.event_id, q.route_id, 'invariant_quarantined', jsonb_build_object('error', v_err), o.payload_hash);
    return 'dead';
  end if;

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
  v_backoff := least(30.0, 0.1 * power(2, q.attempts)) * (0.5 + random() * 0.5);
  update gw_queue set status = 'retry', lease_until = null, leased_by = null, last_error = v_err,
    available_at = clock_timestamp() + make_interval(secs => v_backoff) where id = _id;
  return 'retry';
end $$;
revoke all on function public.gw_apply_internal(bigint, text) from public, anon, authenticated;

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
      v_res := gw_publish_internal(v_last, _bench);
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
        else jsonb_build_object('media_id', 'med-syn-' || left(md5(random()::text), 16),
          'content_sha256', md5(random()::text) || md5(random()::text),
          'object_ref', 'objref:dev-synthetic-media/' || inst.id || '/' || floor(random()*99999)::int || '.jpg',
          'mime', 'image/jpeg', 'width', 1920, 'height', 1080, 'preset_version', 'dev-1', 'preset_order', floor(random()*24)::int,
          'approval', jsonb_build_object('role', 'inventory_manager', 'approval_id', 'apr-syn-' || left(md5(random()::text), 12), 'approved_at', clock_timestamp()))
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