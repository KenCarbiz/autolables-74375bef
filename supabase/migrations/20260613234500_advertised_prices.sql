-- ──────────────────────────────────────────────────────────────
-- Wave 20 — advertised_prices.
--
-- The FTC's March 2026 97-dealer warning letter campaign cited
-- the same hook on every recipient: the price a dealer
-- advertises on their website / AutoTrader / Cars.com / Facebook
-- must match the price the customer actually pays at the
-- sticker. SB 766 §11713.21 codifies the same requirement for
-- California sales effective Oct 1, 2026 with a 2-year
-- retention rule.
--
-- This table snapshots advertised prices per VIN. Multiple rows
-- per VIN are allowed and EXPECTED — each represents a
-- point-in-time observation of what the dealer was advertising,
-- either captured manually by the dealer or (Wave 20.x) scraped
-- nightly from configured source URLs. The "latest" snapshot
-- wins for compare-to-sticker math:
--
--   select * from advertised_prices
--   where tenant_id = ? and vin = ?
--   order by snapshot_at desc limit 1
--
-- The full history feeds the Audit-Defense Packet so a regulator
-- can see exactly what was advertised, when, and how it tracked
-- the sticker price.
-- ──────────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS public.advertised_prices (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  store_id          TEXT NOT NULL DEFAULT '',
  vin               TEXT NOT NULL,
  source_url        TEXT NOT NULL DEFAULT '',
  source_label      TEXT NOT NULL DEFAULT 'manual'
                    CHECK (source_label IN (
                      'website',
                      'autotrader',
                      'cars_com',
                      'facebook',
                      'cargurus',
                      'truecar',
                      'manual',
                      'other'
                    )),
  advertised_price  NUMERIC(10, 2) NOT NULL CHECK (advertised_price >= 0),
  snapshot_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  captured_by       TEXT NOT NULL DEFAULT '',
  notes             TEXT NOT NULL DEFAULT '',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Hot read: "latest snapshot for this VIN in this tenant."
-- DESC on snapshot_at + LIMIT 1 hits this index directly.
CREATE INDEX IF NOT EXISTS idx_advertised_prices_tenant_vin_at
  ON public.advertised_prices (tenant_id, vin, snapshot_at DESC);

CREATE INDEX IF NOT EXISTS idx_advertised_prices_store_at
  ON public.advertised_prices (tenant_id, store_id, snapshot_at DESC);

ALTER TABLE public.advertised_prices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Tenant members read advertised_prices" ON public.advertised_prices;
CREATE POLICY "Tenant members read advertised_prices"
  ON public.advertised_prices FOR SELECT TO authenticated
  USING (
    tenant_id IN (
      SELECT tenant_id FROM public.tenant_members
      WHERE user_id = (SELECT auth.uid())
    )
  );

DROP POLICY IF EXISTS "Tenant members write advertised_prices" ON public.advertised_prices;
CREATE POLICY "Tenant members write advertised_prices"
  ON public.advertised_prices FOR ALL TO authenticated
  USING (
    tenant_id IN (
      SELECT tenant_id FROM public.tenant_members
      WHERE user_id = (SELECT auth.uid())
    )
  )
  WITH CHECK (
    tenant_id IN (
      SELECT tenant_id FROM public.tenant_members
      WHERE user_id = (SELECT auth.uid())
    )
  );

DROP TRIGGER IF EXISTS set_tenant_id_advertised_prices ON public.advertised_prices;
CREATE TRIGGER set_tenant_id_advertised_prices
  BEFORE INSERT ON public.advertised_prices
  FOR EACH ROW EXECUTE FUNCTION public.set_tenant_id_on_insert();

-- ──────────────────────────────────────────────────────────────
-- latest_advertised_prices view — convenience for clients that
-- want one row per VIN. Avoids the "DISTINCT ON" pattern on
-- every query.
-- ──────────────────────────────────────────────────────────────

CREATE OR REPLACE VIEW public.latest_advertised_prices AS
SELECT DISTINCT ON (tenant_id, vin)
  id,
  tenant_id,
  store_id,
  vin,
  source_url,
  source_label,
  advertised_price,
  snapshot_at,
  captured_by,
  notes
FROM public.advertised_prices
ORDER BY tenant_id, vin, snapshot_at DESC;

GRANT SELECT ON public.latest_advertised_prices TO authenticated;

-- Add to realtime publication so the Inventory page's price-
-- band updates when a colleague captures a new snapshot.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'advertised_prices'
  ) THEN
    EXECUTE 'ALTER TABLE public.advertised_prices REPLICA IDENTITY FULL';
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = 'advertised_prices'
    ) THEN
      EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.advertised_prices';
    END IF;
  END IF;
END $$;
