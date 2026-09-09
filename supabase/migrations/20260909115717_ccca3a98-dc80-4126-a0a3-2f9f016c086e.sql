-- stale_document_flags: give the reconcile path the DELETE it has always
-- assumed, then collapse the 7,078 duplicate rows the missing policy created.
--
-- PURPOSE
--
-- The client reconcile path is written as a refresh: for each issued document
-- it clears that document's OPEN flags and re-inserts the findings it just
-- computed, leaving reviewed/resolved/ignored rows alone as an audit trail
-- (src/lib/stickerStudio/staleDetection.ts:80-95). The service-role path in
-- supabase/functions/factory-sticker-orchestrate/truth.ts:386-395 is the same
-- contract and works, because service_role bypasses RLS.
--
-- The client path does not work. The table was created with a single
-- FOR ALL policy (20260620140000_stale_document_flags.sql:35). One day later
-- 20260621003616:27 dropped the table CASCADE and rebuilt it with three
-- policies -- SELECT, INSERT, UPDATE -- and no DELETE; 20260622160526:91-100
-- rewrote those same three to add the accepted_at membership test, still
-- without a DELETE. Live pg_policy confirms exactly three policies today, all
-- TO authenticated, none for DELETE. The table-level grant is intact
-- (has_table_privilege('authenticated','stale_document_flags','DELETE') is
-- true), so RLS denies the delete silently -- zero rows matched, no error --
-- and staleDetection.ts:82 swallows the result anyway. Every mount of the
-- Vehicle File Documents tab (src/components/vehicle/GeneratedDocumentsSection.tsx:71)
-- therefore appended a fresh set of flags on top of the previous set.
--
-- The result is 7,080 open rows that describe two findings. Adding the
-- missing DELETE policy makes the reconcile path behave as written and stops
-- the growth at the source; this migration also collapses what the defect
-- already accumulated.
--
-- The same 20260621003616 rebuild also dropped the partial unique index
-- uq_stale_flag_open (generated_document_id, changed_field) WHERE status =
-- 'open' that 20260620140000:26-28 had created. It is deliberately NOT
-- restored here -- see INDEX IMPACT.
--
-- DATA IMPACT
--
-- Live counts, read-only on 2026-09-09 against project onnbmmdbrsgytfozfozn:
--
--   stale_document_flags total rows                          7,080
--     of which status = 'open'                               7,080
--     of which status <> 'open'                                  0
--   distinct tenants                        1 (3f0f97f5-...-e2d6fc5a3142,
--                                              Harte Infiniti, the pilot)
--   distinct vehicle_id                                           2
--   distinct generated_document_id                                2
--   rows with a NULL generated_document_id                        0
--   created_at range           2026-08-03 18:59:28Z .. 2026-08-12 19:32:11Z
--
-- The 7,080 open rows form exactly two (tenant_id, generated_document_id,
-- changed_field) groups:
--
--   A. tenant 3f0f97f5..., document e777df2e-9cd9-402c-8e35-0878803416cb
--      (generated_documents: document_type 'window', status 'published'),
--      vehicle a1ad8709-6c74-48e3-a6d7-e074cb4b517c
--      (vehicle_listings VIN 7SAYGDEE2TF369123, ARCHIVED 2026-08-27),
--      changed_field 'price', severity 'warning'          7,079 rows
--      old_value 3238.99 on all of them; new_value 45876 on the 222 rows
--      written 2026-08-03, new_value 45474 on the 6,857 rows written
--      2026-08-12. Newest row: 2026-08-12 19:32:11.87849Z, new_value 45474.
--
--   B. tenant 3f0f97f5..., document 8ced3637-be02-4a66-a6e6-a7210473a7c7
--      (document_type 'factory_sticker', status 'superseded'),
--      vehicle e054aac9-9350-47d9-8408-838a5b57bad2
--      (VIN 7SAYGDEF9RF035866, ARCHIVED 2026-08-16),
--      changed_field 'mechanical.transmission'                 1 row
--
-- Neither group has a tie at its max(created_at) (verified: ties_at_max = 1
-- for both), so "the newest row per group" is unambiguous without the id
-- tiebreak, which is included anyway.
--
--   EXPECTED ROWS DELETED                                     7,078
--   EXPECTED ROWS REMAINING (open)                                2
--   EXPECTED TABLE ROWS AFTER                                     2
--
-- Both surviving rows are the newest of their group: A keeps the 2026-08-12
-- 19:32:11Z row (new_value 45474, the later of the two observed prices),
-- B keeps its only row.
--
-- WHO CHANGES BEHAVIOUR
--
--   src/pages/DocumentReview.tsx via useStaleQueue
--   (src/lib/stickerStudio/useStaleFlags.ts:33-38) -- tenant-wide open flags,
--   no limit, one card rendered per row. This is the surface where the
--   collapse is visible: the manager review queue stops being thousands of
--   copies of one price flag and becomes two cards. Both point at archived
--   vehicles, so the honest post-state is "two flags on cars that already
--   left the lot", not "all clear".
--
--   src/components/vehicle/GeneratedDocumentsSection.tsx:65 via
--   useVehicleStaleFlags (useStaleFlags.ts:57) -- per-vehicle open flags on
--   the Vehicle File Documents tab. Vehicle a1ad8709 goes from 7,079 flags
--   to 1. Reachable only by opening that archived vehicle's file.
--
--   src/components/compliance/useComplianceCenterData.ts:105 -- selects
--   stale_document_flags ordered created_at DESC with limit 5000 and no
--   status filter. Today the 6,857 newest duplicates consume the whole cap,
--   so group B's flag (2026-08-11) never reaches the browser at all. After
--   the collapse both rows fit inside the cap. The fetched rows are not read
--   by any downstream consumer (complianceData.ts contains no reference), so
--   the effect there is payload -- about 5,000 rows down to 2 -- plus a flag
--   that was invisible becoming visible.
--
-- WHO DOES NOT CHANGE
--
--   operating_metrics(p_tenant_id) -> 'price_review_required' is the only
--   object in the live catalog that reads this table (pg_proc scan over
--   pg_get_functiondef: one hit; information_schema.views: none). It counts
--   DISTINCT f.vehicle_id and INNER JOINs the non-archived listing set, and
--   both flagged vehicles are archived -- so the badge behind
--   src/hooks/useNavBadges.ts:92 and src/hooks/useOperatingMetrics.ts:82
--   reads 0 before this migration and 0 after.
--
--   src/hooks/useVehicleCompliance.ts:116 maps flag.vehicle_id through
--   vehicle_files.id, but flags carry a vehicle_listings id
--   (staleDetection.ts:87, truth.ts:389-395), so the map is empty today and
--   stays empty; reprint_required is false before and after.
--
--   THE CUSTOMER PASSPORT IS NOT AFFECTED. Nothing on the served passport
--   path reads this table: grep for stale_document_flags across
--   supabase/functions/public-listing-view/, src/pages/VehiclePassport*.tsx,
--   src/lib/passportV2Data.ts, src/lib/passport/, src/hooks/usePublicListing.ts,
--   src/pages/PublicDocuments.tsx and src/hooks/usePublishedWindowSticker.ts
--   returns nothing, and neither get_vehicle_listing_by_slug nor
--   get_published_documents_public references it. No table has a foreign key
--   INTO stale_document_flags (pg_constraint: zero inbound references), so
--   deleting these rows cascades nowhere; the FK runs the other way
--   (generated_document_id -> generated_documents ON DELETE SET NULL), and
--   the two flagged documents in generated_documents are untouched. The only
--   trigger on the table is trg_stale_flags_updated, BEFORE UPDATE, which a
--   DELETE never fires.
--
-- RLS IMPACT
--
-- One policy added: DELETE, TO authenticated, tenant-scoped in the CLAUDE.md
-- shape with auth.uid() wrapped as (SELECT auth.uid()). Its USING clause is
-- copied verbatim from the sibling SELECT/INSERT/UPDATE policies, including
-- the accepted_at IS NOT NULL membership test, so a user who can already
-- read and insert a tenant's flags can delete exactly the same rows and no
-- others -- if it were written without accepted_at it would be wider than
-- the SELECT policy that governs what the same user can even see. The pilot
-- tenant has 2 members, both with accepted_at set, so no one is locked out.
-- anon holds the table-level DELETE grant but has no policy on this table in
-- any command, and this migration adds none for it, so anon stays denied.
-- service_role continues to bypass RLS. No existing policy is altered.
--
-- INDEX IMPACT
--
-- No index is created or dropped. The heap is 1,704 kB across 7,080 rows and
-- 1,280 kB of indexes; after the collapse both shrink to near nothing, and
-- the four existing indexes (tenant_id/status/created_at, vehicle_id/status,
-- generated_document_id, severity) keep serving every reader listed above.
--
-- A partial unique index on (tenant_id, generated_document_id, changed_field)
-- WHERE status = 'open' WOULD prevent recurrence structurally, and it is
-- deliberately NOT added, because it breaks a live writer:
--
--   flagStaleDocuments (truth.ts:373-397) builds one document's rows by
--   filtering FAMILY_KEYS with documentTypesForFamily(family).includes(type)
--   and flat-mapping staleFlagsForFamily over the survivors. Both
--   new_vehicle_addendum and used_vehicle_addendum declare
--   legacyTypes: ["addendum"] (src/lib/documents/families.ts:80, 93), so a
--   stored document_type of 'addendum' matches TWO families; and three
--   material fields -- condition, identity.stockNumber and
--   equipment.dealerInstalled (src/lib/vehicleTruth/materialChange.ts:35, 42,
--   57) -- list both addendum families in their affects[]. The flatMap then
--   emits the same changed_field twice for one document, the single array
--   insert at truth.ts:391 fails 23505 as a whole, and the surrounding
--   try/catch swallows it -- every flag for that document is lost silently.
--   This is not hypothetical: generated_documents row
--   0e30abf9-ebfe-4943-b25e-1070587f7309 is document_type 'addendum',
--   status 'published', on vehicle fcf35d65-a0f7-418b-ba3f-35fbeff66da0
--   (VIN JN8AZ3CC9T9622022), a PUBLISHED pilot listing -- an on-lot car.
--
--   The client writer would not self-conflict (detectStale pushes at most one
--   finding per field), but two concurrent mounts would collide and lose a
--   flag to the same swallowed 23505.
--
-- So the index is safe only after truth.ts dedupes its rows by changed_field
-- (or the two addendum families stop sharing the 'addendum' legacy type).
-- Until then the DELETE policy is the fix: the reconcile path clears its own
-- open flags before re-inserting, which is what stops duplicates recurring.
--
-- BACKFILL PLAN
--
-- None beyond the one-time collapse below. The two surviving rows are left
-- open and unmodified; a manager resolves or ignores them from
-- /dashboard/document-review as normal. Nothing needs to be recomputed: the
-- next time anyone opens either vehicle's Documents tab, the reconcile path
-- deletes the survivor (now that it can) and re-inserts whatever is true
-- against the live row at that moment.
--
-- VERIFICATION QUERY (expect 2 rows out, 2 open flags, 0 duplicate groups)
--
--   SELECT count(*) FILTER (WHERE status = 'open')                AS open_rows,
--          count(*)                                               AS all_rows,
--          (SELECT count(*) FROM (
--             SELECT 1 FROM public.stale_document_flags
--              WHERE status = 'open'
--              GROUP BY tenant_id, generated_document_id, changed_field
--             HAVING count(*) > 1) d)                             AS dup_groups
--     FROM public.stale_document_flags;
--
--   SELECT polname, polcmd, pg_get_expr(polqual, polrelid) AS using_expr
--     FROM pg_policy
--    WHERE polrelid = 'public.stale_document_flags'::regclass
--    ORDER BY polcmd;   -- expect four policies: r, a, w, d
--
-- ROLLBACK / COMPENSATING STRATEGY
--
-- The policy is fully reversible:
--
--   DROP POLICY IF EXISTS "tenant delete stale_document_flags"
--     ON public.stale_document_flags;
--
-- THE DELETED ROWS ARE NOT RECOVERABLE. This migration writes no backup
-- table and no archive; once it commits, 7,078 rows are gone and no SQL in
-- this repository can bring them back. Restoring them would mean a
-- point-in-time restore of the whole database.
--
-- That is acceptable, and it is worth being plain about why:
--   1. The rows are derived, not recorded. Every one of them is a
--      recomputable comparison between a document's frozen data_snapshot and
--      the live vehicle_listings row -- not an observation, not a signature,
--      not evidence. Nothing in signed_document_archive, addendums,
--      advertised_prices or audit_log depends on them.
--   2. They are regenerated by the same reconcile path that created them. If
--      a finding is still true, the next visit to that vehicle's Documents
--      tab writes it again.
--   3. Every survivor is the newest of its group, so no information is lost
--      that the survivor does not already carry -- the discarded rows are
--      older restatements of the same (document, field) finding, and for
--      group A the survivor carries the later of the two new_value readings.
--   4. The rows are not an audit trail: the reviewed/resolved/ignored states
--      that WOULD be an audit trail are excluded from the delete by the
--      status = 'open' predicate, and there are zero such rows today anyway.
--
-- If a record of what was discarded is wanted before applying, run this
-- read-only snapshot first and keep the output outside the database:
--
--   SELECT * FROM public.stale_document_flags WHERE status = 'open'
--    ORDER BY tenant_id, generated_document_id, changed_field, created_at;

