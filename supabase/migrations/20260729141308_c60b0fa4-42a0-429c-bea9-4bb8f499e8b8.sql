-- 20260729150000_oem_distribution_evidence.sql
CREATE TABLE IF NOT EXISTS public.oem_distribution_events (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  store_id           TEXT,
  vin                TEXT NOT NULL,
  vehicle_listing_id UUID,
  brand              TEXT NOT NULL,
  document_kind      TEXT NOT NULL CHECK (document_kind IN ('owners_manual', 'brochure')),
  decision           TEXT NOT NULL CHECK (decision IN ('host', 'link')),
  source_url         TEXT,
  stored_path        TEXT,
  evidence           JSONB NOT NULL DEFAULT '{}'::jsonb,
  gate_version       INTEGER NOT NULL DEFAULT 1,
  decided_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_by         UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

COMMENT ON TABLE public.oem_distribution_events IS
  'Append-only record of every OEM document distribution decision, with the franchise evidence in force at that moment. Answers a copyright inquiry; never updated or deleted.';

GRANT SELECT ON public.oem_distribution_events TO authenticated;
GRANT ALL ON public.oem_distribution_events TO service_role;

CREATE INDEX IF NOT EXISTS idx_oem_distribution_events_vehicle
  ON public.oem_distribution_events (tenant_id, upper(vin), document_kind, decided_at DESC);
CREATE INDEX IF NOT EXISTS idx_oem_distribution_events_brand
  ON public.oem_distribution_events (brand, decided_at DESC);

CREATE OR REPLACE FUNCTION public.oem_distribution_events_immutable()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'oem_distribution_events is append-only (attempted %)', TG_OP;
END $$;

DROP TRIGGER IF EXISTS oem_distribution_events_no_update ON public.oem_distribution_events;
CREATE TRIGGER oem_distribution_events_no_update
  BEFORE UPDATE OR DELETE ON public.oem_distribution_events
  FOR EACH ROW EXECUTE FUNCTION public.oem_distribution_events_immutable();

ALTER TABLE public.oem_distribution_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "oem distribution events readable by tenant" ON public.oem_distribution_events;
CREATE POLICY "oem distribution events readable by tenant"
  ON public.oem_distribution_events FOR SELECT
  TO authenticated
  USING (
    tenant_id IN (
      SELECT tenant_id FROM public.tenant_members
       WHERE user_id = (SELECT auth.uid())
    )
    OR EXISTS (
      SELECT 1 FROM public.user_roles
       WHERE user_id = (SELECT auth.uid()) AND role = 'admin'
    )
  );

CREATE OR REPLACE FUNCTION public.record_oem_distribution(
  _tenant_id UUID,
  _vin TEXT,
  _brand TEXT,
  _document_kind TEXT,
  _source_url TEXT DEFAULT NULL,
  _store_id TEXT DEFAULT NULL,
  _vehicle_listing_id UUID DEFAULT NULL,
  _stored_path TEXT DEFAULT NULL
)
RETURNS TABLE (decision TEXT, event_id UUID)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_brand TEXT := lower(btrim(coalesce(_brand, '')));
  v_vin TEXT := upper(btrim(coalesce(_vin, '')));
  v_may BOOLEAN;
  v_decision TEXT;
  v_evidence JSONB;
  v_id UUID;
BEGIN
  IF v_brand = '' OR v_vin = '' THEN
    RAISE EXCEPTION 'vin and brand are required';
  END IF;
  IF _document_kind NOT IN ('owners_manual', 'brochure') THEN
    RAISE EXCEPTION 'unknown document kind %', _document_kind;
  END IF;

  v_may := public.tenant_may_host_oem_documents(_tenant_id, v_brand, _store_id);
  v_decision := CASE WHEN v_may THEN 'host' ELSE 'link' END;

  SELECT jsonb_build_object(
    'franchise_brands', COALESCE(
      (SELECT jsonb_agg(jsonb_build_object('brand', f.brand, 'new_units', f.new_units)
                        ORDER BY f.brand)
         FROM public.derive_oem_franchise_brands(_tenant_id) f), '[]'::jsonb),
    'min_new_units_required', public.oem_franchise_min_new_units(),
    'brand_blocked', EXISTS (
      SELECT 1 FROM public.oem_distribution_blocks b
       WHERE lower(b.brand) = v_brand
         AND (b.tenant_id IS NULL OR b.tenant_id = _tenant_id)),
    'derived_at', now()
  ) INTO v_evidence;

  INSERT INTO public.oem_distribution_events
    (tenant_id, store_id, vin, vehicle_listing_id, brand, document_kind,
     decision, source_url, stored_path, evidence, decided_by)
  VALUES
    (_tenant_id, _store_id, v_vin, _vehicle_listing_id, v_brand, _document_kind,
     v_decision, _source_url, CASE WHEN v_may THEN _stored_path ELSE NULL END,
     v_evidence, (SELECT auth.uid()))
  RETURNING id INTO v_id;

  RETURN QUERY SELECT v_decision, v_id;
END $$;

CREATE OR REPLACE FUNCTION public.oem_distribution_for_vehicle(
  _tenant_id UUID,
  _vin TEXT,
  _document_kind TEXT
)
RETURNS TEXT
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM public.oem_distribution_events e
     WHERE e.tenant_id = _tenant_id
       AND upper(e.vin) = upper(btrim(coalesce(_vin, '')))
       AND e.document_kind = _document_kind
       AND e.decision = 'host'
  ) THEN 'host' ELSE 'link' END;
$$;

GRANT EXECUTE ON FUNCTION public.record_oem_distribution(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.oem_distribution_for_vehicle(UUID, TEXT, TEXT) TO authenticated, service_role;