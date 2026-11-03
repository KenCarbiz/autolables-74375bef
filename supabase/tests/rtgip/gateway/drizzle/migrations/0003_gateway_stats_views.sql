create view public.gw_route_status_counts with (security_invoker = true) as
  select tenant_id, route_id, target_app, status, count(*)::int as n,
         max(delivered_at) as last_delivered_at
  from public.gw_queue group by tenant_id, route_id, target_app, status;
grant select on public.gw_route_status_counts to authenticated;

create view public.gw_target_health with (security_invoker = true) as
  select tenant_id, target_app,
    count(*) filter (where status = 'delivered' and delivered_at > now() - interval '15 minutes')::int as delivered_15m,
    count(*) filter (where status = 'dead')::int as dead_total,
    count(*) filter (where status in ('pending','retry','leased','held'))::int as backlog,
    count(*) filter (where status = 'retry')::int as retrying,
    round(avg(extract(epoch from delivered_at - accepted_at) * 1000) filter (where status = 'delivered' and delivered_at > now() - interval '15 minutes')::numeric, 1) as avg_latency_ms_15m
  from public.gw_queue group by tenant_id, target_app;
grant select on public.gw_target_health to authenticated;
