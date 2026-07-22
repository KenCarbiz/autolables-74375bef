-- ──────────────────────────────────────────────────────────────────────
-- Self-aware addendum — safety remediation (review findings)
--
-- 1. Opt-in: the Get-Ready→addendum driver is behind a per-dealer setting
--    (dealer_profiles.settings.getready_drives_addendum, default false), so a
--    dealer whose default is "everything pre-installed in the ad price" is not
--    silently switched into proof-driven optional/installed defaulting.
-- 2. Source marker: install_proofs.source records how a proof was captured
--    ('getready' = dealer self-attested via Get-Ready vs the outside-installer
--    token flow), so self-attested and independent substantiation stay
--    distinguishable for the finalize gate and audit.
-- 3. Customer-facing label: Get-Ready proofs carry NO installer_company, so the
--    internal "Get-Ready" sentinel never shows to shoppers as a third-party
--    installer on the passport recon module.
-- 4. Membership check now requires an ACCEPTED membership (matches the RLS read
--    policy), so a writer can always read back what it wrote.
-- ──────────────────────────────────────────────────────────────────────

ALTER TABLE public.install_proofs
  ADD COLUMN IF NOT EXISTS source text;

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
DECLARE _tenant uuid; _vin text; _uid uuid; _pid uuid; _id uuid; _enabled boolean;
BEGIN
  _uid := (SELECT auth.uid());
  SELECT tenant_id, vin INTO _tenant, _vin
    FROM public.get_ready_records WHERE id = _record_id;
  IF _tenant IS NULL THEN RAISE EXCEPTION 'get-ready record not found'; END IF;

  -- Caller must be an ACCEPTED member of the record's tenant, or a platform
  -- admin. (accepted_at mirrors the install_proofs RLS read policy.)
  IF NOT EXISTS (
    SELECT 1 FROM public.tenant_members
     WHERE tenant_id = _tenant AND user_id = _uid AND accepted_at IS NOT NULL
  ) AND NOT EXISTS (
    SELECT 1 FROM public.user_roles WHERE user_id = _uid AND role = 'admin'
  ) THEN
    RAISE EXCEPTION 'not authorized for this tenant';
  END IF;

  -- Opt-in: only drive the addendum when the dealer enabled it.
  SELECT (settings->>'getready_drives_addendum')::boolean INTO _enabled
    FROM public.dealer_profiles WHERE tenant_id = _tenant;
  IF _enabled IS NOT TRUE THEN RETURN NULL; END IF;

  -- A verifiable proof needs both a photo and a signature.
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
    installer_signature_data, installer_signature_type, verified_at, source
  ) VALUES (
    _tenant, _vin, _pid, _product_name,
    COALESCE(NULLIF(_installer_name, ''), 'Dealer install'), NULL, now(), _photo_path,
    'Recorded from Get-Ready', _signature_data, COALESCE(_signature_type, 'draw'), now(), 'getready'
  ) RETURNING id INTO _id;
  RETURN _id;
END; $$;

GRANT EXECUTE ON FUNCTION public.record_getready_install_proof(
  uuid, text, text, text, text, text, text
) TO authenticated;
