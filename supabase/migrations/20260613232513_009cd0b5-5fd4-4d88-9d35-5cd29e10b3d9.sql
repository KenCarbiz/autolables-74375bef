-- Wave 20: advertised_prices — track dealer-advertised price per VIN over time
-- FTC §5 + CA SB 766 §11713.21: dealers must honor the advertised price.

CREATE TABLE IF NOT EXISTS public.advertised_prices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  store_id TEXT,
  vin TEXT NOT NULL,
  advertised_price NUMERIC(10,2) NOT NULL CHECK (advertised_price >= 0),
  source_channel TEXT NOT NULL DEFAULT 'website'
    CHECK (source_channel IN ('website','autotrader','cars_com','cargurus','facebook','craigslist','truecar','carfax','other')),
  source_url TEXT,
  screenshot_url TEXT,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  captured_by UUID,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.advertised_prices IS
  'FTC §5 + SB 766 §11713.21: audit trail of advertised prices per VIN; proves addendum/sale price matches advertised price.';

CREATE INDEX IF NOT EXISTS idx_advertised_prices_tenant_vin
  ON public.advertised_prices (tenant_id, vin, captured_at DESC);
CREATE INDEX IF NOT EXISTS idx_advertised_prices_vin_captured
  ON public.advertised_prices (vin, captured_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.advertised_prices TO authenticated;
GRANT ALL ON public.advertised_prices TO service_role;

ALTER TABLE public.advertised_prices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant members can view advertised prices"
  ON public.advertised_prices FOR SELECT
  TO authenticated
  USING (
    tenant_id IN (
      SELECT tenant_id FROM public.tenant_members
      WHERE user_id = (SELECT auth.uid()) AND accepted_at IS NOT NULL
    )
  );

CREATE POLICY "tenant members can insert advertised prices"
  ON public.advertised_prices FOR INSERT
  TO authenticated
  WITH CHECK (
    tenant_id IN (
      SELECT tenant_id FROM public.tenant_members
      WHERE user_id = (SELECT auth.uid()) AND accepted_at IS NOT NULL
    )
  );

CREATE POLICY "tenant members can update advertised prices"
  ON public.advertised_prices FOR UPDATE
  TO authenticated
  USING (
    tenant_id IN (
      SELECT tenant_id FROM public.tenant_members
      WHERE user_id = (SELECT auth.uid()) AND accepted_at IS NOT NULL
    )
  )
  WITH CHECK (
    tenant_id IN (
      SELECT tenant_id FROM public.tenant_members
      WHERE user_id = (SELECT auth.uid()) AND accepted_at IS NOT NULL
    )
  );

CREATE POLICY "tenant members can delete advertised prices"
  ON public.advertised_prices FOR DELETE
  TO authenticated
  USING (
    tenant_id IN (
      SELECT tenant_id FROM public.tenant_members
      WHERE user_id = (SELECT auth.uid()) AND accepted_at IS NOT NULL
    )
  );

CREATE POLICY "service_role full access advertised_prices"
  ON public.advertised_prices FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.set_tenant_id_advertised_prices()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.tenant_id IS NULL THEN
    NEW.tenant_id := public.current_tenant_id();
  END IF;
  IF NEW.captured_by IS NULL THEN
    NEW.captured_by := auth.uid();
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_tenant_id_advertised_prices ON public.advertised_prices;
CREATE TRIGGER trg_set_tenant_id_advertised_prices
  BEFORE INSERT OR UPDATE ON public.advertised_prices
  FOR EACH ROW EXECUTE FUNCTION public.set_tenant_id_advertised_prices();

ALTER PUBLICATION supabase_realtime ADD TABLE public.advertised_prices;
