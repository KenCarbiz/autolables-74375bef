-- 0013: media.approved must target aggregate.id = vehicle.instance_id (per-instance monotonic revision)
-- and reference the instance's current, already-registered listing episode (never auto-created). DEV, no new grants.
do $$
declare d text; anchor text := '  insert into gw_source_revisions(tenant_id, source_app, aggregate_type, aggregate_id, revision)';
begin
  select pg_get_functiondef('public.gw_publish_core(jsonb,uuid)'::regprocedure) into d;
  if position(anchor in d) = 0 then raise exception '0013: anchor not found in gw_publish_core'; end if;
  if position('media.approved aggregate.id must equal' in d) > 0 then return; end if;
  d := replace(d, anchor,
'  if v_type = ''media.approved'' then
    if v_inst is null or v_agg_id is distinct from v_inst then
      return jsonb_build_object(''status'',''rejected'',''reason'',''media.approved aggregate.id must equal vehicle.instance_id'');
    end if;
    if not exists (select 1 from gw_vehicle_instances vi where vi.id = v_inst and vi.tenant_id = v_tenant and vi.rooftop_id = v_rooftop) then
      return jsonb_build_object(''status'',''rejected'',''reason'',''media.approved requires a registered vehicle instance at this rooftop'');
    end if;
    if v_epi is distinct from (select e.id from gw_listing_episodes e where e.instance_id = v_inst and e.tenant_id = v_tenant order by e.opened_at desc limit 1) then
      return jsonb_build_object(''status'',''rejected'',''reason'',''media.approved requires the instance''''s current registered listing episode'');
    end if;
  end if;
' || anchor);
  execute d;
end $$;
revoke all on function public.gw_publish_core(jsonb, uuid) from public, anon, authenticated;