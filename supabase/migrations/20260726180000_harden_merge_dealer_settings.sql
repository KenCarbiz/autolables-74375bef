-- Closes the settings-merge privilege escalation (security audit finding D4.1):
-- merge_dealer_settings previously required only a bare tenant_members row, so
-- any member could add themselves to k208_authorized_users or flip compliance
-- policy keys with no audit trail. Applied live 2026-07-26.

CREATE OR REPLACE FUNCTION public.merge_dealer_settings(_tenant_id UUID, _patch JSONB)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_role text;
  v_protected text[] := ARRAY[
    'k208_authority_roles','k208_authorized_users',
    'require_safety_inspection','require_k208_licensee_certification',
    'service_failure_photo_required','service_reinspection_managers_only',
    'service_pass_all_enabled','service_overdue_hours'];
  v_touched text[];
BEGIN
  SELECT lower(trim(tm.role)) INTO v_role
    FROM public.tenant_members tm
    WHERE tm.tenant_id = _tenant_id AND tm.user_id = v_uid AND tm.accepted_at IS NOT NULL
    LIMIT 1;
  IF v_role IS NULL AND NOT public.has_role(v_uid, 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  -- Compliance and signer-authority keys are policy: only settings-managing
  -- roles may change them, and every change is audited server-side. A member
  -- adding themselves to k208_authorized_users was a privilege escalation.
  SELECT array_agg(k) INTO v_touched
    FROM jsonb_object_keys(COALESCE(_patch, '{}'::jsonb)) AS t(k)
    WHERE k = ANY(v_protected);
  IF v_touched IS NOT NULL THEN
    IF NOT (public.has_role(v_uid, 'admin'::public.app_role)
            OR v_role IN ('owner','general_manager','gsm','admin','manager','service_manager')) THEN
      RAISE EXCEPTION 'not_authorized_for_policy_keys';
    END IF;
    INSERT INTO public.audit_log (action, entity_type, entity_id, store_id, user_id, details)
    VALUES ('service_policy_changed', 'tenant', _tenant_id::text, _tenant_id::text, v_uid,
            jsonb_build_object('keys', to_jsonb(v_touched),
              'prev', (SELECT jsonb_object_agg(k, dp.settings -> k)
                       FROM unnest(v_touched) AS k, public.dealer_profiles dp
                       WHERE dp.tenant_id = _tenant_id),
              'next', (SELECT jsonb_object_agg(k, _patch -> k) FROM unnest(v_touched) AS k)));
  END IF;
  INSERT INTO public.dealer_profiles (tenant_id, settings, updated_by)
  VALUES (_tenant_id, COALESCE(_patch, '{}'::jsonb), v_uid)
  ON CONFLICT (tenant_id) DO UPDATE
    SET settings   = COALESCE(dealer_profiles.settings, '{}'::jsonb) || COALESCE(_patch, '{}'::jsonb),
        updated_by = v_uid;
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.merge_dealer_settings(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.merge_dealer_settings(uuid, jsonb) TO authenticated;
