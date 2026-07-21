-- ──────────────────────────────────────────────────────────────────────
-- VINData terms compliance: do NOT cache or persist VINData responses.
--
-- The accepted VINData third-party data agreement states: "I will not cache
-- or persist VINData responses beyond a single user session." The original
-- title_reports table stored the raw NMVTIS report + normalized summary for
-- 90 days, which violates that clause. Drop it.
--
-- The title record is now fetched live per session (generate, then cheap
-- provider-side access within the 90-day window) and held only in the open
-- admin panel — never written to our database. What we DO keep is compliant:
--   • vehicle_listings.title_verification — the dealer's own attestation
--     (clean/branded + verified date), a dealership business record, not a
--     VINData response.
--   • title_report_pulls — our own billing/usage meter (no VINData data).
-- ──────────────────────────────────────────────────────────────────────

DROP TABLE IF EXISTS public.title_reports;
