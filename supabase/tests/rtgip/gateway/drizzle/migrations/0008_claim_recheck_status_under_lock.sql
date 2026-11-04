-- Fix: concurrent workers could re-lease a row another worker had just delivered/dead-lettered.
-- Under READ COMMITTED, FOR UPDATE SKIP LOCKED re-evaluates only quals on the locked row, not the
-- earlier CTEs, so the claimability conditions must be repeated on q itself.
create or replace function public.gw_claim_internal(_worker text, _tenants text[], _batch int, _lease_s int, _per_tenant int)
returns setof bigint language plpgsql security definer set search_path = public as $$
begin
  return query
  with heads as (
    select distinct on (lane_key) id, tenant_id, status, available_at, lease_until, outbox_seq
    from gw_queue
    where status in ('pending','retry','leased','held') and tenant_id = any(_tenants)
    order by lane_key, outbox_seq
  ), ready as (
    select h.id, row_number() over (partition by h.tenant_id order by h.outbox_seq) as rn, h.outbox_seq
    from heads h
    where (h.status in ('pending','retry') and h.available_at <= clock_timestamp())
       or (h.status = 'leased' and h.lease_until < clock_timestamp())
  ), pick as (
    select q.id from gw_queue q join ready r on r.id = q.id
    where r.rn <= _per_tenant
      and ((q.status in ('pending','retry') and q.available_at <= clock_timestamp())
        or (q.status = 'leased' and q.lease_until < clock_timestamp()))
    order by r.rn, r.outbox_seq
    limit _batch
    for update of q skip locked
  )
  update gw_queue q set status = 'leased', leased_by = _worker, attempts = q.attempts + 1,
    lease_until = clock_timestamp() + make_interval(secs => _lease_s)
  from pick where q.id = pick.id
    and ((q.status in ('pending','retry') and q.available_at <= clock_timestamp())
      or (q.status = 'leased' and q.lease_until < clock_timestamp()))
  returning q.id;
end $$;
revoke all on function public.gw_claim_internal(text,text[],integer,integer,integer) from public, anon, authenticated;