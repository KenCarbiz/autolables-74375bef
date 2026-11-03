-- Signed ingress (0014) + exactly-once effect + synthetic fault drills. One DO block, ALWAYS rolls back.
-- Run as a privileged DB session (gw_dev_ingest is service-role only). Success = 'GW_TESTS_PASSED: n | metrics'.
-- Drill timings are IN-TRANSACTION measurements on this DEV DB; the 30-minute pause is modelled by shifting
-- accepted_at, not by waiting 30 wall-clock minutes. DB-down/network-timeout are covered in TS (no way to kill the DB from inside it).
do $$
declare
  ua uuid := '00000000-0000-4000-a000-0000000000d1';
  -- Fresh per-run drill aggregates: shared-projection cleanup can create false recovery evidence.
  -- The original reported 16 were not captured; a reproduction does not establish their historical cause.
  run text := substr(md5(clock_timestamp()::text), 1, 8);
  inst text := 'vi-drill-' || run || '-a'; inst2 text := 'vi-drill-' || run || '-b'; tvin text := 'DEVSYN00000000401'; epi text := 'ep-drill-' || run || '-a-1';
  base jsonb; r jsonb; n int; n0 int; passed int := 0; e1 uuid := gen_random_uuid(); ev uuid; ids uuid[] := '{}';
  q_film bigint; ac0 int; t0 timestamptz; rto_ms numeric; rto2_ms numeric; steps int; lost int; metrics jsonb := '{}';
  pl jsonb := '{"status":"active","mileage":1200}';
