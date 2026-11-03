-- Phase 3B read contract (migrations 0017/0018). One DO block, ALWAYS rolls back. Success = 'GW_READ_TESTS_PASSED: n'.
-- Synthetic data only. Run as a privileged DB session (gw_read_fetch is service-role only).
do $$
declare
  ua uuid := '00000000-0000-4000-a000-0000000000e1';
  run text := replace(gen_random_uuid()::text, '-', '');
  tvin text := 'DEVSYNRD000000001'; ia text := 'vi-rd-nw-' || run; ib text := 'vi-rd-ls-' || run;
  e1 text := 'ep-rd-nw-' || run || '-1'; e2 text := 'ep-rd-nw-' || run || '-2'; els text := 'ep-rd-ls-' || run || '-1';
  lab jsonb; film jsonb; curb jsonb; frame jsonb; r jsonb; it jsonb; a jsonb; b jsonb; cp jsonb; n int; i int; passed int := 0;
  ev_sold uuid := gen_random_uuid(); ev_price uuid := gen_random_uuid(); ev_mpi uuid := gen_random_uuid();
  media jsonb;
begin
  insert into gw_tenant_members values (ua, 'grp-syn-northwind', 'admin', now()), (ua, 'grp-syn-lakeshore', 'admin', now()) on conflict do nothing;
  perform set_config('request.jwt.claims', json_build_object('sub', ua, 'role', 'authenticated')::text, true);
  update gw_queue set status = 'skipped' where status in ('pending','retry','leased','held');
  update gw_circuit_breakers set consecutive_failures = 0, state = 'closed', opened_at = null, forced_open = false;
  update gw_route_controls set enabled = true, killed = false, dry_run = false;
  update gw_settings set global_kill = false;

  lab := jsonb_build_object('schema_version', 1, 'tenant_id', 'grp-syn-northwind', 'rooftop_id', 'rt-syn-nw-01',
    'vehicle', jsonb_build_object('vin', tvin, 'instance_id', ia, 'episode_id', e1), 'source_app', 'autolabels', 'occurred_at', now(), 'emitted_at', now());
  film := lab || jsonb_build_object('source_app', 'autofilm', 'vehicle', jsonb_build_object('vin', tvin, 'instance_id', ia));
  curb := lab || jsonb_build_object('source_app', 'autocurb', 'vehicle', jsonb_build_object('vin', tvin, 'instance_id', ia));

  -- R0 source-authority registry (mirrors SOURCE_AUTHORITY in src/lib/gateway/readmodel.ts)
  select count(*) into n from gw_source_authority; if n <> 37 then raise exception 'R0 rows %', n; end if;
  select count(*) into n from gw_source_authority where not shareable; if n <> 3 then raise exception 'R0 nonshare %', n; end if;
  if exists (select 1 from gw_source_authority where classification in ('pii','finance') and shareable) then raise exception 'R0 pii shareable'; end if;
  if (select string_agg(distinct domain || '=' || owner_app, ',' order by domain || '=' || owner_app) from gw_source_authority)
     <> 'acquisition=autocurb,crm=autocurb,identity=autolabels,listing=autolabels,media=autoframe,service=autofilm,video=autofilm'
     then raise exception 'R0 owners'; end if;
  passed := passed + 1;

  -- fixtures: NW instance (episode 1) listed, repriced, sold; LS instance with the SAME VIN
  r := gw_publish(lab || jsonb_build_object('event_id', gen_random_uuid(), 'event_type', 'inventory.updated',
    'aggregate', jsonb_build_object('type','vehicle_instance','id',ia,'revision',1), 'payload', '{"status":"active","mileage":1000}'::jsonb));
  if r->>'status' <> 'accepted' then raise exception 'setup inv %', r; end if;
  update gw_listing_episodes set opened_at = now() - interval '2 days' where id = e1;
  r := gw_publish(lab || jsonb_build_object('event_id', ev_price, 'event_type', 'price.changed',
    'aggregate', jsonb_build_object('type','vehicle_instance','id',ia,'revision',2), 'payload', '{"price_cents":2400000}'::jsonb));
  r := gw_publish(lab || jsonb_build_object('event_id', ev_sold, 'event_type', 'listing.sold',
    'aggregate', jsonb_build_object('type','vehicle_instance','id',ia,'revision',3), 'payload', '{"sold_at":"2026-10-01"}'::jsonb));
  r := gw_publish(lab || jsonb_build_object('event_id', gen_random_uuid(), 'tenant_id', 'grp-syn-lakeshore', 'rooftop_id', 'rt-syn-ls-01',
    'vehicle', jsonb_build_object('vin', tvin, 'instance_id', ib, 'episode_id', els), 'event_type', 'inventory.updated',
    'aggregate', jsonb_build_object('type','vehicle_instance','id',ib,'revision',1), 'payload', '{"status":"active","mileage":5}'::jsonb));
  if r->>'status' <> 'accepted' then raise exception 'setup ls %', r; end if;
  for i in 1..6 loop perform gw_worker_step('rd-w', 200, 100); end loop;

  -- R1 fail-closed authorization: no business data, every attempt audited
  r := gw_read_fetch('nope-key', 'rdnonce' || md5(random()::text), now(), 'grp-syn-northwind', 'rt-syn-nw-01', 'service_lane', tvin);
  if r->>'reason' <> 'no app identity' or (r->>'http_status')::int <> 401 or r ? 'items' then raise exception 'R1a %', r; end if;
  r := gw_read_fetch('frame-nw-r1', 'rdnonce' || md5(random()::text), now(), 'grp-syn-northwind', 'rt-syn-nw-01', 'service_lane', tvin);
  if r->>'reason' <> 'no read grant for app identity' then raise exception 'R1b %', r; end if;
  r := gw_read_fetch('film-nw-r1', 'rdnonce' || md5(random()::text), now(), 'grp-syn-lakeshore', 'rt-syn-ls-01', 'service_lane', tvin);
  if r->>'reason' <> 'identity not bound to tenant' or (r->>'http_status')::int <> 403 then raise exception 'R1c %', r; end if;
  r := gw_read_fetch('curb-nw-k1', 'rdnonce' || md5(random()::text), now(), 'grp-syn-northwind', 'rt-syn-nw-03', 'appraisal_context', tvin);
  if r->>'reason' <> 'identity not bound to rooftop' then raise exception 'R1d %', r; end if;
  r := gw_read_fetch('film-nw-r1', 'rdnonce' || md5(random()::text), now(), 'grp-syn-northwind', 'rt-syn-nw-01', 'marketing', tvin);
  if r->>'reason' <> 'purpose not granted' then raise exception 'R1e %', r; end if;
  r := gw_read_fetch('film-nw-r1', 'rdnonce' || md5(random()::text), now(), 'grp-syn-northwind', 'rt-syn-nw-01', 'service_lane', null, 101);
  if r->>'reason' <> 'limit outside grant cap' then raise exception 'R1f %', r; end if;
  r := gw_read_fetch('film-nw-r1', 'rdnonce' || md5(random()::text), now() - interval '400 seconds', 'grp-syn-northwind', 'rt-syn-nw-01', 'service_lane', tvin);
  if r->>'reason' not like 'timestamp%' then raise exception 'R1g %', r; end if;
  r := gw_read_fetch('labels-nw-revoked', 'rdnonce' || md5(random()::text), now(), 'grp-syn-northwind', 'rt-syn-nw-01', 'listing_display', tvin);
  if r->>'reason' <> 'revoked key' then raise exception 'R1h %', r; end if;
  select count(*) into n from gw_read_audit where decision = 'denied' and created_at >= now(); if n < 8 then raise exception 'R1 audit %', n; end if;
  passed := passed + 1;

  -- R2 least privilege: browser roles cannot call the read fetch or write grants/audit
  if has_function_privilege('authenticated', 'public.gw_read_fetch(text,text,timestamptz,text,text,text,text,int,text,uuid)', 'execute')
     or has_function_privilege('anon', 'public.gw_read_fetch(text,text,timestamptz,text,text,text,text,int,text,uuid)', 'execute') then raise exception 'R2 exec'; end if;
  if has_table_privilege('authenticated', 'public.gw_read_grants', 'insert') or has_table_privilege('authenticated', 'public.gw_read_audit', 'insert')
     or has_table_privilege('anon', 'public.gw_read_grants', 'select') then raise exception 'R2 table'; end if;
  passed := passed + 1;

  -- R3 two groups, same VIN: NW reader sees only its own instance
  r := gw_read_fetch('film-nw-r1', 'rdnonce' || md5(random()::text), now(), 'grp-syn-northwind', 'rt-syn-nw-01', 'service_lane', tvin);
  if r->>'decision' <> 'ok' or jsonb_array_length(r->'items') <> 1 or r->'items'->0->>'instance_id' <> ia then raise exception 'R3 %', r; end if;
  if r::text like '%' || ib || '%' or r::text like '%lakeshore%' then raise exception 'R3 leak'; end if;
  passed := passed + 1;

  -- R4 listing reflects source price change and sale; fresh; ETag inputs present
  it := r->'items'->0;
  if it->'sections'->'listing'->>'status' <> 'sold' or (it->'sections'->'listing'->>'price_cents')::int <> 2400000
     or (it->>'stale')::boolean or it->>'current_episode_id' <> e1 then raise exception 'R4 %', it; end if;
  passed := passed + 1;

  -- R5 MPI after sold (no relist) as seen by AutoLabels' consumer view; R8 read-your-writes via origin receipt
  r := gw_publish(film || jsonb_build_object('event_id', ev_mpi, 'event_type', 'service.mpi_verified',
    'refs', jsonb_build_object('service_visit_ref', 'ro-rd-1', 'evidence_refs', jsonb_build_array('evd-rd-1')),
    'aggregate', jsonb_build_object('type','vehicle_instance','id',ia,'revision',1), 'payload', '{"technician_verified":true,"mpi_id":"MPI-RD-1","items_green":40}'::jsonb));
  if r->>'status' <> 'accepted' then raise exception 'R5 publish %', r; end if;
  for i in 1..4 loop perform gw_worker_step('rd-w', 200, 100); end loop;
  r := gw_read_fetch('labels-nw-k1', 'rdnonce' || md5(random()::text), now(), 'grp-syn-northwind', 'rt-syn-nw-01', 'listing_display', tvin, 25, null, ev_sold);
  it := r->'items'->0;
  if it->'sections'->'mpi'->>'mpi_id' <> 'MPI-RD-1' or it->'sections' ? 'listing' then raise exception 'R5 %', it; end if;
  if (select state->'listing'->>'status' from gw_projections where target_app='autofilm' and aggregate_id=ia) <> 'sold' then raise exception 'R5 relisted'; end if;
  passed := passed + 1;
  if not (r->'origin'->>'committed')::boolean or (r->'origin'->>'revision')::int <> 3
     or (it->'own_revisions'->'vehicle_instance'->>'revision')::int <> 3 then raise exception 'R8 %', r->'origin'; end if;
  r := gw_read_fetch('labels-nw-k1', 'rdnonce' || md5(random()::text), now(), 'grp-syn-northwind', 'rt-syn-nw-01', 'listing_display', tvin, 25, null, ev_mpi);
  if (r->'origin'->>'committed')::boolean or r->'origin'->>'reason' <> 'origin receipt not owned by caller' then raise exception 'R8b %', r->'origin'; end if;
  passed := passed + 1;

  -- R6 appraisal without purchase: no finance value, no acquired flag; CRM never exposed
  r := gw_publish(curb || jsonb_build_object('event_id', gen_random_uuid(), 'event_type', 'appraisal.completed',
    'aggregate', jsonb_build_object('type','vehicle_instance','id',ia,'revision',1), 'payload', '{"appraisal_cents":1500000}'::jsonb));
  if r->>'status' <> 'accepted' then raise exception 'R6 publish %', r; end if;
  for i in 1..4 loop perform gw_worker_step('rd-w', 200, 100); end loop;
  r := gw_read_fetch('film-nw-r1', 'rdnonce' || md5(random()::text), now(), 'grp-syn-northwind', 'rt-syn-nw-01', 'service_lane', tvin);
  it := r->'items'->0;
  if not (it->'sections' ? 'appraisal') or it->'sections'->'appraisal' ? 'appraisal_cents' or it->'sections'->'appraisal' ? 'acquired'
     or r::text like '%1500000%' or r::text like '%crm_consent%' then raise exception 'R6 %', it->'sections'; end if;
  r := gw_read_fetch('curb-nw-k1', 'rdnonce' || md5(random()::text), now(), 'grp-syn-northwind', 'rt-syn-nw-01', 'appraisal_context', tvin);
  if r->'items'->0->'sections' ? 'media' or r->'items'->0->'sections' ? 'video' then raise exception 'R6 section grant %', r; end if;
  passed := passed + 1;

  -- R7 duplicate + reordered (stale revision) deliveries leave the read model byte-identical
  a := (gw_read_fetch('film-nw-r1', 'rdnonce' || md5(random()::text), now(), 'grp-syn-northwind', 'rt-syn-nw-01', 'service_lane', tvin))->'items'->0->'sections';
  r := gw_publish(lab || jsonb_build_object('event_id', ev_price, 'event_type', 'price.changed',
    'aggregate', jsonb_build_object('type','vehicle_instance','id',ia,'revision',2), 'payload', '{"price_cents":2400000}'::jsonb));
  if r->>'status' <> 'duplicate' then raise exception 'R7 dup %', r; end if;
  r := gw_publish(lab || jsonb_build_object('event_id', gen_random_uuid(), 'event_type', 'price.changed',
    'aggregate', jsonb_build_object('type','vehicle_instance','id',ia,'revision',2), 'payload', '{"price_cents":1}'::jsonb));
  if r->>'status' <> 'stale' then raise exception 'R7 stale %', r; end if;
  for i in 1..3 loop perform gw_worker_step('rd-w', 200, 100); end loop;
  b := (gw_read_fetch('film-nw-r1', 'rdnonce' || md5(random()::text), now(), 'grp-syn-northwind', 'rt-syn-nw-01', 'service_lane', tvin))->'items'->0->'sections';
  if a <> b then raise exception 'R7 changed % vs %', a, b; end if;
  passed := passed + 1;

  -- R9 media in episode 1, then VIN returns in a NEW custody episode: stale until projected, never mixed
  media := jsonb_build_object('media_id', 'med-rd-e1', 'content_sha256', repeat('ab', 32),
    'object_ref', 'objref:dev-synthetic-media/nw-01/med-rd-e1.jpg', 'mime', 'image/jpeg', 'width', 1600, 'height', 1200,
    'preset_version', 'studio-3', 'preset_order', 0,
    'approval', jsonb_build_object('role', 'inventory_manager', 'approval_id', 'apr-rd-01', 'approved_at', '2026-11-01T17:00:00Z'));
  frame := lab || jsonb_build_object('source_app', 'autoframe', 'event_type', 'media.approved');
  r := gw_publish(frame || jsonb_build_object('event_id', gen_random_uuid(), 'aggregate', jsonb_build_object('type','vehicle_instance','id',ia,'revision',1), 'payload', media));
  if r->>'status' <> 'accepted' then raise exception 'R9 media1 %', r; end if;
  for i in 1..3 loop perform gw_worker_step('rd-w', 200, 100); end loop;
  r := gw_publish(lab || jsonb_build_object('event_id', gen_random_uuid(), 'event_type', 'inventory.updated',
    'vehicle', jsonb_build_object('vin', tvin, 'instance_id', ia, 'episode_id', e2),
    'aggregate', jsonb_build_object('type','vehicle_instance','id',ia,'revision',4), 'payload', '{"status":"active","mileage":9000}'::jsonb));
  if r->>'status' <> 'accepted' then raise exception 'R9 relist %', r; end if;
  r := gw_read_fetch('film-nw-r1', 'rdnonce' || md5(random()::text), now(), 'grp-syn-northwind', 'rt-syn-nw-01', 'service_lane', tvin);
  it := r->'items'->0;
  if not (it->>'stale')::boolean or it->>'current_episode_id' <> e2 or (it->>'lag_copies')::int < 1
     or it->>'stale_reason' not like '%projection not at current episode%' then raise exception 'R9 pre %', it; end if;
  for i in 1..4 loop perform gw_worker_step('rd-w', 200, 100); end loop;
  r := gw_read_fetch('film-nw-r1', 'rdnonce' || md5(random()::text), now(), 'grp-syn-northwind', 'rt-syn-nw-01', 'service_lane', tvin);
  it := r->'items'->0;
  if (it->>'stale')::boolean or it->'sections'->'listing'->>'episode_id' <> e2 or it->'sections'->'listing'->>'status' <> 'active'
     or it->'sections'->'listing' ? 'sold_at' or it->'sections'->'listing' ? 'price_cents' then raise exception 'R9 post %', it; end if;
  if jsonb_array_length(it->'sections'->'listing_history') < 1 or it->'sections'->'listing_history'->0->>'status' <> 'sold'
     or it->'sections'->'listing_history'->0->>'episode_id' <> e1 then raise exception 'R9 history %', it->'sections'->'listing_history'; end if;
  if it->'sections'->'media'->'assets' ? 'med-rd-e1' then raise exception 'R9 media from old episode leaked into current'; end if;
  passed := passed + 1;

  -- R10 media approved in the current episode appears; media.revoked unsupported (rejected, never applied)
  r := gw_publish(frame || jsonb_build_object('event_id', gen_random_uuid(), 'vehicle', jsonb_build_object('vin', tvin, 'instance_id', ia, 'episode_id', e2),
    'aggregate', jsonb_build_object('type','vehicle_instance','id',ia,'revision',2), 'payload', media || '{"media_id":"med-rd-e2","object_ref":"objref:dev-synthetic-media/nw-01/med-rd-e2.jpg"}'::jsonb));
  if r->>'status' <> 'accepted' then raise exception 'R10 media2 %', r; end if;
  for i in 1..3 loop perform gw_worker_step('rd-w', 200, 100); end loop;
  r := gw_publish(frame || jsonb_build_object('event_id', gen_random_uuid(), 'event_type', 'media.revoked',
    'aggregate', jsonb_build_object('type','vehicle_instance','id',ia,'revision',3), 'payload', '{"media_id":"med-rd-e2"}'::jsonb));
  if r->>'status' <> 'rejected' then raise exception 'R10 revoked %', r; end if;
  it := (gw_read_fetch('film-nw-r1', 'rdnonce' || md5(random()::text), now(), 'grp-syn-northwind', 'rt-syn-nw-01', 'service_lane', tvin))->'items'->0;
  if not (it->'sections'->'media'->'assets' ? 'med-rd-e2') or it->'sections'->'media'->'assets' ? 'med-rd-e1' then raise exception 'R10 %', it->'sections'->'media'; end if;
  passed := passed + 1;

  -- R11 queue outage: destination breaker forced open -> last-known data flagged stale with source timestamp
  perform gw_set_breaker('grp-syn-northwind', 'autofilm', true);
  r := gw_publish(lab || jsonb_build_object('event_id', gen_random_uuid(), 'vehicle', jsonb_build_object('vin', tvin, 'instance_id', ia, 'episode_id', e2),
    'event_type', 'price.changed', 'aggregate', jsonb_build_object('type','vehicle_instance','id',ia,'revision',5), 'payload', '{"price_cents":2100000}'::jsonb));
  for i in 1..2 loop perform gw_worker_step('rd-w', 200, 100); end loop;
  it := (gw_read_fetch('film-nw-r1', 'rdnonce' || md5(random()::text), now(), 'grp-syn-northwind', 'rt-syn-nw-01', 'service_lane', tvin))->'items'->0;
  if not (it->>'stale')::boolean or it->>'stale_reason' not like '%breaker forced_open%' or it->'sections'->'listing' ? 'price_cents'
     or it->>'projection_updated_at' is null or it->>'lag_oldest_at' is null then raise exception 'R11 outage %', it; end if;
  perform gw_set_breaker('grp-syn-northwind', 'autofilm', false);
  update gw_queue set available_at = now() - interval '1 second' where status = 'retry';
  for i in 1..4 loop perform gw_worker_step('rd-w', 200, 100); end loop;
  it := (gw_read_fetch('film-nw-r1', 'rdnonce' || md5(random()::text), now(), 'grp-syn-northwind', 'rt-syn-nw-01', 'service_lane', tvin))->'items'->0;
  if (it->>'stale')::boolean or (it->'sections'->'listing'->>'price_cents')::int <> 2100000 then raise exception 'R11 recover %', it; end if;
  passed := passed + 1;

  -- R12 per-identity budget -> 429
  insert into gw_read_audit(key_id, tenant_id, decision, http_status) select 'curb-nw-k1', 'grp-syn-northwind', 'ok', 200 from generate_series(1, 120);
  r := gw_read_fetch('curb-nw-k1', 'rdnonce' || md5(random()::text), now(), 'grp-syn-northwind', 'rt-syn-nw-01', 'appraisal_context', tvin);
  if (r->>'http_status')::int <> 429 then raise exception 'R12 %', r; end if;
  passed := passed + 1;

  -- R13 pagination: keyset cursor, list mode carries no sections
  r := gw_read_fetch('film-nw-r1', 'rdnonce' || md5(random()::text), now(), 'grp-syn-northwind', 'rt-syn-nw-01', 'service_lane', null, 2);
  if jsonb_array_length(r->'items') <> 2 or r->>'next_cursor' is null or r->'items'->0 ? 'sections' then raise exception 'R13a %', r; end if;
  b := gw_read_fetch('film-nw-r1', 'rdnonce' || md5(random()::text), now(), 'grp-syn-northwind', 'rt-syn-nw-01', 'service_lane', null, 2, r->>'next_cursor');
  if b->'items'->0->>'instance_id' <= r->>'next_cursor' then raise exception 'R13b %', b; end if;
  passed := passed + 1;

  -- R14 nonce replay on reads
  r := gw_read_fetch('film-nw-r1', 'rdnonce-fixed-000000001', now(), 'grp-syn-northwind', 'rt-syn-nw-01', 'service_lane', tvin);
  r := gw_read_fetch('film-nw-r1', 'rdnonce-fixed-000000001', now(), 'grp-syn-northwind', 'rt-syn-nw-01', 'service_lane', tvin);
  if r->>'reason' <> 'nonce replay' or (r->>'http_status')::int <> 409 then raise exception 'R14 %', r; end if;
  passed := passed + 1;

  -- R15 projection rebuild from the event log equals the checkpoint
  select state into cp from gw_projections where tenant_id = 'grp-syn-northwind' and target_app = 'autofilm' and aggregate_id = ia;
  delete from gw_projections where tenant_id = 'grp-syn-northwind' and target_app = 'autofilm' and aggregate_id = ia;
  delete from gw_inbox i using gw_queue q where q.event_id = i.event_id and q.target_app = i.target_app
    and q.lane_key = 'autofilm|grp-syn-northwind|vehicle_instance:' || ia and q.status = 'delivered';
  update gw_queue set status = 'pending', attempts = 0, available_at = now() - interval '1 second', delivered_at = null, lease_until = null, leased_by = null
    where lane_key = 'autofilm|grp-syn-northwind|vehicle_instance:' || ia and status = 'delivered';
  for i in 1..10 loop perform gw_worker_step('rd-rebuild', 200, 100); end loop;
  if (select state from gw_projections where tenant_id = 'grp-syn-northwind' and target_app = 'autofilm' and aggregate_id = ia) is distinct from cp then
    raise exception 'R15 rebuild mismatch % vs %', (select state from gw_projections where target_app = 'autofilm' and aggregate_id = ia), cp; end if;
  passed := passed + 1;

  -- R16 read freshness instrumentation in the ops snapshot
  r := gw_ops_snapshot();
  if (r->>'reads_15m')::int < 10 or (r->>'read_denied_15m')::int < 8 or (r->>'read_stale_rows_15m')::int < 2 then raise exception 'R16 %', r; end if;
  passed := passed + 1;

  raise exception 'GW_READ_TESTS_PASSED: %', passed;
end $$;