-- ---------------------------------------------------------------------------
-- 1. The missing DELETE policy.
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "tenant delete stale_document_flags" ON public.stale_document_flags;
CREATE POLICY "tenant delete stale_document_flags"
  ON public.stale_document_flags FOR DELETE
  TO authenticated
  USING (
    tenant_id IN (
      SELECT tm.tenant_id FROM public.tenant_members tm
      WHERE tm.user_id = (SELECT auth.uid()) AND tm.accepted_at IS NOT NULL
    )
  );

-- ---------------------------------------------------------------------------
-- 2. Collapse the duplicates the missing policy created.
--    Keep the newest open row per (tenant_id, generated_document_id,
--    changed_field); delete the rest. Non-open rows are never touched.
-- ---------------------------------------------------------------------------

-- Captured before the delete so the self-check below can prove that what
-- survived is the newest row of each group, and that the delete removed
-- exactly the arithmetic it was supposed to.
DROP TABLE IF EXISTS _stale_flag_collapse_before;
CREATE TEMP TABLE _stale_flag_collapse_before AS
SELECT tenant_id,
       generated_document_id,
       changed_field,
       count(*)        AS rows_before,
       max(created_at) AS newest_before
  FROM public.stale_document_flags
 WHERE status = 'open'
 GROUP BY tenant_id, generated_document_id, changed_field;

