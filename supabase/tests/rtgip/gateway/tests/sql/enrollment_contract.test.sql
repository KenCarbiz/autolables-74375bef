-- RooftopOS Integration Gateway — DEV fail-closed enrollment + contract dialect tests.
-- One DO block that ALWAYS rolls back. Success = error text 'GW_ENROLL_CONTRACT_TESTS_PASSED: n'.
-- Synthetic users are inserted inside the rolled-back transaction only (no real accounts are created).
do $$
declare
  u_new   uuid := '00000000-0000-4000-a000-0000000000c1';  -- verified, no invite, not allowlisted
  u_unver uuid := '00000000-0000-4000-a000-0000000000c2';  -- unverified, holds an invite
  u_owner uuid := '00000000-0000-4000-a000-0000000000c3';  -- verified, on DEV owner allowlist
  u_inv   uuid := '00000000-0000-4000-a000-0000000000c4';  -- verified, invited as viewer
  u_anon  uuid := '00000000-0000-4000-a000-0000000000c5';  -- anonymous session
  passed int := 0; n int; r jsonb; v_inv uuid; base jsonb;
begin
  insert into auth.users(id, email, email_confirmed_at, is_anonymous, aud, role) values
    (u_new,   'new.op@example.test',   now(), false, 'authenticated', 'authenticated'),
    (u_unver, 'unver.op@example.test', null,  false, 'authenticated', 'authenticated'),
    (u_owner, 'owner.op@example.test', now(), false, 'authenticated', 'authenticated'),
    (u_inv,   'inv.op@example.test',   now(), false, 'authenticated', 'authenticated'),
    (u_anon,  null,                    null,  true,  'authenticated', 'authenticated');
  insert into gw_dev_owner_allowlist(email, note) values ('owner.op@example.test', 'test only');
  -- Isolate from real DEV operators (e.g. a claimed owner) so "last admin" checks are deterministic. Rolled back.
  delete from gw_tenant_members;

  execute 'set local role authenticated';

  -- E1 legacy auto-join is disabled for a verified user
  perform set_config('request.jwt.claims', json_build_object('sub', u_new, 'role', 'authenticated')::text, true);
  begin perform gw_dev_join(); raise exception 'E1 dev_join still callable';
  exception when insufficient_privilege then passed := passed + 1; end;

  -- E2 verified user with no invite: no tenants, no rows, claim_owner refused, accept_invites grants nothing
  select count(*) into n from gw_tenants; if n <> 0 then raise exception 'E2 tenants visible %', n; end if;
  begin perform gw_dev_claim_owner(); raise exception 'E2 owner claim allowed';
  exception when raise_exception then if sqlerrm not like 'not on DEV owner allowlist%' then raise; end if; end;
  r := gw_accept_invites(); if (r->>'accepted')::int <> 0 then raise exception 'E2 accepted %', r; end if;
  select count(*) into n from gw_tenant_members; if n <> 0 then raise exception 'E2 member rows'; end if;
  passed := passed + 1;

  -- E3 direct membership insert is denied (no table privilege)
  begin insert into gw_tenant_members values (u_new, 'grp-syn-northwind', 'admin', now()); raise exception 'E3 direct insert';
  exception when insufficient_privilege then passed := passed + 1; end;

  -- E4 allowlist is invisible to authenticated users
  begin select count(*) into n from gw_dev_owner_allowlist; raise exception 'E4 allowlist readable';
  exception when insufficient_privilege then passed := passed + 1; end;

  -- E5 non-admin cannot invite
  begin perform gw_invite_member('grp-syn-northwind', 'x@example.test', 'admin'); raise exception 'E5 invite by non-admin';
  exception when raise_exception then if sqlerrm not like 'only tenant admins%' then raise; end if; passed := passed + 1; end;

  -- E6 anonymous session gets nothing
  perform set_config('request.jwt.claims', json_build_object('sub', u_anon, 'role', 'authenticated', 'is_anonymous', true)::text, true);
  begin perform gw_dev_claim_owner(); raise exception 'E6 anon owner claim';
  exception when raise_exception then if sqlerrm not like 'verified email required%' then raise; end if; passed := passed + 1; end;

  -- E7 allowlisted verified owner bootstraps admin on synthetic groups only
  perform set_config('request.jwt.claims', json_build_object('sub', u_owner, 'role', 'authenticated')::text, true);
  r := gw_dev_claim_owner();
  select count(*) into n from gw_tenant_members where user_id = u_owner and role = 'admin';
  if n <> (select count(*) from gw_tenants) or n < 1 then raise exception 'E7 owner grant %', n; end if;
  passed := passed + 1;

  -- E8 owner invites: viewer for inv, operator for the unverified user
  v_inv := gw_invite_member('grp-syn-lakeshore', 'Inv.Op@Example.test', 'viewer');
  perform gw_invite_member('grp-syn-lakeshore', 'unver.op@example.test', 'operator');
  begin perform gw_invite_member('grp-syn-lakeshore', 'not-an-email', 'viewer'); raise exception 'E8 bad email';
  exception when raise_exception then if sqlerrm not like 'invalid email%' then raise; end if; end;
  passed := passed + 1;

  -- E9 unverified invitee cannot accept
  perform set_config('request.jwt.claims', json_build_object('sub', u_unver, 'role', 'authenticated')::text, true);
  begin perform gw_accept_invites(); raise exception 'E9 unverified accept';
  exception when raise_exception then if sqlerrm not like 'verified email required%' then raise; end if; passed := passed + 1; end;

  -- E10 a different verified user cannot take someone else's invite
  perform set_config('request.jwt.claims', json_build_object('sub', u_new, 'role', 'authenticated')::text, true);
  r := gw_accept_invites(); if (r->>'accepted')::int <> 0 then raise exception 'E10 stolen invite'; end if;
  passed := passed + 1;

  -- E11 invitee accepts: viewer on lakeshore only; sees no northwind rows; cannot publish; cannot invite
  perform set_config('request.jwt.claims', json_build_object('sub', u_inv, 'role', 'authenticated')::text, true);
  r := gw_accept_invites(); if (r->>'accepted')::int <> 1 then raise exception 'E11 accept %', r; end if;
  select count(*) into n from gw_tenants; if n <> 1 then raise exception 'E11 tenant scope %', n; end if;
  select count(*) into n from gw_outbox where tenant_id = 'grp-syn-northwind'; if n <> 0 then raise exception 'E11 RLS leak'; end if;
  begin perform gw_invite_member('grp-syn-lakeshore', 'y@example.test', 'admin'); raise exception 'E11 viewer invite';
  exception when raise_exception then if sqlerrm not like 'only tenant admins%' then raise; end if; end;
  r := gw_accept_invites(); if (r->>'accepted')::int <> 0 then raise exception 'E11 invite reusable'; end if;
  passed := passed + 1;

  -- E12 last admin cannot be removed; revoked invite cannot be accepted
  perform set_config('request.jwt.claims', json_build_object('sub', u_owner, 'role', 'authenticated')::text, true);
  begin perform gw_remove_member('grp-syn-lakeshore', u_owner); raise exception 'E12 last admin removed';
  exception when raise_exception then if sqlerrm not like 'cannot remove the last admin%' then raise; end if; end;
  perform gw_revoke_invite((select id from gw_invites where email = 'unver.op@example.test'));
  begin update auth.users set email_confirmed_at = now() where id = u_unver; raise exception 'E12 auth.users writable';
  exception when insufficient_privilege then null; end;
  passed := passed + 1;

  -- E13 revoked invite cannot be accepted even after the invitee verifies
  execute 'reset role';
  update auth.users set email_confirmed_at = now() where id = u_unver;
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', u_unver, 'role', 'authenticated')::text, true);
  r := gw_accept_invites(); if (r->>'accepted')::int <> 0 then raise exception 'E13 revoked invite accepted'; end if;
  passed := passed + 1;

  -- C1..C5 foreign dialect envelopes are rejected with explicit reasons (no coercion)
  perform set_config('request.jwt.claims', json_build_object('sub', u_owner, 'role', 'authenticated')::text, true);
  base := jsonb_build_object('event_id', gen_random_uuid(), 'schema_version', 1, 'tenant_id', 'grp-syn-northwind', 'rooftop_id', 'rt-syn-nw-01',
    'vehicle', jsonb_build_object('vin', 'DEVSYN00000000401', 'instance_id', 'vi-rt-syn-nw-01-001'),
    'source_app', 'autofilm', 'event_type', 'video.engagement',
    'aggregate', jsonb_build_object('type','vehicle_instance','id','vi-rt-syn-nw-01-001','revision', 900001),
    'occurred_at', now(), 'emitted_at', now(), 'payload', '{"views":1}'::jsonb);
  r := gw_publish(base || '{"schema_version":"af.v1"}');
  if r->>'status' <> 'rejected' or r->>'reason' not like 'foreign dialect: schema_version%' then raise exception 'C1 af.v1 %', r; end if;
  r := gw_publish(base || '{"schema_version":"1"}');
  if r->>'status' <> 'rejected' then raise exception 'C2 string "1" coerced %', r; end if;
  r := gw_publish(base || '{"source_app":"autocurb","event_type":"acquisition.recorded","schema_version":"rooftop.v1"}');
  if r->>'status' <> 'rejected' then raise exception 'C3 rooftop.v1 %', r; end if;
  r := gw_publish(base || '{"source_app":"autocurb","event_type":"acquisition.recorded"}');
  if r->>'status' <> 'rejected' or r->>'reason' not like 'non-canonical event_type acquisition.recorded%' then raise exception 'C4 %', r; end if;
  r := gw_publish(base || '{"source_app":"AutoFilm"}');
  if r->>'reason' not like 'foreign dialect: source_app%' then raise exception 'C5 casing %', r; end if;
  r := gw_publish(base || jsonb_build_object('aggregate', jsonb_build_object('type','vehicle_instance','id','vi-rt-syn-nw-01-001','revision','900001')));
  if r->>'reason' not like 'foreign dialect: aggregate.revision%' then raise exception 'C6 revision string %', r; end if;
  -- C7 canonical envelope still accepted by the same caller
  r := gw_publish(base);
  if r->>'status' <> 'accepted' then raise exception 'C7 canonical rejected %', r; end if;
  passed := passed + 7;

  -- C8 DB catalog snapshot matches src/lib/gateway/contract.ts (kept in sync by contract.snapshot.test.ts)
  execute 'reset role';
  select count(*) into n from gw_source_allowlist; if n <> 13 then raise exception 'C8 allowlist size %', n; end if;
  if (select string_agg(source_app::text || ':' || event_type || ':' || aggregate_type || ':' || classification || ':' || array_to_string(schema_versions, ','), ';' order by source_app::text, event_type)
      from gw_source_allowlist) <>
     'autocurb:acquisition.closed:vehicle_instance:internal:1;autocurb:appraisal.completed:vehicle_instance:internal:1;autocurb:lead.consented:crm_lead:pii:1;autofilm:service.mpi_verified:vehicle_instance:internal:1;autofilm:service.repair_verified:vehicle_instance:internal:1;autofilm:video.engagement:vehicle_instance:internal:1;autoframe:media.approved:vehicle_instance:media_meta:1;autolabels:inventory.updated:vehicle_instance:internal:1,2;autolabels:listing.archived:vehicle_instance:internal:1;autolabels:listing.delivered:vehicle_instance:internal:1;autolabels:listing.sold:vehicle_instance:internal:1;autolabels:price.changed:vehicle_instance:internal:1;autolabels:sale.voided:vehicle_instance:internal:1'
  then raise exception 'C8 allowlist drift'; end if;
  if (select string_agg(id || '=' || source_app::text || '>' || target_app::text || ':' || array_to_string(event_types, ','), ';' order by id) from gw_routes) <>
     'curb->film=autocurb>autofilm:appraisal.completed,lead.consented;curb->labels=autocurb>autolabels:appraisal.completed,acquisition.closed;film->curb=autofilm>autocurb:video.engagement,service.mpi_verified,service.repair_verified;film->labels=autofilm>autolabels:video.engagement,service.mpi_verified,service.repair_verified;frame->film=autoframe>autofilm:media.approved;frame->labels=autoframe>autolabels:media.approved;labels->curb=autolabels>autocurb:inventory.updated,listing.sold,listing.delivered,sale.voided,listing.archived;labels->film=autolabels>autofilm:inventory.updated,price.changed,listing.sold,listing.delivered,sale.voided,listing.archived'
  then raise exception 'C8 routes drift'; end if;
  passed := passed + 1;

  raise exception 'GW_ENROLL_CONTRACT_TESTS_PASSED: %', passed;
end $$;
