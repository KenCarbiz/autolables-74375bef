-- ──────────────────────────────────────────────────────────────────────
-- get_vehicle_listing_by_slug stops being an anonymous read of the whole
-- listing row.
--
-- PURPOSE
--
-- public.get_vehicle_listing_by_slug(text) is SECURITY DEFINER, its body is
-- `SELECT * FROM public.vehicle_listings`, it RETURNS SETOF
-- public.vehicle_listings, and EXECUTE is granted to anon and authenticated
-- (20260626050347:28, re-created and re-granted at 20260729030000:100-110 and
-- 20260729132322:71-81). All 86 columns of the table therefore leave the
-- database for anyone holding the project's anon key.
--
-- The customer Passport is not the leak. The Passport calls the edge function
-- public-listing-view, which calls the RPC with the SERVICE-ROLE key
-- (public-listing-view/index.ts:61,70,113) and only THEN deletes
-- PUBLIC_VIEW_DENY -- install_token, created_by, assigned_agent_id,
-- recall_override_by / _at / _notes, price_parse_notes, mc_raw
-- (public-listing-view/index.ts:910, _shared/lotFeedRow.ts:20-38,75-77).
-- That deny sweep runs in Deno, after the row has already crossed the SQL
-- boundary. A caller who skips the edge function and posts straight to
-- /rest/v1/rpc/get_vehicle_listing_by_slug with the anon key gets the row the
-- sweep was written to prevent, and the function resolves on a bare VIN
-- (`vin = upper(_slug)`), so a VIN off a windshield is the whole input.
--
-- install_token is the part that is not merely embarrassing. It is the sole
-- credential for the anon `install_proofs_upload` storage policy and for
-- record_install_proof(), which is EXECUTE-granted to anon; it is set on
-- 285 of 285 anon-reachable rows. Reading it is not reading data, it is
-- acquiring a write capability.
--
-- FORWARD SQL
--
-- REVOKE EXECUTE from anon and authenticated. Nothing else. The function's
-- signature, body, volatility, SECURITY DEFINER flag, return type and the row
-- set it produces are untouched, so no caller's row shape changes and no row
-- changes value. service_role keeps EXECUTE, and service_role is the only key
-- any surviving caller uses.
--
-- Why the grant and not the body: every remaining caller was checked and every
-- one of them holds the service key.
--
--   supabase/functions/public-listing-view/index.ts:113,132 -- service role
--     (`createClient(supabaseUrl, serviceKey)` :70, key read at :61). This is
--     the Passport's only server path.
--   supabase/functions/marketcheck-comps/index.ts:63,68 -- service role
--     (`adminClient()` :38 -> _shared/supabase.ts:13-14, SERVICE_KEY).
--   src/hooks/useVehicleListing.ts:364-368 (`getBySlug`) -- browser, anon or
--     user JWT, and DEAD. It is returned from the hook (:387) and no consumer
--     destructures it: the five files that call useVehicleListing() take only
--     publicUrl, createListing, publishListing and embedSnippet
--     (PublicDocuments.tsx:605, PublicListing.tsx:204, VehiclePassportV3.tsx:386,
--     UsedCarSticker.tsx:47, NewCarSticker.tsx:34). `grep -rn getBySlug src
--     supabase` returns the definition and the return statement, nothing else.
--   No other reference exists: a repo-wide grep finds only migrations, the
--     generated types file (src/integrations/supabase/types.ts:10664), two
--     comments (src/lib/commandCenter/passportVisibility.ts:10 and its test)
--     and one test that reads a migration's TEXT
--     (src/lib/inventory/retirement.test.ts:56-67 -- it asserts the 2026-07-29
--     file still contains its GRANT line; that file is not edited here, so the
--     suite stays green). No SQL function or view in the live catalog
--     references it (checked against pg_proc.prosrc and
--     information_schema.views: zero rows). No raw /rest/v1/rpc call anywhere.
--
-- The code audit is corroborated by 152 days of runtime. pg_stat_statements
-- has been accumulating since 2026-04-10 and holds 13 distinct PostgREST
-- invocations of this RPC totalling 2,058 calls. Every one of them ran as
-- service_role. There is not a single call as anon or as authenticated in the
-- whole window -- which also covers the sister apps that share this Supabase
-- project, since they would appear here as anon or authenticated calls if they
-- used the RPC:
--
--   SELECT s.userid::regrole::text, sum(s.calls), count(*)
--     FROM pg_stat_statements s
--    WHERE s.query ILIKE '%get_vehicle_listing_by_slug%'
--      AND s.query ILIKE '%pgrst_source%'
--    GROUP BY 1;                    -- service_role | 2058 | 13   (only row)
--
-- The alternative -- keep the anon grant and NULL the sensitive columns inside
-- the body -- was rejected. It rewrites the function that serves the locked
-- Passport in order to protect callers that do not exist, and it would have to
-- be revisited every time vehicle_listings grows a column. Revoking a grant is
-- one statement, changes no shape, and is undone by one statement.
--
-- DATA IMPACT
--
-- None. No INSERT, UPDATE, DELETE or DDL against any table. Zero rows written.
-- Nothing is backfilled and nothing needs to be.
--
-- What changes is reachability, and it changes for exactly one caller class:
-- a request bearing the anon key or a dealer's user JWT that calls this RPC
-- directly. Live counts of the rows whose exposure closes (2026-09-09, project
-- onnbmmdbrsgytfozfozn):
--
--   285 rows are anon-reachable through the RPC today
--       (131 published + 154 archived-with-archived_at), across 2 tenants.
--   285 of 285 carry a non-null install_token (the credential).
--   282 of 285 carry mc_raw; 280 carry price_parse_notes; 5 carry created_by.
--   86 columns per row.
--
-- After this migration those 285 rows are reachable by anon through no path at
-- all: anon holds no SELECT privilege on public.vehicle_listings (checked in
-- information_schema.role_table_grants -- anon has INSERT/UPDATE/DELETE/
-- TRUNCATE/REFERENCES/TRIGGER but NOT SELECT; 20260623022547:40 dropped it),
-- and PUBLIC holds no EXECUTE on this function
-- (has_function_privilege('public', ...) = false; live ACL is exactly
-- postgres, service_role, anon, authenticated).
--
-- authenticated loses a cross-tenant read. Dealer staff lose nothing they can
-- see today by other means: authenticated keeps SELECT on vehicle_listings
-- under the policy "Tenant members view listings"
-- (qual: tenant_id = current_tenant_id() OR (tenant_id IS NULL AND created_by =
-- (SELECT auth.uid()))), so a signed-in user still reads their OWN tenant's
-- listings directly. What the RPC gave them, and this takes away, is the other
-- tenant's rows -- SECURITY DEFINER bypasses that policy.
--
-- THE PASSPORT IS UNAFFECTED -- how that was proved
--
--   1. The browser never calls this RPC. src/hooks/usePublicListing.ts:48 is
--      the single fetch for every Passport surface and it invokes the edge
--      function public-listing-view. VehiclePassportGoverned.tsx and every
--      sub-page read that hook's result.
--   2. The edge function calls the RPC with the service-role client
--      (index.ts:61,70,113,132). service_role's EXECUTE is deliberately left
--      in place below, and the DO block asserts it is still there.
--   3. The function body is not touched, so the row the Passport receives is
--      byte-for-byte the row it receives today -- same columns, same values,
--      same slug/VIN resolution, same published-or-archived predicate, same
--      ORDER BY. There is no column to enumerate and no column to prove
--      un-nulled, because nothing is nulled. That is the point of choosing
--      the grant over the body.
--   4. Specifically for vehicle_listings.title_verification, added by
--      20260721210000 (approved in this same batch) and read by
--      derivePassport at src/lib/passportV2Data.ts:582: this migration is
--      column-agnostic. RETURNS SETOF public.vehicle_listings still resolves
--      to the live rowtype, so title_verification flows through the RPC the
--      moment the column exists, exactly as that migration's header (:13-17)
--      says it will. Confirmed against the live catalog: the column does not
--      exist yet, and nothing here would gate it if it did.
--
-- RLS IMPACT
--
-- None. No policy is created, dropped or altered, and no table's RLS is
-- enabled or disabled. vehicle_listings keeps RLS on with its four existing
-- policies (all already TO authenticated with auth.uid() wrapped as
-- (SELECT auth.uid()), per the CLAUDE.md house rule). This migration is a
-- privilege change on a routine, which is a different mechanism from RLS --
-- and the reason the leak existed at all is that SECURITY DEFINER makes the
-- table's RLS irrelevant to this function. Removing the grant is what makes
-- the table's RLS the operative control for anon and authenticated again.
--
-- INDEX IMPACT
--
-- None. No index is created, dropped or reindexed; no query plan changes. The
-- function's own lookup (slug / upper(vin)) is unchanged and still runs for
-- the service-role caller on every Passport load.
--
-- EXPECTED ROW COUNTS
--
--   Rows written by this migration:                             0
--   Rows whose exposure changes:                              285
--     of which published:                                     131
--     of which archived (archived_at NOT NULL):               154
--   Tenants touched:                                            2
--   Callers that change behaviour:                              1
--     src/hooks/useVehicleListing.ts:364 getBySlug -- dead code; it would
--     now return a permission error if anything ever called it. Nothing does.
--   Callers that do NOT change behaviour:                        2
--     public-listing-view (service role) and marketcheck-comps (service role).
--   ACL rows on the function after this migration:               2
--     postgres, service_role.
--
-- BACKFILL PLAN
--
-- Not applicable -- no data is added, moved or rewritten. There is no
-- historical state to reconcile and no window during which rows are half
-- migrated. The REVOKE is a single catalog update that takes effect for the
-- next request; in-flight service-role requests are unaffected because
-- service_role's grant is never removed.
--
-- VERIFICATION QUERY (run after apply; expects exactly one row, all booleans
-- as shown)
--
--   SELECT p.oid::regprocedure::text                              AS sig,
--          p.prosecdef                                            AS still_definer,
--          pg_get_function_result(p.oid)                          AS still_setof_listings,
--          has_function_privilege('anon', p.oid, 'EXECUTE')       AS anon_exec,
--          has_function_privilege('authenticated', p.oid,'EXECUTE') AS auth_exec,
--          has_function_privilege('service_role', p.oid,'EXECUTE') AS svc_exec,
--          has_function_privilege('public', p.oid, 'EXECUTE')     AS public_exec,
--          p.proacl::text                                         AS acl
--     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname = 'public'
--      AND p.proname = 'get_vehicle_listing_by_slug';
--
--   Expected: still_definer = t, still_setof_listings = 'SETOF vehicle_listings',
--             anon_exec = f, auth_exec = f, svc_exec = t, public_exec = f,
--             acl = {postgres=X/postgres,service_role=X/postgres}
--
--   And the Passport path, which must still resolve (expects 1):
--
--   SELECT count(*) FROM public.get_vehicle_listing_by_slug(
--     (SELECT slug FROM public.vehicle_listings
--       WHERE status = 'published' AND slug IS NOT NULL LIMIT 1));
--
-- ROLLBACK / COMPENSATING STRATEGY
--
-- One statement, no data to restore, safe to run at any time:
--
--   GRANT EXECUTE ON FUNCTION public.get_vehicle_listing_by_slug(text)
--     TO anon, authenticated;
--
-- That returns the ACL to exactly its pre-migration value
-- ({postgres,service_role,anon,authenticated}). Because nothing was written,
-- rolling back restores the previous behaviour completely -- there is no
-- compensating data repair, no reprocessing and no window of divergence.
--
-- Symptom that would call for it: a Passport surface returning
-- "permission denied for function get_vehicle_listing_by_slug". That would
-- mean a caller uses the anon or user key after all, contradicting the audit
-- above; restore the grant first, then fix that caller to route through
-- public-listing-view before revoking again.
-- ──────────────────────────────────────────────────────────────────────

