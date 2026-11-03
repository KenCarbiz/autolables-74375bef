-- RooftopOS Integration Gateway — DEV engine integration test.
-- Runs entirely inside one DO block against the DEV database and ALWAYS rolls back
-- (the final RAISE aborts the transaction). Success = error text 'GW_TESTS_PASSED: n'.
-- Any other error text = failing assertion.
do $$
declare
  ua uuid := '00000000-0000-4000-a000-0000000000aa';  -- admin on both synthetic groups
  ub uuid := '00000000-0000-4000-a000-0000000000bb';  -- viewer on lakeshore only
  r jsonb; n int; s text; v_id bigint; passed int := 0; ids bigint[];
  -- Phase 3C: fresh per-run aggregates instead of deleting committed projections of shared synthetic instances.
  run text := substr(md5(clock_timestamp()::text), 1, 8);
  lead_id text := 'lead-eng-' || run;
  transfer_id text := 'vi-eng-transfer-' || run; transfer_ep text := 'ep-eng-transfer-' || run;
  other_id text := 'vi-eng-other-' || run; other_ep text := 'ep-eng-other-' || run;
  inst text := 'vi-eng-' || run || '-a'; inst2 text := 'vi-eng-' || run || '-b'; tvin text := 'DEVSYN00000000401'; epi text := 'ep-eng-' || run || '-a-1';
  e1 uuid := gen_random_uuid();
  base jsonb;
