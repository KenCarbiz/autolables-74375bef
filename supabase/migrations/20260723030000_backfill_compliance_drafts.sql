-- ──────────────────────────────────────────────────────────────────────
-- One-time backfill: draft the FTC Buyers Guide + CT K-208 for EXISTING
-- used/CPO inventory.
--
-- The auto-generation only ran when a vehicle_listings row was first inserted,
-- so any car ingested before the autogen flow (or re-synced nightly, which took
-- the update branch) never got its compliance drafts — they showed as "not
-- generated" in the admin. The draft RPCs are VIN-idempotent, so this safely
-- creates the missing drafts for every used/CPO vehicle already on file. Going
-- forward, marketcheck-sync ensures drafts on every sync, not just inserts.
-- ──────────────────────────────────────────────────────────────────────

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
      PERFORM public.create_draft_buyers_guide(r.tenant_id, r.vin);
      PERFORM public.create_draft_safety_inspection(r.tenant_id, r.vin);
    EXCEPTION WHEN OTHERS THEN
      -- Best-effort: skip any row that errors so one bad VIN can't abort the batch.
      NULL;
    END;
  END LOOP;
END $$;
