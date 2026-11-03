-- Fix: deadlock under 16 parallel workers. A step applies its whole claimed batch in one
-- transaction, locking circuit-breaker (tenant,target) and projection (tenant,target,aggregate)
-- rows. Applying in a single global order (tenant, target, lane, seq) makes lock acquisition
-- order identical across workers, so they can wait on each other but never cycle.
create or replace function public.gw_worker_step(_worker text, _batch int default 100, _per_tenant int default 50)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id bigint; v_res text; v_out jsonb := '{}'::jsonb; v_n int := 0;
  v_tenants text[] := gw_member_tenants(array['admin','operator']::gw_role[]);
  v_ids bigint[];
begin
  select coalesce(array_agg(c), '{}') into v_ids
    from gw_claim_internal(_worker, v_tenants, least(_batch, 500), 30, least(_per_tenant, 500)) c;
  for v_id in
    select q.id from gw_queue q where q.id = any(v_ids)
    order by q.tenant_id, q.target_app, q.lane_key, q.outbox_seq
  loop
    v_res := gw_apply_internal(v_id, _worker);
    v_out := v_out || jsonb_build_object(v_res, coalesce((v_out->>v_res)::int, 0) + 1);
    v_n := v_n + 1;
  end loop;
  return v_out || jsonb_build_object('claimed', v_n);
end $$;