REVOKE EXECUTE ON FUNCTION public.get_vehicle_listing_by_slug(text)
  FROM anon, authenticated;

DO $$
DECLARE
  fn_oid       oid;
  sample_slug  text;
  sample_rows  integer;
BEGIN
  -- to_regprocedure resolves the exact (text) overload and returns NULL
  -- rather than raising when it is absent.
  fn_oid := to_regprocedure('public.get_vehicle_listing_by_slug(text)');

  IF fn_oid IS NULL THEN
    RAISE EXCEPTION
      'get_vehicle_listing_by_slug(text) is missing -- the revoke had nothing to act on';
  END IF;

  -- The leak is closed.
  IF has_function_privilege('anon', fn_oid, 'EXECUTE') THEN
    RAISE EXCEPTION
      'anon can still EXECUTE get_vehicle_listing_by_slug(text); the whole listing row is still public';
  END IF;

  IF has_function_privilege('authenticated', fn_oid, 'EXECUTE') THEN
    RAISE EXCEPTION
      'authenticated can still EXECUTE get_vehicle_listing_by_slug(text); cross-tenant read is still open';
  END IF;

  -- A PUBLIC grant would defeat the revoke without appearing as a role grant.
  IF has_function_privilege('public', fn_oid, 'EXECUTE') THEN
    RAISE EXCEPTION
      'PUBLIC holds EXECUTE on get_vehicle_listing_by_slug(text); revoking anon and authenticated changed nothing';
  END IF;

  -- The Passport's server path is untouched.
  IF NOT has_function_privilege('service_role', fn_oid, 'EXECUTE') THEN
    RAISE EXCEPTION
      'service_role lost EXECUTE on get_vehicle_listing_by_slug(text); public-listing-view and marketcheck-comps would 500';
  END IF;

  -- The contract every caller depends on is unchanged: same shape, same
  -- SECURITY DEFINER read past RLS, same SELECT * body.
  IF pg_get_function_result(fn_oid) <> 'SETOF vehicle_listings' THEN
    RAISE EXCEPTION
      'get_vehicle_listing_by_slug(text) no longer RETURNS SETOF vehicle_listings (got %) -- caller row shape changed',
      pg_get_function_result(fn_oid);
  END IF;

  IF NOT (SELECT prosecdef FROM pg_proc WHERE oid = fn_oid) THEN
    RAISE EXCEPTION
      'get_vehicle_listing_by_slug(text) is no longer SECURITY DEFINER; the service-role Passport read would now hit RLS';
  END IF;

  IF (SELECT prosrc FROM pg_proc WHERE oid = fn_oid) NOT LIKE '%SELECT * FROM public.vehicle_listings%' THEN
    RAISE EXCEPTION
      'get_vehicle_listing_by_slug(text) body changed; this migration must not alter which columns the Passport receives';
  END IF;

  -- And it still resolves a real vehicle, which is what the Passport asks of
  -- it. Skipped only on a database with no published listing to ask about.
  SELECT slug INTO sample_slug
    FROM public.vehicle_listings
   WHERE status = 'published' AND slug IS NOT NULL
   LIMIT 1;

  IF sample_slug IS NOT NULL THEN
    SELECT count(*) INTO sample_rows
      FROM public.get_vehicle_listing_by_slug(sample_slug);
    IF sample_rows <> 1 THEN
      RAISE EXCEPTION
        'get_vehicle_listing_by_slug(%) returned % rows, expected 1 -- the Passport lookup is broken',
        sample_slug, sample_rows;
    END IF;
  END IF;
END $$;
