-- Test-only stand-ins for the production tables the duplicate reconciliation
-- dependency scan reads, with just the key columns it uses, and the production
-- vehicle_listings columns the bare stub lacks. Never applied to a real project.
ALTER TABLE public.vehicle_listings
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS published_at timestamptz,
  ADD COLUMN IF NOT EXISTS deal_processed_at timestamptz,
  ADD COLUMN IF NOT EXISTS key_specs jsonb,
  ADD COLUMN IF NOT EXISTS mc_attributes jsonb,
  ADD COLUMN IF NOT EXISTS market_value numeric,
  ADD COLUMN IF NOT EXISTS market_checked_at timestamptz,
  ADD COLUMN IF NOT EXISTS recall_checked_at timestamptz,
  ADD COLUMN IF NOT EXISTS in_service_date date,
  ADD COLUMN IF NOT EXISTS history_payload jsonb,
  ADD COLUMN IF NOT EXISTS title_verification jsonb,
  ADD COLUMN IF NOT EXISTS enriched_at timestamptz;

CREATE OR REPLACE FUNCTION public.test_touch_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at := clock_timestamp(); RETURN NEW; END $$;
CREATE TRIGGER update_vehicle_listings_updated_at BEFORE UPDATE ON public.vehicle_listings FOR EACH ROW EXECUTE FUNCTION public.test_touch_updated_at();

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['addendum_signings:vehicle_listing_id','signature_evidence:vehicle_id','vehicle_documents:vehicle_listing_id','document_assets:vehicle_id',
    'generated_documents:vehicle_id','dept_signoff_tokens:vehicle_listing_id','detail_signoffs:vehicle_listing_id','pdi_signoffs:vehicle_listing_id',
    'safety_inspections:vehicle_listing_id','recall_service_tasks:vehicle_listing_id','service_requests:vehicle_listing_id','recon_estimates:vehicle_listing_id',
    'vehicle_change_history:vehicle_listing_id','vehicle_exceptions:vehicle_listing_id','vehicle_work_events:listing_id','document_lifecycle_events:vehicle_id',
    'oem_distribution_events:vehicle_listing_id','used_vehicle_inspections:vehicle_id','used_vehicle_investment_items:vehicle_id','dealer_work_items:vehicle_id',
    'vehicle_addendums:vehicle_id','ct_mvp_certification_runs:vehicle_id','qr_codes:vehicle_id','qr_scan_events:vehicle_id','vehicle_source_records:vehicle_id',
    'vehicle_facts:vehicle_id','vehicle_snapshots:vehicle_id','vehicle_fact_conflicts:vehicle_id','neovin_snapshots:vehicle_id','vehicle_market_valuations:listing_id',
    'market_pricing_legacy_payloads:listing_id','vehicle_ingest_ledger:vehicle_id','vehicle_lifecycle:vehicle_id','used_vehicle_inspection_photos:vehicle_id',
    'description_jobs:vehicle_id','stale_document_flags:vehicle_id'] LOOP
    EXECUTE format('CREATE TABLE public.%I (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid, vin text, %I uuid REFERENCES public.vehicle_listings(id), created_at timestamptz DEFAULT now())',
      split_part(t, ':', 1), split_part(t, ':', 2));
  END LOOP;
END $$;
CREATE TABLE public.customer_engagement_events (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid, vin text, vehicle_id text, created_at timestamptz DEFAULT now());
CREATE TABLE public.passport_document_delivery_requests (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid, vin text, vehicle_id text);
CREATE TABLE public.passport_engagement (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid, vin text, slug text, seconds integer);
CREATE TABLE public.price_watchers (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vin text, slug text);
CREATE TABLE public.addendums (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_vin text, listing_slug text);
CREATE TABLE public.factory_sticker_records (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid, vehicle_id uuid REFERENCES public.vehicle_listings(id), generation_status text);
CREATE TABLE public.description_cases (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid REFERENCES public.vehicle_listings(id), archived_at timestamptz);
CREATE TABLE public.signed_document_archive (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid, vin text, storage_path text, content_hash text);
CREATE TABLE public.provider_call_events (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vin text, at timestamptz DEFAULT now());
