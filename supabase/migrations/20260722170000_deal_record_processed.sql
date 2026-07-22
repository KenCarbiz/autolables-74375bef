-- ──────────────────────────────────────────────────────────────────────
-- Deal record — "processed" marker (FLOW #5)
--
-- When a used-car manager hits Process on a Ready vehicle, the four finished
-- documents (accepted addendum, K-208 safety inspection, Get-Ready record, FTC
-- Buyers Guide) are emailed to the office and the deal is filed. There is no
-- deals table yet — the deal record is assembled live by VIN from the tables
-- that already carry tenant_id + vin. These columns are the only durable state:
-- when the deal was processed and by whom, so the Ready Board and Vehicle File
-- can show a deal as filed and not re-send it by accident.
-- ──────────────────────────────────────────────────────────────────────

ALTER TABLE public.vehicle_listings
  ADD COLUMN IF NOT EXISTS deal_processed_at timestamptz,
  ADD COLUMN IF NOT EXISTS deal_processed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;
