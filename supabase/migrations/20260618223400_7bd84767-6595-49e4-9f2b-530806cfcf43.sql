CREATE OR REPLACE FUNCTION public.tenant_price_verification_on(_tenant_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(
    (SELECT (dp.settings->>'feature_price_verification')::boolean
       FROM public.dealer_profiles dp
      WHERE dp.tenant_id = _tenant_id),
    false
  );
$$;
GRANT EXECUTE ON FUNCTION public.tenant_price_verification_on(uuid) TO authenticated, anon;

CREATE OR REPLACE FUNCTION public.enforce_price_verified_before_sign()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'signed'
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'signed')
     AND COALESCE(NEW.price_verified, false) IS NOT TRUE
     AND public.tenant_price_verification_on(NEW.tenant_id) THEN
    RAISE EXCEPTION 'price not verified: addendum cannot be signed (status=%)',
      COALESCE(NEW.price_verification_status, 'pending')
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

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
    IF COALESCE(v_addendum.price_verified, false) IS NOT TRUE
       AND public.tenant_price_verification_on(v_addendum.tenant_id) THEN
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

CREATE OR REPLACE FUNCTION public.admin_set_tenant_features(_tenant_id uuid, _patch jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'admin only';
  END IF;
  INSERT INTO public.dealer_profiles (tenant_id, settings, updated_by, updated_at)
  VALUES (_tenant_id, _patch, auth.uid(), now())
  ON CONFLICT (tenant_id) DO UPDATE
    SET settings = public.dealer_profiles.settings || _patch,
        updated_by = auth.uid(), updated_at = now();
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_set_tenant_features(uuid, jsonb) TO authenticated;

NOTIFY pgrst, 'reload schema';