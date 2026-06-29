-- K-208 sign-off authority: make the Service Desk's "Service Writer" /
-- "Service Manager" chips real, and keep the legacy "service" key working.
--
-- The finalize gate (get_ready_blocks_finalize) matches the signed K-208
-- inspector's tenant_members.role against settings.k208_authority_roles. The old
-- UI offered a single "service" key, but no member role is literally "service",
-- so that selection could never be satisfied by a logged-in member. The UI now
-- offers service_manager / service_advisor (the real roles); here we redefine
-- the gate to expand a saved legacy "service" entry to those two roles, so any
-- dealer who already chose "Service" keeps a working gate.
--
-- Byte-for-byte identical to 20260629100000's definition except the v_roles
-- back-compat expansion. Idempotent.

CREATE OR REPLACE FUNCTION public.get_ready_blocks_finalize(_tenant_id uuid, _vin text)
 RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_require boolean; v_condition text; v_vin text := upper(coalesce(_vin, ''));
        v_roles text[]; v_k208 boolean := false;
BEGIN
  IF _tenant_id IS NULL OR v_vin = '' THEN RETURN false; END IF;

  SELECT (settings ->> 'require_safety_inspection')::boolean,
         ARRAY(SELECT jsonb_array_elements_text(coalesce(settings -> 'k208_authority_roles', '[]'::jsonb)))
    INTO v_require, v_roles
    FROM public.dealer_profiles WHERE tenant_id = _tenant_id;

  -- Legacy "service" authority key → the real service job roles.
  IF v_roles IS NOT NULL AND 'service' = ANY(v_roles) THEN
    v_roles := array_cat(v_roles, ARRAY['service_manager','service_advisor']);
  END IF;

  IF v_require IS TRUE THEN
    SELECT lower(coalesce(condition, 'used')) INTO v_condition
      FROM public.vehicle_listings WHERE tenant_id = _tenant_id AND vin = v_vin LIMIT 1;
    IF FOUND AND v_condition IN ('used','cpo','certified') THEN
      IF v_roles IS NULL OR array_length(v_roles, 1) IS NULL THEN
        v_k208 := NOT EXISTS (
          SELECT 1 FROM public.safety_inspections
          WHERE tenant_id = _tenant_id AND vin = v_vin AND status = 'signed'
        );
      ELSE
        v_k208 := NOT EXISTS (
          SELECT 1 FROM public.safety_inspections si
          JOIN public.tenant_members tm
            ON tm.user_id = si.created_by AND tm.tenant_id = si.tenant_id
          WHERE si.tenant_id = _tenant_id AND si.vin = v_vin AND si.status = 'signed'
            AND tm.accepted_at IS NOT NULL AND tm.role = ANY(v_roles)
        );
      END IF;
    END IF;
  END IF;
  IF v_k208 THEN RETURN true; END IF;

  RETURN public.installs_block_finalize(_tenant_id, v_vin);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.get_ready_blocks_finalize(uuid, text) TO anon, authenticated;
