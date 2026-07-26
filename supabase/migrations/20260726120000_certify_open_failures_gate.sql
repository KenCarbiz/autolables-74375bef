-- ──────────────────────────────────────────────────────────────────────
-- Server half of the "never execute with open failures" gate.
--
-- 20260726105000 refuses to certify an inspection whose OWN result is
-- 'fail', but a NEWER signed pass on the same VIN could still be certified
-- while unresolved safety_inspection_item_failures rows (from an earlier
-- inspection) sit open — laundering the failure loop. Redefine
-- certify_safety_inspection to also RAISE while any item failure for the
-- VIN has repair_state != 'passed_on_reinspection'. The client mirror
-- (K208Panel openFailureCount gate) shows the same refusal up front.
-- ──────────────────────────────────────────────────────────────────────

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

  -- No unresolved item failure anywhere on this VIN: matched by VIN (the
  -- live work queue) or by inspection id (legacy rows filed without a VIN).
  IF EXISTS (
    SELECT 1 FROM public.safety_inspection_item_failures f
    WHERE f.tenant_id = v_tenant
      AND ((f.vin IS NOT NULL AND v_vin IS NOT NULL AND upper(f.vin) = upper(v_vin))
           OR f.inspection_id = p_inspection_id)
      AND f.repair_state <> 'passed_on_reinspection'
  ) THEN
    RAISE EXCEPTION 'failed_items_open';
  END IF;

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
