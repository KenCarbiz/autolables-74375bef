-- AutoFrame media.approved v1 (migration 0011). One DO block, ALWAYS rolls back. Success = 'GW_TESTS_PASSED: n'.
do $$
declare
  ua uuid := '00000000-0000-4000-a000-0000000000aa';
  -- Phase 3C: a fresh instance + episode registered inside this rolled-back transaction, instead of deleting the committed
  -- projections of vi-rt-syn-nw-01-001 (which made whole-tenant reconcile report projection_behind_delivered).
  run text := substr(md5(clock_timestamp()::text), 1, 8);
  inst text := 'vi-media-' || run; tvin text := 'DEVSYN00000000401'; epi text := 'ep-media-' || run || '-1';
  r jsonb; n int; passed int := 0; e1 uuid := gen_random_uuid(); base jsonb; media jsonb; st jsonb; v_q bigint;
begin
  insert into gw_tenant_members values (ua, 'grp-syn-northwind', 'admin', now()), (ua, 'grp-syn-lakeshore', 'admin', now()) on conflict do nothing;
  perform set_config('request.jwt.claims', json_build_object('sub', ua, 'role', 'authenticated')::text, true);
  update gw_queue set status = 'skipped' where status in ('pending','retry','leased','held');
  insert into gw_vehicle_instances(id, tenant_id, rooftop_id, identity_id, kind, created_at)
    select inst, 'grp-syn-northwind', 'rt-syn-nw-01', id, 'inventory', now() from gw_vehicle_identities where tenant_id = 'grp-syn-northwind' and vin = tvin;
  insert into gw_listing_episodes(id, tenant_id, instance_id, opened_at) values (epi, 'grp-syn-northwind', inst, now());

  media := jsonb_build_object('media_id', 'med-syn-0001', 'content_sha256', repeat('ab', 32),
    'object_ref', 'objref:dev-synthetic-media/nw-01/med-syn-0001.jpg', 'mime', 'image/jpeg', 'width', 1600, 'height', 1200,
    'preset_version', 'studio-3', 'preset_order', 0,
    'approval', jsonb_build_object('role', 'inventory_manager', 'approval_id', 'apr-syn-01', 'approved_at', '2026-11-01T17:00:00Z'));
  base := jsonb_build_object('schema_version', 1, 'tenant_id', 'grp-syn-northwind', 'rooftop_id', 'rt-syn-nw-01',
    'vehicle', jsonb_build_object('vin', tvin, 'instance_id', inst, 'episode_id', epi),
    'source_app', 'autoframe', 'event_type', 'media.approved', 'occurred_at', now(), 'emitted_at', now());

  -- M1 accepted, fan-out to exactly AutoLabels + AutoFilm
  r := gw_publish(base || jsonb_build_object('event_id', e1, 'aggregate', jsonb_build_object('type','vehicle_instance','id',inst,'revision',1), 'payload', media));
  if r->>'status' <> 'accepted' or (r->>'fanout')::int <> 2 then raise exception 'M1: %', r; end if;
  select count(*) into n from gw_queue where event_id = e1 and target_app in ('autolabels','autofilm');
  if n <> 2 then raise exception 'M1 targets %', n; end if; passed := passed + 1;

  -- M2 delivered into both consumer projections, keyed by media_id, metadata only
  r := gw_worker_step('af-w1', 100, 50);
  select count(*) into n from gw_projections where aggregate_id = inst and target_app in ('autolabels','autofilm')
    and state->'media'->'assets'->'med-syn-0001'->>'content_sha256' = repeat('ab', 32)
    and state->'media'->'assets'->'med-syn-0001'->>'episode_id' = epi;
  if n <> 2 then raise exception 'M2 projections %: %', n, r; end if; passed := passed + 1;

  -- M3 duplicate event_id is idempotent at the producer
  r := gw_publish(base || jsonb_build_object('event_id', e1, 'aggregate', jsonb_build_object('type','vehicle_instance','id',inst,'revision',1), 'payload', media));
  if r->>'status' <> 'duplicate' then raise exception 'M3: %', r; end if; passed := passed + 1;

  -- M4 transport replay of a delivered copy: inbox dedupe, apply_count unchanged
  select id into v_q from gw_queue where event_id = e1 and target_app = 'autolabels';
  select apply_count into n from gw_projections where aggregate_id = inst and target_app = 'autolabels';
  update gw_queue set status = 'pending', delivered_at = null, available_at = now() where id = v_q;
  perform gw_worker_step('af-w2', 100, 50);
  if (select status from gw_queue where id = v_q) <> 'duplicate'
     or (select apply_count from gw_projections where aggregate_id = inst and target_app = 'autolabels') <> n then
    raise exception 'M4 replay not idempotent'; end if; passed := passed + 1;

  -- M5 stale / out-of-order revision rejected at producer
  r := gw_publish(base || jsonb_build_object('event_id', gen_random_uuid(), 'aggregate', jsonb_build_object('type','vehicle_instance','id',inst,'revision',1), 'payload', media));
  if r->>'status' <> 'stale' then raise exception 'M5: %', r; end if; passed := passed + 1;

  -- M6 wrong tenant rooftop rejected
  r := gw_publish(base || jsonb_build_object('event_id', gen_random_uuid(), 'rooftop_id', 'rt-syn-ls-01',
    'aggregate', jsonb_build_object('type','vehicle_instance','id',inst,'revision',9), 'payload', media));
  if r->>'status' <> 'rejected' then raise exception 'M6: %', r; end if; passed := passed + 1;

  -- M7 negative payloads: URL ref, signed link, binary key, non-manager approval, missing episode, bad hash
  r := gw_publish(base || jsonb_build_object('event_id', gen_random_uuid(), 'aggregate', jsonb_build_object('type','vehicle_instance','id',inst,'revision',9),
    'payload', media || '{"object_ref":"https://cdn.example/x.jpg"}'));
  if r->>'status' <> 'rejected' then raise exception 'M7a: %', r; end if;
  r := gw_publish(base || jsonb_build_object('event_id', gen_random_uuid(), 'aggregate', jsonb_build_object('type','vehicle_instance','id',inst,'revision',9),
    'payload', media || '{"object_ref":"objref:b/x.jpg?X-Amz-Signature=abc"}'));
  if r->>'status' <> 'rejected' then raise exception 'M7b: %', r; end if;
  r := gw_publish(base || jsonb_build_object('event_id', gen_random_uuid(), 'aggregate', jsonb_build_object('type','vehicle_instance','id',inst,'revision',9),
    'payload', media || '{"photo_bytes":"AAAA"}'));
  if r->>'status' <> 'rejected' then raise exception 'M7c: %', r; end if;
  r := gw_publish(base || jsonb_build_object('event_id', gen_random_uuid(), 'aggregate', jsonb_build_object('type','vehicle_instance','id',inst,'revision',9),
    'payload', media || jsonb_build_object('approval', jsonb_build_object('role','photographer','approval_id','a1','approved_at','2026-11-01T17:00:00Z'))));
  if r->>'status' <> 'rejected' then raise exception 'M7d: %', r; end if;
  r := gw_publish(base || jsonb_build_object('event_id', gen_random_uuid(), 'vehicle', jsonb_build_object('vin', tvin, 'instance_id', inst),
    'aggregate', jsonb_build_object('type','vehicle_instance','id',inst,'revision',9), 'payload', media));
  if r->>'status' <> 'rejected' then raise exception 'M7e: %', r; end if;
  r := gw_publish(base || jsonb_build_object('event_id', gen_random_uuid(), 'aggregate', jsonb_build_object('type','vehicle_instance','id',inst,'revision',9),
    'payload', media || '{"content_sha256":"zz"}'));
  if r->>'status' <> 'rejected' then raise exception 'M7f: %', r; end if;
  r := gw_publish(base || jsonb_build_object('event_id', gen_random_uuid(), 'aggregate', jsonb_build_object('type','vehicle_instance','id',inst,'revision',9),
    'payload', media || jsonb_build_object('approval', (media->'approval') || '{"approver_email":"x@y.z"}')));
  if r->>'status' <> 'rejected' then raise exception 'M7g: %', r; end if;
  passed := passed + 1;

  -- M8 media.revoked is not in the catalog -> rejected (no implicit revoke semantics)
  r := gw_publish(base || jsonb_build_object('event_id', gen_random_uuid(), 'event_type', 'media.revoked',
    'aggregate', jsonb_build_object('type','vehicle_instance','id',inst,'revision',9), 'payload', media));
  if r->>'status' <> 'rejected' then raise exception 'M8: %', r; end if; passed := passed + 1;

  -- M9 sold listing is never reopened by media; second asset keeps the first
  r := gw_publish(jsonb_build_object('event_id', gen_random_uuid(), 'schema_version', 1, 'tenant_id', 'grp-syn-northwind', 'rooftop_id', 'rt-syn-nw-01',
    'vehicle', jsonb_build_object('vin', tvin, 'instance_id', inst, 'episode_id', epi), 'source_app', 'autolabels', 'event_type', 'listing.sold',
    'aggregate', jsonb_build_object('type','vehicle_instance','id',inst,'revision',1), 'occurred_at', now(), 'emitted_at', now(), 'payload', '{"sold_at":"2026-11-01"}'::jsonb));
  if r->>'status' <> 'accepted' then raise exception 'M9 sold: %', r; end if;
  perform gw_worker_step('af-w3', 100, 50);
  r := gw_publish(base || jsonb_build_object('event_id', gen_random_uuid(), 'aggregate', jsonb_build_object('type','vehicle_instance','id',inst,'revision',2),
    'payload', media || '{"media_id":"med-syn-0002","preset_order":1}'));
  if r->>'status' <> 'accepted' then raise exception 'M9 media2: %', r; end if;
  perform gw_worker_step('af-w4', 100, 50);
  select state into st from gw_projections where aggregate_id = inst and target_app = 'autofilm';
  if st->'listing'->>'status' <> 'sold' then raise exception 'M9 listing reopened: %', st->'listing'; end if;
  if (select count(*) from jsonb_object_keys(st->'media'->'assets')) <> 2 then raise exception 'M9 assets: %', st->'media'; end if;
  passed := passed + 1;

  -- M10 (0013) media-specific aggregate id is rejected: revision must be per vehicle instance
  r := gw_publish(base || jsonb_build_object('event_id', gen_random_uuid(), 'aggregate', jsonb_build_object('type','vehicle_instance','id','med-syn-0003','revision',1), 'payload', media));
  if r->>'status' <> 'rejected' or r->>'reason' not like '%aggregate.id must equal%' then raise exception 'M10: %', r; end if;
  -- aggregate.type 'media' is not on the allowlist
  r := gw_publish(base || jsonb_build_object('event_id', gen_random_uuid(), 'aggregate', jsonb_build_object('type','media','id',inst,'revision',20), 'payload', media));
  if r->>'status' <> 'rejected' then raise exception 'M10 type: %', r; end if; passed := passed + 1;

  -- M11 (0013) unregistered episode is rejected and NOT created
  r := gw_publish(base || jsonb_build_object('event_id', gen_random_uuid(), 'vehicle', jsonb_build_object('vin', tvin, 'instance_id', inst, 'episode_id', 'ep-syn-invented-9'),
    'aggregate', jsonb_build_object('type','vehicle_instance','id',inst,'revision',21), 'payload', media));
  if r->>'status' <> 'rejected' or r->>'reason' not like '%current registered listing episode%' then raise exception 'M11: %', r; end if;
  if exists (select 1 from gw_listing_episodes where id = 'ep-syn-invented-9') then raise exception 'M11 episode invented'; end if;
  passed := passed + 1;

  -- M12 (0013) unregistered instance is rejected and NOT created; wrong rooftop rejected
  r := gw_publish(base || jsonb_build_object('event_id', gen_random_uuid(), 'vehicle', jsonb_build_object('vin', tvin, 'instance_id', 'vi-syn-invented-9', 'episode_id', epi),
    'aggregate', jsonb_build_object('type','vehicle_instance','id','vi-syn-invented-9','revision',1), 'payload', media));
  if r->>'status' <> 'rejected' then raise exception 'M12: %', r; end if;
  if exists (select 1 from gw_vehicle_instances where id = 'vi-syn-invented-9') then raise exception 'M12 instance invented'; end if;
  r := gw_publish(base || jsonb_build_object('event_id', gen_random_uuid(), 'rooftop_id', 'rt-syn-nw-02',
    'aggregate', jsonb_build_object('type','vehicle_instance','id',inst,'revision',22), 'payload', media));
  if r->>'status' <> 'rejected' then raise exception 'M12 rooftop: %', r; end if;
  passed := passed + 1;

  raise exception 'GW_TESTS_PASSED: %', passed;
end $$;
