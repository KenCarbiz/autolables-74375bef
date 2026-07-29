-- The record that answers a copyright inquiry.
--
-- tenant_may_host_oem_documents says whether a dealer MAY serve a
-- manufacturer's document. That is policy, and policy is computed from today's
-- inventory. It cannot answer "why were you serving INFINITI manuals in July
-- 2026" two years later, because re-running it describes 2028.
--
-- So every distribution decision is written down at the moment it is made,
-- with the evidence it rested on. The gate is the reason; this table is the
-- proof.
--
-- TWO RULES MAKE IT EVIDENCE RATHER THAN LOGGING:
--
-- 1. The caller cannot supply the decision. record_oem_distribution asks the
--    gate itself and snapshots the franchise counts it saw. A caller-supplied
--    verdict would only record what some client claimed was true.
--
-- 2. It is append-only, enforced by a TRIGGER and not by RLS. RLS does not
--    apply to the service role, and every writer here is the service role, so
--    a policy alone would protect nothing. Rows cannot be updated or deleted
--    by anyone, including us.
--
-- PERSISTENCE. A customer who was lawfully given a copy keeps it. If the
-- dealer later drops the franchise, or a manufacturer files a takedown, that
-- stops NEW distributions -- it does not reach into a passport somebody
-- already owns. So the effective answer for a vehicle is "host" if this
-- vehicle was EVER distributed under a host decision, and the log keeps both
-- rows so the change of circumstances is visible too.

CREATE TABLE IF NOT EXISTS public.oem_distribution_events (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  store_id           TEXT,
  vin                TEXT NOT NULL,
  -- Kept as a plain reference: the evidence has to outlive the listing, and a
  -- vehicle record is retired rather than deleted anyway.
  vehicle_listing_id UUID,
  brand              TEXT NOT NULL,
  document_kind      TEXT NOT NULL CHECK (document_kind IN ('owners_manual', 'brochure')),
  decision           TEXT NOT NULL CHECK (decision IN ('host', 'link')),
  -- The manufacturer URL this document came from, hosted or linked.
  source_url         TEXT,
  -- Where our copy lives, when the decision was host. NULL for a link.
  stored_path        TEXT,
  -- What the gate saw: franchise brand counts, the threshold in force, whether
  -- a takedown applied. This is the part an inquiry actually reads.
  evidence           JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Bump when the gate's rule changes, so an old row is read against the rule
  -- that actually decided it.
  gate_version       INTEGER NOT NULL DEFAULT 1,
  decided_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_by         UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

COMMENT ON TABLE public.oem_distribution_events IS
  'Append-only record of every OEM document distribution decision, with the franchise evidence in force at that moment. Answers a copyright inquiry; never updated or deleted.';

CREATE INDEX IF NOT EXISTS idx_oem_distribution_events_vehicle
  ON public.oem_distribution_events (tenant_id, upper(vin), document_kind, decided_at DESC);
CREATE INDEX IF NOT EXISTS idx_oem_distribution_events_brand
  ON public.oem_distribution_events (brand, decided_at DESC);

-- Append-only, for real. RLS is not the mechanism: the service role bypasses
-- it, and the service role is what writes here.
CREATE OR REPLACE FUNCTION public.oem_distribution_events_immutable()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
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

-- Decide, snapshot the evidence, and write the row. The decision is NOT a
-- parameter: it is taken from the gate here, so the record says what the gate
-- concluded rather than what the caller believed.
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

  -- The evidence an inquiry reads: what franchises we could see, the bar in
  -- force, and whether a takedown was against this brand at the time.
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

-- What this customer is entitled to, now and for as long as they own the car.
--
-- "Host" if this vehicle was EVER distributed under a host decision. A dealer
-- losing the franchise, or a later takedown, governs new distributions; it
-- does not retroactively un-authorize a copy already lawfully given to a
-- customer, and taking their manual away years later would be the opposite of
-- a passport they keep.
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
