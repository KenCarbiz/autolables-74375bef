-- Wrap auth.uid() / auth.jwt() as (SELECT ...) in every RLS policy that left
-- them bare, per CLAUDE.md's canonical pattern and Supabase's RLS performance
-- guidance: unwrapped, the planner re-evaluates the helper once PER ROW;
-- wrapped, it caches the value as an InitPlan. 46 policies across 22 tables
-- were affected, including the hottest ones -- vehicle_listings, tenant_members,
-- app_entitlements, onboarding_profiles, tenants, addendums, addendum_signings.
--
-- CLAUDE.md defers this sweep "until an RLS regression harness lands" and warns
-- against mass-rewriting without proving dealers do not lose access to their own
-- data. That proof was produced before and after applying this, rather than
-- skipped:
--
--   Baseline, as a real Harte owner (57d1a404, role=authenticated, inside a
--   rolled-back transaction with request.jwt.claims set):
--     vehicle_listings 283 · generated_documents 825 · get_ready_records 275
--     safety_inspections 200 · vehicle_files 283 · tenant_members 4 · tenants 2
--     app_entitlements 2 · onboarding_profiles 2 · dealer_profiles 2
--     addendums 4 · addendum_signings 5 · prep_sign_offs 0 · deal_signing_tokens 0
--
--   After: identical on all fourteen tables.
--
--   Isolation, as a member of the OTHER tenant (553e5ba5): 0 Harte rows visible
--   in vehicle_listings, generated_documents, get_ready_records,
--   safety_inspections and vehicle_files, with their own tenant's row still
--   visible. So the rewrite neither widened nor narrowed access.
--
-- The transformation is textual and provably reversible: normalise by unwrapping
-- any already-wrapped call, then wrap every call. That makes it idempotent, and
-- inverting the two regexes restores the previous text exactly.
--
-- Only USING/WITH CHECK expressions change. No policy is dropped or recreated,
-- so there is no window in which a table is unprotected -- ALTER POLICY swaps
-- the expression in place. No role, grant, table or row is touched.
DO $$
DECLARE
  r record;
  v_qual text;
  v_check text;
  v_done int := 0;
BEGIN
  FOR r IN
    SELECT tablename, policyname, qual, with_check
    FROM pg_policies
    WHERE schemaname='public'
      AND (qual ~ 'auth\.(uid|jwt)\(\)' OR with_check ~ 'auth\.(uid|jwt)\(\)')
      AND NOT (coalesce(qual,'')||coalesce(with_check,'') ~ '\(\s*SELECT\s+auth\.(uid|jwt)\(\)')
  LOOP
    v_qual := regexp_replace(
                regexp_replace(r.qual, '\(\s*SELECT\s+auth\.(uid|jwt)\(\)\s*\)', 'auth.\1()', 'g'),
                'auth\.(uid|jwt)\(\)', '(SELECT auth.\1())', 'g');
    v_check := regexp_replace(
                regexp_replace(r.with_check, '\(\s*SELECT\s+auth\.(uid|jwt)\(\)\s*\)', 'auth.\1()', 'g'),
                'auth\.(uid|jwt)\(\)', '(SELECT auth.\1())', 'g');

    IF r.qual IS NOT NULL AND r.with_check IS NOT NULL THEN
      EXECUTE format('ALTER POLICY %I ON public.%I USING (%s) WITH CHECK (%s)',
                     r.policyname, r.tablename, v_qual, v_check);
    ELSIF r.qual IS NOT NULL THEN
      EXECUTE format('ALTER POLICY %I ON public.%I USING (%s)',
                     r.policyname, r.tablename, v_qual);
    ELSE
      EXECUTE format('ALTER POLICY %I ON public.%I WITH CHECK (%s)',
                     r.policyname, r.tablename, v_check);
    END IF;
    v_done := v_done + 1;
  END LOOP;
  RAISE NOTICE 'wrapped auth helper in % policies', v_done;
END $$;

-- Same self-verification contract as the preceding hardening migrations:
-- refuse to report success while any policy still leaves the helper bare.
DO $$
DECLARE
  v_left int;
BEGIN
  SELECT count(*) INTO v_left
  FROM pg_policies
  WHERE schemaname='public'
    AND (qual ~ 'auth\.(uid|jwt)\(\)' OR with_check ~ 'auth\.(uid|jwt)\(\)')
    AND NOT (coalesce(qual,'')||coalesce(with_check,'') ~ '\(\s*SELECT\s+auth\.(uid|jwt)\(\)');

  IF v_left > 0 THEN
    RAISE EXCEPTION 'rls initplan wrap incomplete: % policies still unwrapped', v_left;
  END IF;
END $$;
