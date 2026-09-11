-- ── Narrow the snapshot table's privileges to the append-only contract ──────
--
-- 20260912000000 revoked only from PUBLIC and anon, then GRANTed the intended
-- subset to authenticated and service_role. Supabase's default privileges for
-- new tables in `public` had already granted ALL to both roles, and a GRANT
-- adds to what is there — it never narrows it. The result was that UPDATE and
-- DELETE remained available on an append-only evidence table, proven by role:
-- authenticated and service_role were both ALLOWED, and service_role carries
-- rolbypassrls = true, so RLS was no backstop for it.
--
-- REVOKE first, then GRANT. This corrects one table only; the schema-wide
-- default-privilege behaviour is recorded as a separate hardening finding and
-- deliberately left untouched here.

REVOKE ALL PRIVILEGES ON TABLE public.market_cohort_snapshots FROM PUBLIC;
REVOKE ALL PRIVILEGES ON TABLE public.market_cohort_snapshots FROM anon;
REVOKE ALL PRIVILEGES ON TABLE public.market_cohort_snapshots FROM authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.market_cohort_snapshots FROM service_role;

GRANT SELECT ON TABLE public.market_cohort_snapshots TO authenticated;
GRANT SELECT, INSERT ON TABLE public.market_cohort_snapshots TO service_role;