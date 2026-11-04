-- Blocked cross-contract mappings (AutoLabels PR #46 review, AutoFilm/AutoCurb semantic gaps).
-- One DO block that ALWAYS rolls back. Success = 'GW_BLOCKED_MAPPING_TESTS_PASSED: 14'. Synthetic data only.
do $$
declare
  u_owner uuid := '00000000-0000-4000-a000-0000000000d1';
  passed int := 0; r jsonb; base jsonb; t text;
begin
  insert into gw_tenant_members values (u_owner, 'grp-syn-northwind', 'admin', now());
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', u_owner, 'role', 'authenticated')::text, true);
  base := jsonb_build_object('event_id', gen_random_uuid(), 'schema_version', 1, 'tenant_id', 'grp-syn-northwind', 'rooftop_id', 'rt-syn-nw-01',
    'vehicle', jsonb_build_object('vin', 'DEVSYN00000000401', 'instance_id', 'vi-rt-syn-nw-01-001'),
    'source_app', 'autolabels', 'event_type', 'listing.sold',
    'aggregate', jsonb_build_object('type','vehicle_instance','id','vi-rt-syn-nw-01-001','revision', 800001),
    'occurred_at', now(), 'emitted_at', now(), 'payload', '{}'::jsonb);

  -- B1-B2 PR #46 string semver rejected
  r := gw_publish(base || '{"schema_version":"1.0.0"}');
  if r->>'reason' not like 'foreign dialect: schema_version%' then raise exception 'B1 %', r; end if; passed := passed + 1;
  r := gw_publish(base || '{"schema_version":"1.1.0","service_visit_ref":{"app":"autofilm","id":"sv-syn-1"}}');
  if r->>'reason' not like 'foreign dialect: schema_version%' then raise exception 'B2 %', r; end if; passed := passed + 1;
  -- B3 half-translated envelope (integer version, PR #46 fields present)
  r := gw_publish(base || '{"source_record_id":"syn-rec-1","instance_ref":{"app":"autolabels","id":"x"}}');
  if r->>'reason' not like 'foreign dialect: AutoLabels PR #46 field%' then raise exception 'B3 %', r; end if; passed := passed + 1;

  -- B4-B11 semantic gaps rejected, never auto-mapped
  foreach t in array array['autolabels.vehicle.sold','autolabels.vehicle.delivered','autolabels.vehicle.sale_voided','autolabels.vehicle.archived'] loop
    r := gw_publish(base || jsonb_build_object('event_type', t));
    if r->>'reason' not like 'blocked mapping:%' then raise exception 'B4 % %', t, r; end if; passed := passed + 1;
  end loop;
  r := gw_publish(base || '{"source_app":"autofilm","event_type":"autofilm.inspection.completed","payload":{"technician_verified":false}}');
  if r->>'reason' not like 'blocked mapping:%' then raise exception 'B8 %', r; end if; passed := passed + 1;
  r := gw_publish(base || '{"source_app":"autofilm","event_type":"autofilm.inspection.completed","payload":{"technician_verified":true}}');
  if r->>'reason' not like 'blocked mapping:%' then raise exception 'B9 verified inspection auto-mapped %', r; end if; passed := passed + 1;
  r := gw_publish(base || '{"source_app":"autofilm","event_type":"autofilm.repair.completed_verified","payload":{"evidence_ref":"ev-syn-2","after_sale":true}}');
  if r->>'reason' not like 'blocked mapping:%' then raise exception 'B10 %', r; end if; passed := passed + 1;
  r := gw_publish(base || '{"source_app":"autocurb","event_type":"appraisal.recorded"}');
  if r->>'reason' not like 'blocked mapping:%' then raise exception 'B11 %', r; end if; passed := passed + 1;

  -- B12 nothing from the above reached the outbox
  if exists (select 1 from gw_outbox where aggregate_id = 'vi-rt-syn-nw-01-001' and (event_type like '%.%.%' or event_type in ('appraisal.recorded','inspection.completed')))
    then raise exception 'B12 blocked event persisted'; end if;
  passed := passed + 1;

  -- B13 canonical listing.sold still accepted; B14 forward-compatible extra field tolerated
  r := gw_publish(base);
  if r->>'status' <> 'accepted' then raise exception 'B13 %', r; end if; passed := passed + 1;
  r := gw_publish(base || jsonb_build_object('event_id', gen_random_uuid(), 'visibility', 'internal',
       'aggregate', jsonb_build_object('type','vehicle_instance','id','vi-rt-syn-nw-01-001','revision', 800002)));
  if r->>'status' <> 'accepted' then raise exception 'B14 %', r; end if; passed := passed + 1;
  execute 'reset role';

  raise exception 'GW_BLOCKED_MAPPING_TESTS_PASSED: %', passed;
end $$;
