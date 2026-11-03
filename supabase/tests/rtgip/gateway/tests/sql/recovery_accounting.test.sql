-- Phase 3C recovery / accounting (migration 0021). One DO block, ALWAYS rolls back. Success = 'GW_TESTS_PASSED: n | metrics'.
-- Run as a privileged DB session (gw_dev_ingest is service-role only). Synthetic tenants/aggregates only.
--   R0  committed DB baseline: whole-tenant reconcile has 0 invariant mismatches (Northwind and Lakeshore)
--   F1  isolated delivered-projection corruption detector; never delete shared committed projections.
--       A separate durable forensic drill captures all 16 reproduced groups, not the unknown original historical IDs.
--   C1  crash of a whole worker step (claim+apply roll back together): copy stays pending, nothing lost or acked
--   C2  crash before inbox write   C3 crash after inbox write, before ACK   C4 crash after inbox+projection, before ACK
--       -> nothing committed, lease kept, re-lease applies exactly once (apply_count, inbox rows, revisions)
--   C5  crash after ACK (committed; transport redelivers) -> duplicate, no second effect; stale worker ACK fenced
--   N1  never-lose: every accepted test event has every route copy, each terminal with exactly one inbox receipt
--   L1  late deliveries + route-level vs source-event counts tracked separately and NOT counted as mismatches
--   P1  synthetic poison DLQ stays distinct (dlq.poison) and durable (dead_without_dead_letter = 0)
--   V1  detectors are not vacuous: injected corruption is caught by each never-lose check
--   X1  cross-tenant: non-member reconcile forbidden; Lakeshore report/claims/RLS never expose Northwind rows
do $$
declare
  ua uuid := '00000000-0000-4000-a000-0000000000c1';
  ub uuid := '00000000-0000-4000-a000-0000000000c2';
  run text := substr(md5(clock_timestamp()::text), 1, 8);
  inst text := 'vi-recov-' || run || '-a'; inst2 text := 'vi-recov-' || run || '-b';
  base jsonb; r jsonb; r0 jsonb; n int; k int := 0; passed int := 0; ev uuid; ids uuid[] := '{}'; qid bigint;
  metrics jsonb := '{}'; keys jsonb; msg text; late0 int; poison0 int;