begin
  insert into gw_tenant_members values (ua, 'grp-syn-northwind', 'admin', now()), (ua, 'grp-syn-lakeshore', 'admin', now()),
    (ub, 'grp-syn-lakeshore', 'viewer', now());
  perform set_config('request.jwt.claims', json_build_object('sub', ua, 'role', 'authenticated')::text, true);
  -- isolate from any pre-existing DEV queue rows
  update gw_queue set status = 'skipped' where status in ('pending','retry','leased','held');

  base := jsonb_build_object('schema_version', 1, 'tenant_id', 'grp-syn-northwind', 'rooftop_id', 'rt-syn-nw-01',
    'vehicle', jsonb_build_object('vin', tvin, 'instance_id', inst, 'episode_id', epi),
    'source_app', 'autolabels', 'event_type', 'inventory.updated', 'occurred_at', now(), 'emitted_at', now());

  -- T1 accepted + fan-out to labels->film and labels->curb
  r := gw_publish(base || jsonb_build_object('event_id', e1, 'aggregate', jsonb_build_object('type','vehicle_instance','id',inst,'revision',1),
        'payload', '{"status":"active","mileage":1200}'::jsonb));
  if r->>'status' <> 'accepted' or (r->>'fanout')::int <> 2 then raise exception 'T1 publish: %', r; end if; passed := passed + 1;

  -- T2 duplicate event_id is idempotent
  r := gw_publish(base || jsonb_build_object('event_id', e1, 'aggregate', jsonb_build_object('type','vehicle_instance','id',inst,'revision',1), 'payload', '{}'::jsonb));
  if r->>'status' <> 'duplicate' then raise exception 'T2 duplicate: %', r; end if; passed := passed + 1;

  -- T3 stale revision rejected at producer boundary
  r := gw_publish(base || jsonb_build_object('event_id', gen_random_uuid(), 'aggregate', jsonb_build_object('type','vehicle_instance','id',inst,'revision',1), 'payload', '{}'::jsonb));
  if r->>'status' <> 'stale' then raise exception 'T3 stale: %', r; end if; passed := passed + 1;

  -- T4 positive allowlist: AutoFilm is not authoritative for inventory
  r := gw_publish(base || jsonb_build_object('event_id', gen_random_uuid(), 'source_app', 'autofilm',
        'aggregate', jsonb_build_object('type','vehicle_instance','id',inst,'revision',9), 'payload', '{}'::jsonb));
  if r->>'status' <> 'rejected' then raise exception 'T4 allowlist: %', r; end if; passed := passed + 1;

  -- T5 rooftop from another tenant rejected
  r := gw_publish(base || jsonb_build_object('event_id', gen_random_uuid(), 'rooftop_id', 'rt-syn-ls-01',
        'aggregate', jsonb_build_object('type','vehicle_instance','id',inst,'revision',9), 'payload', '{}'::jsonb));
  if r->>'status' <> 'rejected' then raise exception 'T5 cross-tenant rooftop: %', r; end if; passed := passed + 1;

  -- T6 unsupported schema version rejected; v2 accepted for inventory.updated (compat)
  r := gw_publish(base || jsonb_build_object('event_id', gen_random_uuid(), 'schema_version', 3,
        'aggregate', jsonb_build_object('type','vehicle_instance','id',inst,'revision',9), 'payload', '{}'::jsonb));
  if r->>'status' <> 'rejected' then raise exception 'T6 schema: %', r; end if; passed := passed + 1;

  -- T7 worker delivers both route copies; projections exist in both targets
  r := gw_worker_step('test-w1', 100, 50);
  if coalesce((r->>'delivered')::int, 0) <> 2 then raise exception 'T7 deliver: %', r; end if;
  select count(*) into n from gw_projections where tenant_id = 'grp-syn-northwind' and aggregate_id = inst and target_app in ('autofilm','autocurb');
  if n <> 2 then raise exception 'T7 projections: %', n; end if; passed := passed + 1;

  -- T8 sold listing does not regress on later inventory event of same episode
  r := gw_publish(base || jsonb_build_object('event_id', gen_random_uuid(), 'event_type', 'listing.sold',
        'aggregate', jsonb_build_object('type','vehicle_instance','id',inst,'revision',2), 'payload', '{"sold_at":"2026-01-01"}'::jsonb));
  perform gw_worker_step('test-w1', 100, 50);
  r := gw_publish(base || jsonb_build_object('event_id', gen_random_uuid(),
        'aggregate', jsonb_build_object('type','vehicle_instance','id',inst,'revision',3), 'payload', '{"status":"active","mileage":1300}'::jsonb));
  perform gw_worker_step('test-w1', 100, 50);
  select state->'listing'->>'status' into s from gw_projections where tenant_id = 'grp-syn-northwind' and target_app = 'autofilm' and aggregate_id = inst;
  if s <> 'sold' then raise exception 'T8 sold regression: %', s; end if;
  select count(*) into n from gw_evidence where tenant_id = 'grp-syn-northwind' and kind = 'applied_sold_guard';
  if n < 1 then raise exception 'T8 evidence missing'; end if; passed := passed + 1;

  -- T9 replay of delivered rows: exactly-once effect (inbox dedupe; apply_count unchanged)
  select apply_count into n from gw_projections where tenant_id = 'grp-syn-northwind' and target_app = 'autofilm' and aggregate_id = inst;
  select array_agg(id) into ids from gw_queue where event_id = e1;
  r := gw_replay('grp-syn-northwind', ids, 'test');
  if (r->>'requeued')::int <> 2 then raise exception 'T9 replay: %', r; end if;
  r := gw_worker_step('test-w2', 100, 50);
  if coalesce((r->>'duplicate')::int, 0) <> 2 then raise exception 'T9 dedupe: %', r; end if;
  if (select apply_count from gw_projections where tenant_id = 'grp-syn-northwind' and target_app = 'autofilm' and aggregate_id = inst) <> n then
    raise exception 'T9 effect applied twice'; end if;
  if not exists (select 1 from gw_replay_audit where tenant_id = 'grp-syn-northwind') then raise exception 'T9 audit'; end if;
  passed := passed + 1;

  -- T10 lane ordering: 3 queued revisions in one lane -> claim returns only the head
  for n in 4..6 loop
    perform gw_publish(base || jsonb_build_object('event_id', gen_random_uuid(), 'target_app', 'autofilm',
        'aggregate', jsonb_build_object('type','vehicle_instance','id',inst,'revision',n), 'payload', '{"mileage":1}'::jsonb));
  end loop;
  select count(*) into n from gw_claim('test-w3', 50, 30, 50);
  if n <> 1 then raise exception 'T10 lane head-only claim returned %', n; end if;
  select count(*) into n from gw_claim('test-w4', 50, 30, 50);   -- second worker blocked while head leased
  if n <> 0 then raise exception 'T10 concurrent lane claim returned %', n; end if;
  select id into v_id from gw_queue where leased_by = 'test-w3' and status = 'leased';
  if gw_ack(v_id, 'test-w4') <> 'lost_lease' then raise exception 'T10 foreign ack accepted'; end if;
  if gw_ack(v_id, 'test-w3') <> 'delivered' then raise exception 'T10 ack'; end if;
  perform gw_worker_step('test-w3', 100, 50); perform gw_worker_step('test-w3', 100, 50);
  if (select (source_revisions->>'autolabels:vehicle_instance')::int from gw_projections
      where tenant_id = 'grp-syn-northwind' and target_app = 'autofilm' and aggregate_id = inst) <> 6 then raise exception 'T10 final revision'; end if;
  passed := passed + 1;

  -- T11 poison -> dead letter immediately
  r := gw_publish(base || jsonb_build_object('event_id', gen_random_uuid(), 'target_app', 'autocurb',
        'aggregate', jsonb_build_object('type','vehicle_instance','id',inst2,'revision',1),
        'vehicle', jsonb_build_object('vin','DEVSYN00000000402','instance_id',inst2,'episode_id','ep-eng-' || run || '-b-1'),
        'payload', '{"_synthetic_fault":"poison"}'::jsonb));
  r := gw_worker_step('test-w1', 100, 50);
  if coalesce((r->>'dead')::int, 0) <> 1 then raise exception 'T11 poison: %', r; end if;
  if not exists (select 1 from gw_dead_letters where event_id = (select event_id from gw_outbox where aggregate_id = inst2 order by seq desc limit 1)) then
    raise exception 'T11 dead letter row'; end if;
  passed := passed + 1;

  -- T12 same VIN different rooftop (same tenant) and different tenant -> distinct projections, no bleed
  perform gw_publish(base || jsonb_build_object('event_id', gen_random_uuid(), 'rooftop_id', 'rt-syn-nw-02',
        'vehicle', jsonb_build_object('vin', tvin, 'instance_id', transfer_id, 'episode_id', transfer_ep),
        'aggregate', jsonb_build_object('type','vehicle_instance','id',transfer_id,'revision',1), 'payload', '{"status":"active"}'::jsonb));
  perform gw_publish(base || jsonb_build_object('event_id', gen_random_uuid(), 'tenant_id', 'grp-syn-lakeshore', 'rooftop_id', 'rt-syn-ls-01',
        'vehicle', jsonb_build_object('vin', tvin, 'instance_id', other_id, 'episode_id', other_ep),
        'aggregate', jsonb_build_object('type','vehicle_instance','id',other_id,'revision',1), 'payload', '{"status":"active"}'::jsonb));
  perform gw_worker_step('test-w1', 100, 50);
  select count(distinct (tenant_id, aggregate_id)) into n from gw_projections where vin = tvin and target_app = 'autofilm' and aggregate_id in (inst,transfer_id,other_id);
  if n < 3 then raise exception 'T12 same-VIN instances: %', n; end if;
  r := gw_publish(base || jsonb_build_object('event_id', gen_random_uuid(), 'tenant_id', 'grp-syn-lakeshore', 'rooftop_id', 'rt-syn-ls-01',
        'aggregate', jsonb_build_object('type','vehicle_instance','id',inst,'revision',50), 'payload', '{}'::jsonb));
  if r->>'status' <> 'rejected' then raise exception 'T12 cross-tenant instance hijack: %', r; end if;
  passed := passed + 1;

  -- T13 kill switch holds (lane blocked, not lost); dry-run records evidence without effect
  perform gw_set_route_control('grp-syn-northwind', 'labels->curb', true, false, true, false);
  perform gw_publish(base || jsonb_build_object('event_id', gen_random_uuid(), 'target_app', 'autocurb',
        'aggregate', jsonb_build_object('type','vehicle_instance','id',inst,'revision',7), 'payload', '{"mileage":7}'::jsonb));
  r := gw_worker_step('test-w1', 100, 50);
  if coalesce((r->>'held')::int, 0) <> 1 then raise exception 'T13 kill: %', r; end if;
  perform gw_set_route_control('grp-syn-northwind', 'labels->curb', true, true, false, false);
  perform gw_release_held('grp-syn-northwind');
  r := gw_worker_step('test-w1', 100, 50);
  if coalesce((r->>'dry_run')::int, 0) <> 1 then raise exception 'T13 dry run: %', r; end if;
  passed := passed + 1;

  -- T14 PII requires consent id and only flows on consent-enabled routes
  r := gw_publish(base || jsonb_build_object('event_id', gen_random_uuid(), 'source_app', 'autocurb', 'event_type', 'lead.consented',
        'aggregate', jsonb_build_object('type','crm_lead','id',lead_id,'revision',1), 'payload', '{"contact_ref":"x"}'::jsonb));
  if r->>'status' <> 'rejected' then raise exception 'T14 pii no consent: %', r; end if;
  r := gw_publish(base || jsonb_build_object('event_id', gen_random_uuid(), 'source_app', 'autocurb', 'event_type', 'lead.consented',
        'aggregate', jsonb_build_object('type','crm_lead','id',lead_id,'revision',1), 'payload', '{"contact_ref":"x","consent_id":"CNS-1"}'::jsonb));
  r := gw_worker_step('test-w1', 100, 50);
  if coalesce((r->>'skipped')::int, 0) <> 1 then raise exception 'T14 pii route gate: %', r; end if;
  passed := passed + 1;

  -- T15 binary media payload rejected
  r := gw_publish(base || jsonb_build_object('event_id', gen_random_uuid(), 'source_app', 'autoframe', 'event_type', 'media.approved',
        'aggregate', jsonb_build_object('type','vehicle_instance','id',inst,'revision',1), 'payload', '{"data_base64":"AAAA"}'::jsonb));
  if r->>'status' <> 'rejected' then raise exception 'T15 binary: %', r; end if; passed := passed + 1;

  -- T16 external delivery flag cannot be enabled; evidence is immutable
  begin update gw_settings set external_delivery_enabled = true where id = 1; raise exception 'T16 flag enabled';
  exception when check_violation then passed := passed + 1; end;
  begin update gw_evidence set kind = 'x' where id = (select min(id) from gw_evidence); raise exception 'T16b evidence mutable';
  exception when raise_exception then if sqlerrm not like 'immutable%' then raise; end if; passed := passed + 1; end;

  -- T17 tenant RLS: viewer B cannot read northwind rows nor publish/drain
  perform set_config('request.jwt.claims', json_build_object('sub', ub, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into n from gw_outbox where tenant_id = 'grp-syn-northwind';
  if n <> 0 then raise exception 'T17 RLS leak: %', n; end if;
  select count(*) into n from gw_projections where tenant_id = 'grp-syn-northwind';
  if n <> 0 then raise exception 'T17 RLS projection leak'; end if;
  r := gw_publish(base || jsonb_build_object('event_id', gen_random_uuid(), 'tenant_id', 'grp-syn-lakeshore', 'rooftop_id', 'rt-syn-ls-01',
        'aggregate', jsonb_build_object('type','vehicle_instance','id','vi-rt-syn-ls-01-001','revision',1), 'payload', '{}'::jsonb));
  if r->>'status' <> 'rejected' then raise exception 'T17 viewer publish: %', r; end if;
  begin perform gw_publish_internal('{}'::jsonb, null); raise exception 'T17 internal callable';
  exception when insufficient_privilege then null; end;
  begin perform gw_publish_core('{}'::jsonb, null); raise exception 'T17 core callable';
  exception when insufficient_privilege then null; end;
  execute 'reset role';
  passed := passed + 1;

  raise exception 'GW_TESTS_PASSED: %', passed;
end $$;
