-- MarketCheck AutoRecalls results, stored separately from the NHTSA
-- recall_check column and from VIN-decode data. Written best-effort by the
-- marketcheck-recalls edge function.
--   recall_status      — 'clear' | 'open_recalls' | 'unknown' | 'error'
--   recall_checked_at  — last successful check
--   open/closed counts — quick chip + readiness signal
--   recall_payload     — full normalized provider response

ALTER TABLE public.vehicle_listings ADD COLUMN IF NOT EXISTS recall_status text;
ALTER TABLE public.vehicle_listings ADD COLUMN IF NOT EXISTS recall_checked_at timestamptz;
ALTER TABLE public.vehicle_listings ADD COLUMN IF NOT EXISTS open_recall_count integer;
ALTER TABLE public.vehicle_listings ADD COLUMN IF NOT EXISTS closed_recall_count integer;
ALTER TABLE public.vehicle_listings ADD COLUMN IF NOT EXISTS recall_payload jsonb;
