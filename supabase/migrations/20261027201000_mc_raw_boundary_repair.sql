-- ── mc_raw means one thing: the verbatim syndication row ───────────────────
--
-- Audited 2026-10-27: 247 vehicle_listings rows hold the syndication listing
-- in mc_raw, as documented; 81 hold the output of the retired
-- marketcheck-market-pricing function instead ({belowMarket, checkedAt, high,
-- low, listingPrice, marketValue, position, raw, rawProvider}), written before
-- the single-writer boundary. Those cars have no stored feed row, and every
-- reader of mc_raw.build / mc_raw.dealer / mc_raw.media finds nothing on them.
--
-- This moves the legacy payloads, intact, into their own product-specific
-- store and clears mc_raw on exactly those rows. Nothing is reinterpreted:
-- the predicate below is the classifier's (src/lib/market/rawPayloadBoundary.ts,
-- LEGACY_PRICING_SQL_PREDICATE) and a test holds the two to the same text.
-- A payload that is neither shape is left where it is for a person.
--
-- Authored as part of the MarketCheck V3 containment tranche. It is applied
-- only on explicit authorization: it changes production data.
-- ──────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.market_pricing_legacy_payloads (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL,
  listing_id    uuid NOT NULL,
  vin           text NOT NULL,
  payload       jsonb NOT NULL,
  -- The writer that produced it, recorded so the row's provenance does not
  -- depend on anyone remembering this migration.
  source_writer text NOT NULL DEFAULT 'marketcheck-market-pricing (retired)',
  moved_from    text NOT NULL DEFAULT 'vehicle_listings.mc_raw',
  moved_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS market_pricing_legacy_payloads_tenant_vin_idx
  ON public.market_pricing_legacy_payloads (tenant_id, vin);

ALTER TABLE public.market_pricing_legacy_payloads ENABLE ROW LEVEL SECURITY;

-- Append-only evidence. REVOKE before GRANT: Supabase's default privileges
-- grant ALL to authenticated and service_role on a new table, and a GRANT
-- never narrows.
REVOKE ALL PRIVILEGES ON TABLE public.market_pricing_legacy_payloads FROM PUBLIC;
REVOKE ALL PRIVILEGES ON TABLE public.market_pricing_legacy_payloads FROM anon;
REVOKE ALL PRIVILEGES ON TABLE public.market_pricing_legacy_payloads FROM authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.market_pricing_legacy_payloads FROM service_role;
GRANT SELECT ON TABLE public.market_pricing_legacy_payloads TO authenticated;
GRANT SELECT, INSERT ON TABLE public.market_pricing_legacy_payloads TO service_role;

CREATE POLICY "market_pricing_legacy_payloads_tenant_read"
  ON public.market_pricing_legacy_payloads FOR SELECT
  TO authenticated
  USING (
    tenant_id IN (
      SELECT tenant_id FROM public.tenant_members
      WHERE user_id = (SELECT auth.uid())
    )
  );

-- 1. Copy. Idempotent on re-run: a (listing, payload) pair already moved is
--    not moved twice.
INSERT INTO public.market_pricing_legacy_payloads (tenant_id, listing_id, vin, payload)
SELECT vl.tenant_id, vl.id, vl.vin, vl.mc_raw
FROM public.vehicle_listings vl
WHERE vl.mc_raw IS NOT NULL
  AND (mc_raw ? 'marketValue' AND mc_raw ? 'rawProvider') AND NOT (mc_raw ? 'build') AND NOT (mc_raw ? 'dealer')
  AND NOT EXISTS (
    SELECT 1 FROM public.market_pricing_legacy_payloads m
    WHERE m.listing_id = vl.id AND m.payload = vl.mc_raw
  );

-- 2. Clear, on exactly the rows whose payload is now held elsewhere.
UPDATE public.vehicle_listings vl
SET mc_raw = NULL
WHERE vl.mc_raw IS NOT NULL
  AND (mc_raw ? 'marketValue' AND mc_raw ? 'rawProvider') AND NOT (mc_raw ? 'build') AND NOT (mc_raw ? 'dealer')
  AND EXISTS (
    SELECT 1 FROM public.market_pricing_legacy_payloads m
    WHERE m.listing_id = vl.id AND m.payload = vl.mc_raw
  );

COMMENT ON TABLE public.market_pricing_legacy_payloads IS
  'Payloads the retired marketcheck-market-pricing function wrote into vehicle_listings.mc_raw, moved here intact so mc_raw can mean one thing. Append-only; never reinterpreted.';

COMMENT ON COLUMN public.vehicle_listings.mc_raw IS
  'The verbatim MarketCheck Dealer Inventory Syndication row for this listing, exactly as received. No other product may write here; every other provider payload has its own product-specific store (decode snapshots, valuation audit rows, cohort evidence, recall envelopes, legacy pricing payloads).';
