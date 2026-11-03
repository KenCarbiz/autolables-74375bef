-- 0019: new read-contract tables follow the SELECT-only browser model (default privileges had granted writes).
revoke insert, update, delete, truncate, references, trigger on public.gw_source_authority, public.gw_read_grants, public.gw_read_audit from anon, authenticated;
revoke select on public.gw_source_authority, public.gw_read_grants, public.gw_read_audit from anon;
revoke all on sequence public.gw_read_audit_id_seq from anon, authenticated;