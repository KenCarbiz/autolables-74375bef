-- 0016: enforce the documented rule "authenticated gets SELECT only on gw_* tables; writes only via gw_* functions".
-- Previously RLS (no write policies) blocked writes, but table-level INSERT/UPDATE/DELETE privileges were still present.
do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public' and tablename like 'gw\_%' loop
    execute format('revoke insert, update, delete, truncate, references, trigger on public.%I from public, anon, authenticated', t);
  end loop;
end $$;
alter default privileges in schema public revoke insert, update, delete, truncate on tables from anon, authenticated;