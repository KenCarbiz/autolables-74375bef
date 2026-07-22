-- ──────────────────────────────────────────────────────────────────────
-- Self-aware addendum link (Phase 1)
--
-- The addendum builder already has an "install-proof regime": once a VERIFIED
-- install_proofs row exists for a VIN, that product defaults to Installed and
-- every other product defaults to Optional/available. Get-Ready installs never
-- fed it — markAccessoryInstalled only wrote the get_ready_records JSONB.
--
-- This RPC lets the authenticated dealer Get-Ready flow record the same
-- VERIFIED install proof (keyed off the get_ready_records row instead of an
-- outside installer's QR token). A proof requires BOTH a photo and an installer
-- signature (matching install_proofs.is_verified), so the addendum never
-- over-claims an install — checking off a product with proof on Get-Ready is
-- what flips it to Installed and moves the rest to Optional.
--
-- Idempotent + non-clobbering: if a verified proof already exists for the
-- product (e.g. an outside installer recorded it via the token flow), this is a
-- no-op that returns the existing id.
-- ──────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.record_getready_install_proof(
  _record_id uuid,
  _product_id text,
  _product_name text,
  _photo_path text,
  _signature_data text,
  _signature_type text,
  _installer_name text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _tenant uuid; _vin text; _uid uuid; _pid uuid; _id uuid;
BEGIN
  _uid := (SELECT auth.uid());
  SELECT tenant_id, vin INTO _tenant, _vin
    FROM public.get_ready_records WHERE id = _record_id;
  IF _tenant IS NULL THEN RAISE EXCEPTION 'get-ready record not found'; END IF;

  -- Caller must be a member of the record's tenant, or a platform admin.
  IF NOT EXISTS (
    SELECT 1 FROM public.tenant_members WHERE tenant_id = _tenant AND user_id = _uid
  ) AND NOT EXISTS (
    SELECT 1 FROM public.user_roles WHERE user_id = _uid AND role = 'admin'
  ) THEN
    RAISE EXCEPTION 'not authorized for this tenant';
  END IF;

  -- A verifiable proof needs both a photo and a signature. Without both, write
  -- nothing so the addendum will not mark the product installed.
  IF _photo_path IS NULL OR _photo_path = ''
     OR _signature_data IS NULL OR _signature_data = '' THEN
    RETURN NULL;
  END IF;

  BEGIN _pid := _product_id::uuid; EXCEPTION WHEN others THEN _pid := NULL; END;

  -- Non-clobbering: reuse an existing verified proof (e.g. from the outside
  -- installer token flow) rather than duplicating or overwriting it.
  SELECT id INTO _id FROM public.install_proofs
   WHERE tenant_id = _tenant AND vehicle_vin = _vin AND is_verified = true
     AND ( (_pid IS NOT NULL AND product_id = _pid)
        OR (_pid IS NULL AND lower(product_name) = lower(_product_name)) )
   LIMIT 1;
  IF _id IS NOT NULL THEN RETURN _id; END IF;

  INSERT INTO public.install_proofs (
    tenant_id, vehicle_vin, product_id, product_name,
    installer_name, installer_company, installed_at, photo_path, notes,
    installer_signature_data, installer_signature_type, verified_at
  ) VALUES (
    _tenant, _vin, _pid, _product_name,
    COALESCE(NULLIF(_installer_name, ''), 'Dealer install'), 'Get-Ready', now(), _photo_path,
    'Recorded from Get-Ready', _signature_data, COALESCE(_signature_type, 'draw'), now()
  ) RETURNING id INTO _id;
  RETURN _id;
END; $$;

GRANT EXECUTE ON FUNCTION public.record_getready_install_proof(
  uuid, text, text, text, text, text, text
) TO authenticated;
