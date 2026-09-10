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
-- sandbox_exec — SELECT KEPT, EVERYTHING ELSE REMOVED
--
-- sandbox_exec is Lovable's platform diagnostic SQL identity. Its sandbox shell
-- connects as `sandbox_exec.<project_ref>` through the Supabase pooler, which is
-- how the platform answers diagnostic questions about this database. It is
-- platform-required but undocumented: no Supabase or Lovable documentation names
-- it, and nothing in this repository references it.
--
-- It KEEPS SELECT on these five tables. Diagnostic inspection is a real need and
-- removing it would break platform tooling for no security gain — the role holds
-- BYPASSRLS regardless, so denying SELECT here would not hide the data.
--
-- It LOSES INSERT and every other table privilege. INSERT is not vestigial — the
-- sandbox has a documented generic data-load path, `COPY <table> FROM STDIN`, and
-- that is what the grant backs. But it is an ANY-TABLE capability that arrives
-- here through the blanket default privilege above, and no workflow loads a CSV
-- into a Market V2 table. Removing it for these five is the point, not a
-- regression: these are machine-written evidence and ledger tables.
--
-- INSERT is also precisely the privilege the append-only design does not defend
-- against. The triggers reject UPDATE and DELETE, so they stop history being
-- rewritten or erased — but a fabricated INSERT is a brand-new row and passes
-- straight through them. Every legitimate Market V2 write goes through the
-- service-role writer and the RPC boundary.
--
-- This narrows five tables. It is not a posture change: sandbox_exec keeps INSERT
-- on every other table in public via the same default privilege.
--
-- The role's own attributes are NOT changed. It stays LOGIN and BYPASSRLS: those
-- are platform-managed, the sandbox depends on them, and this migration has no
-- business reaching outside its five tables to alter a platform identity.
--
-- WHAT IS DELIBERATELY NOT DONE
--
--   * ALTER DEFAULT PRIVILEGES is NOT changed. The default above applies to
--     every table in public, not just these five, so correcting it needs an
--     audit of all of them. It remains a separate future governance change with
--     its own blast-radius review.
--   * sandbox_exec's role attributes (LOGIN, BYPASSRLS) are NOT changed.
--   * No RLS setting, policy, trigger, function or application behaviour is
--     touched anywhere in this file.
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
--   GRANT INSERT, SELECT
--     ON public.vehicle_market_valuations, public.vehicle_market_comparables,
--        public.market_value_model_metrics, public.market_provider_budgets,
--        public.provider_request_reservations
--     TO sandbox_exec;
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

-- ══ 7. Lovable's sandbox diagnostic identity ══════════════════════════
-- Lovable's sandbox execution role needs cross-tenant SELECT for diagnostic
-- inspection, but no observed workflow requires direct Market V2 writes.
-- Remove the incidental default INSERT grant and preserve SELECT only.
--
-- INSERT is the privilege the append-only triggers cannot cover: they reject
-- UPDATE and DELETE, so a fabricated row would be inserted, not caught.

REVOKE ALL PRIVILEGES
  ON TABLE
    public.vehicle_market_valuations,
    public.vehicle_market_comparables,
    public.market_value_model_metrics,
    public.market_provider_budgets,
    public.provider_request_reservations
  FROM sandbox_exec;

GRANT SELECT
  ON TABLE
    public.vehicle_market_valuations,
    public.vehicle_market_comparables,
    public.market_value_model_metrics,
    public.market_provider_budgets,
    public.provider_request_reservations
  TO sandbox_exec;
