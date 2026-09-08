-- ──────────────────────────────────────────────────────────────────────
-- VIN check-in: the vehicle comes from the scan, the authority comes from
-- the session.
--
-- Vendor, service and detail check-in are addressed today by a per-vehicle
-- token (/install/:token, /inspect/:token, /ready/:token). A token is a
-- capability: holding the link IS the proof that the dealership sent it to
-- you, which is why those RPCs are granted to anon.
--
-- A VIN is not a capability. It is legible through the windshield, printed on
-- the door jamb, and stamped on the dashboard of every car on the lot. So a
-- surface that resolved a scanned VIN straight to a sign-off would let anyone
-- standing next to a vehicle close out work on it. Replacing the token with a
-- VIN therefore has to move the authorisation, not delete it.
--
-- It moves here. This function refuses anon, takes the caller's identity from
-- the JWT and never from a parameter, and only then hands back the vehicle's
-- existing token — to a member whose role does this work, and, for a
-- third-party vendor, only for a vehicle carrying a line addressed to their own
-- email. That is the scoping vendor_assigned_lines (20260907190000) already
-- established for the vendor read, applied to the check-in. A vendor scanning a
-- car nobody dispatched to them gets 'not_assigned' and no token.
--
-- Net effect vs the printed QR: the sign-off is now attributable to a signed-in
-- person, where before it only proved that somebody held the link.
-- ──────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.resolve_vin_checkin(p_vin text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_email text;
  v_vin text;
  v_member record;
  v_tenant uuid;
  v_role text;
  v_tenant_name text;
  v_listing public.vehicle_listings%ROWTYPE;
  v_ready public.get_ready_records%ROWTYPE;
  v_found boolean := false;
  v_assignments jsonb := '[]'::jsonb;
  v_token text;
  v_install uuid;
  v_ymm text;
  v_stock text;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  END IF;

  -- The caller's own verified address. Never a parameter: a vendor asking on
  -- another vendor's behalf would otherwise reach work that is not theirs.
  v_email := lower(trim(coalesce(auth.jwt() ->> 'email', '')));

  v_vin := upper(regexp_replace(coalesce(p_vin, ''), '[^A-Za-z0-9]', '', 'g'));
  IF length(v_vin) <> 17 OR v_vin ~ '[IOQ]' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_vin', 'vin', v_vin);
  END IF;

  -- A person can belong to more than one store. Take the first of their own
  -- tenants that actually holds this VIN, so a scan resolves without asking
  -- them which building they are standing in.
  FOR v_member IN
    SELECT m.tenant_id, lower(trim(coalesce(m.role, ''))) AS role
      FROM public.tenant_members m
     WHERE m.user_id = v_uid
       AND m.accepted_at IS NOT NULL
     ORDER BY m.invited_at
  LOOP
    v_tenant := v_member.tenant_id;
    v_role := v_member.role;

    SELECT * INTO v_listing
      FROM public.vehicle_listings
     WHERE tenant_id = v_tenant AND upper(vin) = v_vin
     LIMIT 1;

    SELECT * INTO v_ready
      FROM public.get_ready_records
     WHERE tenant_id = v_tenant AND upper(vin) = v_vin
     ORDER BY created_at DESC
     LIMIT 1;

    IF v_listing.id IS NOT NULL OR v_ready.id IS NOT NULL THEN
      v_found := true;
      EXIT;
    END IF;
  END LOOP;

  IF v_tenant IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_membership', 'vin', v_vin);
  END IF;

  SELECT name INTO v_tenant_name FROM public.tenants WHERE id = v_tenant;

  IF NOT v_found THEN
    RETURN jsonb_build_object(
      'ok', false, 'reason', 'vehicle_not_found',
      'vin', v_vin, 'tenant_id', v_tenant, 'tenant_name', v_tenant_name);
  END IF;

  v_ymm := nullif(coalesce(v_listing.ymm, v_ready.ymm, ''), '');
  v_stock := nullif(coalesce(v_ready.stock_number, ''), '');

  IF v_role IN ('third_party_vendor', 'vendor') THEN
    -- Same predicate as vendor_assigned_lines: the line has to name this
    -- caller's own address. Anything else on the car stays invisible.
    SELECT coalesce(jsonb_agg(jsonb_build_object(
             'record_id', g.id,
             'item_id', x.item ->> 'id',
             'label', x.item ->> 'label',
             'category', coalesce(x.item ->> 'category', 'other'),
             'status', coalesce(x.item ->> 'status', 'pending'),
             'notes', nullif(trim(coalesce(x.item ->> 'notes', '')), '')
           )), '[]'::jsonb)
      INTO v_assignments
      FROM public.get_ready_records g
      CROSS JOIN LATERAL jsonb_array_elements(coalesce(g.items, '[]'::jsonb)) AS x(item)
     WHERE g.tenant_id = v_tenant
       AND upper(g.vin) = v_vin
       AND lower(trim(coalesce(x.item ->> 'vendorEmail', ''))) = v_email;

    IF jsonb_array_length(v_assignments) = 0 THEN
      RETURN jsonb_build_object(
        'ok', false, 'reason', 'not_assigned',
        'vin', v_vin, 'ymm', v_ymm, 'tenant_id', v_tenant, 'tenant_name', v_tenant_name,
        'role', v_role, 'email', v_email);
    END IF;

    -- The install-proof surface, and only for a vendor who has an install line
    -- on THIS car. install_proofs is evidence a product was fitted; an outside
    -- company must not be able to file that against a vehicle nobody gave them.
    IF EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_assignments) a WHERE a ->> 'category' = 'accessory'
    ) THEN
      v_install := v_listing.install_token;
    END IF;

    RETURN jsonb_build_object(
      'ok', true, 'mode', 'vendor',
      'vin', v_vin, 'ymm', v_ymm, 'stock_number', v_stock,
      'tenant_id', v_tenant, 'tenant_name', v_tenant_name, 'role', v_role,
      'vehicle_listing_id', v_listing.id,
      'ready_token', NULL, 'install_token', v_install,
      'assignments', v_assignments);
  END IF;

  -- Dealership staff. The roles listed here are the ones whose capability set
  -- in src/lib/permissions/dealerRoleCapabilities.ts carries get-ready or
  -- inspection work; a salesperson or a biller scanning a door jamb is told so
  -- rather than handed a sign-off surface.
  IF v_role NOT IN (
    'owner', 'admin', 'general_manager', 'gsm', 'manager',
    'used_car_manager', 'inventory_manager',
    'service_manager', 'service_advisor', 'technician', 'detail'
  ) THEN
    RETURN jsonb_build_object(
      'ok', false, 'reason', 'role_not_permitted',
      'vin', v_vin, 'ymm', v_ymm, 'tenant_id', v_tenant, 'tenant_name', v_tenant_name,
      'role', v_role);
  END IF;

  -- Reuse, never re-implement, the hub token. issue_vehicle_ready_token is the
  -- one place a dept_signoff_tokens row is minted, and it re-checks membership
  -- against auth.uid() itself.
  v_token := public.issue_vehicle_ready_token(v_tenant, v_vin);
  v_install := v_listing.install_token;

  RETURN jsonb_build_object(
    'ok', true, 'mode', 'staff',
    'vin', v_vin, 'ymm', v_ymm, 'stock_number', v_stock,
    'tenant_id', v_tenant, 'tenant_name', v_tenant_name, 'role', v_role,
    'vehicle_listing_id', v_listing.id,
    'ready_token', v_token, 'install_token', v_install,
    'assignments', '[]'::jsonb);
END $$;

REVOKE ALL ON FUNCTION public.resolve_vin_checkin(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_vin_checkin(text) TO authenticated;

COMMENT ON FUNCTION public.resolve_vin_checkin(text) IS
  'Resolves a scanned VIN to the check-in the CALLER may perform on it. Authenticated only; identity comes from the JWT, never a parameter. A third-party vendor resolves only vehicles carrying a line addressed to their own email.';
