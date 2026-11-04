-- Scheduler fairness + lane ordering (DEV). One DO block, ALWAYS rolls back. Success = 'GW_TESTS_PASSED: n'.
-- Proves, at the DB claim layer the worker pool calls: (F1) per-tenant cap stops a hot tenant from
-- starving a cold one; (F2) a lane yields only its head, so N concurrent claimers cannot reorder it;
-- (F3) a second claimer gets disjoint rows (SKIP LOCKED, no double lease); (F4) applying heads
-- delivers each lane strictly in outbox_seq order across rounds.
do $$
declare
  ua uuid := '00000000-0000-4000-a000-0000000000aa';
  r jsonb; passed int := 0; ids1 bigint[]; ids2 bigint[]; i int; nw int; ls int; lane text; seqs bigint[];
  hot_lane text := 'fair-hot-lane-agg';
begin
  insert into gw_tenant_members values (ua, 'grp-syn-northwind', 'admin', now()), (ua, 'grp-syn-lakeshore', 'admin', now())
    on conflict do nothing;
  perform set_config('request.jwt.claims', json_build_object('sub', ua, 'role', 'authenticated')::text, true);
  update gw_queue set status = 'skipped' where status in ('pending','retry','leased','held');

  -- hot tenant: 20 independent aggregates; cold tenant: 3 aggregates; plus one hot lane with 3 revisions
  for i in 1..20 loop
    r := gw_publish(jsonb_build_object('event_id', gen_random_uuid(), 'schema_version', 1, 'tenant_id', 'grp-syn-northwind',
      'rooftop_id', 'rt-syn-nw-01', 'vehicle', jsonb_build_object('vin', 'DEVSYNFAR' || lpad(i::text, 8, '0'),
      'instance_id', 'fair-nw-' || i, 'episode_id', 'fair-nw-ep-' || i), 'source_app', 'autolabels', 'event_type', 'inventory.updated',
      'aggregate', jsonb_build_object('type', 'vehicle_instance', 'id', 'fair-nw-' || i, 'revision', 1),
      'occurred_at', now(), 'emitted_at', now(), 'payload', '{"status":"active"}'::jsonb));
    if r->>'status' <> 'accepted' then raise exception 'setup hot %: %', i, r; end if;
  end loop;
  for i in 1..3 loop
    r := gw_publish(jsonb_build_object('event_id', gen_random_uuid(), 'schema_version', 1, 'tenant_id', 'grp-syn-lakeshore',
      'rooftop_id', 'rt-syn-ls-01', 'vehicle', jsonb_build_object('vin', 'DEVSYNFLS' || lpad(i::text, 8, '0'),
      'instance_id', 'fair-ls-' || i, 'episode_id', 'fair-ls-ep-' || i), 'source_app', 'autolabels', 'event_type', 'inventory.updated',
      'aggregate', jsonb_build_object('type', 'vehicle_instance', 'id', 'fair-ls-' || i, 'revision', 1),
      'occurred_at', now(), 'emitted_at', now(), 'payload', '{"status":"active"}'::jsonb));
    if r->>'status' <> 'accepted' then raise exception 'setup cold %: %', i, r; end if;
  end loop;
  for i in 1..3 loop
    r := gw_publish(jsonb_build_object('event_id', gen_random_uuid(), 'schema_version', 1, 'tenant_id', 'grp-syn-northwind',
      'rooftop_id', 'rt-syn-nw-01', 'vehicle', jsonb_build_object('vin', 'DEVSYNFHL00000001',
      'instance_id', hot_lane, 'episode_id', hot_lane || '-ep'), 'source_app', 'autolabels', 'event_type', 'inventory.updated',
      'aggregate', jsonb_build_object('type', 'vehicle_instance', 'id', hot_lane, 'revision', i),
      'occurred_at', now(), 'emitted_at', now(), 'payload', jsonb_build_object('status', 'active', 'mileage', i)));
    if r->>'status' <> 'accepted' then raise exception 'setup lane %: %', i, r; end if;
  end loop;

  -- F1 fairness: batch 12, per-tenant cap 6 -> cold tenant's 6 copies (3 aggregates x 2 routes) all fit; hot capped at 6
  select array_agg(x) into ids1 from gw_claim('fair-w1', 12, 30, 6) x;
  select count(*) filter (where tenant_id = 'grp-syn-northwind'), count(*) filter (where tenant_id = 'grp-syn-lakeshore')
    into nw, ls from gw_queue where id = any(ids1);
  if nw > 6 or ls <> 6 then raise exception 'F1 fairness nw=% ls=%', nw, ls; end if; passed := passed + 1;

  -- F2 lane head only: no lane appears twice in one claim
  if exists (select lane_key from gw_queue where id = any(ids1) group by lane_key having count(*) > 1) then
    raise exception 'F2 lane yielded more than its head'; end if;
  -- and a second concurrent-style claim cannot take a later revision of a lane whose head is leased
  select array_agg(x) into ids2 from gw_claim('fair-w2', 100, 30, 100) x;
  if exists (select 1 from gw_queue a join gw_queue b on a.lane_key = b.lane_key
             where a.id = any(ids1) and b.id = any(ids2)) then
    raise exception 'F2 second claimer took a non-head row of a leased lane'; end if;
  if exists (select lane_key from gw_queue where id = any(ids2) group by lane_key having count(*) > 1) then
    raise exception 'F2b lane yielded more than its head'; end if;
  passed := passed + 1;

  -- F3 disjoint leases
  if ids1 && ids2 then raise exception 'F3 double lease'; end if; passed := passed + 1;

  -- F4 drain via worker_step; hot lane delivered strictly by outbox_seq
  update gw_queue set lease_until = clock_timestamp() - interval '1 second' where id = any(ids1 || ids2);
  for i in 1..10 loop
    r := gw_worker_step('fair-w3', 100, 50);
    exit when coalesce((r->>'claimed')::int, 0) = 0;
  end loop;
  for lane in select distinct lane_key from gw_queue where lane_key like '%|' || hot_lane loop
    select array_agg(outbox_seq order by delivered_at, id) into seqs from gw_queue where lane_key = lane and status = 'delivered';
    if coalesce(array_length(seqs, 1), 0) <> 3 or seqs <> (select array_agg(s order by s) from unnest(seqs) s) then
      raise exception 'F4 lane % order %', lane, seqs; end if;
  end loop;
  passed := passed + 1;

  raise exception 'GW_TESTS_PASSED: %', passed;
end $$;