begin
  insert into gw_tenant_members values (ua, 'grp-syn-northwind', 'admin', now()), (ua, 'grp-syn-lakeshore', 'admin', now()) on conflict do nothing;
  perform set_config('request.jwt.claims', json_build_object('sub', ua, 'role', 'authenticated')::text, true);
  update gw_queue set status = 'skipped' where status in ('pending','retry','leased','held');
  update gw_circuit_breakers set consecutive_failures = 0, state = 'closed', opened_at = null, forced_open = false;
  update gw_route_controls set enabled = true, killed = false, dry_run = false;
  update gw_settings set global_kill = false;
  base := jsonb_build_object('schema_version', 1, 'tenant_id', 'grp-syn-northwind', 'rooftop_id', 'rt-syn-nw-01',
    'vehicle', jsonb_build_object('vin', tvin, 'instance_id', inst, 'episode_id', epi), 'source_app', 'autolabels',
    'event_type', 'inventory.updated', 'occurred_at', now(), 'emitted_at', now(), 'correlation_id', gen_random_uuid(), 'trace_id', 'trc-syn-1');

  -- I1 accepted
  r := gw_dev_ingest('labels-nw-k1', 'nonce-i1-aaaaaaaaaaaa', now(), repeat('0',64), base || jsonb_build_object('event_id', e1, 'aggregate', jsonb_build_object('type','vehicle_instance','id',inst,'revision',1), 'payload', pl));
  if (r->>'http_status')::int <> 202 then raise exception 'I1 %', r; end if;
  if not exists (select 1 from gw_ingest_receipts where event_id = e1 and decision = 'accepted' and trace_id = 'trc-syn-1' and correlation_id is not null) then raise exception 'I1 receipt'; end if;
  passed := passed + 1;
  select count(*) into n0 from gw_outbox;

  -- I2 nonce replay (same signed request re-sent)
  r := gw_dev_ingest('labels-nw-k1', 'nonce-i1-aaaaaaaaaaaa', now(), repeat('0',64), base || jsonb_build_object('event_id', e1, 'aggregate', jsonb_build_object('type','vehicle_instance','id',inst,'revision',1), 'payload', pl));
  if r->>'reason' <> 'nonce replay' or (r->>'http_status')::int <> 409 then raise exception 'I2 %', r; end if; passed := passed + 1;
  -- I3 at-least-once redelivery with a fresh nonce: idempotent duplicate
  r := gw_dev_ingest('labels-nw-k1', 'nonce-i3-aaaaaaaaaaaa', now(), repeat('0',64), base || jsonb_build_object('event_id', e1, 'aggregate', jsonb_build_object('type','vehicle_instance','id',inst,'revision',1), 'payload', pl));
  if r->>'decision' <> 'duplicate' or (r->>'http_status')::int <> 200 then raise exception 'I3 %', r; end if; passed := passed + 1;
  -- I4 same event_id, different canonical payload -> 409 conflict
  r := gw_dev_ingest('labels-nw-k1', 'nonce-i4-aaaaaaaaaaaa', now(), repeat('0',64), base || jsonb_build_object('event_id', e1, 'aggregate', jsonb_build_object('type','vehicle_instance','id',inst,'revision',1), 'payload', '{"status":"sold"}'::jsonb));
  if r->>'decision' <> 'conflict' or (r->>'http_status')::int <> 409 then raise exception 'I4 %', r; end if; passed := passed + 1;
  -- I5 revoked key, I6 expired key, I7 stale timestamp, I8 wrong tenant, I9 rooftop not bound / mapping lost
  r := gw_dev_ingest('labels-nw-revoked', 'nonce-i5-aaaaaaaaaaaa', now(), repeat('0',64), base || jsonb_build_object('event_id', gen_random_uuid(), 'aggregate', jsonb_build_object('type','vehicle_instance','id',inst,'revision',50), 'payload', pl));
  if r->>'reason' <> 'revoked key' then raise exception 'I5 %', r; end if;
  r := gw_dev_ingest('film-ls-expired', 'nonce-i6-aaaaaaaaaaaa', now(), repeat('0',64), base || jsonb_build_object('event_id', gen_random_uuid(), 'aggregate', jsonb_build_object('type','vehicle_instance','id',inst,'revision',50), 'payload', pl));
  if r->>'reason' <> 'key outside validity window' then raise exception 'I6 %', r; end if;
  r := gw_dev_ingest('labels-nw-k1', 'nonce-i7-aaaaaaaaaaaa', now() - interval '400 seconds', repeat('0',64), base || jsonb_build_object('event_id', gen_random_uuid(), 'aggregate', jsonb_build_object('type','vehicle_instance','id',inst,'revision',50), 'payload', pl));
  if r->>'reason' not like 'timestamp%' then raise exception 'I7 %', r; end if;
  r := gw_dev_ingest('labels-nw-k1', 'nonce-i8-aaaaaaaaaaaa', now(), repeat('0',64), base || jsonb_build_object('event_id', gen_random_uuid(), 'tenant_id', 'grp-syn-lakeshore', 'rooftop_id', 'rt-syn-ls-01', 'aggregate', jsonb_build_object('type','vehicle_instance','id',inst,'revision',50), 'payload', pl));
  if r->>'reason' <> 'key not bound to tenant' or (r->>'http_status')::int <> 403 then raise exception 'I8 %', r; end if;
  r := gw_dev_ingest('labels-nw-k1', 'nonce-i8b-aaaaaaaaaaa', now(), repeat('0',64), base || jsonb_build_object('event_id', gen_random_uuid(), 'source_app', 'autofilm', 'event_type', 'video.engagement', 'aggregate', jsonb_build_object('type','vehicle_instance','id',inst,'revision',50), 'payload', pl));
  if r->>'reason' <> 'key not bound to source_app' then raise exception 'I8b %', r; end if;
  update gw_ingest_keys set rooftop_ids = '{}' where key_id = 'curb-nw-k1';  -- tenant mapping loss
  r := gw_dev_ingest('curb-nw-k1', 'nonce-i9-aaaaaaaaaaaa', now(), repeat('0',64), base || jsonb_build_object('event_id', gen_random_uuid(), 'source_app', 'autocurb', 'event_type', 'appraisal.completed', 'aggregate', jsonb_build_object('type','vehicle_instance','id',inst,'revision',50), 'payload', '{"value_band":"B"}'::jsonb));
  if r->>'reason' not like 'key not bound to rooftop%' then raise exception 'I9 %', r; end if;
  r := gw_dev_ingest('nope', 'nonce-i9b-aaaaaaaaaaa', now(), repeat('0',64), base);
  if r->>'reason' <> 'unknown key' then raise exception 'I9b %', r; end if;
  select count(*) into n from gw_outbox; if n <> n0 then raise exception 'I2-I9 denials mutated outbox (% -> %)', n0, n; end if;
  if exists (select 1 from gw_ingest_nonces where nonce in ('nonce-i5-aaaaaaaaaaaa','nonce-i6-aaaaaaaaaaaa','nonce-i7-aaaaaaaaaaaa','nonce-i8-aaaaaaaaaaaa','nonce-i9-aaaaaaaaaaaa')) then
    raise exception 'denied request consumed a nonce'; end if;
  passed := passed + 1;
  -- I10 out-of-order / stale revision
  r := gw_dev_ingest('labels-nw-k2', 'nonce-i10-aaaaaaaaaaa', now(), repeat('0',64), base || jsonb_build_object('event_id', gen_random_uuid(), 'aggregate', jsonb_build_object('type','vehicle_instance','id',inst,'revision',1), 'payload', pl));
  if r->>'decision' <> 'stale' then raise exception 'I10 %', r; end if; passed := passed + 1;
  -- I11 direct call from an authenticated role is impossible (service-role only)
  if has_function_privilege('authenticated', 'public.gw_dev_ingest(text,text,timestamptz,text,jsonb)', 'execute')
     or has_function_privilege('anon', 'public.gw_dev_ingest(text,text,timestamptz,text,jsonb)', 'execute') then raise exception 'I11 privilege'; end if;
  if has_table_privilege('authenticated', 'public.gw_ingest_nonces', 'select') then raise exception 'I11 nonces readable'; end if;
  passed := passed + 1;

  -- E1 crash between processing and ACK + stale-lease fencing + two workers racing
  select id into q_film from gw_queue where event_id = e1 and target_app = 'autofilm';
  perform gw_claim('w-a', 50, 30, 50);
  if (select leased_by from gw_queue where id = q_film) <> 'w-a' then raise exception 'E1 claim'; end if;
  perform gw_claim('w-b', 50, 30, 50);           -- racing worker cannot take a live lease
  if (select leased_by from gw_queue where id = q_film) <> 'w-a' then raise exception 'E1 race stole lease'; end if;
  update gw_queue set lease_until = clock_timestamp() - interval '1 second' where id = q_film;  -- w-a "crashes" before ACK
  perform gw_claim('w-b', 50, 30, 50);
  if (select leased_by from gw_queue where id = q_film) <> 'w-b' then raise exception 'E1 re-lease'; end if;
  if gw_ack(q_film, 'w-a') <> 'lost_lease' then raise exception 'E1 fencing'; end if;
  if gw_ack(q_film, 'w-b') <> 'delivered' then raise exception 'E1 ack'; end if;
  -- w-a also leased the autocurb copy and "crashed": that lane stays blocked until its lease expires (RTO bound = lease_s).
  update gw_queue set lease_until = clock_timestamp() - interval '1 second' where status = 'leased' and leased_by = 'w-a';
  select apply_count into ac0 from gw_projections where aggregate_id = inst and target_app = 'autofilm';
  if ac0 <> 1 then raise exception 'E1 apply_count %', ac0; end if;
  update gw_queue set status = 'pending', delivered_at = null, available_at = now() where id = q_film;  -- transport redelivers
  perform gw_worker_step('w-c', 100, 50);
  if (select status from gw_queue where id = q_film) <> 'duplicate'
     or (select apply_count from gw_projections where aggregate_id = inst and target_app = 'autofilm') <> 1 then raise exception 'E1 redelivery applied twice'; end if;
  perform gw_worker_step('w-c', 100, 50);
  passed := passed + 1;

  -- D1 30-minute pause (kill switch) and recovery: RPO (accepted-but-lost) must be 0; RTO measured
  perform gw_set_global_kill(true);
  for n in 2..4 loop
    ev := gen_random_uuid(); ids := ids || ev;
    r := gw_dev_ingest('labels-nw-k1', 'nonce-d1-' || n || '-aaaaaaaaaa', now(), repeat('0',64), base || jsonb_build_object('event_id', ev, 'aggregate', jsonb_build_object('type','vehicle_instance','id',inst,'revision',n), 'payload', jsonb_build_object('mileage', 1200 + n)));
    if r->>'decision' <> 'accepted' then raise exception 'D1 ingest during pause %', r; end if;
  end loop;
  perform gw_worker_step('w-d', 100, 50);
  select count(*) into n from gw_queue where event_id = any(ids) and status = 'delivered';
  if n <> 0 then raise exception 'D1 delivered during pause %', n; end if;
  update gw_queue set accepted_at = accepted_at - interval '30 minutes' where event_id = any(ids);
  perform gw_set_global_kill(false);
  t0 := clock_timestamp();
  perform gw_release_held('grp-syn-northwind');
  steps := 0;
  while exists (select 1 from gw_queue where event_id = any(ids) and status in ('pending','retry','leased','held')) and steps < 30 loop
    perform gw_worker_step('w-d', 100, 50); steps := steps + 1;
  end loop;
  rto_ms := extract(epoch from clock_timestamp() - t0) * 1000;
  select 3 - count(*) into lost from gw_outbox where event_id = any(ids);
  select count(*) into n from gw_queue where event_id = any(ids) and status = 'delivered';
  if lost <> 0 or n <> 6 then raise exception 'D1 lost % delivered % statuses %', lost, n, (select jsonb_agg(jsonb_build_object('t',target_app,'s',status,'e',left(last_error,80))) from gw_queue where event_id = any(ids)); end if;
  if (select (source_revisions->>'autolabels:vehicle_instance')::int from gw_projections where aggregate_id = inst and target_app = 'autocurb') <> 4 then raise exception 'D1 order'; end if;
  metrics := metrics || jsonb_build_object('d1_rto_ms', round(rto_ms, 1), 'd1_steps', steps, 'd1_rpo_lost_events', lost,
    'd1_max_lag_s', (select round(max(extract(epoch from delivered_at - accepted_at))) from gw_queue where event_id = any(ids)));
  r := gw_reconcile('grp-syn-northwind');
  -- Hard gate (was informational): whole-tenant reconcile after the drill must have zero invariant mismatches.
  if (select mismatches from gw_reconciliation_runs order by id desc limit 1) <> 0 or not (r->>'never_lose_ok')::boolean then
    raise exception 'D1 reconcile mismatches % behind_keys %', r - 'routes' - 'projection_behind_keys', r->'projection_behind_keys'; end if;
  metrics := metrics || jsonb_build_object('reconcile_mismatches', 0, 'late_deliveries', r->'late_deliveries');
  passed := passed + 1;

  -- D2 provider outage on one destination: others keep flowing; recovery after breaker closes
  perform gw_set_breaker('grp-syn-northwind', 'autofilm', true);
  ev := gen_random_uuid();
  r := gw_dev_ingest('labels-nw-k1', 'nonce-d2-aaaaaaaaaaaa', now(), repeat('0',64), base || jsonb_build_object('event_id', ev, 'aggregate', jsonb_build_object('type','vehicle_instance','id',inst,'revision',5), 'payload', '{"mileage":1300}'::jsonb));
  perform gw_worker_step('w-e', 100, 50);
  if (select status from gw_queue where event_id = ev and target_app = 'autocurb') <> 'delivered' then raise exception 'D2 healthy destination blocked'; end if;
  if (select status from gw_queue where event_id = ev and target_app = 'autofilm') = 'delivered' then raise exception 'D2 open breaker delivered'; end if;
  perform gw_set_breaker('grp-syn-northwind', 'autofilm', false);
  t0 := clock_timestamp();
  update gw_queue set available_at = now() where event_id = ev and status = 'retry';
  steps := 0;
  while (select status from gw_queue where event_id = ev and target_app = 'autofilm') <> 'delivered' and steps < 10 loop
    perform gw_worker_step('w-e', 100, 50); steps := steps + 1;
  end loop;
  rto2_ms := extract(epoch from clock_timestamp() - t0) * 1000;
  if (select status from gw_queue where event_id = ev and target_app = 'autofilm') <> 'delivered' then raise exception 'D2 no recovery'; end if;
  metrics := metrics || jsonb_build_object('d2_rto_ms', round(rto2_ms, 1), 'd2_steps', steps);
  passed := passed + 1;

  -- D3 poison isolation: a poison copy dead-letters without blocking another lane
  ev := gen_random_uuid();
  r := gw_dev_ingest('labels-nw-k1', 'nonce-d3-aaaaaaaaaaaa', now(), repeat('0',64), base || jsonb_build_object('event_id', ev,
    'vehicle', jsonb_build_object('vin','DEVSYN00000000402','instance_id',inst2,'episode_id','ep-drill-' || run || '-b-1'),
    'aggregate', jsonb_build_object('type','vehicle_instance','id',inst2,'revision', 900), 'payload', '{"_synthetic_fault":"poison"}'::jsonb));
  if r->>'decision' <> 'accepted' then raise exception 'D3 %', r; end if;
  e1 := gen_random_uuid();
  r := gw_dev_ingest('labels-nw-k1', 'nonce-d3b-aaaaaaaaaaa', now(), repeat('0',64), base || jsonb_build_object('event_id', e1, 'aggregate', jsonb_build_object('type','vehicle_instance','id',inst,'revision',6), 'payload', '{"mileage":1400}'::jsonb));
  perform gw_worker_step('w-f', 100, 50); perform gw_worker_step('w-f', 100, 50);
  select count(*) into n from gw_queue where event_id = ev and status = 'dead';
  if n <> 2 then raise exception 'D3 poison not dead-lettered %', n; end if;
  select count(*) into n from gw_queue where event_id = e1 and status = 'delivered';
  if n <> 2 then raise exception 'D3 healthy lane blocked %', n; end if;
  passed := passed + 1;

  -- O1 ops snapshot is RLS-scoped: a non-member sees no queue rows
  perform set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-4000-a000-0000000000d9', 'role', 'authenticated')::text, true);
  set local role authenticated;
  r := gw_ops_snapshot();
  reset role;
  if r->'queue' <> '{}'::jsonb or (r->>'dlq_unresolved')::int <> 0 or (r->>'ingest_total_15m')::int <> 0 then raise exception 'O1 leakage %', r; end if;
  if (r->>'external_delivery_enabled')::boolean then raise exception 'O1 external on'; end if;
  passed := passed + 1;

  raise exception 'GW_TESTS_PASSED: % | %', passed, metrics;
end $$;
