-- Pre-step: addendums columns referenced by later wave RPCs
ALTER TABLE public.addendums
  ADD COLUMN IF NOT EXISTS store_id        TEXT,
  ADD COLUMN IF NOT EXISTS dealer_snapshot JSONB DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS customer_email  TEXT;

-- ──────────────────────────────────────────────────────────────────────
-- Allow anonymous vehicle inquiry submissions from the public /v/:slug
-- ──────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Anon can insert signing audit events" ON public.audit_log;

CREATE POLICY "Anon can insert shopper audit events"
  ON public.audit_log FOR INSERT TO anon
  WITH CHECK (
    user_id IS NULL
    AND action IN (
      'addendum_viewed',
      'addendum_consent_given',
      'addendum_signed',
      'listing_viewed',
      'vehicle_inquiry'
    )
  );

-- ──────────────────────────────────────────────────────────────────────
-- dealer_profiles
-- ──────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.dealer_profiles (
  tenant_id  UUID PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
  settings   JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_by UUID REFERENCES auth.users(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dealer_profiles_updated_at
  ON public.dealer_profiles (updated_at DESC);

ALTER TABLE public.dealer_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant members read dealer profile"
  ON public.dealer_profiles FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id());

CREATE POLICY "Owners upsert dealer profile"
  ON public.dealer_profiles FOR INSERT TO authenticated
  WITH CHECK (
    tenant_id = public.current_tenant_id()
    AND EXISTS (
      SELECT 1 FROM public.tenant_members m
      WHERE m.tenant_id = dealer_profiles.tenant_id
        AND m.user_id = auth.uid()
        AND m.role IN ('owner','admin')
        AND m.accepted_at IS NOT NULL
    )
  );

CREATE POLICY "Owners update dealer profile"
  ON public.dealer_profiles FOR UPDATE TO authenticated
  USING (
    tenant_id = public.current_tenant_id()
    AND EXISTS (
      SELECT 1 FROM public.tenant_members m
      WHERE m.tenant_id = dealer_profiles.tenant_id
        AND m.user_id = auth.uid()
        AND m.role IN ('owner','admin')
        AND m.accepted_at IS NOT NULL
    )
  )
  WITH CHECK (tenant_id = public.current_tenant_id());

CREATE POLICY "Platform admins read all dealer profiles"
  ON public.dealer_profiles FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Platform admins write all dealer profiles"
  ON public.dealer_profiles FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER update_dealer_profiles_updated_at
  BEFORE UPDATE ON public.dealer_profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ──────────────────────────────────────────────────────────────────────
-- addendum_signings
-- ──────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.addendum_signings (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID REFERENCES public.tenants(id) ON DELETE CASCADE,
  addendum_id         UUID REFERENCES public.addendums(id) ON DELETE SET NULL,
  deal_token_id       UUID REFERENCES public.deal_signing_tokens(id) ON DELETE SET NULL,
  vehicle_listing_id  UUID REFERENCES public.vehicle_listings(id) ON DELETE SET NULL,
  prep_sign_off_id    UUID REFERENCES public.prep_sign_offs(id) ON DELETE SET NULL,
  vin                 TEXT,
  signer_type         TEXT NOT NULL
                        CHECK (signer_type IN (
                          'customer', 'cobuyer',
                          'employee', 'salesperson', 'finance_manager',
                          'foreman', 'service_writer',
                          'dealer_principal', 'other'
                        )),
  signer_name         TEXT,
  signer_email        TEXT,
  signer_phone        TEXT,
  signature_data      TEXT,
  signature_type      TEXT CHECK (signature_type IN ('draw', 'type')),
  ip_address          TEXT,
  user_agent          TEXT,
  signing_location    JSONB,
  content_hash        TEXT,
  esign_consent       JSONB,
  canonical_payload   JSONB,
  acknowledgments     JSONB NOT NULL DEFAULT '{}'::jsonb,
  delivery_mileage    INTEGER,
  price_overrides     JSONB,
  signed_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_signings_tenant   ON public.addendum_signings (tenant_id);
CREATE INDEX IF NOT EXISTS idx_signings_addendum ON public.addendum_signings (addendum_id);
CREATE INDEX IF NOT EXISTS idx_signings_deal     ON public.addendum_signings (deal_token_id);
CREATE INDEX IF NOT EXISTS idx_signings_vehicle  ON public.addendum_signings (vehicle_listing_id);
CREATE INDEX IF NOT EXISTS idx_signings_prep     ON public.addendum_signings (prep_sign_off_id);
CREATE INDEX IF NOT EXISTS idx_signings_vin      ON public.addendum_signings (vin);
CREATE INDEX IF NOT EXISTS idx_signings_signer   ON public.addendum_signings (signer_type);
CREATE INDEX IF NOT EXISTS idx_signings_time     ON public.addendum_signings (signed_at DESC);

ALTER TABLE public.addendum_signings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant members read signings"
  ON public.addendum_signings FOR SELECT TO authenticated
  USING (
    tenant_id = public.current_tenant_id()
    OR (tenant_id IS NULL AND EXISTS (
      SELECT 1 FROM public.addendums a
      WHERE a.id = addendum_signings.addendum_id
        AND a.created_by = auth.uid()
    ))
  );

CREATE POLICY "Tenant members insert employee signings"
  ON public.addendum_signings FOR INSERT TO authenticated
  WITH CHECK (
    (tenant_id IS NULL OR tenant_id = public.current_tenant_id())
    AND signer_type IN (
      'employee', 'salesperson', 'finance_manager', 'foreman',
      'service_writer', 'dealer_principal', 'other'
    )
  );

CREATE POLICY "Platform admins read all signings"
  ON public.addendum_signings FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Platform admins write all signings"
  ON public.addendum_signings FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER set_tenant_id_signings
  BEFORE INSERT ON public.addendum_signings
  FOR EACH ROW EXECUTE FUNCTION public.set_tenant_id_on_insert();

CREATE OR REPLACE FUNCTION public.record_customer_signing(
  _signing_token      TEXT,
  _signer_type        TEXT,
  _signer_name        TEXT,
  _signer_email       TEXT,
  _signer_phone       TEXT,
  _signature_data     TEXT,
  _signature_type     TEXT,
  _ip_address         TEXT,
  _user_agent         TEXT,
  _signing_location   JSONB,
  _content_hash       TEXT,
  _esign_consent      JSONB,
  _canonical_payload  JSONB,
  _acknowledgments    JSONB,
  _delivery_mileage   INTEGER,
  _price_overrides    JSONB
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_addendum   public.addendums%ROWTYPE;
  v_deal       public.deal_signing_tokens%ROWTYPE;
  v_tenant_id  UUID;
  v_vin        TEXT;
  v_id         UUID;
BEGIN
  IF _signer_type NOT IN ('customer','cobuyer') THEN
    RAISE EXCEPTION 'only customer/cobuyer signings accepted via this RPC';
  END IF;

  SELECT * INTO v_addendum FROM public.addendums
    WHERE signing_token::text = _signing_token AND status <> 'signed'
    LIMIT 1;

  IF FOUND THEN
    v_tenant_id := v_addendum.tenant_id;
    v_vin       := v_addendum.vehicle_vin;
    UPDATE public.addendums SET
      status = CASE WHEN _signer_type = 'customer' THEN 'signed' ELSE status END,
      customer_name = COALESCE(_signer_name, customer_name),
      customer_signature_data = CASE WHEN _signer_type = 'customer' THEN _signature_data ELSE customer_signature_data END,
      customer_signature_type = CASE WHEN _signer_type = 'customer' THEN _signature_type ELSE customer_signature_type END,
      customer_signed_at = CASE WHEN _signer_type = 'customer' THEN now() ELSE customer_signed_at END,
      content_hash = _content_hash,
      esign_consent = _esign_consent,
      user_agent = _user_agent,
      customer_ip = _ip_address,
      signing_location = _signing_location
    WHERE id = v_addendum.id;

    INSERT INTO public.addendum_signings (
      tenant_id, addendum_id, vin, signer_type,
      signer_name, signer_email, signer_phone,
      signature_data, signature_type,
      ip_address, user_agent, signing_location,
      content_hash, esign_consent, canonical_payload, acknowledgments,
      delivery_mileage, price_overrides
    ) VALUES (
      v_tenant_id, v_addendum.id, v_vin, _signer_type,
      _signer_name, _signer_email, _signer_phone,
      _signature_data, _signature_type,
      _ip_address, _user_agent, _signing_location,
      _content_hash, _esign_consent, _canonical_payload, COALESCE(_acknowledgments, '{}'::jsonb),
      _delivery_mileage, _price_overrides
    ) RETURNING id INTO v_id;

    INSERT INTO public.audit_log (
      action, entity_type, entity_id, store_id, content_hash,
      ip_address, user_agent, details
    ) VALUES (
      'addendum_signed', 'addendum', v_addendum.id::text, v_tenant_id::text, _content_hash,
      _ip_address, _user_agent,
      jsonb_build_object('signer_type', _signer_type, 'signing_id', v_id, 'vin', v_vin)
    );

    RETURN v_id;
  END IF;

  SELECT * INTO v_deal FROM public.deal_signing_tokens
    WHERE token = _signing_token AND status = 'pending' AND expires_at > now()
    FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'invalid or expired signing token';
  END IF;

  v_tenant_id := v_deal.tenant_id;
  v_vin       := (v_deal.vehicle_payload->>'vin');

  UPDATE public.deal_signing_tokens SET
    status = 'signed',
    signed_payload = _canonical_payload,
    content_hash = _content_hash,
    customer_ip = _ip_address,
    user_agent = _user_agent,
    esign_consent = _esign_consent,
    signed_at = now(),
    updated_at = now()
  WHERE id = v_deal.id;

  INSERT INTO public.addendum_signings (
    tenant_id, deal_token_id, vin, signer_type,
    signer_name, signer_email, signer_phone,
    signature_data, signature_type,
    ip_address, user_agent, signing_location,
    content_hash, esign_consent, canonical_payload, acknowledgments,
    delivery_mileage, price_overrides
  ) VALUES (
    v_tenant_id, v_deal.id, v_vin, _signer_type,
    _signer_name, _signer_email, _signer_phone,
    _signature_data, _signature_type,
    _ip_address, _user_agent, _signing_location,
    _content_hash, _esign_consent, _canonical_payload, COALESCE(_acknowledgments, '{}'::jsonb),
    _delivery_mileage, _price_overrides
  ) RETURNING id INTO v_id;

  INSERT INTO public.audit_log (
    action, entity_type, entity_id, store_id, content_hash,
    ip_address, user_agent, details
  ) VALUES (
    'deal_signed', 'deal_signing_token', v_deal.id::text, v_tenant_id::text, _content_hash,
    _ip_address, _user_agent,
    jsonb_build_object('signer_type', _signer_type, 'signing_id', v_id, 'vin', v_vin)
  );

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_customer_signing(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, TEXT,
  JSONB, JSONB, JSONB, INTEGER, JSONB
) TO anon, authenticated;

CREATE OR REPLACE VIEW public.addendum_signings_full AS
SELECT
  s.id,
  s.tenant_id,
  t.name AS tenant_name,
  s.addendum_id,
  s.deal_token_id,
  s.vehicle_listing_id,
  s.prep_sign_off_id,
  s.vin,
  s.signer_type,
  s.signer_name,
  s.signer_email,
  s.signer_phone,
  s.signature_type,
  s.ip_address,
  s.content_hash,
  s.signed_at,
  s.acknowledgments,
  s.delivery_mileage
FROM public.addendum_signings s
LEFT JOIN public.tenants t ON t.id = s.tenant_id;

GRANT SELECT ON public.addendum_signings_full TO authenticated;

-- ──────────────────────────────────────────────────────────────────────
-- audit_log tamper-evident hash chain
-- ──────────────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE public.audit_log
  ADD COLUMN IF NOT EXISTS prev_hash TEXT,
  ADD COLUMN IF NOT EXISTS row_hash  TEXT;

CREATE INDEX IF NOT EXISTS idx_audit_log_row_hash
  ON public.audit_log (row_hash);

CREATE OR REPLACE FUNCTION public._audit_chain_payload(
  _prev_hash   TEXT,
  _action      TEXT,
  _entity_type TEXT,
  _entity_id   TEXT,
  _store_id    TEXT,
  _user_email  TEXT,
  _details     JSONB,
  _created_at  TIMESTAMPTZ
) RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT encode(
    digest(
      coalesce(_prev_hash, 'GENESIS') || '|'
        || coalesce(_action, '') || '|'
        || coalesce(_entity_type, '') || '|'
        || coalesce(_entity_id, '') || '|'
        || coalesce(_store_id, '') || '|'
        || coalesce(_user_email, '') || '|'
        || coalesce(_details::text, '{}') || '|'
        || to_char(_created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'sha256'
    ),
    'hex'
  );
$$;

CREATE OR REPLACE FUNCTION public._audit_chain_before_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _prev TEXT;
BEGIN
  SELECT row_hash INTO _prev
  FROM public.audit_log
  WHERE coalesce(store_id, '') = coalesce(NEW.store_id, '')
  ORDER BY created_at DESC, id DESC
  LIMIT 1
  FOR UPDATE;

  NEW.prev_hash := _prev;
  NEW.created_at := coalesce(NEW.created_at, now());
  NEW.row_hash := public._audit_chain_payload(
    _prev,
    NEW.action,
    NEW.entity_type,
    NEW.entity_id,
    NEW.store_id,
    NEW.user_email,
    NEW.details,
    NEW.created_at
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS audit_log_chain_before_insert ON public.audit_log;
CREATE TRIGGER audit_log_chain_before_insert
BEFORE INSERT ON public.audit_log
FOR EACH ROW
EXECUTE FUNCTION public._audit_chain_before_insert();

DO $$
DECLARE
  _processed INT;
BEGIN
  WITH RECURSIVE ordered AS (
    SELECT
      id,
      store_id,
      action,
      entity_type,
      entity_id,
      user_email,
      details,
      created_at,
      row_number() OVER (
        PARTITION BY coalesce(store_id, '')
        ORDER BY created_at ASC, id ASC
      ) AS rn
    FROM public.audit_log
  ),
  chained AS (
    SELECT
      id,
      store_id,
      action,
      entity_type,
      entity_id,
      user_email,
      details,
      created_at,
      rn,
      NULL::TEXT AS prev_hash,
      public._audit_chain_payload(
        NULL, action, entity_type, entity_id, store_id, user_email, details, created_at
      ) AS row_hash
    FROM ordered
    WHERE rn = 1
    UNION ALL
    SELECT
      o.id,
      o.store_id,
      o.action,
      o.entity_type,
      o.entity_id,
      o.user_email,
      o.details,
      o.created_at,
      o.rn,
      c.row_hash AS prev_hash,
      public._audit_chain_payload(
        c.row_hash, o.action, o.entity_type, o.entity_id, o.store_id, o.user_email, o.details, o.created_at
      ) AS row_hash
    FROM ordered o
    JOIN chained c
      ON coalesce(o.store_id, '') = coalesce(c.store_id, '')
     AND o.rn = c.rn + 1
  )
  UPDATE public.audit_log a
     SET prev_hash = c.prev_hash,
         row_hash  = c.row_hash
    FROM chained c
   WHERE a.id = c.id
     AND a.row_hash IS NULL;

  GET DIAGNOSTICS _processed = ROW_COUNT;
  RAISE NOTICE 'audit_log hash chain backfilled: % rows', _processed;
END;
$$;

CREATE OR REPLACE FUNCTION public.verify_audit_chain(_store_id TEXT)
RETURNS TABLE (
  total          INT,
  verified       INT,
  first_break_id UUID,
  first_break_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _row       RECORD;
  _prev      TEXT := NULL;
  _expected  TEXT;
  _total     INT := 0;
  _verified  INT := 0;
  _break_id  UUID := NULL;
  _break_at  TIMESTAMPTZ := NULL;
BEGIN
  FOR _row IN
    SELECT id, action, entity_type, entity_id, store_id,
           user_email, details, created_at, prev_hash, row_hash
      FROM public.audit_log
     WHERE coalesce(store_id, '') = coalesce(_store_id, '')
     ORDER BY created_at ASC, id ASC
  LOOP
    _total := _total + 1;
    _expected := public._audit_chain_payload(
      _prev,
      _row.action, _row.entity_type, _row.entity_id, _row.store_id,
      _row.user_email, _row.details, _row.created_at
    );
    IF _row.row_hash = _expected AND coalesce(_row.prev_hash, '') = coalesce(_prev, '') THEN
      _verified := _verified + 1;
      _prev := _row.row_hash;
    ELSE
      IF _break_id IS NULL THEN
        _break_id := _row.id;
        _break_at := _row.created_at;
      END IF;
      _prev := _row.row_hash;
    END IF;
  END LOOP;

  total := _total;
  verified := _verified;
  first_break_id := _break_id;
  first_break_at := _break_at;
  RETURN NEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION public.verify_audit_chain(TEXT)
  TO authenticated, anon;