-- Durable report validation after 0022. Read-only assertions plus role-scoped reads; always rolls back.
DO $$
DECLARE r jsonb; tenant text; n int; passed int := 0; report_id uuid; source_sha text; digest text;
BEGIN
  SELECT f.id,f.report,f.tenant_id,f.source_sha,f.report_sha256 INTO report_id,r,tenant,source_sha,digest
    FROM gw_recovery_forensic_reports f ORDER BY f.created_at DESC LIMIT 1;
  IF r IS NULL OR jsonb_array_length(r->'resolutions') IS DISTINCT FROM 16 OR (r->>'checks_passed')::int IS DISTINCT FROM 7
    THEN RAISE EXCEPTION 'F1 missing complete durable report'; END IF;
  passed := passed + 1;
  IF r->'before'->'originals' IS DISTINCT FROM r->'restored'->'originals'
    OR jsonb_typeof(r->'before'->'originals') IS DISTINCT FROM 'object'
    OR (r->>'lost_fixture_events')::int IS DISTINCT FROM 0 THEN RAISE EXCEPTION 'F2 originals changed'; END IF;
  passed := passed + 1;
  IF (r->>'historical_original_ids_verified')::boolean IS DISTINCT FROM false
    OR EXISTS (SELECT 1 FROM jsonb_array_elements(r->'resolutions') g WHERE (g->>'historical_original')::boolean IS DISTINCT FROM false)
    THEN RAISE EXCEPTION 'F3 historical certainty invented'; END IF;
  passed := passed + 1;
  IF (r->'missing_reconcile'->>'projection_behind_delivered')::int IS DISTINCT FROM 16
    OR (r->'partial_recreation'->>'projection_behind_delivered')::int IS DISTINCT FROM 16
    OR EXISTS (SELECT 1 FROM jsonb_array_elements(r->'resolutions') g WHERE (g->>'expected_revision')::int IS DISTINCT FROM 100
      OR (g->>'missing_revision')::int IS DISTINCT FROM 0 OR (g->>'restored_revision')::int IS DISTINCT FROM 100
      OR (g->>'receipt_wrong')::boolean IS DISTINCT FROM false)
    THEN RAISE EXCEPTION 'F4 per-row revisions/receipts invalid'; END IF;
  passed := passed + 1;
  IF has_table_privilege('authenticated','public.gw_recovery_forensic_reports','INSERT')
    OR has_table_privilege('anon','public.gw_recovery_forensic_reports','SELECT')
    OR has_function_privilege('authenticated','public.gw_recovery_snapshot(text,text[])','EXECUTE')
    OR has_function_privilege('authenticated','public.gw_apply_internal(bigint,text)','EXECUTE')
    THEN RAISE EXCEPTION 'F5 privilege leak'; END IF;
  passed := passed + 1;
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',gen_random_uuid(),'role','authenticated')::text,true);
  SET LOCAL ROLE authenticated;
  SELECT count(id) INTO n FROM gw_recovery_forensic_reports;
  RESET ROLE;
  IF n <> 0 THEN RAISE EXCEPTION 'F6 nonmember forensic leakage'; END IF;
  passed := passed + 1;
  IF EXISTS (SELECT 1 FROM gw_tenants WHERE id LIKE 'grp-syn-forensic-%')
    OR EXISTS (SELECT 1 FROM gw_tenant_members WHERE tenant_id LIKE 'grp-syn-forensic-%')
    THEN RAISE EXCEPTION 'F7 fixture tenant or membership persisted'; END IF;
  passed := passed + 1;
  IF digest IS DISTINCT FROM encode(extensions.digest(r::text,'sha256'),'hex')
    OR report_id::text IS DISTINCT FROM r->>'run_id' OR source_sha IS DISTINCT FROM r->>'source_sha'
    THEN RAISE EXCEPTION 'F8 report checksum/provenance invalid'; END IF;
  passed := passed + 1;
  IF jsonb_array_length(r->'missing'->'groups') IS DISTINCT FROM 16
    OR (SELECT count(DISTINCT g->>'route_id') FROM jsonb_array_elements(r->'missing'->'groups')g) <> 8
    OR (SELECT count(DISTINCT g->>'aggregate_id') FROM jsonb_array_elements(r->'missing'->'groups')g) <> 2
    OR EXISTS (SELECT 1 FROM jsonb_array_elements(r->'missing'->'groups')g WHERE (g->>'invariant_failed')::boolean IS DISTINCT FROM true)
    THEN RAISE EXCEPTION 'F9 missing-state groups incomplete'; END IF;
  passed := passed + 1;
  IF NOT coalesce((r->'pending'->>'captured_at')::timestamptz <= (r->'before'->>'captured_at')::timestamptz
    AND (r->'before'->>'captured_at')::timestamptz <= (r->'missing'->>'captured_at')::timestamptz
    AND (r->'missing'->>'captured_at')::timestamptz <= (r->'partial_recreation'->>'captured_at')::timestamptz
    AND (r->'partial_recreation'->>'captured_at')::timestamptz <= (r->'restored'->>'captured_at')::timestamptz,false)
    OR (r->'restored'->>'projection_behind_delivered')::int IS DISTINCT FROM 0
    THEN RAISE EXCEPTION 'F10 capture-before-cleanup ordering invalid'; END IF;
  passed := passed + 1;
  RAISE EXCEPTION 'GW_TESTS_PASSED: %',passed;
END $$;