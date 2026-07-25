-- ──────────────────────────────────────────────────────────────────────
-- Service workspace RPCs the Phase B UI needs but RLS predates.
--
-- The safety_inspections UPDATE policy (20260629070000) allows only the
-- legacy roles ('owner','admin','manager','service'), so assignment and
-- draft saves fail for service_manager / service_advisor — the roles the
-- Service Desk exists for. Rather than widening a broad UPDATE policy,
-- these two narrow SECURITY DEFINER paths write exactly one thing each:
--   assign_safety_inspection  -> assigned_to        (can_assign matrix)
--   save_inspection_draft     -> checklist progress (can_conduct matrix)
-- Neither can touch status, result, signatures, or certification — the
-- legal fields still move only through the sign/certify/transition RPCs.
-- ──────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.assign_safety_inspection(
  p_inspection_id uuid,
  p_user_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_row public.safety_inspections%ROWTYPE;
  v_authorized boolean;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'auth_required'; END IF;

  SELECT * INTO v_row FROM public.safety_inspections WHERE id = p_inspection_id;
  IF v_row.id IS NULL THEN RAISE EXCEPTION 'inspection_not_found'; END IF;
  IF v_row.status <> 'pending' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_pending');
  END IF;

  -- Mirrors the can_assign_service_work capability matrix in
  -- dealerRoleCapabilities.ts — the UI control and this RPC must agree.
  SELECT EXISTS (
    SELECT 1 FROM public.tenant_members tm
    WHERE tm.tenant_id = v_row.tenant_id AND tm.user_id = v_uid AND tm.accepted_at IS NOT NULL
      AND lower(trim(tm.role)) IN (
        'owner','general_manager','gsm','admin','manager',
        'service_manager','service_advisor')
  ) OR public.has_role(v_uid, 'admin'::public.app_role) INTO v_authorized;
  IF NOT v_authorized THEN RAISE EXCEPTION 'not_authorized_to_assign'; END IF;

  -- The assignee must be a member of the same tenant (NULL unassigns).
  IF p_user_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.tenant_members tm
    WHERE tm.tenant_id = v_row.tenant_id AND tm.user_id = p_user_id AND tm.accepted_at IS NOT NULL
  ) THEN RAISE EXCEPTION 'assignee_not_in_tenant'; END IF;

  UPDATE public.safety_inspections
  SET assigned_to = p_user_id, updated_at = now()
  WHERE id = p_inspection_id;

  INSERT INTO public.audit_log (action, entity_type, entity_id, store_id, user_id, details)
  VALUES ('inspection_assigned', 'vehicle', v_row.vin, v_row.tenant_id::text, v_uid,
          jsonb_build_object(
            'inspection_id', p_inspection_id,
            'prev_assigned_to', v_row.assigned_to,
            'new_assigned_to', p_user_id));

  RETURN jsonb_build_object('ok', true);
END $$;

CREATE OR REPLACE FUNCTION public.save_inspection_draft(
  p_inspection_id uuid,
  p_checklist jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_row public.safety_inspections%ROWTYPE;
  v_authorized boolean;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'auth_required'; END IF;
  IF p_checklist IS NULL OR jsonb_typeof(p_checklist) <> 'array' THEN
    RAISE EXCEPTION 'invalid_checklist';
  END IF;

  SELECT * INTO v_row FROM public.safety_inspections WHERE id = p_inspection_id;
  IF v_row.id IS NULL THEN RAISE EXCEPTION 'inspection_not_found'; END IF;
  IF v_row.status <> 'pending' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_pending');
  END IF;

  -- Mirrors the can_conduct_inspection capability matrix.
  SELECT EXISTS (
    SELECT 1 FROM public.tenant_members tm
    WHERE tm.tenant_id = v_row.tenant_id AND tm.user_id = v_uid AND tm.accepted_at IS NOT NULL
      AND lower(trim(tm.role)) IN (
        'owner','general_manager','gsm','admin','manager',
        'service_manager','service_advisor','detail','service')
  ) OR public.has_role(v_uid, 'admin'::public.app_role) INTO v_authorized;
  IF NOT v_authorized THEN RAISE EXCEPTION 'not_authorized_to_inspect'; END IF;

  UPDATE public.safety_inspections
  SET checklist = p_checklist,
      inspection_state = CASE WHEN inspection_state = 'not_started' THEN 'in_progress'
                              ELSE inspection_state END,
      started_at = coalesce(started_at, now()),
      updated_at = now()
  WHERE id = p_inspection_id;

  RETURN jsonb_build_object('ok', true, 'saved_at', now());
END $$;

REVOKE EXECUTE ON FUNCTION public.assign_safety_inspection(uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.save_inspection_draft(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.assign_safety_inspection(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.save_inspection_draft(uuid, jsonb) TO authenticated, service_role;
