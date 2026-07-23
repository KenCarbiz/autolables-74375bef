-- One-time backfill: pre-start a Get-Ready record for existing used/CPO
-- inventory that predates the ingest pre-start (VIN-idempotent via
-- create_draft_get_ready). Going forward marketcheck-sync seeds it at ingest.

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT tenant_id, vin FROM public.vehicle_listings
    WHERE lower(coalesce(condition, 'used')) IN ('used', 'cpo', 'certified')
      AND tenant_id IS NOT NULL
      AND coalesce(trim(vin), '') <> ''
  LOOP
    BEGIN
      PERFORM public.create_draft_get_ready(r.tenant_id, r.vin);
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END LOOP;
END $$;
