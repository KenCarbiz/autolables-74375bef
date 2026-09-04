-- ──────────────────────────────────────────────────────────────────────
-- The nightly advertised-price crawl queue.
--
-- crawl-advertised-prices built its work list by reading advertised_prices
-- newest-captured_at first, de-duping to the latest row per VIN, and cutting
-- the list at `limit` (500 on the cron). Crawling a vehicle writes a new
-- snapshot, which lifts that VIN back to the top of "newest first" — so the
-- same head of the list was re-crawled every night and everything past the cut
-- was never reached again. Not a backlog that drains: a starvation loop that
-- reinforces itself.
--
-- The queue has to be ordered by STALENESS, and the "latest row per VIN" has
-- to be computed over the whole table rather than over the newest 2000 rows —
-- a vehicle whose last snapshot has aged out of that window is exactly the
-- vehicle the crawler needs to find.
--
-- DISTINCT ON does both server-side. SETOF advertised_prices so the row shape
-- can never drift from the table's.
-- ──────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.advertised_price_crawl_queue(
  _tenant_id uuid    DEFAULT NULL,
  _limit     integer DEFAULT 500
)
RETURNS SETOF public.advertised_prices
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT *
  FROM (
    SELECT DISTINCT ON (ap.tenant_id, upper(ap.vin)) ap.*
    FROM public.advertised_prices ap
    WHERE COALESCE(ap.source_url, '') <> ''
      AND (_tenant_id IS NULL OR ap.tenant_id = _tenant_id)
    ORDER BY ap.tenant_id, upper(ap.vin), ap.captured_at DESC
  ) latest
  -- Least recently crawled first. NULLS FIRST so a seeded row that has never
  -- been visited outranks every vehicle that has.
  ORDER BY latest.captured_at ASC NULLS FIRST
  LIMIT GREATEST(COALESCE(_limit, 500), 1);
$$;

COMMENT ON FUNCTION public.advertised_price_crawl_queue(uuid, integer) IS
  'Latest advertised_prices row per (tenant, VIN) that carries a source_url, ordered least-recently-crawled first. The nightly crawler''s work list; ordering by staleness is what stops the same vehicles being re-crawled while the rest of the lot is never reached.';

-- Service role only: the crawler is the caller, and this deliberately reads
-- across tenants (the cron runs unscoped).
REVOKE ALL ON FUNCTION public.advertised_price_crawl_queue(uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.advertised_price_crawl_queue(uuid, integer) TO service_role;

-- Makes both the DISTINCT ON and the staleness sort index-supported.
CREATE INDEX IF NOT EXISTS idx_advertised_prices_tenant_vin_captured
  ON public.advertised_prices (tenant_id, upper(vin), captured_at DESC);
