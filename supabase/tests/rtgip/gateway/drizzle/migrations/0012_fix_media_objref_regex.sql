-- 0012: Postgres ARE caps bounded repetition at 255; 0011's {1,256} raised at runtime. Rewrite in place.
do $$
declare d text;
begin
  select pg_get_functiondef('public.gw_semantic_violation(jsonb)'::regprocedure) into d;
  d := replace(d, '[A-Za-z0-9._/-]{1,256}$', '[A-Za-z0-9._/-]{1,255}$');
  execute d;
end $$;
revoke all on function public.gw_semantic_violation(jsonb) from public, anon;
grant execute on function public.gw_semantic_violation(jsonb) to authenticated;