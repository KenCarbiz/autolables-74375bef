-- Legacy feed hardening. PROPOSED, NOT APPLIED.
-- Gives the three live legacy edge functions (autofilm-feed, autocurb-sync, dms-webhook) a
-- tenant-scoped signed mode on top of the RooftopOS spine credentials, replay protection for
-- signed writes, a per-tenant switch that retires the old shared secrets, and a hold for
-- vehicles that reappear on a feed after their listing was archived.
-- Idempotent. Requires the spine (20261030000000) and vehicle history foundation (20261109000000).

-- 1. DMS connections can live in the same registry as AutoFilm and AutoCurb.
ALTER TABLE public.integration_connections DROP CONSTRAINT IF EXISTS integration_connections_app_check;
ALTER TABLE public.integration_connections
  ADD CONSTRAINT integration_connections_app_check CHECK (app IN ('autofilm','autocurb','dms'));

-- 2. Which connection speaks for which legacy feed of which tenant, and whether the old
-- shared-secret wire format is still accepted for that tenant.
CREATE TABLE IF NOT EXISTS public.legacy_feed_bindings (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  feed            text NOT NULL CHECK (feed IN ('autofilm_feed','autocurb_sync','dms_webhook')),
  provider        text CHECK (provider IN ('vauto','vinsolutions','cdk','reynolds','generic')),
  connection_id   uuid REFERENCES public.integration_connections(id) ON DELETE RESTRICT,
  legacy_unsigned text NOT NULL DEFAULT 'allowed' CHECK (legacy_unsigned IN ('allowed','rejected')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CHECK ((feed = 'dms_webhook') = (provider IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS legacy_feed_bindings_scope_uniq
  ON public.legacy_feed_bindings (tenant_id, feed, COALESCE(provider, ''));
CREATE INDEX IF NOT EXISTS legacy_feed_bindings_connection_idx
  ON public.legacy_feed_bindings (connection_id) WHERE connection_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.legacy_feed_bindings_check()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE c public.integration_connections%ROWTYPE; v_app text;
BEGIN
  IF NEW.connection_id IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO c FROM public.integration_connections WHERE id = NEW.connection_id;
  IF c.id IS NULL OR c.tenant_id <> NEW.tenant_id THEN
    RAISE EXCEPTION 'binding_connection_tenant_mismatch';
  END IF;
  v_app := CASE NEW.feed WHEN 'autofilm_feed' THEN 'autofilm' WHEN 'autocurb_sync' THEN 'autocurb' ELSE 'dms' END;
  IF c.app <> v_app THEN
    RAISE EXCEPTION 'binding_connection_app_mismatch';
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS legacy_feed_bindings_check_trg ON public.legacy_feed_bindings;
CREATE TRIGGER legacy_feed_bindings_check_trg BEFORE INSERT OR UPDATE ON public.legacy_feed_bindings
  FOR EACH ROW EXECUTE FUNCTION public.legacy_feed_bindings_check();
DROP TRIGGER IF EXISTS legacy_feed_bindings_set_updated_at ON public.legacy_feed_bindings;
CREATE TRIGGER legacy_feed_bindings_set_updated_at BEFORE UPDATE ON public.legacy_feed_bindings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 3. Idempotency receipts for signed writes. Service role only.
CREATE TABLE IF NOT EXISTS public.legacy_feed_receipts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id   uuid NOT NULL REFERENCES public.integration_connections(id) ON DELETE CASCADE,
  tenant_id       uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  feed            text NOT NULL CHECK (feed IN ('autofilm_feed','autocurb_sync','dms_webhook')),
  idempotency_key text NOT NULL CHECK (char_length(idempotency_key) BETWEEN 1 AND 200),
  body_sha256     text NOT NULL,
  status          text NOT NULL DEFAULT 'processing' CHECK (status IN ('processing','done')),
  response        jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  completed_at    timestamptz,
  UNIQUE (connection_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS legacy_feed_receipts_created_idx ON public.legacy_feed_receipts (created_at);

ALTER TABLE public.legacy_feed_bindings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.legacy_feed_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.legacy_feed_bindings FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.legacy_feed_receipts FROM PUBLIC, anon, authenticated;

DROP POLICY IF EXISTS legacy_feed_bindings_manager_select ON public.legacy_feed_bindings;
CREATE POLICY legacy_feed_bindings_manager_select ON public.legacy_feed_bindings
  FOR SELECT TO authenticated USING (
    tenant_id IN (
      SELECT tenant_id FROM public.tenant_members
      WHERE user_id = (SELECT auth.uid()) AND accepted_at IS NOT NULL AND role IN ('owner','admin')
    )
  );
GRANT SELECT ON public.legacy_feed_bindings TO authenticated;
GRANT ALL ON public.legacy_feed_bindings TO service_role;
GRANT ALL ON public.legacy_feed_receipts TO service_role;

-- 4. Replay protection.
CREATE OR REPLACE FUNCTION public.legacy_feed_claim_request(
  p_connection uuid, p_feed text, p_key text, p_body_sha256 text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_tenant uuid;
  r public.legacy_feed_receipts%ROWTYPE;
BEGIN
  SELECT tenant_id INTO v_tenant FROM public.integration_connections WHERE id = p_connection;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'unknown_connection'; END IF;

  INSERT INTO public.legacy_feed_receipts (connection_id, tenant_id, feed, idempotency_key, body_sha256)
  VALUES (p_connection, v_tenant, p_feed, p_key, p_body_sha256)
  ON CONFLICT (connection_id, idempotency_key) DO NOTHING
  RETURNING * INTO r;
  IF FOUND THEN RETURN jsonb_build_object('outcome', 'new'); END IF;

  SELECT * INTO r FROM public.legacy_feed_receipts
   WHERE connection_id = p_connection AND idempotency_key = p_key FOR UPDATE;
  IF r.body_sha256 <> p_body_sha256 THEN RETURN jsonb_build_object('outcome', 'conflict'); END IF;
  IF r.status = 'done' THEN
    RETURN jsonb_build_object('outcome', 'replay', 'response', r.response);
  END IF;
  -- A worker that died mid-request leaves a processing row; after ten minutes the same
  -- request may run again (feed writes are idempotent upserts).
  IF r.created_at < now() - interval '10 minutes' THEN
    UPDATE public.legacy_feed_receipts SET created_at = now() WHERE id = r.id;
    RETURN jsonb_build_object('outcome', 'new');
  END IF;
  RETURN jsonb_build_object('outcome', 'in_progress');
END; $$;

CREATE OR REPLACE FUNCTION public.legacy_feed_complete_request(
  p_connection uuid, p_key text, p_response jsonb
) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  UPDATE public.legacy_feed_receipts
     SET status = 'done', response = p_response, completed_at = now()
   WHERE connection_id = p_connection AND idempotency_key = p_key AND status = 'processing';
$$;

-- 5. False only when the tenant's binding says the shared-secret format is retired.
CREATE OR REPLACE FUNCTION public.legacy_feed_legacy_allowed(p_tenant uuid, p_feed text, p_provider text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT NOT EXISTS (
    SELECT 1 FROM public.legacy_feed_bindings b
     WHERE b.tenant_id = p_tenant AND b.feed = p_feed
       AND COALESCE(b.provider, '') = COALESCE(p_provider, '')
       AND b.legacy_unsigned = 'rejected');
$$;

-- 6. A VIN that comes back on a feed for an archived listing is held for review, not updated.
CREATE OR REPLACE FUNCTION public.legacy_feed_hold_archived(
  p_tenant uuid, p_vin text, p_listing_id uuid, p_feed text, p_ref text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_id uuid;
BEGIN
  IF p_listing_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.vehicle_listings l WHERE l.id = p_listing_id AND l.tenant_id = p_tenant
  ) THEN
    RAISE EXCEPTION 'listing_not_in_tenant';
  END IF;
  IF upper(trim(p_vin)) !~ '^[A-HJ-NPR-Z0-9]{17}$' THEN RETURN NULL; END IF;
  INSERT INTO public.vehicles (vin) VALUES (upper(trim(p_vin))) ON CONFLICT (vin) DO NOTHING;
  v_id := public.vehicle_history_flag_reappearance(p_tenant, NULL, p_vin, p_listing_id, p_feed, p_ref);
  IF v_id IS NULL THEN
    SELECT r.id INTO v_id FROM public.vehicle_reappearance_reviews r
     WHERE r.tenant_id = p_tenant AND r.vin = upper(trim(p_vin)) AND r.status = 'open' LIMIT 1;
  END IF;
  RETURN v_id;
END; $$;

DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.legacy_feed_bindings_check()',
    'public.legacy_feed_claim_request(uuid, text, text, text)',
    'public.legacy_feed_complete_request(uuid, text, jsonb)',
    'public.legacy_feed_legacy_allowed(uuid, text, text)',
    'public.legacy_feed_hold_archived(uuid, text, uuid, text, text)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f);
  END LOOP;
END $$;