begin
  insert into gw_tenant_members values (ua, 'grp-syn-northwind', 'admin', now()) on conflict do nothing;
  insert into gw_tenant_members values (ub, 'grp-syn-lakeshore', 'admin', now()) on conflict do nothing;
  perform set_config('request.jwt.claims', json_build_object('sub', ua, 'role', 'authenticated')::text, true);
  update gw_circuit_breakers set consecutive_failures = 0, state = 'closed', opened_at = null, forced_open = false;
  update gw_route_controls set enabled = true, killed = false, dry_run = false;
  update gw_settings set global_kill = false;
  base := jsonb_build_object('schema_version', 1, 'tenant_id', 'grp-syn-northwind', 'rooftop_id', 'rt-syn-nw-01',
    'vehicle', jsonb_build_object('vin', 'DEVSYN00000000777', 'instance_id', inst, 'episode_id', 'ep-recov-' || run || '-a-1'),
    'source_app', 'autolabels', 'event_type', 'inventory.updated', 'occurred_at', now(), 'emitted_at', now(),
    'correlation_id', gen_random_uuid(), 'trace_id', 'trc-recov-' || run);

  -- R0 committed baseline (no fixture deletions)
  r0 := gw_reconcile('grp-syn-northwind');
  if (select mismatches from gw_reconciliation_runs order by id desc limit 1) <> 0 or not (r0->>'never_lose_ok')::boolean then
    raise exception 'R0 northwind baseline %', r0 - 'routes'; end if;
  late0 := (r0->>'late_deliveries')::int; poison0 := (r0->'dlq'->>'poison')::int;
  metrics := metrics || jsonb_build_object('r0_northwind_mismatches', 0, 'r0_source_events', r0->'source_events', 'r0_route_copies', r0->'route_copies');
  passed := passed + 1;

  -- C1 whole worker step crashes: claim + apply roll back together; copy remains pending (not lost, not acked)
  ev := gen_random_uuid(); ids := ids || ev; k := k + 1;
  r := gw_dev_ingest('labels-nw-k1', 'nonce-rc-' || run || '-' || k || '-aaaa', now(), repeat('0',64), base || jsonb_build_object('event_id', ev,
    'aggregate', jsonb_build_object('type','vehicle_instance','id',inst,'revision',1), 'payload', '{"mileage":1,"_synthetic_crash":"before_inbox"}'::jsonb));
  if r->>'decision' <> 'accepted' then raise exception 'C1 ingest %', r; end if;
  begin
    perform gw_worker_step('w-c1', 100, 50);
    raise exception 'C1 no crash';
  exception when others then
    if sqlerrm not like 'SYNTHETIC_CRASH: before inbox%' then raise; end if;
  end;
  if exists (select 1 from gw_queue where event_id = ev and (status <> 'pending' or attempts <> 0 or leased_by is not null))
     or (select count(*) from gw_queue where event_id = ev) <> 2 then raise exception 'C1 step crash left state %',
       (select jsonb_agg(jsonb_build_object('s',status,'a',attempts,'w',leased_by)) from gw_queue where event_id = ev); end if;
  if exists (select 1 from gw_inbox where event_id = ev) then raise exception 'C1 inbox survived crash'; end if;
  passed := passed + 1;

  -- C2 crash before inbox write (claim committed separately, apply crashes)
  perform gw_claim('w-c2', 50, 30, 50);
  select id into qid from gw_queue where event_id = ev and target_app = 'autofilm';
  if (select leased_by from gw_queue where id = qid) <> 'w-c2' or (select attempts from gw_queue where id = qid) <> 1 then raise exception 'C2 claim'; end if;
  begin
    perform gw_ack(qid, 'w-c2'); raise exception 'C2 no crash';
  exception when others then
    if sqlerrm not like 'SYNTHETIC_CRASH: before inbox%' then raise; end if;
  end;
  if (select status from gw_queue where id = qid) <> 'leased' or exists (select 1 from gw_inbox where event_id = ev and target_app = 'autofilm')
     or exists (select 1 from gw_projections where aggregate_id = inst) then raise exception 'C2 partial commit'; end if;
  update gw_queue set lease_until = clock_timestamp() - interval '1 second' where event_id = ev and status = 'leased';  -- worker died
  for n in 1..5 loop perform gw_worker_step('w-c2b', 100, 50); end loop;
  if (select count(*) from gw_queue where event_id = ev and status = 'delivered') <> 2
     or (select count(*) from gw_inbox where event_id = ev) <> 2
     or exists (select 1 from gw_projections where aggregate_id = inst and (apply_count <> 1 or (source_revisions->>'autolabels:vehicle_instance')::int <> 1))
     or (select count(*) from gw_projections where aggregate_id = inst) <> 2 then raise exception 'C2 recovery'; end if;
  passed := passed + 1;

  -- F1 corrupt only this run's fresh projection; the delivered ACK remains an invariant failure, not tolerated lag.
  begin
    delete from gw_projections where tenant_id = 'grp-syn-northwind' and aggregate_id = inst and target_app = 'autofilm';
    r := gw_reconcile('grp-syn-northwind');
    raise exception 'F1_ROLLBACK';
  exception when others then
    if sqlerrm <> 'F1_ROLLBACK' then raise; end if;
  end;
  keys := r->'projection_behind_keys';
  if (r->>'projection_behind_delivered')::int <> 1
     or not (keys @> jsonb_build_array(jsonb_build_object('aggregate_id', inst, 'head_event_id', ev, 'projection_exists', false)))
    then raise exception 'F1 fresh projection corruption undetected %', keys; end if;
  r := gw_reconcile('grp-syn-northwind');
  if (r->>'projection_behind_delivered')::int <> 0 then raise exception 'F1 rollback failed'; end if;
  metrics := metrics || jsonb_build_object('f1_isolated_flags', 1, 'historical_original_ids_verified', false);
  passed := passed + 1;

  -- C3 crash after inbox write, before projection/ACK; C4 crash after inbox+projection write, before ACK
  for n in 2..3 loop
    ev := gen_random_uuid(); ids := ids || ev; k := k + 1;
    r := gw_dev_ingest('labels-nw-k1', 'nonce-rc-' || run || '-' || k || '-aaaa', now(), repeat('0',64), base || jsonb_build_object('event_id', ev,
      'aggregate', jsonb_build_object('type','vehicle_instance','id',inst,'revision',n),
      'payload', jsonb_build_object('mileage', n, '_synthetic_crash', case n when 2 then 'after_inbox' else 'after_projection' end)));
    if r->>'decision' <> 'accepted' then raise exception 'C% ingest %', n + 1, r; end if;
    perform gw_claim('w-c' || (n + 1), 50, 30, 50);
    for qid in select id from gw_queue where event_id = ev order by target_app loop
      begin
        perform gw_ack(qid, 'w-c' || (n + 1)); raise exception 'C% no crash', n + 1;
      exception when others then
        msg := sqlerrm;
        if msg not like (case n when 2 then 'SYNTHETIC_CRASH: after inbox write%' else 'SYNTHETIC_CRASH: after inbox and projection%' end) then raise; end if;
      end;
    end loop;
    if exists (select 1 from gw_inbox where event_id = ev) then raise exception 'C% inbox committed without ACK', n + 1; end if;
    if exists (select 1 from gw_queue where event_id = ev and status <> 'leased') then raise exception 'C% copy acked', n + 1; end if;
    if exists (select 1 from gw_projections where aggregate_id = inst and (apply_count <> n - 1 or (source_revisions->>'autolabels:vehicle_instance')::int <> n - 1))
      then raise exception 'C% projection advanced without ACK', n + 1; end if;
    if exists (select 1 from gw_evidence where event_id = ev) then raise exception 'C% evidence survived', n + 1; end if;
    update gw_queue set lease_until = clock_timestamp() - interval '1 second' where event_id = ev and status = 'leased';
    for qid in 1..5 loop perform gw_worker_step('w-r' || n, 100, 50); end loop;
    if (select count(*) from gw_queue where event_id = ev and status = 'delivered' and attempts = 2) <> 2
       or (select count(*) from gw_inbox where event_id = ev and result = 'applied') <> 2
       or exists (select 1 from gw_projections where aggregate_id = inst and (apply_count <> n or (source_revisions->>'autolabels:vehicle_instance')::int <> n))
      then raise exception 'C% recovery', n + 1; end if;
    passed := passed + 1;
  end loop;

  -- C5 crash after ACK: commit happened, worker died before reporting; transport redelivers -> duplicate, no second effect
  ev := gen_random_uuid(); ids := ids || ev; k := k + 1;
  r := gw_dev_ingest('labels-nw-k1', 'nonce-rc-' || run || '-' || k || '-aaaa', now(), repeat('0',64), base || jsonb_build_object('event_id', ev,
    'aggregate', jsonb_build_object('type','vehicle_instance','id',inst,'revision',4), 'payload', '{"mileage":4}'::jsonb));
  perform gw_claim('w-c5', 50, 30, 50);
  for qid in select id from gw_queue where event_id = ev loop
    if gw_ack(qid, 'w-c5') <> 'delivered' then raise exception 'C5 ack'; end if;
  end loop;
  select id into qid from gw_queue where event_id = ev and target_app = 'autofilm';
  update gw_queue set status = 'pending', delivered_at = null, available_at = now(), leased_by = null where id = qid;  -- redelivery
  for n in 1..5 loop perform gw_worker_step('w-c5b', 100, 50); end loop;
  if (select status from gw_queue where id = qid) <> 'duplicate'
     or (select apply_count from gw_projections where aggregate_id = inst and target_app = 'autofilm') <> 4
     or (select apply_count from gw_projections where aggregate_id = inst and target_app = 'autocurb') <> 4 then raise exception 'C5 second effect'; end if;
  if gw_ack(qid, 'w-c5') <> 'lost_lease' then raise exception 'C5 stale worker ACK not fenced'; end if;
  passed := passed + 1;

  -- N1 never-lose for every test event
  if (select count(*) from gw_outbox where event_id = any(ids)) <> array_length(ids, 1) then raise exception 'N1 outbox lost'; end if;
  if (select count(*) from gw_queue where event_id = any(ids)) <> 2 * array_length(ids, 1) then raise exception 'N1 fanout'; end if;
  if exists (select 1 from gw_queue where event_id = any(ids) and status not in ('delivered','duplicate')) then raise exception 'N1 non-terminal'; end if;
  if exists (select 1 from gw_queue q where q.event_id = any(ids)
             and (select count(*) from gw_inbox i where i.event_id = q.event_id and i.target_app = q.target_app) <> 1) then raise exception 'N1 inbox'; end if;
  r := gw_reconcile('grp-syn-northwind');
  if (select mismatches from gw_reconciliation_runs order by id desc limit 1) <> 0 or not (r->>'never_lose_ok')::boolean then
    raise exception 'N1 reconcile %', r - 'routes'; end if;
  passed := passed + 1;

  -- L1 late delivery + route vs source accounting (informational, not mismatches)
  r0 := r;
  ev := gen_random_uuid(); ids := ids || ev; k := k + 1;
  r := gw_dev_ingest('labels-nw-k1', 'nonce-rc-' || run || '-' || k || '-aaaa', now(), repeat('0',64), base || jsonb_build_object('event_id', ev,
    'aggregate', jsonb_build_object('type','vehicle_instance','id',inst,'revision',5), 'payload', '{"mileage":5}'::jsonb));
  update gw_queue set accepted_at = accepted_at - interval '5 minutes' where event_id = ev;
  for n in 1..3 loop perform gw_worker_step('w-l1', 100, 50); end loop;
  r := gw_reconcile('grp-syn-northwind');
  if (r->>'late_deliveries')::int <> (r0->>'late_deliveries')::int + 2 then raise exception 'L1 late % -> %', r0->'late_deliveries', r->'late_deliveries'; end if;
  if (r->>'source_events')::int <> (r0->>'source_events')::int + 1 or (r->>'route_copies')::int <> (r0->>'route_copies')::int + 2 then
    raise exception 'L1 source vs route counts'; end if;
  if (r->'routes'->'labels->film'->>'late_delivered')::int <> coalesce((r0->'routes'->'labels->film'->>'late_delivered')::int, 0) + 1 then raise exception 'L1 route late'; end if;
  if (select mismatches from gw_reconciliation_runs order by id desc limit 1) <> 0 then raise exception 'L1 late counted as mismatch'; end if;
  passed := passed + 1;

  -- P1 synthetic poison DLQ distinct and durable
  ev := gen_random_uuid(); k := k + 1;
  r := gw_dev_ingest('labels-nw-k1', 'nonce-rc-' || run || '-' || k || '-aaaa', now(), repeat('0',64), base || jsonb_build_object('event_id', ev,
    'vehicle', jsonb_build_object('vin','DEVSYN00000000778','instance_id',inst2,'episode_id','ep-recov-' || run || '-b-1'),
    'aggregate', jsonb_build_object('type','vehicle_instance','id',inst2,'revision',1), 'payload', '{"_synthetic_fault":"poison"}'::jsonb));
  for n in 1..3 loop perform gw_worker_step('w-p1', 100, 50); end loop;
  r := gw_reconcile('grp-syn-northwind');
  if (r->'dlq'->>'poison')::int <> poison0 + 2 or (r->>'dead_without_dead_letter')::int <> 0
     or (select mismatches from gw_reconciliation_runs order by id desc limit 1) <> 0 then raise exception 'P1 %', r->'dlq'; end if;
  passed := passed + 1;

  -- V1 detectors are not vacuous (each corruption inside a rolled-back sub-block)
  select id into qid from gw_queue where event_id = ids[1] and target_app = 'autofilm';
  begin delete from gw_inbox where event_id = ids[1] and target_app = 'autofilm'; r := gw_reconcile('grp-syn-northwind'); raise exception 'V_RB'; exception when others then if sqlerrm <> 'V_RB' then raise; end if; end;
  if (r->>'delivered_without_inbox')::int < 1 or (r->>'terminal_without_inbox')::int < 1 or (r->>'never_lose_ok')::boolean then raise exception 'V1 ack-without-inbox undetected'; end if;
  begin update gw_queue set status = 'skipped' where id = qid; r := gw_reconcile('grp-syn-northwind'); raise exception 'V_RB'; exception when others then if sqlerrm <> 'V_RB' then raise; end if; end;
  if (r->>'inbox_without_ack')::int < 1 or (r->>'never_lose_ok')::boolean then raise exception 'V1 inbox-without-ack undetected'; end if;
  begin delete from gw_dead_letters where event_id = ev; r := gw_reconcile('grp-syn-northwind'); raise exception 'V_RB'; exception when others then if sqlerrm <> 'V_RB' then raise; end if; end;
  if (r->>'dead_without_dead_letter')::int <> 2 then raise exception 'V1 dead-without-dlq undetected'; end if;
  begin delete from gw_queue where id = qid; r := gw_reconcile('grp-syn-northwind'); raise exception 'V_RB'; exception when others then if sqlerrm <> 'V_RB' then raise; end if; end;
  if (r->>'missing_fanout')::int < 1 or not (r->'missing_fanout_keys' @> jsonb_build_array(jsonb_build_object('event_id', ids[1], 'route_id', 'labels->film'))) then raise exception 'V1 missing fanout undetected %', r->'missing_fanout_keys'; end if;
  begin update gw_queue set status = 'leased', leased_by = 'ghost', lease_until = now() - interval '1 minute' where id = qid; r := gw_reconcile('grp-syn-northwind'); raise exception 'V_RB'; exception when others then if sqlerrm <> 'V_RB' then raise; end if; end;
  if (r->>'stuck_messages')::int < 1 then raise exception 'V1 stuck undetected'; end if;
  r := gw_reconcile('grp-syn-northwind');
  if (select mismatches from gw_reconciliation_runs order by id desc limit 1) <> 0 then raise exception 'V1 rollback left corruption'; end if;
  passed := passed + 1;

  -- X1 cross-tenant
  ev := gen_random_uuid(); k := k + 1;
  r := gw_dev_ingest('labels-nw-k1', 'nonce-rc-' || run || '-' || k || '-aaaa', now(), repeat('0',64), base || jsonb_build_object('event_id', ev,
    'aggregate', jsonb_build_object('type','vehicle_instance','id',inst,'revision',6), 'payload', '{"mileage":6}'::jsonb));
  perform set_config('request.jwt.claims', json_build_object('sub', ub, 'role', 'authenticated')::text, true);
  begin perform gw_reconcile('grp-syn-northwind'); raise exception 'X1 non-member reconciled'; exception when others then if sqlerrm <> 'forbidden' then raise; end if; end;
  r := gw_reconcile('grp-syn-lakeshore');
  if r::text like '%vi-recov-%' or r::text like '%nw-01%' then raise exception 'X1 northwind keys in lakeshore report'; end if;
  if (r->>'source_events')::int <> (select count(*) from gw_outbox where tenant_id = 'grp-syn-lakeshore') then raise exception 'X1 count scope'; end if;
  if (select mismatches from gw_reconciliation_runs order by id desc limit 1) <> 0 then raise exception 'X1 lakeshore mismatches %', r - 'routes'; end if;
  metrics := metrics || jsonb_build_object('r0_lakeshore_mismatches', 0);
  perform gw_worker_step('w-x1', 100, 50);
  if exists (select 1 from gw_queue where event_id = ev and status <> 'pending') then raise exception 'X1 lakeshore worker claimed northwind'; end if;
  set local role authenticated;
  select count(*) into n from gw_projections where aggregate_id = inst;
  reset role;
  if n <> 0 then raise exception 'X1 RLS leak %', n; end if;
  passed := passed + 1;

  raise exception 'GW_TESTS_PASSED: % | %', passed, metrics;
end $$;
