-- ──────────────────────────────────────────────────────────────────────
-- S8: ONE definition of an executed K-208 — signed AND result != 'fail'.
--
-- The client predicate (isExecutedSignoff, inspectionState.ts) already says a
-- signed FAIL is not an executed sign-off, but two server functions still
-- counted bare status='signed':
--   • get_vehicle_ready (20260629020000:39) reported service_done=true on a
--     signed FAIL, which locked the QR service station ("already completed")
--     on exactly the vehicle that most needs re-inspection;
--   • get_ready_blocks_finalize (20260723010000) let a signed FAIL satisfy the
--     require_safety_inspection finalize gate.
-- Both are re-defined here on executed semantics. Certification stays a
-- separate boolean (licensee_certified_at), exactly as on the client.
-- ──────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_vehicle_ready(_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r public.dept_signoff_tokens%ROWTYPE;
  v_service_done boolean;
  v_service_failed boolean;
  v_detail_done boolean;
  v_products jsonb;
  v_signoffs jsonb;
BEGIN
  SELECT * INTO r FROM public.dept_signoff_tokens WHERE token = _token LIMIT 1;
  IF r.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found'); END IF;
  IF r.expires_at <= now() OR r.status <> 'pending' THEN RETURN jsonb_build_object('ok', false, 'reason', 'expired'); END IF;
  -- Executed semantics: a signed FAIL must NOT read as done — the station has
  -- to stay open for the re-inspection after repairs.
  v_service_done := EXISTS (
    SELECT 1 FROM public.safety_inspections
    WHERE tenant_id = r.tenant_id AND vin = r.vin
      AND status = 'signed' AND result IS DISTINCT FROM 'fail');
  v_service_failed := (NOT v_service_done) AND EXISTS (
    SELECT 1 FROM public.safety_inspections
    WHERE tenant_id = r.tenant_id AND vin = r.vin
      AND status = 'signed' AND result = 'fail');
  v_detail_done := EXISTS (SELECT 1 FROM public.detail_signoffs WHERE tenant_id = r.tenant_id AND vin = r.vin AND status = 'signed');
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'pre_install', true) ORDER BY sort_order), '[]'::jsonb)
    INTO v_products FROM public.products WHERE is_active = true AND available_preinstalled = true;
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'id', id,
           'role', coalesce(performer_role, CASE WHEN is_third_party THEN 'outside' ELSE 'detail' END),
           'performer_name', performer_name,
           'company', provider_company,
           'is_third_party', is_third_party,
           'detail_types', detail_types,
           'installs', installs,
           'photos', jsonb_array_length(coalesce(photos, '[]'::jsonb)),
           'signed_at', signed_at
         ) ORDER BY signed_at), '[]'::jsonb)
    INTO v_signoffs FROM public.detail_signoffs
   WHERE tenant_id = r.tenant_id AND vin = r.vin AND status = 'signed';
  RETURN jsonb_build_object(
    'ok', true, 'tenant_id', r.tenant_id, 'vehicle_listing_id', r.vehicle_listing_id,
    'vin', r.vin, 'ymm', r.ymm,
    'service_done', v_service_done, 'service_failed', v_service_failed,
    'detail_done', v_detail_done,
    'signoffs', v_signoffs,
    'preinstall_products', v_products
  );
END; $$;

GRANT EXECUTE ON FUNCTION public.get_vehicle_ready(text) TO anon, authenticated;

-- Same as 20260723010000 plus executed semantics in all three EXISTS branches.
-- (20260726105000 re-defines this again on the single authority helper; the
-- non-fail rule established here is preserved there.)
CREATE OR REPLACE FUNCTION public.get_ready_blocks_finalize(_tenant_id uuid, _vin text)
 RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_require boolean; v_require_cert boolean; v_condition text;
        v_vin text := upper(coalesce(_vin, '')); v_roles text[]; v_k208 boolean := false;
BEGIN
  IF _tenant_id IS NULL OR v_vin = '' THEN RETURN false; END IF;

  SELECT (settings ->> 'require_safety_inspection')::boolean,
         (settings ->> 'require_k208_licensee_certification')::boolean,
         ARRAY(SELECT jsonb_array_elements_text(coalesce(settings -> 'k208_authority_roles', '[]'::jsonb)))
    INTO v_require, v_require_cert, v_roles
    FROM public.dealer_profiles WHERE tenant_id = _tenant_id;

  -- Legacy "service" authority key → the real service job roles.
  IF v_roles IS NOT NULL AND 'service' = ANY(v_roles) THEN
    v_roles := array_cat(v_roles, ARRAY['service_manager','service_advisor']);
  END IF;

  IF v_require IS TRUE OR v_require_cert IS TRUE THEN
    SELECT lower(coalesce(condition, 'used')) INTO v_condition
      FROM public.vehicle_listings WHERE tenant_id = _tenant_id AND vin = v_vin LIMIT 1;

    IF FOUND AND v_condition IN ('used','cpo','certified') THEN
      -- (a) require an executed (optionally role-authorized) K-208.
      IF v_require IS TRUE THEN
        IF v_roles IS NULL OR array_length(v_roles, 1) IS NULL THEN
          v_k208 := NOT EXISTS (
            SELECT 1 FROM public.safety_inspections
            WHERE tenant_id = _tenant_id AND vin = v_vin AND status = 'signed'
              AND result IS DISTINCT FROM 'fail'
          );
        ELSE
          v_k208 := NOT EXISTS (
            SELECT 1 FROM public.safety_inspections si
            JOIN public.tenant_members tm
              ON tm.user_id = si.created_by AND tm.tenant_id = si.tenant_id
            WHERE si.tenant_id = _tenant_id AND si.vin = v_vin AND si.status = 'signed'
              AND si.result IS DISTINCT FROM 'fail'
              AND tm.accepted_at IS NOT NULL AND tm.role = ANY(v_roles)
          );
        END IF;
      END IF;

      -- (b) additionally require licensee certification of an executed K-208.
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
