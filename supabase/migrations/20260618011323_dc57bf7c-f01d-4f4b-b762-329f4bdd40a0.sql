-- ============ 20260618000000_addendum_selling_price.sql ============
ALTER TABLE public.addendums
  ADD COLUMN IF NOT EXISTS selling_price numeric(10,2);

COMMENT ON COLUMN public.addendums.selling_price IS
  'Actual selling price before doc fee. expectedOnline = selling_price + doc fee + pre-installed (in-advertised) items, verified against advertised_prices.';

-- ============ 20260618001000_price_integrity_server_gate.sql ============
ALTER TABLE public.addendums
  ADD COLUMN IF NOT EXISTS price_verified            boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS price_verified_at         timestamptz,
  ADD COLUMN IF NOT EXISTS price_verification_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS price_verification_method text,
  ADD COLUMN IF NOT EXISTS expected_total            numeric(10,2),
  ADD COLUMN IF NOT EXISTS scraped_advertised_price  numeric(10,2),
  ADD COLUMN IF NOT EXISTS price_verification_delta  numeric(10,2);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'addendums_price_verification_status_chk'
  ) THEN
    ALTER TABLE public.addendums
      ADD CONSTRAINT addendums_price_verification_status_chk
      CHECK (price_verification_status IN ('pending','verified','mismatch','untracked'));
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.verify_addendum_price(
  _addendum_id uuid,
  _tolerance   numeric DEFAULT 50
) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_addendum public.addendums%ROWTYPE;
  v_adv      numeric;
  v_expected numeric;
  v_status   text;
BEGIN
  SELECT * INTO v_addendum FROM public.addendums WHERE id = _addendum_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'addendum % not found', _addendum_id;
  END IF;

  v_expected := v_addendum.expected_total;

  SELECT ap.advertised_price INTO v_adv
    FROM public.advertised_prices ap
   WHERE ap.tenant_id = v_addendum.tenant_id
     AND upper(ap.vin) = upper(coalesce(v_addendum.vehicle_vin, ''))
   ORDER BY (ap.source_channel = 'website') DESC, ap.captured_at DESC
   LIMIT 1;

  IF v_expected IS NULL OR v_adv IS NULL THEN
    v_status := 'pending';
  ELSIF abs(v_expected - v_adv) <= _tolerance THEN
    v_status := 'verified';
  ELSE
    v_status := 'mismatch';
  END IF;

  UPDATE public.addendums SET
    price_verification_status = v_status,
    price_verified            = (v_status = 'verified'),
    price_verified_at         = CASE WHEN v_status = 'verified' THEN now() ELSE price_verified_at END,
    price_verification_method = CASE WHEN v_adv IS NULL THEN 'scrape_pending' ELSE 'scrape_auto' END,
    scraped_advertised_price  = v_adv,
    price_verification_delta  = CASE WHEN v_adv IS NULL OR v_expected IS NULL THEN NULL ELSE v_expected - v_adv END
  WHERE id = _addendum_id;

  RETURN v_status;
END;
$$;

GRANT EXECUTE ON FUNCTION public.verify_addendum_price(uuid, numeric) TO authenticated;

CREATE OR REPLACE FUNCTION public.enforce_price_verified_before_sign()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'signed'
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'signed')
     AND COALESCE(NEW.price_verified, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'price not verified: addendum cannot be signed (status=%)',
      COALESCE(NEW.price_verification_status, 'pending')
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_price_verified ON public.addendums;
CREATE TRIGGER trg_enforce_price_verified
  BEFORE INSERT OR UPDATE ON public.addendums
  FOR EACH ROW EXECUTE FUNCTION public.enforce_price_verified_before_sign();

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
    IF COALESCE(v_addendum.price_verified, false) IS NOT TRUE THEN
      RAISE EXCEPTION 'price not verified: addendum % cannot be signed (status=%)',
        v_addendum.id, COALESCE(v_addendum.price_verification_status, 'pending')
        USING ERRCODE = 'check_violation';
    END IF;

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

DROP FUNCTION IF EXISTS public.get_addendum_by_token(uuid);

CREATE FUNCTION public.get_addendum_by_token(_token uuid)
RETURNS TABLE (
  id uuid, status text, vehicle_ymm text, vehicle_vin text, vehicle_state text,
  vehicle_price numeric, vehicle_condition text, buyers_guide_id uuid,
  addendum_date date, products_snapshot jsonb, initials jsonb,
  optional_selections jsonb, financing_input jsonb, dealer_snapshot jsonb,
  sb766_financing_disclosure jsonb, sb766_three_day_return_ack boolean,
  sb766_add_on_precontract jsonb, price_overrides jsonb, listing_slug text,
  cobuyer_name text, selling_price numeric,
  price_verified boolean, price_verification_status text
) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT a.id, a.status::text, a.vehicle_ymm::text, a.vehicle_vin::text, a.vehicle_state::text,
    a.vehicle_price::numeric, NULL::text, NULL::uuid, a.addendum_date::date,
    a.products_snapshot, a.initials, a.optional_selections, a.financing_input, a.dealer_snapshot,
    a.sb766_financing_disclosure, a.sb766_three_day_return_ack, a.sb766_add_on_precontract,
    a.price_overrides, a.listing_slug::text, a.cobuyer_name::text, a.selling_price::numeric,
    a.price_verified, a.price_verification_status::text
  FROM public.addendums a WHERE a.signing_token = _token LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_addendum_by_token(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.get_addendum_by_token(uuid) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';