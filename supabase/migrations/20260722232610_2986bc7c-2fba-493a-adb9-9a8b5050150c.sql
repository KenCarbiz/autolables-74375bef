ALTER TABLE public.safety_inspections
  ADD COLUMN IF NOT EXISTS licensee_certified_by uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS licensee_certified_at timestamptz,
  ADD COLUMN IF NOT EXISTS licensee_name text,
  ADD COLUMN IF NOT EXISTS licensee_signature_data text;

CREATE OR REPLACE FUNCTION public.certify_safety_inspection(
  p_inspection_id uuid,
  p_result_initial text,
  p_licensee_name text,
  p_signature_data text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid; v_status text; v_vin text; v_uid uuid := auth.uid(); v_is_mgr boolean;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'auth_required'; END IF;
  SELECT tenant_id, status, vin INTO v_tenant, v_status, v_vin
    FROM public.safety_inspections WHERE id = p_inspection_id;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'inspection_not_found'; END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.tenant_members tm
    WHERE tm.tenant_id = v_tenant AND tm.user_id = v_uid AND tm.accepted_at IS NOT NULL
      AND lower(trim(tm.role)) IN (
        'owner','general_manager','gsm','admin','manager',
        'sales_manager','used_car_manager','inventory_manager','service_manager'
      )
  ) OR public.has_role(v_uid, 'admin'::public.app_role) INTO v_is_mgr;
  IF NOT v_is_mgr THEN RAISE EXCEPTION 'not_authorized_to_certify'; END IF;

  IF v_status <> 'signed' THEN RAISE EXCEPTION 'inspection_not_completed'; END IF;
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

GRANT EXECUTE ON FUNCTION public.certify_safety_inspection(uuid, text, text, text) TO authenticated;