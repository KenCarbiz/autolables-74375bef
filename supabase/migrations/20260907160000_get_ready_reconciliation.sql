-- Get Ready record reconciliation.
--
-- 196 rows had accumulated at status 'pending' with get_ready_complete_date
-- null, because the completion writer (useGetReady.completeItem) had no caller
-- until the prep completion path was wired. Counting the table therefore
-- returned every vehicle that ever entered Get Ready -- including 106 sold
-- months ago -- which is how the dashboard came to claim 196 vehicles in recon
-- against 134 active ones.
--
-- Nothing is deleted here. These rows are Get Ready evidence and some support
-- compliance history. They are CLASSIFIED so operational counts can exclude
-- what is no longer current, while the history stays queryable and auditable.

ALTER TABLE public.get_ready_records
  ADD COLUMN IF NOT EXISTS reconciliation_state text,
  ADD COLUMN IF NOT EXISTS reconciled_at timestamptz,
  ADD COLUMN IF NOT EXISTS reconciliation_note text;

COMMENT ON COLUMN public.get_ready_records.reconciliation_state IS
  'current = live vehicle still in preparation. historical_sold = vehicle archived, kept as evidence. orphaned_no_listing = listing row no longer exists. Null = not yet classified.';

DO $$
DECLARE v_current int; v_sold int; v_orphan int;
BEGIN
  -- A: the vehicle was archived. Real history, never a current count.
  UPDATE public.get_ready_records g
     SET reconciliation_state = 'historical_sold',
         reconciled_at = now(),
         reconciliation_note = 'Vehicle archived; record retained as Get Ready evidence.'
   WHERE g.reconciliation_state IS NULL
     AND EXISTS (SELECT 1 FROM public.vehicle_listings v
                  WHERE v.tenant_id = g.tenant_id AND upper(v.vin) = upper(g.vin)
                    AND coalesce(v.status,'') = 'archived');
  GET DIAGNOSTICS v_sold = ROW_COUNT;

  -- B: no listing at all. Quarantined rather than deleted: these carry valid
  -- VINs and real vehicle descriptions, so they are evidence of work done on a
  -- listing that was later removed, not corruption to discard.
  UPDATE public.get_ready_records g
     SET reconciliation_state = 'orphaned_no_listing',
         reconciled_at = now(),
         reconciliation_note = 'No vehicle_listings row for this VIN; listing deleted after the record was created.'
   WHERE g.reconciliation_state IS NULL
     AND NOT EXISTS (SELECT 1 FROM public.vehicle_listings v
                      WHERE v.tenant_id = g.tenant_id AND upper(v.vin) = upper(g.vin));
  GET DIAGNOSTICS v_orphan = ROW_COUNT;

  -- C: still on the lot. Left at its stored status on purpose -- inferring a
  -- completion here would fabricate evidence that work finished.
  UPDATE public.get_ready_records g
     SET reconciliation_state = 'current',
         reconciled_at = now(),
         reconciliation_note = 'Active inventory; operational state remains the workflow''s to set.'
   WHERE g.reconciliation_state IS NULL
     AND EXISTS (SELECT 1 FROM public.vehicle_listings v
                  WHERE v.tenant_id = g.tenant_id AND upper(v.vin) = upper(g.vin)
                    AND coalesce(v.status,'') <> 'archived');
  GET DIAGNOSTICS v_current = ROW_COUNT;

  RAISE NOTICE 'get_ready reconciliation: current=% historical_sold=% orphaned=%',
    v_current, v_sold, v_orphan;
END $$;

CREATE INDEX IF NOT EXISTS idx_get_ready_records_reconciliation
  ON public.get_ready_records (tenant_id, reconciliation_state);
