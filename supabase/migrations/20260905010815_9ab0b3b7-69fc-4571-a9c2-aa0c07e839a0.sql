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
  ORDER BY latest.captured_at ASC NULLS FIRST
  LIMIT GREATEST(COALESCE(_limit, 500), 1);
$$;

COMMENT ON FUNCTION public.advertised_price_crawl_queue(uuid, integer) IS
  'Latest advertised_prices row per (tenant, VIN) that carries a source_url, ordered least-recently-crawled first. The nightly crawler''s work list; ordering by staleness is what stops the same vehicles being re-crawled while the rest of the lot is never reached.';

REVOKE ALL ON FUNCTION public.advertised_price_crawl_queue(uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.advertised_price_crawl_queue(uuid, integer) TO service_role;

CREATE INDEX IF NOT EXISTS idx_advertised_prices_tenant_vin_captured
  ON public.advertised_prices (tenant_id, upper(vin), captured_at DESC);