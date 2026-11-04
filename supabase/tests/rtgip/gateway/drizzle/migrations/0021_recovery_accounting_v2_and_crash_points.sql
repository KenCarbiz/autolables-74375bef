-- Phase 3C (DEV only). Additive: same signatures, no new grants.
-- 1) gw_apply_internal: DEV-only synthetic crash points (payload key _synthetic_crash, first attempt only) that abort the
--    caller transaction before COMMIT at: before inbox write / after inbox write / after inbox+projection write. No semantic change otherwise.
-- 2) gw_reconcile v2: legacy four checks unchanged + ACK-integrity / never-lose checks, route vs source counts, late deliveries,
--    DLQ classes and exact offending keys. Rollback: docs/runbooks/rollback/0021_down.sql.
CREATE OR REPLACE FUNCTION public.gw_apply_internal(_id bigint, _worker text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
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
    if s.environment = 'DEV' and q.attempts = 1 and o.envelope->'payload'->>'_synthetic_crash' = 'before_inbox' then
      raise exception 'SYNTHETIC_CRASH: before inbox write';
    end if;

    insert into gw_inbox(target_app, event_id, tenant_id, result) values (q.target_app, q.event_id, q.tenant_id, 'applied')
      on conflict do nothing;
    get diagnostics v_ins = row_count;
    if v_ins = 0 then
      update gw_queue set status = 'duplicate', delivered_at = clock_timestamp(), lease_until = null where id = _id;
      return 'duplicate';
    end if;
    if s.environment = 'DEV' and q.attempts = 1 and o.envelope->'payload'->>'_synthetic_crash' = 'after_inbox' then
      raise exception 'SYNTHETIC_CRASH: after inbox write, before projection and ACK';
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
    v_payload := v_payload - '_synthetic_fault' - '_synthetic_crash';
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
    if s.environment = 'DEV' and q.attempts = 1 and o.envelope->'payload'->>'_synthetic_crash' = 'after_projection' then
      raise exception 'SYNTHETIC_CRASH: after inbox and projection write, before ACK';
    end if;

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
  -- A synthetic crash models the worker process dying before COMMIT: the inner block has already rolled back
  -- inbox/projection/evidence; re-raising aborts the caller's transaction so no status change or ACK survives.
  if v_err like 'SYNTHETIC_CRASH:%' then raise exception '%', v_err; end if;

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
end $function$;

CREATE OR REPLACE FUNCTION public.gw_reconcile(_tenant text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_missing int; v_no_inbox int; v_lag int; v_stuck int; v_checked int; v_details jsonb;
  v_term_no_inbox int; v_inbox_no_ack int; v_dead_no_dlq int; v_copies int; v_late int;
  v_by_status jsonb; v_routes jsonb; v_dlq jsonb; v_lag_keys jsonb; v_missing_keys jsonb;
begin
  if not gw_is_member(_tenant) then raise exception 'forbidden'; end if;
  select count(*) into v_checked from gw_outbox where tenant_id = _tenant;
  select count(*) into v_missing from gw_outbox o join gw_routes r on r.source_app = o.source_app and o.event_type = any(r.event_types)
    where o.tenant_id = _tenant and not exists (select 1 from gw_queue q where q.event_id = o.event_id and q.route_id = r.id);
  select coalesce(jsonb_agg(k), '[]') into v_missing_keys from (
    select jsonb_build_object('event_id', o.event_id, 'route_id', r.id) k from gw_outbox o
      join gw_routes r on r.source_app = o.source_app and o.event_type = any(r.event_types)
     where o.tenant_id = _tenant and not exists (select 1 from gw_queue q where q.event_id = o.event_id and q.route_id = r.id)
     limit 50) x;
  select count(*) into v_no_inbox from gw_queue q where q.tenant_id = _tenant and q.status = 'delivered'
    and not exists (select 1 from gw_inbox i where i.target_app = q.target_app and i.event_id = q.event_id);
  select count(*) into v_term_no_inbox from gw_queue q where q.tenant_id = _tenant and q.status in ('delivered','duplicate','stale')
    and not exists (select 1 from gw_inbox i where i.target_app = q.target_app and i.event_id = q.event_id);
  select count(*) into v_inbox_no_ack from gw_inbox i where i.tenant_id = _tenant
    and not exists (select 1 from gw_queue q where q.event_id = i.event_id and q.target_app = i.target_app
                    and q.status in ('delivered','duplicate','stale','pending','retry','leased','held'));
  select count(*) into v_dead_no_dlq from gw_queue q where q.tenant_id = _tenant and q.status = 'dead'
    and not exists (select 1 from gw_dead_letters d where d.queue_id = q.id);
  with d as (
    select distinct on (q.target_app, o.source_app, o.aggregate_type, o.aggregate_id)
      q.target_app, o.source_app, o.aggregate_type, o.aggregate_id, o.aggregate_revision mx, o.event_id, q.route_id
    from gw_queue q join gw_outbox o on o.event_id = q.event_id
    where q.tenant_id = _tenant and q.status = 'delivered'
    order by q.target_app, o.source_app, o.aggregate_type, o.aggregate_id, o.aggregate_revision desc),
  b as (
    select d.*, coalesce((p.source_revisions->>(d.source_app::text || ':' || d.aggregate_type))::bigint, 0) pr, p.tenant_id is not null has_proj
    from d left join gw_projections p on p.tenant_id = _tenant and p.target_app = d.target_app
      and p.aggregate_type = d.aggregate_type and p.aggregate_id = d.aggregate_id
    where coalesce((p.source_revisions->>(d.source_app::text || ':' || d.aggregate_type))::bigint, 0) < d.mx)
  select count(*), coalesce((select jsonb_agg(jsonb_build_object('route_id', l.route_id, 'target_app', l.target_app, 'source_app', l.source_app,
      'aggregate_type', l.aggregate_type, 'aggregate_id', l.aggregate_id, 'max_delivered_revision', l.mx, 'head_event_id', l.event_id,
      'projection_revision', l.pr, 'projection_exists', l.has_proj)) from (select * from b order by aggregate_id, route_id limit 50) l), '[]')
    into v_lag, v_lag_keys from b;
  select count(*) into v_stuck from gw_queue where tenant_id = _tenant
    and ((status = 'leased' and lease_until < now()) or (status in ('pending','retry') and accepted_at < now() - interval '15 minutes'));
  select count(*), count(*) filter (where status = 'delivered' and delivered_at - accepted_at > interval '60 seconds')
    into v_copies, v_late from gw_queue where tenant_id = _tenant;
  select coalesce(jsonb_object_agg(status, n), '{}') into v_by_status
    from (select status, count(*) n from gw_queue where tenant_id = _tenant group by 1) s;
  select coalesce(jsonb_object_agg(route_id, j), '{}') into v_routes from (
    select route_id, jsonb_build_object('copies', count(*),
      'delivered', count(*) filter (where status = 'delivered'), 'duplicate', count(*) filter (where status = 'duplicate'),
      'stale', count(*) filter (where status = 'stale'), 'dead', count(*) filter (where status = 'dead'),
      'in_flight', count(*) filter (where status in ('pending','retry','leased','held')),
      'late_delivered', count(*) filter (where status = 'delivered' and delivered_at - accepted_at > interval '60 seconds')) j
    from gw_queue where tenant_id = _tenant group by route_id) r;
  select jsonb_build_object(
      'poison', count(*) filter (where reason like 'POISON:%'),
      'invariant', count(*) filter (where reason like 'INVARIANT:%'),
      'other', count(*) filter (where reason not like 'POISON:%' and reason not like 'INVARIANT:%'),
      'unresolved', count(*) filter (where resolved_at is null))
    into v_dlq from gw_dead_letters where tenant_id = _tenant;
  v_details := jsonb_build_object('missing_fanout', v_missing, 'delivered_without_inbox', v_no_inbox,
    'projection_behind_delivered', v_lag, 'stuck_messages', v_stuck,
    'terminal_without_inbox', v_term_no_inbox, 'inbox_without_ack', v_inbox_no_ack, 'dead_without_dead_letter', v_dead_no_dlq,
    'never_lose_ok', (v_missing + v_stuck + v_term_no_inbox + v_inbox_no_ack + v_dead_no_dlq) = 0,
    'source_events', v_checked, 'route_copies', v_copies, 'copies_by_status', v_by_status, 'routes', v_routes,
    'late_deliveries', v_late, 'late_threshold_s', 60, 'dlq', v_dlq,
    'projection_behind_keys', v_lag_keys, 'missing_fanout_keys', v_missing_keys, 'version', 2);
  insert into gw_reconciliation_runs(tenant_id, actor, checked, mismatches, details)
    values (_tenant, auth.uid(), v_checked,
      v_missing + v_no_inbox + v_lag + v_stuck + (v_term_no_inbox - v_no_inbox) + v_inbox_no_ack + v_dead_no_dlq, v_details);
  return v_details || jsonb_build_object('checked', v_checked);
end $function$;