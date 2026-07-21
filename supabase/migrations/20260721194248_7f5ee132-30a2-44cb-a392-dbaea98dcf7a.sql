
CREATE OR REPLACE FUNCTION public.create_draft_addendum(p_tenant_id uuid, p_vin text)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_vin text := upper(trim(p_vin));
  v_existing uuid;
  v_year int; v_make text; v_model text; v_trim text; v_condition text; v_mileage int;
  v_ymm text; v_stock text;
  v_products jsonb;
  v_id uuid;
BEGIN
  IF p_tenant_id IS NULL OR v_vin = '' THEN RETURN NULL; END IF;

  SELECT id INTO v_existing FROM public.addendums
    WHERE tenant_id = p_tenant_id AND vehicle_vin = v_vin LIMIT 1;
  IF v_existing IS NOT NULL THEN RETURN v_existing; END IF;

  SELECT nullif(regexp_replace(coalesce(year, ''), '[^0-9]', '', 'g'), '')::int,
         make, model, trim, condition, mileage, stock_number
    INTO v_year, v_make, v_model, v_trim, v_condition, v_mileage, v_stock
    FROM public.vehicle_files WHERE tenant_id = p_tenant_id AND vin = v_vin LIMIT 1;

  IF v_make IS NULL THEN
    SELECT ymm, condition INTO v_ymm, v_condition
      FROM public.vehicle_listings WHERE tenant_id = p_tenant_id AND vin = v_vin LIMIT 1;
  ELSE
    v_ymm := trim(concat_ws(' ', v_year::text, v_make, v_model));
  END IF;

  SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY p.sort_order), '[]'::jsonb) INTO v_products
  FROM public.products p
  WHERE p.is_active = true AND EXISTS (
    SELECT 1 FROM public.product_rules r
    WHERE r.tenant_id = p_tenant_id AND r.product_id = p.id
      AND (nullif(r.year_min::text, '') IS NULL OR v_year IS NULL OR v_year >= nullif(r.year_min::text, '')::int)
      AND (nullif(r.year_max::text, '') IS NULL OR v_year IS NULL OR v_year <= nullif(r.year_max::text, '')::int)
      AND (r.makes IS NULL OR array_length(r.makes, 1) IS NULL OR lower(coalesce(v_make, '')) = ANY (SELECT lower(x) FROM unnest(r.makes) x))
      AND (r.models IS NULL OR array_length(r.models, 1) IS NULL OR lower(coalesce(v_model, '')) = ANY (SELECT lower(x) FROM unnest(r.models) x))
      AND (r.trims IS NULL OR array_length(r.trims, 1) IS NULL OR lower(coalesce(v_trim, '')) = ANY (SELECT lower(x) FROM unnest(r.trims) x))
      AND (r.condition IS NULL OR r.condition = 'all' OR lower(r.condition) = lower(coalesce(v_condition, 'used')))
      AND (r.mileage_max IS NULL OR v_mileage IS NULL OR v_mileage <= r.mileage_max)
  );

  IF v_products = '[]'::jsonb THEN RETURN NULL; END IF;

  INSERT INTO public.addendums (
    tenant_id, vehicle_vin, vehicle_ymm, vehicle_stock, addendum_date,
    products_snapshot, customer_info, status, lifecycle_status,
    price_verified, price_verification_status
  ) VALUES (
    p_tenant_id, v_vin, v_ymm, v_stock, current_date,
    v_products, '{}'::jsonb, 'draft', 'draft',
    false, 'pending'
  ) RETURNING id INTO v_id;

  RETURN v_id;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.create_draft_addendum(uuid, text) FROM public;
GRANT EXECUTE ON FUNCTION public.create_draft_addendum(uuid, text) TO service_role;

ALTER TABLE public.addendum_signings
  ADD COLUMN IF NOT EXISTS return_window_closes_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS return_status           TEXT
    CHECK (return_status IN ('eligible', 'requested', 'completed', 'denied', 'expired', 'waived')),
  ADD COLUMN IF NOT EXISTS return_requested_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS return_completed_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS return_reason           TEXT,
  ADD COLUMN IF NOT EXISTS return_restocking_fee   NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS return_delivery_mileage INTEGER;

CREATE INDEX IF NOT EXISTS idx_signings_return_status
  ON public.addendum_signings (return_status)
  WHERE return_status IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_signings_return_close
  ON public.addendum_signings (return_window_closes_at)
  WHERE return_window_closes_at IS NOT NULL;

CREATE OR REPLACE FUNCTION public.stamp_sb766_return_window()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  _ack BOOLEAN;
BEGIN
  _ack := COALESCE((NEW.acknowledgments ->> 'three_day_return_ack')::BOOLEAN,
                   (NEW.acknowledgments ->> 'sb766_three_day_return_ack')::BOOLEAN,
                   FALSE);
  IF _ack
     AND NEW.signer_type = 'customer'
     AND NEW.signed_at >= TIMESTAMPTZ '2026-10-01 00:00:00+00'
     AND NEW.return_window_closes_at IS NULL THEN
    NEW.return_window_closes_at := NEW.signed_at + INTERVAL '3 days';
    NEW.return_status := 'eligible';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS stamp_sb766_return_window_trigger ON public.addendum_signings;
