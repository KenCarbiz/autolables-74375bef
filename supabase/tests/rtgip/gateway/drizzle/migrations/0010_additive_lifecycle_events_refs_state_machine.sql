-- 0010: additive canonical v1 lifecycle events + optional refs metadata + per-episode listing state machine.
-- Backward compatible: schema_version stays integer 1; existing events, routes and payloads behave as before.
-- New events: listing.delivered, listing.archived, sale.voided (AutoLabels), service.repair_verified (AutoFilm).
-- New optional top-level envelope object `refs` {service_visit_ref, evidence_refs[], source_receipt{}}.
-- No grants to SECURITY DEFINER functions are added. gw_apply_internal keeps its existing (revoked) ACL.

insert into public.gw_source_allowlist(source_app, event_type, aggregate_type, authority, classification, schema_versions) values
  ('autolabels', 'listing.delivered', 'vehicle_instance', 'listing_episode', 'internal', '{1}'),
  ('autolabels', 'listing.archived',  'vehicle_instance', 'listing_episode', 'internal', '{1}'),
  ('autolabels', 'sale.voided',       'vehicle_instance', 'listing_episode', 'internal', '{1}'),
  ('autofilm',   'service.repair_verified', 'vehicle_instance', 'mpi_service_evidence', 'internal', '{1}')
on conflict do nothing;

update public.gw_routes set event_types = array['inventory.updated','price.changed','listing.sold','listing.delivered','sale.voided','listing.archived'] where id = 'labels->film';
update public.gw_routes set event_types = array['inventory.updated','listing.sold','listing.delivered','sale.voided','listing.archived'] where id = 'labels->curb';
update public.gw_routes set event_types = array['video.engagement','service.mpi_verified','service.repair_verified'] where id = 'film->labels';
update public.gw_routes set event_types = array['video.engagement','service.mpi_verified','service.repair_verified'] where id = 'film->curb';

-- Envelope-local semantic rules (evidence, visit and episode requirements). Pure, not SECURITY DEFINER.
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
  return null;
end $$;
revoke all on function public.gw_semantic_violation(jsonb) from public, anon;
grant execute on function public.gw_semantic_violation(jsonb) to authenticated;

-- Same frozen dialect gate as 0007, plus the semantic rules above as the final check.
create or replace function public.gw_contract_violation(_env jsonb) returns text
language plpgsql immutable set search_path = public as $$
declare v jsonb; k text; t text;
begin
  if _env is null or jsonb_typeof(_env) <> 'object' then return 'envelope must be a JSON object'; end if;
  v := _env->'schema_version';
  if v is null then return 'missing required envelope field'; end if;
  if jsonb_typeof(v) <> 'number' or (v::text)::numeric <> trunc((v::text)::numeric) then
    return 'foreign dialect: schema_version must be an integer (canonical v1), got ' || left(v::text, 40);
  end if;
  foreach k in array array['producer','source_record_id','source_version','tenant_ref','instance_ref','service_visit_ref','payload_checksum'] loop
    if _env ? k then
      return 'foreign dialect: AutoLabels PR #46 field ' || k || ' is not canonical v1 (translation unverified)';
    end if;
  end loop;
  if jsonb_typeof(_env->'event_id') is distinct from 'string' then return 'missing required envelope field'; end if;
  if jsonb_typeof(_env->'aggregate') is distinct from 'object' then
    return 'foreign dialect: aggregate must be an object {type,id,revision}';
  end if;
  v := _env->'aggregate'->'revision';
  if v is null or jsonb_typeof(v) <> 'number' or (v::text)::numeric <> trunc((v::text)::numeric) then
    return 'foreign dialect: aggregate.revision must be an integer';
  end if;
  if _env ? 'vehicle' and jsonb_typeof(_env->'vehicle') <> 'object' then
    return 'foreign dialect: vehicle must be an object {vin,instance_id,episode_id}';
  end if;
  if jsonb_typeof(_env->'source_app') is distinct from 'string'
     or (_env->>'source_app') not in ('autolabels','autofilm','autocurb','autoframe') then
    return 'foreign dialect: source_app must be a lowercase canonical app id';
  end if;
  if _env ? 'target_app' and (_env->>'target_app') not in ('autolabels','autofilm','autocurb','autoframe') then
    return 'foreign dialect: target_app must be a lowercase canonical app id';
  end if;
  t := _env->>'event_type';
  if t = 'acquisition.recorded' then
    return 'non-canonical event_type acquisition.recorded (AutoCurb draft); mapping to acquisition.closed is TBD';
  end if;
  if t in ('appraisal.recorded','autocurb.appraisal.recorded','autocurb.acquisition.recorded',
           'autolabels.vehicle.sold','autolabels.vehicle.delivered','autolabels.vehicle.sale_voided','autolabels.vehicle.archived',
           'vehicle.sold','vehicle.delivered','vehicle.sale_voided','vehicle.archived',
           'autofilm.inspection.completed','inspection.completed',
           'autofilm.repair.completed_verified','repair.completed_verified') then
    return 'blocked mapping: event_type ' || t || ' has no verified canonical v1 equivalent';
  end if;
  return gw_semantic_violation(_env);
end $$;

-- Apply: identical to 0004/0008 behaviour, plus the per-episode listing state machine and visit-keyed repairs.
-- Invariant violations are quarantined (dead letter 'INVARIANT: ...') without touching breaker health and
-- without an inbox row, so an operator replay re-evaluates them.
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
        -- new listing episode: keep the prior episode (incl. sold history) in listing_history, start clean
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
        -- inventory/price updates never regress a sold, delivered or archived listing in the same episode
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
      -- keyed by service visit so verified work survives sale and later visits
      v_payload := jsonb_build_object(v_refs->>'service_visit_ref', v_payload || jsonb_build_object('rev', o.aggregate_revision));
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

  -- semantic invariant: quarantine, do not count against target health, no inbox row (replay re-evaluates)
  if v_err like 'INVARIANT:%' then
    update gw_queue set status = 'dead', lease_until = null, last_error = v_err where id = _id;
    insert into gw_dead_letters(queue_id, event_id, tenant_id, route_id, reason, attempts)
      values (_id, q.event_id, q.tenant_id, q.route_id, v_err, q.attempts);
    insert into gw_evidence(tenant_id, target_app, event_id, route_id, kind, detail, payload_hash)
      values (q.tenant_id, q.target_app, q.event_id, q.route_id, 'invariant_quarantined', jsonb_build_object('error', v_err), o.payload_hash);
    return 'dead';
  end if;

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
  v_backoff := least(30.0, 0.1 * power(2, q.attempts)) * (0.5 + random() * 0.5);
  update gw_queue set status = 'retry', lease_until = null, leased_by = null, last_error = v_err,
    available_at = clock_timestamp() + make_interval(secs => v_backoff) where id = _id;
  return 'retry';
end $$;
revoke all on function public.gw_apply_internal(bigint, text) from public, anon, authenticated;
