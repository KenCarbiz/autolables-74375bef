-- Migration drift repair, plus the guard that makes the next one visible.
--
-- Diffing the 264 functions declared across supabase/migrations against the
-- 250 actually present in the database found 16 missing, 7 of them called by
-- live application code and therefore failing silently on every click:
--
--   autocurb_sync_entitlements            paid subscriptions could not activate
--   list_tenant_members                   team roster, 3 screens
--   remove_tenant_member                  cannot remove a teammate
--   record_signing_event                  signing telemetry, 2 screens
--   signing_funnel_summary                admin funnel widget
--   record_getready_install_proof         vendor install proof
--   get_crawl_advertised_prices_schedule  crawl diagnostic panel
--
-- Six migrations had never applied. They were applied by hand on 2026-09-08,
-- function-by-function rather than file-by-file, because replaying the files
-- whole would have caused three regressions. This migration re-asserts the
-- correct end state so a FRESH database, which does replay those files in
-- order, lands in the same place.
--
-- 1. 20260617000000_team_rbac.sql narrows tenant_members_role_check to seven
--    roles. The live system uses twenty-one, including used_car_manager,
--    service_manager, detail and third_party_vendor -- the roles the whole
--    lifecycle is built on. Replaying that file would break role assignment.
-- 2. The same file redefines rbac_is_tenant_admin, set_tenant_member_role and
--    invite_tenant_member, all superseded later -- one of them by
--    20260726191000_member_role_authority_hardening.sql. Replaying it would
--    silently roll back a security hardening.
-- 3. 20260419020000_billing_contract.sql grants `authenticated` EXECUTE on
--    autocurb_sync_entitlements. That function is the single writer for paid
--    entitlements; with that grant any signed-in dealer can award themselves
--    any tier without paying. CLAUDE.md's single-writer rule says Autocurb's
--    stripe-webhook is authoritative and it calls with the service-role key,
--    so `authenticated` is never needed.
--
-- Idempotent and safe to re-run.

-- 1. Keep the full role set. Re-asserted so a replay of team_rbac cannot
--    narrow it back to seven.
ALTER TABLE public.tenant_members DROP CONSTRAINT IF EXISTS tenant_members_role_check;
ALTER TABLE public.tenant_members
  ADD CONSTRAINT tenant_members_role_check
  CHECK (role IN (
    'owner','admin','general_manager','gsm','sales_manager','salesperson',
    'used_car_manager','inventory_manager','service_manager','service_advisor',
    'office','detail','third_party_vendor','finance','compliance','biller',
    'readonly','manager','staff','sales','viewer'));

-- 2. Entitlement writer: service_role only. Never `authenticated`.
DO $$
BEGIN
  EXECUTE 'REVOKE ALL ON FUNCTION public.autocurb_sync_entitlements(uuid, jsonb) FROM PUBLIC, anon, authenticated';
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.autocurb_sync_entitlements(uuid, jsonb) TO service_role';
EXCEPTION WHEN undefined_function THEN
  RAISE WARNING 'autocurb_sync_entitlements absent; grant not adjusted';
END $$;

-- 3. The crawl diagnostic looked only for a job named 'crawl-advertised-prices'.
--    The job actually running every six hours is
--    'autolabels_crawl_advertised_prices', so a healthy job reported as absent.
CREATE OR REPLACE FUNCTION public.get_crawl_advertised_prices_schedule()
RETURNS TABLE (cron_expression TEXT, active BOOLEAN, last_run TIMESTAMPTZ)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, cron
AS $$
BEGIN
  RETURN QUERY
  SELECT j.schedule::TEXT, j.active,
         (SELECT MAX(jrd.start_time) FROM cron.job_run_details jrd WHERE jrd.jobid = j.jobid)
  FROM cron.job j
  WHERE j.jobname IN ('crawl-advertised-prices','autolabels_crawl_advertised_prices')
  ORDER BY j.jobname LIMIT 1;
END $$;
REVOKE ALL ON FUNCTION public.get_crawl_advertised_prices_schedule() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_crawl_advertised_prices_schedule() TO authenticated, service_role;

-- 4. The guard. A migration that silently fails to apply is indistinguishable
--    from one that worked, which is how seven broken call sites survived for
--    weeks. This reports which public functions the database is missing, given
--    the list the repo expects. Call it from a deploy check:
--
--      SELECT * FROM public.missing_expected_functions(ARRAY[...names...]);
--
--    Generate the array from the repo with:
--      grep -rhoiE 'CREATE (OR REPLACE )?FUNCTION +(public\.)?"?([a-z0-9_]+)' \
--        supabase/migrations/*.sql \
--      | sed -E 's/.*[Nn] +(public\.)?"?//' | tr 'A-Z' 'a-z' | sort -u
CREATE OR REPLACE FUNCTION public.missing_expected_functions(_expected text[])
RETURNS TABLE (missing_function text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT e.fn
  FROM unnest(_expected) AS e(fn)
  WHERE NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = e.fn)
  ORDER BY e.fn;
$$;
REVOKE ALL ON FUNCTION public.missing_expected_functions(text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.missing_expected_functions(text[]) TO authenticated, service_role;

-- Self-verification, same contract as the preceding hardening migrations.
DO $$
DECLARE
  v_missing text;
  v_roles int;
BEGIN
  SELECT string_agg(m.missing_function, ', ') INTO v_missing
  FROM public.missing_expected_functions(ARRAY[
    'autocurb_sync_entitlements','get_tenant_billing_summary','list_tenant_members',
    'remove_tenant_member','record_signing_event','signing_funnel_summary',
    'record_getready_install_proof','get_crawl_advertised_prices_schedule']) m;

  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'drift repair incomplete, still missing: %', v_missing;
  END IF;

  SELECT count(*) INTO v_roles
  FROM unnest(ARRAY['used_car_manager','service_manager','detail','third_party_vendor']) r
  WHERE pg_get_constraintdef(
          (SELECT oid FROM pg_constraint
            WHERE conrelid='public.tenant_members'::regclass
              AND conname='tenant_members_role_check')) LIKE '%'||r||'%';

  IF v_roles < 4 THEN
    RAISE EXCEPTION 'tenant_members role check lost lifecycle roles (found % of 4)', v_roles;
  END IF;

  IF has_function_privilege('authenticated','public.autocurb_sync_entitlements(uuid,jsonb)','EXECUTE') THEN
    RAISE EXCEPTION 'autocurb_sync_entitlements is executable by authenticated; dealers could self-grant paid tiers';
  END IF;
END $$;