WITH survivors AS (
  SELECT DISTINCT ON (tenant_id, generated_document_id, changed_field) id
    FROM public.stale_document_flags
   WHERE status = 'open'
   ORDER BY tenant_id, generated_document_id, changed_field,
            created_at DESC, id DESC
)
DELETE FROM public.stale_document_flags f
 WHERE f.status = 'open'
   AND NOT EXISTS (SELECT 1 FROM survivors s WHERE s.id = f.id);

-- ---------------------------------------------------------------------------
-- 3. Self-check. Raises if the change did not take.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_policies    int;
  v_dup_groups  int;
  v_open        int;
  v_groups      int;
  v_expected    bigint;
  v_not_newest  int;
BEGIN
  -- (a) The DELETE policy exists, is scoped TO authenticated, and wraps
  --     auth.uid() as an initPlan per the CLAUDE.md RLS rule.
  SELECT count(*) INTO v_policies
    FROM pg_policy p
   WHERE p.polrelid = 'public.stale_document_flags'::regclass
     AND p.polcmd = 'd'
     AND p.polroles = ARRAY[(SELECT oid FROM pg_roles WHERE rolname = 'authenticated')]
     AND pg_get_expr(p.polqual, p.polrelid) LIKE '%SELECT auth.uid()%'
     AND pg_get_expr(p.polqual, p.polrelid) LIKE '%tenant_members%';
  IF v_policies <> 1 THEN
    RAISE EXCEPTION
      'stale_document_flags: expected exactly 1 tenant-scoped DELETE policy TO authenticated wrapping (SELECT auth.uid()), found %',
      v_policies;
  END IF;

  -- (b) No (tenant, document, field) group has more than one open row left.
  SELECT count(*) INTO v_dup_groups FROM (
    SELECT 1 FROM public.stale_document_flags
     WHERE status = 'open'
     GROUP BY tenant_id, generated_document_id, changed_field
    HAVING count(*) > 1
  ) d;
  IF v_dup_groups <> 0 THEN
    RAISE EXCEPTION
      'stale_document_flags: % duplicate open (tenant, document, field) group(s) survived the collapse',
      v_dup_groups;
  END IF;

  -- (c) Exactly one open row survived per group that existed before.
  SELECT count(*) INTO v_open
    FROM public.stale_document_flags WHERE status = 'open';
  SELECT count(*), coalesce(sum(rows_before), 0)
    INTO v_groups, v_expected
    FROM _stale_flag_collapse_before;
  IF v_open <> v_groups THEN
    RAISE EXCEPTION
      'stale_document_flags: % open rows remain but % group(s) existed before the collapse',
      v_open, v_groups;
  END IF;

  -- (d) Every survivor is the NEWEST row its group had. This is the whole
  --     correctness claim of a destructive dedupe, so it is asserted, not
  --     assumed.
  SELECT count(*) INTO v_not_newest
    FROM public.stale_document_flags f
    JOIN _stale_flag_collapse_before b
      ON b.tenant_id = f.tenant_id
     AND b.generated_document_id IS NOT DISTINCT FROM f.generated_document_id
     AND b.changed_field         IS NOT DISTINCT FROM f.changed_field
   WHERE f.status = 'open'
     AND f.created_at <> b.newest_before;
  IF v_not_newest <> 0 THEN
    RAISE EXCEPTION
      'stale_document_flags: % surviving row(s) are not the newest of their group',
      v_not_newest;
  END IF;

  RAISE NOTICE
    'stale_document_flags collapsed: % open rows before, % deleted, % remaining across % group(s); DELETE policy in place.',
    v_expected, v_expected - v_open, v_open, v_groups;
END $$;

DROP TABLE IF EXISTS _stale_flag_collapse_before;