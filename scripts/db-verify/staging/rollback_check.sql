-- Read-only. After S08: the four functions must match the fingerprints taken
-- in S03 (definition and grants), and no function the proposal added may remain.
SELECT jsonb_build_object(
  'result', CASE WHEN mismatched = 0 AND added = 0 THEN 'PASS' ELSE 'FAIL' END,
  'functions_restored', 4 - mismatched,
  'functions_mismatched', mismatched,
  'added_functions_left', added) AS result
FROM (
  SELECT
    (SELECT count(*) FROM t.fp_before b
      LEFT JOIN pg_proc p ON p.proname = b.name AND p.pronamespace = 'public'::regnamespace
      WHERE b.fp IS DISTINCT FROM md5(pg_get_functiondef(p.oid)) || ':' || coalesce(p.proacl::text, 'default')) AS mismatched,
    (SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace
      AND proname IN ('doc_fee_change_review', 'doc_fee_evidence_contradicts', 'doc_fee_row_plan', 'doc_fee_basis', 'doc_fee_setting_bool')) AS added
) x;
