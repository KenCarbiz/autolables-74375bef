-- ──────────────────────────────────────────────────────────────────────
-- Shopper engagement analytics (iPacket "Shopper Focus Breakdown"). Tracks how
-- long an anonymous shopper spends on each module of the customer passport, per
-- visit session, so the dealer sees where attention goes.
-- ──────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.passport_engagement (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL,
  vin        text NOT NULL,
  slug       text,
  session_id text NOT NULL,
  module     text NOT NULL,
  seconds    integer NOT NULL DEFAULT 0,
  first_at   timestamptz NOT NULL DEFAULT now(),
  last_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (session_id, vin, module)
);
CREATE INDEX IF NOT EXISTS idx_passport_engagement_tenant_vin ON public.passport_engagement (tenant_id, vin);

ALTER TABLE public.passport_engagement ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "engagement readable by tenant" ON public.passport_engagement;
CREATE POLICY "engagement readable by tenant"
  ON public.passport_engagement FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT tenant_id FROM public.tenant_members WHERE user_id = (SELECT auth.uid())));

-- Anonymous shopper writes go through this SECURITY DEFINER RPC only. It
-- resolves the vehicle from the passport slug/VIN and accumulates per-module
-- seconds for the session. Each module delta is capped to resist abuse.
CREATE OR REPLACE FUNCTION public.record_passport_engagement(_slug text, _session text, _modules jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_vin text; v_tenant uuid; v_slug text; k text; v_sec integer; n integer := 0;
BEGIN
  IF coalesce(btrim(_session),'') = '' OR _modules IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'bad_input');
  END IF;
  SELECT vin, tenant_id, slug INTO v_vin, v_tenant, v_slug
    FROM public.vehicle_listings
   WHERE slug = _slug OR vin = upper(_slug)
   ORDER BY (slug = _slug) DESC LIMIT 1;
  IF v_vin IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found'); END IF;

  FOR k, v_sec IN SELECT key, LEAST(GREATEST((value)::int, 0), 1800) FROM jsonb_each_text(_modules) LOOP
    IF v_sec <= 0 THEN CONTINUE; END IF;
    INSERT INTO public.passport_engagement (tenant_id, vin, slug, session_id, module, seconds)
    VALUES (v_tenant, v_vin, v_slug, btrim(_session), k, v_sec)
    ON CONFLICT (session_id, vin, module)
    DO UPDATE SET seconds = public.passport_engagement.seconds + EXCLUDED.seconds, last_at = now();
    n := n + 1;
  END LOOP;
  RETURN jsonb_build_object('ok', true, 'modules', n);
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_passport_engagement(text, text, jsonb) TO anon, authenticated;
