-- ──────────────────────────────────────────────────────────────────────
-- Price-drop re-engagement (iPacket-style). A shopper viewing a vehicle
-- passport can ask to be emailed if the advertised price drops. We capture
-- the watcher with the price at opt-in time; a daily sweep compares each
-- watcher's last_price to the listing's current price and re-engages on a
-- drop, then advances last_price so each drop notifies at most once.
-- ──────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.price_watchers (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL,
  vin             text NOT NULL,
  slug            text,
  email           text NOT NULL,
  name            text,
  last_price      numeric,
  last_notified_at timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (vin, email)
);
CREATE INDEX IF NOT EXISTS idx_price_watchers_tenant ON public.price_watchers (tenant_id);
CREATE INDEX IF NOT EXISTS idx_price_watchers_vin ON public.price_watchers (vin);

ALTER TABLE public.price_watchers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "watchers readable by tenant" ON public.price_watchers;
CREATE POLICY "watchers readable by tenant"
  ON public.price_watchers FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT tenant_id FROM public.tenant_members WHERE user_id = (SELECT auth.uid())));

-- Anonymous shopper opt-in. Resolves the vehicle from the passport slug/VIN,
-- stamps the current advertised price as the watcher baseline, and upserts so a
-- shopper re-opting in just refreshes their record (without resetting an
-- already-pending drop downward).
CREATE OR REPLACE FUNCTION public.watch_price(_slug text, _email text, _name text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_vin text; v_tenant uuid; v_slug text; v_price numeric; v_email text;
BEGIN
  v_email := lower(btrim(coalesce(_email, '')));
  IF v_email = '' OR position('@' in v_email) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'bad_email');
  END IF;
  SELECT vin, tenant_id, slug, price INTO v_vin, v_tenant, v_slug, v_price
    FROM public.vehicle_listings
   WHERE slug = _slug OR vin = upper(_slug)
   ORDER BY (slug = _slug) DESC LIMIT 1;
  IF v_vin IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found'); END IF;

  INSERT INTO public.price_watchers (tenant_id, vin, slug, email, name, last_price)
  VALUES (v_tenant, v_vin, v_slug, v_email, nullif(btrim(coalesce(_name, '')), ''), v_price)
  ON CONFLICT (vin, email) DO UPDATE
    SET slug = EXCLUDED.slug,
        name = COALESCE(EXCLUDED.name, public.price_watchers.name),
        last_price = COALESCE(public.price_watchers.last_price, EXCLUDED.last_price);
  RETURN jsonb_build_object('ok', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.watch_price(text, text, text) TO anon, authenticated;
