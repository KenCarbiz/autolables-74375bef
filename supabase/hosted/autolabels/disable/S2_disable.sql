-- Forward recovery for S2 (canonical store registry): signed-in staff can no longer call the registry reader.
-- Nothing else is changed; apply_payment_estimator_settings keeps accepting a dealer_stores id, which only
-- widens which of the tenant's own stores a manager may configure. Restoring the 0009 body is the paired
-- 20261108000000_canonical_store_registry.rollback.sql, a separate decision. Re-running S2 restores the grant.
DO $$
BEGIN
  IF to_regprocedure('public.tenant_store_registry(uuid)') IS NOT NULL THEN
    REVOKE EXECUTE ON FUNCTION public.tenant_store_registry(uuid) FROM authenticated;
  END IF;
END $$;
NOTIFY pgrst, 'reload schema';
