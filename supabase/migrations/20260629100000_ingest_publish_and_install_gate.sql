-- ─────────────────────────────────────────────────────────────────────────
-- Intake publishes freely; the hard gate moves entirely to deal finalization.
--
-- Per the dealer's compliance model:
--   • NO gate at intake. The customer passport publishes the moment a car is in
--     inventory — recon, K-208, and pre-installs all happen afterward while the
--     car is being made ready. The only publish-time block that survives is a
--     KNOWN do-not-drive recall (a genuine safety/legal floor), with admin
--     override. The prep-sign-off requirement and the recall-freshness
--     requirement are removed.
--   • The HARD gate is at finalization (the customer signing the disclosure):
--     the deal cannot be signed until (a) the CT K-208 safety inspection is
--     signed AND (b) every pre-installed product has a VERIFIED install proof
--     (photo + installer signature). Each half has its own dealer setting and
--     is default-off, so finalization behaves exactly as before until enabled.
-- ─────────────────────────────────────────────────────────────────────────

-- ── Publish gate: do-not-drive recall only (no prep, no freshness) ──────────
CREATE OR REPLACE FUNCTION public.enforce_prep_gate()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_do_not_drive BOOLEAN;
BEGIN
  IF NEW.status = 'published'
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'published') THEN
    IF public.has_role(auth.uid(), 'admin') THEN
      RETURN NEW;
    END IF;
    -- A known do-not-drive recall still blocks publish without an admin override.
    -- Unknown / not-yet-checked recall status does NOT block — vehicles are
    -- shoppable immediately; the recall sweep + RecallBanner surface campaigns.
    v_do_not_drive := COALESCE((NEW.recall_check ->> 'do_not_drive')::BOOLEAN, false);
    IF v_do_not_drive AND NEW.recall_override_by IS NULL THEN
      RAISE EXCEPTION 'recall_gate_blocked: vehicle % has an active do-not-drive recall; admin override required',
        NEW.vin USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

-- ── Install-verification finalize gate (independent, default-off) ───────────
-- Blocks finalization when any pre-installed product on the vehicle's addendum
-- lacks a verified install proof. Default off via require_install_verification.
CREATE OR REPLACE FUNCTION public.installs_block_finalize(_tenant_id uuid, _vin text)
 RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_require boolean; v_vin text := upper(coalesce(_vin, '')); v_snap jsonb;
BEGIN
  IF _tenant_id IS NULL OR v_vin = '' THEN RETURN false; END IF;
  SELECT (settings ->> 'require_install_verification')::boolean INTO v_require
    FROM public.dealer_profiles WHERE tenant_id = _tenant_id;
  IF v_require IS NOT TRUE THEN RETURN false; END IF;     -- default off

  SELECT products_snapshot INTO v_snap
    FROM public.addendums
    WHERE tenant_id = _tenant_id AND vehicle_vin = v_vin
    ORDER BY created_at DESC
    LIMIT 1;
  IF v_snap IS NULL OR jsonb_typeof(v_snap) <> 'array' THEN RETURN false; END IF;

  -- Block if any installed (pre-installed) line has no matching verified proof.
  RETURN EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_snap) prod
    WHERE coalesce(prod->>'badge_type', 'installed') = 'installed'
      AND coalesce(btrim(prod->>'name'), '') <> ''
      AND NOT EXISTS (
        SELECT 1 FROM public.install_proofs ip
        WHERE ip.tenant_id = _tenant_id AND upper(ip.vehicle_vin) = v_vin
          AND ip.is_verified = true
          AND lower(btrim(ip.product_name)) = lower(btrim(prod->>'name'))
      )
  );
END;
$function$;

-- ── Combined get-ready finalize gate: K-208 OR install verification ─────────
-- record_customer_signing already calls this in both finalize branches, so
-- extending it here adds the install gate without touching the signing RPC.
CREATE OR REPLACE FUNCTION public.get_ready_blocks_finalize(_tenant_id uuid, _vin text)
 RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_require boolean; v_condition text; v_vin text := upper(coalesce(_vin, '')); v_k208 boolean := false;
BEGIN
  IF _tenant_id IS NULL OR v_vin = '' THEN RETURN false; END IF;

  -- K-208 half (existing semantics: gated on require_safety_inspection; new
  -- cars exempt; blocks when no signed inspection exists).
  SELECT (settings ->> 'require_safety_inspection')::boolean INTO v_require
    FROM public.dealer_profiles WHERE tenant_id = _tenant_id;
  IF v_require IS TRUE THEN
    SELECT lower(coalesce(condition, 'used')) INTO v_condition
      FROM public.vehicle_listings WHERE tenant_id = _tenant_id AND vin = v_vin LIMIT 1;
    IF FOUND AND v_condition IN ('used','cpo','certified') THEN
      v_k208 := NOT EXISTS (
        SELECT 1 FROM public.safety_inspections
        WHERE tenant_id = _tenant_id AND vin = v_vin AND status = 'signed'
      );
    END IF;
  END IF;
  IF v_k208 THEN RETURN true; END IF;

  -- Install-verification half (independent setting).
  RETURN public.installs_block_finalize(_tenant_id, v_vin);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.get_ready_blocks_finalize(uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.installs_block_finalize(uuid, text) TO anon, authenticated;
