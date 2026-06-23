
-- 1. Passport lookup RPCs: match slug OR VIN, only published
CREATE OR REPLACE FUNCTION public.get_vehicle_listing_by_slug(_slug TEXT)
RETURNS SETOF public.vehicle_listings
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT * FROM public.vehicle_listings
  WHERE (slug = _slug OR vin = upper(_slug))
    AND status = 'published'
  ORDER BY (slug = _slug) DESC, published_at DESC NULLS LAST
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.increment_listing_view(_slug TEXT)
RETURNS VOID
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.vehicle_listings
  SET view_count = view_count + 1
  WHERE (slug = _slug OR vin = upper(_slug))
    AND status = 'published';
$$;

-- 2. mc_raw column for full MarketCheck payload
ALTER TABLE public.vehicle_listings
  ADD COLUMN IF NOT EXISTS mc_raw JSONB;

-- 3. Value history table
CREATE TABLE IF NOT EXISTS public.vehicle_value_history (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     TEXT,
  vin           TEXT NOT NULL,
  source        TEXT,
  market_value  NUMERIC,
  listing_price NUMERIC,
  position      TEXT,
  below_market  NUMERIC,
  payload       JSONB,
  captured_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT ON public.vehicle_value_history TO authenticated;
GRANT ALL ON public.vehicle_value_history TO service_role;

CREATE INDEX IF NOT EXISTS idx_vehicle_value_history_vin
  ON public.vehicle_value_history (vin, captured_at DESC);

CREATE INDEX IF NOT EXISTS idx_vehicle_value_history_tenant
  ON public.vehicle_value_history (tenant_id);

ALTER TABLE public.vehicle_value_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tenant members read value history" ON public.vehicle_value_history;
CREATE POLICY "tenant members read value history"
  ON public.vehicle_value_history FOR SELECT
  TO authenticated
  USING (
    tenant_id::text IN (
      SELECT tenant_id::text FROM public.tenant_members
      WHERE user_id = (SELECT auth.uid())
    )
  );
