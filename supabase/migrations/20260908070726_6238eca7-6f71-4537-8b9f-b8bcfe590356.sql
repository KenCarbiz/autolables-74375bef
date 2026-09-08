DO $$
DECLARE r record; sig text;
BEGIN
  -- 1) Trigger functions are never callable through the API: revoke all execute grants
  FOR r IN
    SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.prorettype='trigger'::regtype
  LOOP
    sig := 'public.' || (SELECT p.proname::text FROM pg_proc p WHERE p.oid=r.oid) || '(' || pg_get_function_identity_arguments(r.oid) || ')';
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', sig);
  END LOOP;

  -- 2) Staff/system-only SECURITY DEFINER routines must not be callable by signed-out visitors.
  --    Public token/slug based routines are intentionally left alone.
  FOR r IN
    SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.prosecdef AND p.prorettype <> 'trigger'::regtype
      AND has_function_privilege('anon', p.oid, 'EXECUTE')
      AND NOT EXISTS (
        SELECT 1 FROM unnest(coalesce(p.proargnames,'{}'::text[])) a
        WHERE a ILIKE '%token%' OR a ILIKE '%slug%'
      )
  LOOP
    sig := 'public.' || (SELECT p.proname::text FROM pg_proc p WHERE p.oid=r.oid) || '(' || pg_get_function_identity_arguments(r.oid) || ')';
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon', sig);
  END LOOP;
END $$;

ALTER FUNCTION public.is_used_condition(text) SET search_path = public;
ALTER FUNCTION public.lifecycle_bucket(text) SET search_path = public;
ALTER FUNCTION public.oem_doc_key_from_ymm(text) SET search_path = public;