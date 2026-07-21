-- Comps cache for marketcheck-comps. The function is callable with the public
-- anon key (shoppers open "Comparable Vehicles" on the passport), so without a
-- throttle, repeated calls each spend paid MarketCheck quota. This table lets the
-- function serve a recent result per vehicle and hit MarketCheck at most once per
-- vehicle per TTL, bounding quota spend regardless of call volume.

CREATE TABLE IF NOT EXISTS public.marketcheck_comps_cache (
  slug       TEXT PRIMARY KEY,
  tenant_id  UUID,
  payload    JSONB NOT NULL,
  cached_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mc_comps_cache_cached_at
  ON public.marketcheck_comps_cache (cached_at);

ALTER TABLE public.marketcheck_comps_cache ENABLE ROW LEVEL SECURITY;

-- No policies on purpose: only the marketcheck-comps edge function (service-role
-- key, which bypasses RLS) reads and writes this cache. Denying anon/authenticated
-- roles keeps the cached comp payloads — which embed competitor pricing — off all
-- public clients.
