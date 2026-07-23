ALTER TABLE public.addendums ADD COLUMN IF NOT EXISTS accepted_at TIMESTAMPTZ;
ALTER TABLE public.vehicle_listings ADD COLUMN IF NOT EXISTS deal_processed_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_addendums_tenant_vin_accepted
  ON public.addendums (tenant_id, vehicle_vin, accepted_at DESC)
  WHERE accepted_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_vehicle_listings_deal_processed_at
  ON public.vehicle_listings (tenant_id, deal_processed_at)
  WHERE deal_processed_at IS NOT NULL;