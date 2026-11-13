-- AutoLabels PRODUCTION read before step 10 (M-1). READ ONLY. Lists the SECURITY DEFINER functions in schema public that
-- PUBLIC may execute (so a direct login such as rtgip_edge may) and whose body reads request.jwt.claims, auth.uid(),
-- auth.role() or auth.jwt(). A direct login can set request.jwt.claims itself and call these as any user or as
-- service_role; a PostgREST caller cannot. The second query lists every PUBLIC-executable SECURITY DEFINER function in
-- public, because one may read the claims through a helper. The owner accepts or revokes each on the step 10 card;
-- nothing here changes a grant. Run it again after step 10 (the fingerprint repeats both counts).
SELECT p.oid::regprocedure AS function, pg_get_userbyid(p.proowner) AS owner, 'reads jwt claims' AS why
  FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.prosecdef
     AND (p.proacl IS NULL OR EXISTS (SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE'))
     AND p.prosrc ~* '(request\.jwt\.claim|auth\.(uid|role|jwt)[[:space:]]*\()'
UNION ALL
SELECT p.oid::regprocedure, pg_get_userbyid(p.proowner), 'public-executable definer'
  FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.prosecdef
     AND (p.proacl IS NULL OR EXISTS (SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE'))
     AND NOT (p.prosrc ~* '(request\.jwt\.claim|auth\.(uid|role|jwt)[[:space:]]*\()')
 ORDER BY 3, 1;
