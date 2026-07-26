-- create_draft_get_ready was the only draft RPC never explicitly revoked
-- from PUBLIC/anon; with the NULL-uid service pass-through in
-- assert_tenant_member_or_service, the default PUBLIC execute grant let an
-- ANONYMOUS caller seed get-ready records into any tenant. Applied live
-- 2026-07-26 and verified (anon EXECUTE = 0).
REVOKE ALL ON FUNCTION public.create_draft_get_ready(uuid, text) FROM PUBLIC, anon;
