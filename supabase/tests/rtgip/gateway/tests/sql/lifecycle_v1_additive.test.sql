-- Migration 0010 additive lifecycle events, refs metadata and per-episode listing state machine.
-- One DO block that ALWAYS rolls back (final RAISE). Success = 'GW_LIFECYCLE_TESTS_PASSED: 22'. Synthetic data only.
do $$
declare
  ua uuid := '00000000-0000-4000-a000-0000000000c1';
  passed int := 0; r jsonb; n int; s text; st jsonb; i int; ids uuid[] := '{}';
  tvin text := 'DEVSYNLC000000001';
  ia text := 'vi-lc-nw-a'; ib text := 'vi-lc-ls-b'; ic text := 'vi-lc-nw-c';
  e1 text := 'ep-lc-nw-a-1'; e2 text := 'ep-lc-nw-a-2';
  lab jsonb; film jsonb; ev uuid;
begin
  insert into gw_tenant_members values (ua, 'grp-syn-northwind', 'admin', now()), (ua, 'grp-syn-lakeshore', 'admin', now())
    on conflict do nothing;
  perform set_config('request.jwt.claims', json_build_object('sub', ua, 'role', 'authenticated')::text, true);
  update gw_queue set status = 'skipped' where status in ('pending','retry','leased','held');
  update gw_circuit_breakers set consecutive_failures = 0, state = 'closed', opened_at = null, forced_open = false;
  update gw_route_controls set enabled = true, killed = false, dry_run = false;
  update gw_settings set global_kill = false;

  lab := jsonb_build_object('schema_version', 1, 'tenant_id', 'grp-syn-northwind', 'rooftop_id', 'rt-syn-nw-01',
    'vehicle', jsonb_build_object('vin', tvin, 'instance_id', ia, 'episode_id', e1),
    'source_app', 'autolabels', 'occurred_at', now(), 'emitted_at', now());
  film := lab || jsonb_build_object('source_app', 'autofilm', 'vehicle', jsonb_build_object('vin', tvin, 'instance_id', ia));

  -- L1 catalog: 13 allowlisted types incl. the 4 additive ones; 8 routes all enabled locally
  select count(*) into n from gw_source_allowlist; if n <> 13 then raise exception 'L1 allowlist %', n; end if;
  select count(*) into n from gw_source_allowlist where event_type in ('listing.delivered','listing.archived','sale.voided','service.repair_verified');
  if n <> 4 then raise exception 'L1 new types %', n; end if;
  select count(*) into n from gw_routes where enabled; if n <> 8 then raise exception 'L1 routes %', n; end if;
  passed := passed + 1;

  -- L2..L8 publish-time semantic rejections (nothing relabelled, nothing accepted)
  r := gw_publish(lab || jsonb_build_object('event_id', gen_random_uuid(), 'event_type', 'listing.delivered',
    'vehicle', jsonb_build_object('vin', tvin, 'instance_id', ia), 'aggregate', jsonb_build_object('type','vehicle_instance','id',ia,'revision',50), 'payload', '{}'::jsonb));
  if r->>'reason' not like 'lifecycle event listing.delivered requires%' then raise exception 'L2 %', r; end if; passed := passed + 1;
  r := gw_publish(lab || jsonb_build_object('event_id', gen_random_uuid(), 'event_type', 'sale.voided',
    'aggregate', jsonb_build_object('type','vehicle_instance','id',ia,'revision',50), 'payload', '{}'::jsonb));
  if r->>'reason' <> 'sale.voided requires payload.void_reason' then raise exception 'L3 %', r; end if; passed := passed + 1;
  r := gw_publish(film || jsonb_build_object('event_id', gen_random_uuid(), 'event_type', 'service.repair_verified',
    'refs', jsonb_build_object('evidence_refs', jsonb_build_array('evd-1')),
    'aggregate', jsonb_build_object('type','vehicle_instance','id',ia,'revision',50), 'payload', '{"technician_verified":true}'::jsonb));
  if r->>'reason' <> 'service.repair_verified requires refs.service_visit_ref' then raise exception 'L4 %', r; end if; passed := passed + 1;
  r := gw_publish(film || jsonb_build_object('event_id', gen_random_uuid(), 'event_type', 'service.repair_verified',
    'refs', jsonb_build_object('service_visit_ref', 'ro-lc-1', 'evidence_refs', '[]'::jsonb),
    'aggregate', jsonb_build_object('type','vehicle_instance','id',ia,'revision',50), 'payload', '{"technician_verified":true}'::jsonb));
  if r->>'reason' <> 'service.repair_verified requires non-empty refs.evidence_refs' then raise exception 'L5 %', r; end if; passed := passed + 1;
  r := gw_publish(film || jsonb_build_object('event_id', gen_random_uuid(), 'event_type', 'service.repair_verified',
    'refs', jsonb_build_object('service_visit_ref', 'ro-lc-1', 'evidence_refs', jsonb_build_array('evd-1')),
    'aggregate', jsonb_build_object('type','vehicle_instance','id',ia,'revision',50), 'payload', '{"technician_verified":false}'::jsonb));
  if r->>'reason' <> 'service.repair_verified requires payload.technician_verified=true' then raise exception 'L6 %', r; end if; passed := passed + 1;
  r := gw_publish(film || jsonb_build_object('event_id', gen_random_uuid(), 'event_type', 'service.mpi_verified',
    'aggregate', jsonb_build_object('type','vehicle_instance','id',ia,'revision',50), 'payload', '{"technician_verified":false}'::jsonb));
  if r->>'reason' not like 'service.mpi_verified with technician_verified%' then raise exception 'L7 %', r; end if; passed := passed + 1;
  r := gw_publish(lab || jsonb_build_object('event_id', gen_random_uuid(), 'event_type', 'inventory.updated', 'refs', '{"customer_name":"x"}'::jsonb,
    'aggregate', jsonb_build_object('type','vehicle_instance','id',ia,'revision',50), 'payload', '{}'::jsonb));
  if r->>'reason' not like 'refs: unknown key%' then raise exception 'L8 %', r; end if; passed := passed + 1;
  select count(*) into n from gw_outbox where aggregate_id = ia; if n <> 0 then raise exception 'L2-8 leaked % rows', n; end if;

  -- inventory rev1, then delivered BEFORE sold (rev2)
  r := gw_publish(lab || jsonb_build_object('event_id', gen_random_uuid(), 'event_type', 'inventory.updated',
    'aggregate', jsonb_build_object('type','vehicle_instance','id',ia,'revision',1), 'payload', '{"status":"active"}'::jsonb));
  for i in 1..3 loop perform gw_worker_step('lc-w', 100, 50); end loop;
  ev := gen_random_uuid();
  r := gw_publish(lab || jsonb_build_object('event_id', ev, 'event_type', 'listing.delivered',
    'aggregate', jsonb_build_object('type','vehicle_instance','id',ia,'revision',2), 'payload', '{}'::jsonb));
  if r->>'status' <> 'accepted' or (r->>'fanout')::int <> 2 then raise exception 'L9 publish %', r; end if;
  for i in 1..3 loop perform gw_worker_step('lc-w', 100, 50); end loop;
  -- L9 quarantined on both targets, no inbox row, no breaker penalty, listing untouched
  select count(*) into n from gw_dead_letters where event_id = ev and reason like 'INVARIANT: listing.delivered requires sold%';
  if n <> 2 then raise exception 'L9 dlq %', n; end if;
  if exists (select 1 from gw_inbox where event_id = ev) then raise exception 'L9 inbox row'; end if;
  if exists (select 1 from gw_circuit_breakers where tenant_id = 'grp-syn-northwind' and consecutive_failures > 0) then raise exception 'L9 breaker'; end if;
  select state->'listing'->>'status' into s from gw_projections where target_app = 'autofilm' and aggregate_id = ia;
  if s <> 'active' then raise exception 'L9 status %', s; end if; passed := passed + 1;

  -- L10 sold (rev3) then voided (rev4) -> active again, lifecycle history kept
  r := gw_publish(lab || jsonb_build_object('event_id', gen_random_uuid(), 'event_type', 'listing.sold',
    'aggregate', jsonb_build_object('type','vehicle_instance','id',ia,'revision',3), 'payload', '{"sold_at":"2026-10-01"}'::jsonb));
  for i in 1..3 loop perform gw_worker_step('lc-w', 100, 50); end loop;
  r := gw_publish(lab || jsonb_build_object('event_id', gen_random_uuid(), 'event_type', 'sale.voided',
    'aggregate', jsonb_build_object('type','vehicle_instance','id',ia,'revision',4), 'payload', '{"void_reason":"financing_declined"}'::jsonb));
  for i in 1..3 loop perform gw_worker_step('lc-w', 100, 50); end loop;
  select state->'listing' into st from gw_projections where target_app = 'autocurb' and aggregate_id = ia;
  if st->>'status' <> 'active' or (st->>'sale_voided')::boolean is not true or jsonb_array_length(st->'lifecycle') <> 2 then raise exception 'L10 %', st; end if;
  passed := passed + 1;

  -- L11 sold again (rev5) then delivered (rev6) -> delivered, sold_at retained, delivered distinct from sold
  r := gw_publish(lab || jsonb_build_object('event_id', gen_random_uuid(), 'event_type', 'listing.sold',
    'aggregate', jsonb_build_object('type','vehicle_instance','id',ia,'revision',5), 'payload', '{"sold_at":"2026-10-05"}'::jsonb));
  for i in 1..3 loop perform gw_worker_step('lc-w', 100, 50); end loop;
  r := gw_publish(lab || jsonb_build_object('event_id', gen_random_uuid(), 'event_type', 'listing.delivered',
    'aggregate', jsonb_build_object('type','vehicle_instance','id',ia,'revision',6), 'payload', '{"delivered_at":"2026-10-07"}'::jsonb));
  for i in 1..3 loop perform gw_worker_step('lc-w', 100, 50); end loop;
  select state->'listing' into st from gw_projections where target_app = 'autofilm' and aggregate_id = ia;
  if st->>'status' <> 'delivered' or st->>'sold_at' <> '2026-10-05' or st->>'delivered_at' <> '2026-10-07' then raise exception 'L11 %', st; end if;
  passed := passed + 1;

  -- L12 void after delivery is quarantined, status stays delivered
  ev := gen_random_uuid();
  r := gw_publish(lab || jsonb_build_object('event_id', ev, 'event_type', 'sale.voided',
    'aggregate', jsonb_build_object('type','vehicle_instance','id',ia,'revision',7), 'payload', '{"void_reason":"late"}'::jsonb));
  for i in 1..3 loop perform gw_worker_step('lc-w', 100, 50); end loop;
  select count(*) into n from gw_dead_letters where event_id = ev and reason like 'INVARIANT: sale.voided%';
  select state->'listing'->>'status' into s from gw_projections where target_app = 'autofilm' and aggregate_id = ia;
  if n <> 2 or s <> 'delivered' then raise exception 'L12 % %', n, s; end if; passed := passed + 1;

  -- L13 later inventory update in same episode cannot regress delivered
  r := gw_publish(lab || jsonb_build_object('event_id', gen_random_uuid(), 'event_type', 'inventory.updated',
    'aggregate', jsonb_build_object('type','vehicle_instance','id',ia,'revision',8), 'payload', '{"status":"active","mileage":9}'::jsonb));
  for i in 1..3 loop perform gw_worker_step('lc-w', 100, 50); end loop;
  select state->'listing'->>'status' into s from gw_projections where target_app = 'autofilm' and aggregate_id = ia;
  if s <> 'delivered' then raise exception 'L13 %', s; end if; passed := passed + 1;

  -- L14 sold -> MPI: verified MPI after sale lands, listing NOT reactivated
  r := gw_publish(film || jsonb_build_object('event_id', gen_random_uuid(), 'event_type', 'service.mpi_verified',
    'refs', jsonb_build_object('service_visit_ref', 'ro-lc-1', 'evidence_refs', jsonb_build_array('evd-mpi-1')),
    'aggregate', jsonb_build_object('type','vehicle_instance','id',ia,'revision',1), 'payload', '{"technician_verified":true,"points":42}'::jsonb));
  if r->>'status' <> 'accepted' then raise exception 'L14 publish %', r; end if;
  for i in 1..3 loop perform gw_worker_step('lc-w', 100, 50); end loop;
  select state into st from gw_projections where target_app = 'autocurb' and aggregate_id = ia;
  if st->'listing'->>'status' <> 'delivered' or st->'mpi'->>'service_visit_ref' <> 'ro-lc-1' then raise exception 'L14 %', st; end if;
  passed := passed + 1;

  -- L15 repair_verified keyed by visit, after sale, listing untouched
  r := gw_publish(film || jsonb_build_object('event_id', gen_random_uuid(), 'event_type', 'service.repair_verified',
    'refs', jsonb_build_object('service_visit_ref', 'ro-lc-1', 'evidence_refs', jsonb_build_array('evd-rep-1','evd-rep-2')),
    'aggregate', jsonb_build_object('type','vehicle_instance','id',ia,'revision',2), 'payload', '{"technician_verified":true,"op_code":"BRK"}'::jsonb));
  for i in 1..3 loop perform gw_worker_step('lc-w', 100, 50); end loop;
  select state into st from gw_projections where target_app = 'autocurb' and aggregate_id = ia;
  if st->'repair'->'ro-lc-1'->>'op_code' <> 'BRK' or jsonb_array_length(st->'repair'->'ro-lc-1'->'evidence_refs') <> 2
     or st->'listing'->>'status' <> 'delivered' then raise exception 'L15 %', st; end if;
  select count(*) into n from gw_projections where target_app = 'autolabels' and aggregate_id = ia and state->'repair' ? 'ro-lc-1';
  if n <> 1 then raise exception 'L15 labels %', n; end if; passed := passed + 1;

  -- L16 archive a delivered listing: keeps delivered status, marks archived
  r := gw_publish(lab || jsonb_build_object('event_id', gen_random_uuid(), 'event_type', 'listing.archived',
    'aggregate', jsonb_build_object('type','vehicle_instance','id',ia,'revision',9), 'payload', '{}'::jsonb));
  for i in 1..3 loop perform gw_worker_step('lc-w', 100, 50); end loop;
  select state->'listing' into st from gw_projections where target_app = 'autofilm' and aggregate_id = ia;
  if st->>'status' <> 'delivered' or (st->>'archived')::boolean is not true then raise exception 'L16 %', st; end if; passed := passed + 1;

  -- L17 new listing episode for the same instance starts clean; prior sold/delivered episode preserved in history
  r := gw_publish(lab || jsonb_build_object('event_id', gen_random_uuid(), 'event_type', 'inventory.updated',
    'vehicle', jsonb_build_object('vin', tvin, 'instance_id', ia, 'episode_id', e2),
    'aggregate', jsonb_build_object('type','vehicle_instance','id',ia,'revision',10), 'payload', '{"status":"active"}'::jsonb));
  for i in 1..3 loop perform gw_worker_step('lc-w', 100, 50); end loop;
  select state into st from gw_projections where target_app = 'autofilm' and aggregate_id = ia;
  if st->'listing'->>'status' <> 'active' or st->'listing'->>'episode_id' <> e2
     or st->'listing_history'->0->>'status' <> 'delivered' or st->'listing_history'->0->>'episode_id' <> e1 then raise exception 'L17 %', st; end if;
  passed := passed + 1;

  -- L18 archive unsold episode; inventory update afterwards cannot reactivate it
  r := gw_publish(lab || jsonb_build_object('event_id', gen_random_uuid(), 'event_type', 'listing.archived',
    'vehicle', jsonb_build_object('vin', tvin, 'instance_id', ia, 'episode_id', e2),
    'aggregate', jsonb_build_object('type','vehicle_instance','id',ia,'revision',11), 'payload', '{}'::jsonb));
  for i in 1..3 loop perform gw_worker_step('lc-w', 100, 50); end loop;
  r := gw_publish(lab || jsonb_build_object('event_id', gen_random_uuid(), 'event_type', 'inventory.updated',
    'vehicle', jsonb_build_object('vin', tvin, 'instance_id', ia, 'episode_id', e2),
    'aggregate', jsonb_build_object('type','vehicle_instance','id',ia,'revision',12), 'payload', '{"status":"active"}'::jsonb));
  for i in 1..3 loop perform gw_worker_step('lc-w', 100, 50); end loop;
  select state->'listing'->>'status' into s from gw_projections where target_app = 'autofilm' and aggregate_id = ia;
  if s <> 'archived' then raise exception 'L18 %', s; end if; passed := passed + 1;

  -- L19 same VIN, different tenant/rooftop: independent identity, instance and projection
  r := gw_publish(lab || jsonb_build_object('event_id', gen_random_uuid(), 'tenant_id', 'grp-syn-lakeshore', 'rooftop_id', 'rt-syn-ls-01',
    'event_type', 'listing.sold', 'vehicle', jsonb_build_object('vin', tvin, 'instance_id', ib, 'episode_id', 'ep-lc-ls-b-1'),
    'aggregate', jsonb_build_object('type','vehicle_instance','id',ib,'revision',1), 'payload', '{"sold_at":"2026-10-09"}'::jsonb));
  for i in 1..3 loop perform gw_worker_step('lc-w', 100, 50); end loop;
  select count(*) into n from gw_vehicle_identities where vin = tvin;
  select state->'listing'->>'status' into s from gw_projections where tenant_id = 'grp-syn-lakeshore' and target_app = 'autofilm' and aggregate_id = ib;
  if n <> 2 or s <> 'sold' then raise exception 'L19 % %', n, s; end if;
  select state->'listing'->>'status' into s from gw_projections where tenant_id = 'grp-syn-northwind' and target_app = 'autofilm' and aggregate_id = ia;
  if s <> 'archived' then raise exception 'L19 nw %', s; end if; passed := passed + 1;

  -- L20 cross-tenant instance reuse rejected
  r := gw_publish(lab || jsonb_build_object('event_id', gen_random_uuid(), 'event_type', 'listing.archived',
    'vehicle', jsonb_build_object('vin', tvin, 'instance_id', ib, 'episode_id', 'ep-lc-ls-b-1'),
    'aggregate', jsonb_build_object('type','vehicle_instance','id',ib,'revision',5), 'payload', '{}'::jsonb));
  if r->>'reason' <> 'instance belongs to another tenant or VIN' then raise exception 'L20 %', r; end if; passed := passed + 1;

  -- L21 stale lifecycle revision rejected at producer boundary
  r := gw_publish(lab || jsonb_build_object('event_id', gen_random_uuid(), 'event_type', 'listing.sold',
    'aggregate', jsonb_build_object('type','vehicle_instance','id',ia,'revision',5), 'payload', '{}'::jsonb));
  if r->>'status' <> 'stale' then raise exception 'L21 %', r; end if; passed := passed + 1;

  -- L22 all eight directions deliver locally (one event per source on a fresh instance)
  lab := lab || jsonb_build_object('vehicle', jsonb_build_object('vin', 'DEVSYNLC000000003', 'instance_id', ic, 'episode_id', 'ep-lc-nw-c-1'));
  ev := gen_random_uuid(); ids := ids || ev;
  r := gw_publish(lab || jsonb_build_object('event_id', ev, 'event_type', 'inventory.updated', 'aggregate', jsonb_build_object('type','vehicle_instance','id',ic,'revision',1), 'payload', '{"status":"active"}'::jsonb));
  ev := gen_random_uuid(); ids := ids || ev;
  r := gw_publish(lab || jsonb_build_object('event_id', ev, 'source_app', 'autofilm', 'event_type', 'video.engagement', 'aggregate', jsonb_build_object('type','vehicle_instance','id',ic,'revision',1), 'payload', '{"views":3}'::jsonb));
  ev := gen_random_uuid(); ids := ids || ev;
  r := gw_publish(lab || jsonb_build_object('event_id', ev, 'source_app', 'autocurb', 'event_type', 'appraisal.completed', 'aggregate', jsonb_build_object('type','vehicle_instance','id',ic,'revision',1), 'payload', '{"value_band":"B"}'::jsonb));
  ev := gen_random_uuid(); ids := ids || ev;
  r := gw_publish(lab || jsonb_build_object('event_id', ev, 'source_app', 'autoframe', 'event_type', 'media.approved', 'aggregate', jsonb_build_object('type','vehicle_instance','id',ic,'revision',1), 'payload', jsonb_build_object('media_id','med-lc-1','content_sha256',repeat('cd',32),'object_ref','objref:dev-synthetic-media/lc/med-lc-1.jpg','mime','image/jpeg','width',1600,'height',1200,'preset_version','studio-3','preset_order',0,'approval',jsonb_build_object('role','inventory_manager','approval_id','apr-lc-1','approved_at','2026-11-01T17:00:00Z'))));
  for i in 1..3 loop perform gw_worker_step('lc-w', 100, 50); end loop;
  select count(distinct route_id) into n from gw_queue where event_id = any(ids) and status = 'delivered';
  if n <> 8 then raise exception 'L22 routes delivered %', n; end if; passed := passed + 1;

  raise exception 'GW_LIFECYCLE_TESTS_PASSED: %', passed;
end $$;
