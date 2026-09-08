DO $$
DECLARE r record; sig text;
BEGIN
  FOR r IN
    SELECT p.oid, p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public'
      AND p.proname IN ('marketcheck_prune_inventory','next_description_reconcile_batch','recompute_vehicle_lifecycle')
      AND p.prorettype <> 'trigger'::regtype
  LOOP
    sig := 'public.' || r.proname || '(' || pg_get_function_identity_arguments(r.oid) || ')';
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', sig);
  END LOOP;
END $$;