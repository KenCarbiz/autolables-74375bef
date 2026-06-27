-- ─────────────────────────────────────────────────────────────────────────
-- Finalization gate: block disclosure signing until the K-208 is done.
--
-- Per the corrected design, vehicles PUBLISH freely; the get-ready requirement
-- gates DEAL FINALIZATION (the customer signing the addendum/deal disclosure).
-- record_customer_signing already gates on price verification via a tenant
-- toggle; we add the same shape for the K-208.
--
-- get_ready_blocks_finalize() returns true only when ALL of:
--   • dealer setting require_safety_inspection = true, AND
--   • the vehicle is used/cpo/certified (new cars exempt), AND
--   • no signed safety_inspections row exists for the VIN.
-- Default off → record_customer_signing behaves exactly as before until enabled.
-- ─────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_ready_blocks_finalize(_tenant_id uuid, _vin text)
 RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_require boolean; v_condition text; v_vin text := upper(coalesce(_vin, ''));
BEGIN
  IF _tenant_id IS NULL OR v_vin = '' THEN RETURN false; END IF;
  SELECT (settings ->> 'require_safety_inspection')::boolean INTO v_require
    FROM public.dealer_profiles WHERE tenant_id = _tenant_id;
  IF v_require IS NOT TRUE THEN RETURN false; END IF;
  SELECT lower(coalesce(condition, 'used')) INTO v_condition
    FROM public.vehicle_listings WHERE tenant_id = _tenant_id AND vin = v_vin LIMIT 1;
  IF NOT FOUND THEN RETURN false; END IF;                 -- unknown vehicle → don't block
  IF v_condition NOT IN ('used','cpo','certified') THEN RETURN false; END IF;  -- new cars exempt
  RETURN NOT EXISTS (
    SELECT 1 FROM public.safety_inspections
    WHERE tenant_id = _tenant_id AND vin = v_vin AND status = 'signed'
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.record_customer_signing(_signing_token text, _signer_type text, _signer_name text, _signer_email text, _signer_phone text, _signature_data text, _signature_type text, _ip_address text, _user_agent text, _signing_location jsonb, _content_hash text, _esign_consent jsonb, _canonical_payload jsonb, _acknowledgments jsonb, _delivery_mileage integer, _price_overrides jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

    IF public.get_ready_blocks_finalize(v_tenant_id, v_vin) THEN
      RAISE EXCEPTION 'safety_inspection_required: vehicle % cannot be signed until its CT K-208 safety inspection is completed', v_vin
        USING ERRCODE = 'check_violation';
    END IF;

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

  IF public.get_ready_blocks_finalize(v_tenant_id, v_vin) THEN
    RAISE EXCEPTION 'safety_inspection_required: vehicle % cannot be signed until its CT K-208 safety inspection is completed', v_vin
      USING ERRCODE = 'check_violation';
  END IF;

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
$function$;

GRANT EXECUTE ON FUNCTION public.get_ready_blocks_finalize(uuid, text) TO anon, authenticated;
