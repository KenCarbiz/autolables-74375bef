-- VIN listing-history + in-service date storage. Pulled at ingest from
-- MarketCheck's History-by-VIN API (GET /v2/history/car/{vin}) by vehicle-enrich
-- so the Passport reads the ownership/price/miles timeline straight off the row.
-- Additive / nullable; existing enrichment columns are unchanged.

ALTER TABLE public.vehicle_listings
  ADD COLUMN IF NOT EXISTS history_payload  jsonb,        -- { available, entries:[{price,miles,seller_type,inventory_type,dealer,source,vdp_url,first_seen,last_seen}], owners, inServiceDate, firstSeen }
  ADD COLUMN IF NOT EXISTS in_service_date  date;         -- estimated first-in-service (first NEW listing) — warranty-clock proxy

COMMENT ON COLUMN public.vehicle_listings.history_payload IS
  'MarketCheck VIN listing history: full price/miles/seller timeline + estimated owner count + in-service date. Honest proxy from listing data, not a CARFAX title record.';
COMMENT ON COLUMN public.vehicle_listings.in_service_date IS
  'Estimated in-service date (first time the VIN appeared as a new listing). Proxy for the warranty start; not an OEM warranty registration date.';
