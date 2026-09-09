-- ──────────────────────────────────────────────────────────────────────
-- Apply the title-verification backlog: the attestation column + the NMVTIS
-- spend meter, and deliberately NOT the raw-report table.
--
-- WHY THIS FILE EXISTS
--
-- Three migrations describing the NMVTIS title feature are in this repo and
-- were never applied to this project:
--
--   20260721210000_title_verification_nmvtis.sql
--       ADD COLUMN vehicle_listings.title_verification + CREATE TABLE title_reports
--   20260721211000_title_report_pull_ledger.sql
--       CREATE TABLE title_report_pulls (the 50-generates-per-month meter)
--   20260721212000_title_reports_no_persist_vindata.sql
--       DROP TABLE title_reports, because the accepted VINData third-party
--       data agreement says "I will not cache or persist VINData responses
--       beyond a single user session"
--
-- Applied in order their net effect is exactly two objects: the dealer
-- attestation column and the billing meter. This migration produces that net
-- state directly and idempotently. It does not rewrite or replace the three
-- originals — they stay in the repo as history.
--
-- HOW "NEVER APPLIED" WAS VERIFIED (live, 2026-09-09, project
-- onnbmmdbrsgytfozfozn / Lovable 1a2a5abf-4218-480d-aac9-d7bd0d3cfb73)
--
-- Not from the migration ledger, which is not a reliable record on this
-- project: supabase_migrations.schema_migrations holds 225 rows against 498
-- .sql files in supabase/migrations, so absence there proves nothing. The
-- catalog was asked instead:
--
--   information_schema.columns  -> vehicle_listings has 86 columns and
--                                  'title_verification' is not one of them
--   information_schema.tables   -> neither 'title_reports' nor
--                                  'title_report_pulls' exists in public
--   pg_class                    -> 0 rows for title_reports,
--                                  title_report_pulls,
--                                  idx_title_report_pulls_tenant_time,
--                                  idx_title_reports_tenant_vin
--   pg_policy                   -> 0 policies whose name starts 'title_report'
--
-- (The ledger agrees, for what it is worth: versions 20260721210000,
-- 20260721211000 and 20260721212000 are absent from it as well.)
--
-- WHAT STARTS WORKING, AND FOR WHOM
--
-- Write path. src/components/vehicle/TitleVerificationPanel.tsx:124 and :135
-- update vehicle_listings.title_verification (set on attest, null on remove)
-- through the caller's JWT. The panel is mounted from the Vehicle File
-- Compliance tab (src/components/vehicleFile/ComplianceTab.tsx:228-236) and
-- is gated on tier('autolabels') === 'compliance_pro' (:103). The pilot
-- tenant Harte Infiniti (3f0f97f5-4151-4e32-88ef-e2d6fc5a3142) holds
-- app_entitlements plan_tier 'compliance_pro', status 'active', so the write
-- genuinely begins to succeed there; today it fails with PostgREST 42703 and
-- the panel toasts "Could not save attestation". The existing UPDATE policy
-- "Tenant members update listings" (TO authenticated, USING tenant_id =
-- current_tenant_id() OR ... OR has_role(admin)) already covers the write, and
-- authenticated already holds table-level UPDATE on vehicle_listings, which a
-- new column inherits. No policy or grant change is needed for the write.
--
-- Shape written vs shape read. The panel writes
--   { status: 'clean'|'branded', verified_at, verified_by, source: 'nmvtis',
--     report_generated_at, report_expires_at, brand_note }
-- (TitleVerificationPanel.tsx:110-119), which is the TitleVerification
-- interface at src/hooks/useVehicleListing.ts:122-130 and the same shape the
-- 20260721210000 column comment documents. src/lib/passportV2Data.ts:582-595
-- consumes only .status and .verified_at (plus truthiness for the source
-- label). The shapes match; no adapter is required.
--
-- Read path — this becomes customer-visible. get_vehicle_listing_by_slug is
-- SECURITY DEFINER RETURNS SETOF vehicle_listings and public-listing-view
-- strips only PUBLIC_VIEW_DENY (supabase/functions/_shared/lotFeedRow.ts:20-77,
-- an allow-by-default denylist that does not name title_verification), so the
-- attestation reaches the anonymous /v/:slug payload on its own and
-- passportV2Data.ts:582-596 promotes it over the softer MarketCheck/CARFAX
-- signal.
--
-- What the shopper sees today, on all 130 active published Harte listings:
-- mc_attributes->>'carfax_clean_title' is NULL on 130/130 and
-- title_brand/title_status is empty on 130/130, so titleStatus resolves to
-- 'unknown'; dealer_profiles.settings.title_policy_no_branded is JSON boolean
-- true for this tenant, so check 5 "Title and brand" in Verified Vehicle Data
-- renders status 'dealer_attested' with the finding "<dealer> states they do
-- not retail branded-title vehicles, and no source has reported a brand on
-- this VIN. This is the dealer's own statement, not an independent
-- title-record check." (src/lib/passport/verificationSummary.ts:404-446).
--
-- What the shopper sees after a dealer attests 'clean' on one VIN: that same
-- check flips to status 'verified' with "No title brands were reported in the
-- NMVTIS title data returned on <verified_at> — no salvage, flood, lemon, or
-- rebuilt records found. Reviewed by the dealer.", evidence rows Title status
-- = Clean, Verification = "Dealer-verified via NMVTIS on <date>", Source =
-- "NMVTIS national title record", plus the required NMVTIS incompleteness
-- caveat. An attested 'branded' instead renders 'needs_attention' ("A title
-- brand is on record for this vehicle...") and adds the "Title brand
-- reported" caution at VehiclePassportGoverned.tsx:669. Nothing renders until
-- a dealer explicitly attests: this migration writes no values, so on the day
-- it is applied every Passport reads exactly as it does today. The locked
-- Passport layout, its module set and its price arithmetic are untouched — no
-- component, query or column consumed by the price derivation changes here.
--
-- Meter path. supabase/functions/marketcheck-title-report/index.ts:143-174
-- reads title_report_pulls for the spend meter and :243 appends one row per
-- pull. Today every one of those calls errors against a missing relation; the
-- errors are swallowed (Promise.all keeps the {data:null,error} envelope, and
-- the insert uses .then(ok, noop)), so monthCount and totalCount are 0 and
-- withinWindow is false, forever. Consequences today: the panel shows
-- "0 of 50 reports generated this month · 0 all-time" no matter how many
-- reports were pulled; the cap test at :199-206
-- (monthCount >= 50 && !withinWindow) can never be true, so the $0.49-per-
-- generate spend is unbounded; and every fetch is forced down the paid
-- 'generate' branch because withinWindow is false, so the cheap 90-day
-- access-report is never used. After this migration the ledger records each
-- pull and the 50/month cap actually binds, returning HTTP 429
-- 'monthly_cap_reached'. Note the cap is per calendar month per tenant and
-- counts only charged rows, and a VIN whose own last generate is inside the
-- 90-day window is still allowed through (withinWindow short-circuits the
-- cap) — that is the existing function's rule, unchanged here.
--
-- What a tenant sees before any pull exists: the same "0 of 50 reports
-- generated this month · 0 all-time" line as today, but now true rather than
-- an error artefact, and the first fetch still takes the paid 'generate'
-- branch behind the panel's explicit confirmation dialog.
--
-- title_reports MUST STAY ABSENT. The VINData agreement forbids persisting the
-- provider response, which is why 20260721212000 dropped it. This migration
-- therefore never creates it, and the DO block at the end fails if it is
-- present, so a future re-application of 20260721210000 alone cannot quietly
-- reintroduce it. The edge function already persists nothing but the meter row.
--
-- ── Directive §55 ─────────────────────────────────────────────────────
--
-- PURPOSE: bring the live database to the net state of the three unapplied
--   title migrations — the dealer attestation column and the NMVTIS spend
--   meter, without the raw-report table.
--
-- FORWARD SQL: ALTER TABLE vehicle_listings ADD COLUMN IF NOT EXISTS
--   title_verification jsonb (+ column comment); CREATE TABLE IF NOT EXISTS
--   public.title_report_pulls; CREATE INDEX IF NOT EXISTS
--   idx_title_report_pulls_tenant_time; ENABLE ROW LEVEL SECURITY; CREATE
--   POLICY "title_report_pulls tenant read" (guarded, CREATE POLICY has no
--   IF NOT EXISTS). Every statement is idempotent; re-running is a no-op.
--
-- DATA IMPACT: none. No UPDATE, INSERT or DELETE is issued. All 285
--   vehicle_listings rows gain a NULL column; on PostgreSQL 17 an ADD COLUMN
--   with no default is a catalog change with no table rewrite, so the
--   ACCESS EXCLUSIVE lock is momentary. Zero rows change value, zero rows
--   change visibility, and no customer-facing output changes until a dealer
--   performs an attestation.
--
-- RLS IMPACT: vehicle_listings policies are not touched; the new column is
--   covered by the existing SELECT/UPDATE policies and by the anon-facing
--   SECURITY DEFINER RPC exactly as every other listing column is.
--   title_report_pulls gets RLS enabled plus one SELECT policy for
--   authenticated tenant members, in the CLAUDE.md shape ((SELECT auth.uid())
--   wrapped, TO authenticated named) — which is how the original
--   20260721211000 already wrote it. No INSERT/UPDATE/DELETE policy is
--   granted: the marketcheck-title-report edge function writes with the
--   service role, which bypasses RLS, and nothing else may append to a
--   billing meter. anon holds table-level privileges on new public tables via
--   Supabase's default ACL, but with RLS on and no anon policy it can read no
--   rows.
--
-- INDEX IMPACT: one new B-tree, idx_title_report_pulls_tenant_time
--   (tenant_id, created_at DESC), on an empty table — instant, and it serves
--   the meter's three queries, all of which filter tenant_id and either range
--   on created_at or order by it. No index is added for the new jsonb column:
--   nothing filters on title_verification; it is read only as part of the row.
--
-- EXPECTED ROW COUNTS (live, 2026-09-09): vehicle_listings 285 rows total,
--   131 published, 130 active published for the pilot tenant (58 of them
--   non-new, the only ones the panel offers). title_verification non-null
--   after apply: 0 of 285. title_report_pulls after apply: 0 rows. tenants: 2,
--   so the FK has 2 valid parents.
--
-- BACKFILL PLAN: none, deliberately, for both objects. There is no historical
--   attestation to restore — the write has never once succeeded — and the pull
--   ledger cannot be reconstructed, because the failed inserts were swallowed
--   and no other table records a title-report pull. The meter therefore starts
--   at zero: any generates already paid for in the current calendar month are
--   invisible to the cap, so this month a tenant could exceed 50 by however
--   many it already pulled. Exposure is bounded at 50 x $0.49 = $24.50 per
--   tenant for the remainder of the month and is correct from the next month.
--
-- VERIFICATION QUERY (run after apply; expect one row, all true / zero):
--   SELECT
--     (SELECT count(*) FROM information_schema.columns
--       WHERE table_schema='public' AND table_name='vehicle_listings'
--         AND column_name='title_verification' AND data_type='jsonb') = 1
--       AS column_present,
--     (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
--       WHERE n.nspname='public' AND c.relname='title_report_pulls') = 1
--       AS meter_present,
--     (SELECT relrowsecurity FROM pg_class WHERE oid='public.title_report_pulls'::regclass)
--       AS meter_rls_on,
--     (SELECT count(*) FROM pg_policy WHERE polrelid='public.title_report_pulls'::regclass)
--       AS meter_policies,
--     (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
--       WHERE n.nspname='public' AND c.relname='title_reports')
--       AS title_reports_must_be_zero,
--     (SELECT count(*) FROM public.vehicle_listings WHERE title_verification IS NOT NULL)
--       AS attestations_must_be_zero,
--     (SELECT count(*) FROM public.title_report_pulls) AS pulls_must_be_zero;
--
-- ROLLBACK / COMPENSATING STRATEGY: both objects are empty at apply time, so
--   rollback is a clean drop with no data loss:
--     DROP TABLE IF EXISTS public.title_report_pulls;
--     ALTER TABLE public.vehicle_listings DROP COLUMN IF EXISTS title_verification;
--   Run it only while both are still empty — check the last two counters of
--   the verification query first. If attestations exist by then, the
--   compensating action instead of dropping the column is to null the
--   attestations (UPDATE public.vehicle_listings SET title_verification = NULL
--   WHERE title_verification IS NOT NULL), which restores the pre-migration
--   customer-facing behaviour (the title check falls back to the dealer-policy
--   statement) while keeping the column. If meter rows exist, export them
--   before dropping — they are the only record of NMVTIS spend.
-- ──────────────────────────────────────────────────────────────────────

-- 1. The dealer ATTESTATION summary (20260721210000, column half).
--    Safe for the shopper view: the dealer's own conclusion plus a date, no
--    raw NMVTIS rows. get_vehicle_listing_by_slug is RETURNS SETOF
--    vehicle_listings, so it flows to /v/:slug automatically once written.
ALTER TABLE public.vehicle_listings
  ADD COLUMN IF NOT EXISTS title_verification jsonb;

COMMENT ON COLUMN public.vehicle_listings.title_verification IS
  'Dealer NMVTIS title attestation shown on the passport: { status: clean|branded, verified_at, verified_by, source, report_generated_at, report_expires_at, brand_note }. Written only on explicit dealer action; never contains raw NMVTIS rows.';

-- 2. The spend meter (20260721211000), verbatim in shape and behaviour.
--    Append-only: one row per pull, a paid generate (charged = true, $0.49) or
--    a free re-access inside the provider's 90-day window (charged = false).
--    Our own billing metadata — it holds no VINData response data, which is
--    why keeping it is compatible with the VINData terms.
CREATE TABLE IF NOT EXISTS public.title_report_pulls (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  vin           text NOT NULL,
  action        text NOT NULL,                      -- 'generate' | 'refresh'
  charged       boolean NOT NULL DEFAULT false,
  unit_cost     numeric(6,2) NOT NULL DEFAULT 0,    -- USD billed for this pull
  pulled_by     uuid,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_title_report_pulls_tenant_time
  ON public.title_report_pulls (tenant_id, created_at DESC);

ALTER TABLE public.title_report_pulls ENABLE ROW LEVEL SECURITY;

-- Dealer staff read their own tenant's meter. The edge function (service role)
-- is the only writer, so no authenticated INSERT policy is granted.
-- CREATE POLICY has no IF NOT EXISTS, hence the guard.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy
     WHERE polrelid = 'public.title_report_pulls'::regclass
       AND polname  = 'title_report_pulls tenant read'
  ) THEN
    CREATE POLICY "title_report_pulls tenant read"
      ON public.title_report_pulls FOR SELECT
      TO authenticated
      USING (
        tenant_id IN (
          SELECT tenant_id FROM public.tenant_members
          WHERE user_id = (SELECT auth.uid())
        )
      );
  END IF;
END $$;

-- 3. title_reports is NOT created here. 20260721212000 dropped it for VINData
--    terms compliance and this project never had it; see the header.

-- ── Self-check: the change took, and took in the shape the readers expect ──
DO $$
DECLARE
  v_policy_cmd  "char";
  v_policy_role boolean;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'vehicle_listings'
       AND column_name = 'title_verification' AND data_type = 'jsonb'
  ) THEN
    RAISE EXCEPTION 'vehicle_listings.title_verification is missing or is not jsonb';
  END IF;

  IF to_regclass('public.title_report_pulls') IS NULL THEN
    RAISE EXCEPTION 'title_report_pulls was not created';
  END IF;

  -- The meter must carry every column the edge function names
  -- (marketcheck-title-report/index.ts:148-158, 243-246).
  IF (
    SELECT count(*) FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'title_report_pulls'
       AND column_name IN ('id','tenant_id','vin','action','charged','unit_cost','pulled_by','created_at')
  ) <> 8 THEN
    RAISE EXCEPTION 'title_report_pulls is missing one of the columns the meter reads';
  END IF;

  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.title_report_pulls'::regclass) THEN
    RAISE EXCEPTION 'RLS is not enabled on title_report_pulls';
  END IF;

  SELECT p.polcmd,
         EXISTS (SELECT 1 FROM pg_roles r WHERE r.oid = ANY(p.polroles) AND r.rolname = 'authenticated')
    INTO v_policy_cmd, v_policy_role
    FROM pg_policy p
   WHERE p.polrelid = 'public.title_report_pulls'::regclass
     AND p.polname  = 'title_report_pulls tenant read';

  IF v_policy_cmd IS NULL THEN
    RAISE EXCEPTION 'the title_report_pulls tenant read policy is missing';
  END IF;
  IF v_policy_cmd <> 'r' OR NOT v_policy_role THEN
    RAISE EXCEPTION 'the title_report_pulls read policy is not a SELECT policy TO authenticated';
  END IF;

  -- Nothing but the service role may append to a billing meter.
  IF EXISTS (
    SELECT 1 FROM pg_policy
     WHERE polrelid = 'public.title_report_pulls'::regclass
       AND polcmd <> 'r'
  ) THEN
    RAISE EXCEPTION 'title_report_pulls has a write policy; only the service role may append to the meter';
  END IF;

  IF to_regclass('public.title_reports') IS NOT NULL THEN
    RAISE EXCEPTION 'title_reports exists; the VINData terms forbid persisting the provider response';
  END IF;

  -- This migration writes no data. If either is non-zero, something other than
  -- this migration ran, and the "rollback is a clean drop" claim no longer holds.
  IF (SELECT count(*) FROM public.title_report_pulls) <> 0 THEN
    RAISE EXCEPTION 'title_report_pulls is not empty at apply time';
  END IF;
  IF (SELECT count(*) FROM public.vehicle_listings WHERE title_verification IS NOT NULL) <> 0 THEN
    RAISE EXCEPTION 'title_verification is already populated at apply time';
  END IF;
END $$;
