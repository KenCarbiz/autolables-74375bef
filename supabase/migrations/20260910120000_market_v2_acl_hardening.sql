-- ──────────────────────────────────────────────────────────────────────
-- Market Intelligence V2 — table privilege hardening
--
-- Privileges only. No table, column, constraint, index, policy, trigger or
-- function is created, altered or dropped, and no row is written. Migration
-- 20260910090000 is historical production state and is not touched.
--
-- WHY THIS IS NEEDED
--
-- Supabase carries a default privilege for the public schema:
--
--   ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
--   -- {postgres=arwdDxtm, anon=arwdDxtm, authenticated=arwdDxtm,
--   --  service_role=arwdDxtm, sandbox_exec=ar}
--
-- so every table postgres creates in public is born granting ALL EIGHT
-- privileges to anon, authenticated and service_role. 20260910090000 revoked
-- privileges BY NAME against that baseline, which removed exactly what it
-- named and left the rest. Four privileges survived on the ancillary tables:
-- TRUNCATE, REFERENCES, TRIGGER and MAINTAIN.
--
-- TRUNCATE is the one that matters. Row level security governs SELECT, INSERT,
-- UPDATE and DELETE. It does not mediate whole-table operations at all, so no
-- policy compensates for a surviving TRUNCATE: an authenticated role holding it
-- can empty market_provider_budgets regardless of every policy on the table.
-- TRIGGER is the second: it lets a grantee attach a trigger function to a table
-- it does not own.
--
-- So this migration stops naming privileges. It revokes everything first and
-- grants back only what a NAMED, CURRENT caller requires.
--
-- WHY service_role KEEPS UPDATE ON market_provider_budgets
--
-- It is not an oversight and it must not be "tidied up". market_reserve_
-- provider_call is SECURITY INVOKER, so it executes with service_role's own
-- privileges, and it takes the budget row lock:
--
--   SELECT * FROM public.market_provider_budgets
--    WHERE tenant_id = p_tenant_id FOR UPDATE;
--
-- PostgreSQL refuses SELECT ... FOR UPDATE without the UPDATE privilege.
-- Verified live against this database: with SELECT but no UPDATE the statement
-- fails with SQLSTATE 42501 and the hint "GRANT UPDATE ON
-- public.market_provider_budgets". Revoking UPDATE here would make every
-- provider reservation fail at the lock that stops two callers spending the
-- same budget twice.
--
-- The cleaner long-term fix is to make that function SECURITY DEFINER so it
-- runs as the owner and service_role needs no table privilege at all. That is a
-- behaviour change and belongs in its own reviewed migration, not here.
--
-- WHAT IS DELIBERATELY NOT DONE
--
--   * sandbox_exec is NOT modified. It can log in, it bypasses RLS, and its
--     purpose is unresolved. Revoking access to a role whose consumer is
--     unknown risks breaking platform tooling. It is under investigation and
--     THIS MIGRATION MUST NOT BE APPLIED TO PRODUCTION UNTIL THAT INVESTIGATION
--     REPORTS.
--   * ALTER DEFAULT PRIVILEGES is NOT changed. The default above applies to
--     every table in public, not just these five, so correcting it needs an
--     audit of all of them. Out of scope by design.
--
-- ROLLBACK PLAN (reviewed, NOT executed, do not run without instruction)
--
-- Restores the privilege state as it stood immediately before this migration,
-- captured from the live catalog on 2026-09-10. It restores nothing else; the
-- schema from 20260910090000 is not affected and must not be rolled back.
--
--   GRANT INSERT, SELECT, REFERENCES, TRIGGER, MAINTAIN
--     ON public.vehicle_market_valuations, public.vehicle_market_comparables
--     TO authenticated, service_role;
--   GRANT SELECT, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN
--     ON public.market_value_model_metrics, public.market_provider_budgets,
--        public.provider_request_reservations
--     TO authenticated;
--   GRANT ALL PRIVILEGES
--     ON public.market_value_model_metrics, public.market_provider_budgets,
--        public.provider_request_reservations
--     TO service_role;
--
-- Idempotent: REVOKE and GRANT both converge on re-run.
-- ──────────────────────────────────────────────────────────────────────

-- ══ 1. Floor ══════════════════════════════════════════════════════════
-- Nothing for PUBLIC, anon or authenticated on any of the five.

REVOKE ALL PRIVILEGES ON TABLE public.vehicle_market_valuations
  FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.vehicle_market_comparables
  FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.market_value_model_metrics
  FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.market_provider_budgets
  FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.provider_request_reservations
  FROM PUBLIC, anon, authenticated;

-- ══ 2. Read-back for authenticated ════════════════════════════════════
-- SELECT and nothing else. Every one of the five carries a SELECT policy and
-- RLS still decides which rows are returned; this grant only makes the table
-- reachable so the policy can be evaluated. anon receives nothing at all.

GRANT SELECT ON public.vehicle_market_valuations     TO authenticated;
GRANT SELECT ON public.vehicle_market_comparables    TO authenticated;
GRANT SELECT ON public.market_value_model_metrics    TO authenticated;
GRANT SELECT ON public.market_provider_budgets       TO authenticated;
GRANT SELECT ON public.provider_request_reservations TO authenticated;

-- ══ 3. Evidence tables — append-only by privilege ═════════════════════
-- market_valuation_commit inserts; the writer reads its own last-good row.
-- Nothing updates, deletes or truncates evidence. The append-only trigger
-- stays as the secondary backstop, but privilege is the primary lock.

REVOKE ALL PRIVILEGES ON TABLE public.vehicle_market_valuations  FROM service_role;
REVOKE ALL PRIVILEGES ON TABLE public.vehicle_market_comparables FROM service_role;

GRANT SELECT, INSERT ON public.vehicle_market_valuations  TO service_role;
GRANT SELECT, INSERT ON public.vehicle_market_comparables TO service_role;

-- ══ 4. Provider budgets ═══════════════════════════════════════════════
-- SELECT and UPDATE only. UPDATE is required by the FOR UPDATE row lock
-- documented above. No INSERT: no code path creates a budget row, so a
-- dealership's budget cannot be conjured by the writer.

REVOKE ALL PRIVILEGES ON TABLE public.market_provider_budgets FROM service_role;

GRANT SELECT, UPDATE ON public.market_provider_budgets TO service_role;

-- ══ 5. Provider reservations ══════════════════════════════════════════
-- INSERT on reserve, UPDATE for reserved -> succeeded / failed / expired.
-- No DELETE: a spend ledger that can erase its own entries is not a ledger.

REVOKE ALL PRIVILEGES ON TABLE public.provider_request_reservations FROM service_role;

GRANT SELECT, INSERT, UPDATE ON public.provider_request_reservations TO service_role;

-- ══ 6. Model metrics ══════════════════════════════════════════════════
-- SELECT only. No metrics writer exists in the codebase today, so no write
-- privilege is granted for one. When a real writer lands, its permissions come
-- with it in its own reviewed migration.

REVOKE ALL PRIVILEGES ON TABLE public.market_value_model_metrics FROM service_role;

GRANT SELECT ON public.market_value_model_metrics TO service_role;
