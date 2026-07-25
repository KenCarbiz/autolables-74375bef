-- ──────────────────────────────────────────────────────────────────────
-- S7: ONE authority source for K-208 execution.
--
-- The signer is EXPLICITLY authorized, never job-title-derived by default:
--   settings.k208_authority_roles   jsonb array of role strings (existing)
--   settings.k208_authorized_users  jsonb array of user-id strings (NEW)
-- k208_signer_allowed() is the single decision point read by
-- certify_safety_inspection, get_ready_blocks_finalize, and any future
-- execution path. Client-side, the can_execute_k208 capability is granted to
-- NO role (dealerRoleCapabilities.ts); per-user grants flow through settings.
--
-- Compatibility: when a dealer has configured NEITHER list, the helper keeps
-- certify's historic manager-level rule so no in-flight store is locked out;
-- the moment either list is configured, only the configured authority signs.
-- ──────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.k208_authority_configured(p_tenant_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.dealer_profiles
    WHERE tenant_id = p_tenant_id
      AND (jsonb_array_length(coalesce(settings -> 'k208_authority_roles', '[]'::jsonb)) > 0
        OR jsonb_array_length(coalesce(settings -> 'k208_authorized_users', '[]'::jsonb)) > 0)
  );
$$;

CREATE OR REPLACE FUNCTION public.k208_signer_allowed(p_tenant_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $function$
DECLARE
  v_roles text[];
  v_users text[];
  v_member_role text;
BEGIN
  IF p_tenant_id IS NULL OR p_user_id IS NULL THEN RETURN false; END IF;
  IF public.has_role(p_user_id, 'admin'::public.app_role) THEN RETURN true; END IF;

  SELECT ARRAY(SELECT jsonb_array_elements_text(coalesce(settings -> 'k208_authority_roles', '[]'::jsonb))),
         ARRAY(SELECT jsonb_array_elements_text(coalesce(settings -> 'k208_authorized_users', '[]'::jsonb)))
    INTO v_roles, v_users
    FROM public.dealer_profiles WHERE tenant_id = p_tenant_id;

  -- Legacy "service" authority key → the real service job roles.
  IF v_roles IS NOT NULL AND 'service' = ANY(v_roles) THEN
    v_roles := array_cat(v_roles, ARRAY['service_manager','service_advisor']);
  END IF;

  SELECT lower(trim(tm.role)) INTO v_member_role
    FROM public.tenant_members tm
    WHERE tm.tenant_id = p_tenant_id AND tm.user_id = p_user_id AND tm.accepted_at IS NOT NULL
    LIMIT 1;
  IF v_member_role IS NULL THEN RETURN false; END IF;   -- signer must be an accepted member

  IF coalesce(array_length(v_users, 1), 0) > 0 AND p_user_id::text = ANY(v_users) THEN
    RETURN true;
  END IF;
  IF coalesce(array_length(v_roles, 1), 0) > 0 AND v_member_role = ANY(v_roles) THEN
    RETURN true;
  END IF;

  -- Neither list configured: historic manager-level compat rule (the exact set
  -- certify_safety_inspection enforced since 20260723000000).
  IF coalesce(array_length(v_roles, 1), 0) = 0 AND coalesce(array_length(v_users, 1), 0) = 0 THEN
    RETURN v_member_role IN (
      'owner','general_manager','gsm','admin','manager',
      'sales_manager','used_car_manager','inventory_manager','service_manager');
  END IF;

  RETURN false;
END;
$function$;

REVOKE ALL ON FUNCTION public.k208_authority_configured(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.k208_authority_configured(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.k208_signer_allowed(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.k208_signer_allowed(uuid, uuid) TO authenticated, service_role;

-- certify_safety_inspection now reads the ONE authority source, and refuses to
-- certify a failed inspection: certification confirms an executed (signed,
-- non-fail) K-208, it can never launder open failures.
CREATE OR REPLACE FUNCTION public.certify_safety_inspection(
  p_inspection_id uuid,
  p_result_initial text,
  p_licensee_name text,
  p_signature_data text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid; v_status text; v_result text; v_vin text; v_uid uuid := (SELECT auth.uid());
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'auth_required'; END IF;
  SELECT tenant_id, status, result, vin INTO v_tenant, v_status, v_result, v_vin
    FROM public.safety_inspections WHERE id = p_inspection_id;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'inspection_not_found'; END IF;

  IF NOT public.k208_signer_allowed(v_tenant, v_uid) THEN
    RAISE EXCEPTION 'not_authorized_to_certify';
  END IF;

  IF v_status <> 'signed' THEN RAISE EXCEPTION 'inspection_not_completed'; END IF;
  IF v_result = 'fail' THEN RAISE EXCEPTION 'inspection_failed_items_open'; END IF;
  IF p_result_initial NOT IN ('A','B','C') THEN RAISE EXCEPTION 'invalid_result'; END IF;

  UPDATE public.safety_inspections
    SET licensee_certified_by = v_uid,
        licensee_certified_at = now(),
        licensee_name = p_licensee_name,
        licensee_signature_data = p_signature_data,
        result_initial = p_result_initial
    WHERE id = p_inspection_id;

  INSERT INTO public.audit_log (action, entity_type, entity_id, store_id, user_id, details)
    VALUES ('k208_licensee_certified', 'vehicle', v_vin, v_tenant::text, v_uid,
            jsonb_build_object('inspection_id', p_inspection_id, 'result_initial', p_result_initial));

  RETURN p_inspection_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.certify_safety_inspection(uuid, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.certify_safety_inspection(uuid, text, text, text) TO authenticated;

-- Finalize gate re-defined on the same authority source. Behavior matrix:
--   authority not configured -> any executed K-208 satisfies (compat);
--   configured -> the executed K-208 must be signed by an allowed signer.
-- Preserves 20260726101000's executed (non-fail) semantics and the optional
-- require_k208_licensee_certification branch.
CREATE OR REPLACE FUNCTION public.get_ready_blocks_finalize(_tenant_id uuid, _vin text)
 RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_require boolean; v_require_cert boolean; v_condition text;
        v_vin text := upper(coalesce(_vin, '')); v_k208 boolean := false;
BEGIN
  IF _tenant_id IS NULL OR v_vin = '' THEN RETURN false; END IF;

  SELECT (settings ->> 'require_safety_inspection')::boolean,
         (settings ->> 'require_k208_licensee_certification')::boolean
    INTO v_require, v_require_cert
    FROM public.dealer_profiles WHERE tenant_id = _tenant_id;

  IF v_require IS TRUE OR v_require_cert IS TRUE THEN
    SELECT lower(coalesce(condition, 'used')) INTO v_condition
      FROM public.vehicle_listings WHERE tenant_id = _tenant_id AND vin = v_vin LIMIT 1;

    IF FOUND AND v_condition IN ('used','cpo','certified') THEN
      IF v_require IS TRUE THEN
        IF NOT public.k208_authority_configured(_tenant_id) THEN
          v_k208 := NOT EXISTS (
            SELECT 1 FROM public.safety_inspections
            WHERE tenant_id = _tenant_id AND vin = v_vin AND status = 'signed'
              AND result IS DISTINCT FROM 'fail'
          );
        ELSE
          v_k208 := NOT EXISTS (
            SELECT 1 FROM public.safety_inspections si
            WHERE si.tenant_id = _tenant_id AND si.vin = v_vin AND si.status = 'signed'
              AND si.result IS DISTINCT FROM 'fail'
              AND public.k208_signer_allowed(_tenant_id, si.created_by)
          );
        END IF;
      END IF;

      IF NOT v_k208 AND v_require_cert IS TRUE THEN
        v_k208 := NOT EXISTS (
          SELECT 1 FROM public.safety_inspections
          WHERE tenant_id = _tenant_id AND vin = v_vin AND status = 'signed'
            AND result IS DISTINCT FROM 'fail'
            AND licensee_certified_at IS NOT NULL
        );
      END IF;
    END IF;
  END IF;

  IF v_k208 THEN RETURN true; END IF;

  RETURN public.installs_block_finalize(_tenant_id, v_vin);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.get_ready_blocks_finalize(uuid, text) TO anon, authenticated;