CREATE TRIGGER stamp_sb766_return_window_trigger
  BEFORE INSERT ON public.addendum_signings
  FOR EACH ROW EXECUTE FUNCTION public.stamp_sb766_return_window();

CREATE OR REPLACE FUNCTION public.request_return(
  _signing_token UUID,
  _reason        TEXT DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _addendum RECORD;
  _signing  RECORD;
BEGIN
  SELECT a.id, a.tenant_id, a.store_id, a.vehicle_vin, a.vehicle_ymm
    INTO _addendum FROM public.addendums a
   WHERE a.signing_token = _signing_token LIMIT 1;
  IF _addendum.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'unknown_token');
  END IF;
  SELECT s.id, s.signed_at, s.return_window_closes_at, s.return_status
    INTO _signing FROM public.addendum_signings s
   WHERE s.addendum_id = _addendum.id AND s.signer_type = 'customer'
   ORDER BY s.signed_at DESC NULLS LAST LIMIT 1;
  IF _signing.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_signed');
  END IF;
  IF _signing.return_window_closes_at IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_eligible');
  END IF;
  IF now() > _signing.return_window_closes_at THEN
    UPDATE public.addendum_signings SET return_status = 'expired'
     WHERE id = _signing.id AND return_status = 'eligible';
    RETURN jsonb_build_object('ok', false, 'reason', 'window_closed',
                              'closed_at', _signing.return_window_closes_at);
  END IF;
  IF _signing.return_status IN ('requested', 'completed') THEN
    RETURN jsonb_build_object('ok', true, 'reason', 'already_requested');
  END IF;
  UPDATE public.addendum_signings
     SET return_status = 'requested',
         return_requested_at = now(),
         return_reason = _reason
   WHERE id = _signing.id;
  INSERT INTO public.audit_log (action, entity_type, entity_id, store_id, user_email, details)
  VALUES ('return_requested', 'addendum_signing', _signing.id::text,
          COALESCE(_addendum.store_id, _addendum.tenant_id::text), NULL,
          jsonb_build_object('addendum_id', _addendum.id, 'vin', _addendum.vehicle_vin,
                             'ymm', _addendum.vehicle_ymm, 'reason', _reason,
                             'signed_at', _signing.signed_at,
                             'closes_at', _signing.return_window_closes_at));
  RETURN jsonb_build_object('ok', true, 'requested_at', now(),
                            'closes_at', _signing.return_window_closes_at);
END;
$$;

GRANT EXECUTE ON FUNCTION public.request_return(UUID, TEXT) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.resolve_return(
  _signing_id  UUID, _outcome TEXT,
  _restocking  NUMERIC DEFAULT NULL, _mileage INTEGER DEFAULT NULL, _reason TEXT DEFAULT NULL
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _tenant_id UUID;
BEGIN
  IF _outcome NOT IN ('completed', 'denied') THEN
    RAISE EXCEPTION 'resolve_return: outcome must be completed or denied';
  END IF;
  SELECT tenant_id INTO _tenant_id FROM public.addendum_signings WHERE id = _signing_id;
  IF _tenant_id IS NULL OR _tenant_id <> public.current_tenant_id() THEN
    RAISE EXCEPTION 'resolve_return: not authorized for this signing';
  END IF;
  UPDATE public.addendum_signings
     SET return_status = _outcome,
         return_completed_at = now(),
         return_restocking_fee = COALESCE(_restocking, return_restocking_fee),
         return_delivery_mileage = COALESCE(_mileage, return_delivery_mileage),
         return_reason = COALESCE(_reason, return_reason)
   WHERE id = _signing_id;
  INSERT INTO public.audit_log (action, entity_type, entity_id, store_id, details)
  VALUES (CASE WHEN _outcome = 'completed' THEN 'return_completed' ELSE 'return_denied' END,
          'addendum_signing', _signing_id::text, _tenant_id::text,
          jsonb_build_object('restocking_fee', _restocking, 'mileage', _mileage, 'reason', _reason));
END;
$$;

GRANT EXECUTE ON FUNCTION public.resolve_return(UUID, TEXT, NUMERIC, INTEGER, TEXT)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_signing_return_status(_signing_token UUID)
RETURNS TABLE (
  addendum_id UUID, tenant_id UUID, store_id TEXT, vehicle_vin TEXT, vehicle_ymm TEXT,
  signing_id UUID, signed_at TIMESTAMPTZ, return_window_closes_at TIMESTAMPTZ,
  return_status TEXT, return_requested_at TIMESTAMPTZ, dealer_snapshot JSONB
) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT a.id, a.tenant_id, a.store_id, a.vehicle_vin, a.vehicle_ymm,
         s.id, s.signed_at, s.return_window_closes_at, s.return_status,
         s.return_requested_at, a.dealer_snapshot
    FROM public.addendums a
    LEFT JOIN LATERAL (
      SELECT ss.* FROM public.addendum_signings ss
       WHERE ss.addendum_id = a.id AND ss.signer_type = 'customer'
       ORDER BY ss.signed_at DESC NULLS LAST LIMIT 1
    ) s ON true
   WHERE a.signing_token = _signing_token LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.get_signing_return_status(UUID)
  TO anon, authenticated, service_role;
