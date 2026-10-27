-- ── Narrow sandbox_exec to SELECT on the legacy pricing store ───────────────
--
-- The repair migration revoked from PUBLIC, anon, authenticated and
-- service_role before granting, but the project's sandbox_exec role took
-- INSERT and SELECT through default privileges, exactly as it had on the
-- Market V2 evidence tables (narrowed in 20260911213911 and the sandbox_exec
-- hardening that followed). An append-only evidence table that a sandbox
-- role can write to is not append-only from the sandbox's point of view.
--
-- Applied 2026-10-27 together with the repair; recorded here so the file
-- tree and the database agree.

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON TABLE public.market_pricing_legacy_payloads FROM sandbox_exec;
GRANT SELECT ON TABLE public.market_pricing_legacy_payloads TO sandbox_exec;
