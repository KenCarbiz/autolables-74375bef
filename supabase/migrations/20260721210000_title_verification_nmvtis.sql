-- ──────────────────────────────────────────────────────────────────────
-- Title verification (NMVTIS / AAMVA via MarketCheck VINData)
--
-- Compliance-Pro dealer tool. The dealer manually pulls the National Motor
-- Vehicle Title Information System report (paid, ~$0.49 per generate; free
-- re-access within the provider's 90-day window), reviews the raw record
-- (DEALER-FACING ONLY), then attests "clean title" with a verified date that
-- surfaces on the customer passport as a dealer attestation.
--
-- Two stores, deliberately split by exposure:
--   1. vehicle_listings.title_verification — the dealer ATTESTATION summary.
--      Safe for the shopper view (status + verified date + source label, no
--      PII, no raw NMVTIS rows). get_vehicle_listing_by_slug is
--      RETURNS SETOF vehicle_listings / SELECT *, so it flows through
--      automatically once written.
--   2. public.title_reports — the RAW provider payload. Kept OFF the listing
--      row on purpose so the public SELECT * RPC can never ship raw title
--      data to a shopper. Tenant-scoped RLS; only the dealer's own staff read
--      it, and only the service-role edge function writes it.
-- ──────────────────────────────────────────────────────────────────────

ALTER TABLE public.vehicle_listings
  ADD COLUMN IF NOT EXISTS title_verification jsonb;

COMMENT ON COLUMN public.vehicle_listings.title_verification IS
  'Dealer NMVTIS title attestation shown on the passport: { status: clean|branded, verified_at, verified_by, source, report_generated_at, report_expires_at, brand_note }. Written only on explicit dealer action; never contains raw NMVTIS rows.';

CREATE TABLE IF NOT EXISTS public.title_reports (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  vin           text NOT NULL,
  provider      text NOT NULL DEFAULT 'vindata_nmvtis',
  report        jsonb NOT NULL,          -- raw provider payload (dealer-facing only)
  summary       jsonb,                   -- normalized { status, brands, junkSalvage, odometer, message }
  generated_at  timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz,             -- generated_at + 90d (provider report TTL)
  generated_by  uuid,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, vin)
);

CREATE INDEX IF NOT EXISTS idx_title_reports_tenant_vin
  ON public.title_reports (tenant_id, vin);

ALTER TABLE public.title_reports ENABLE ROW LEVEL SECURITY;

-- Dealer staff read their own tenant's title reports. Writes go exclusively
-- through the marketcheck-title-report edge function (service role, which
-- bypasses RLS after it validates membership + Compliance-Pro entitlement), so
-- no authenticated INSERT/UPDATE policy is granted.
CREATE POLICY "title_reports tenant read"
  ON public.title_reports FOR SELECT
  TO authenticated
  USING (
    tenant_id IN (
      SELECT tenant_id FROM public.tenant_members
      WHERE user_id = (SELECT auth.uid())
    )
  );
