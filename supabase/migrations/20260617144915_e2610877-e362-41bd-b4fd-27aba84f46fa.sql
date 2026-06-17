ALTER TABLE public.vehicle_files
  ADD COLUMN IF NOT EXISTS customer_info JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS sold_at TIMESTAMPTZ;

COMMENT ON COLUMN public.vehicle_files.customer_info IS
  'Sold-to record: {buyer:{first_name,middle_initial,last_name,suffix,address,city,state,zip,phone,email}, cobuyer:{...}}. PII - internal only, never exposed on the public listing.';

COMMENT ON COLUMN public.vehicle_files.sold_at IS
  'Timestamp the vehicle was marked sold and the customer record captured.';