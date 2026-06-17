-- Customer capture on the unified vehicle file (internal, RLS-protected).
--
-- vehicle_files is the canonical hub everything links to (Phase 0). It already
-- holds customer_name/phone/email + cobuyer_*; add a structured customer_info
-- bag (full buyer + co-buyer incl. ADDRESS) plus sold_at so the full sold-to
-- record lives in one place. PII intentionally lives here, NOT on
-- vehicle_listings, whose entire row is returned to anonymous shoppers by the
-- public /v/:slug RPC. Additive + reversible.

ALTER TABLE public.vehicle_files
  ADD COLUMN IF NOT EXISTS customer_info JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS sold_at TIMESTAMPTZ;

COMMENT ON COLUMN public.vehicle_files.customer_info IS
  'Sold-to record: {buyer:{first_name,middle_initial,last_name,suffix,address,city,state,zip,phone,email}, cobuyer:{...}}. PII — internal only, never exposed on the public listing.';
COMMENT ON COLUMN public.vehicle_files.sold_at IS
  'Timestamp the vehicle was marked sold and the customer record captured.';
