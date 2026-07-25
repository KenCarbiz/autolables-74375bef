-- ──────────────────────────────────────────────────────────────────────
-- S6: additional-work request extensions + the structured decision RPC.
--
-- New columns tie a request to the exact failed item, carry sublet cost and
-- the recommended repair, and hold the writer's reply to a clarification.
-- decide_service_request is the ONLY sanctioned decision path: it checks
-- approve authority (the can_approve_service_work matrix), validates the
-- decision value, writes audit_log with prev/new status, and drops a deduped
-- user_notifications row for the requester. A chat message can never
-- authorize work.
-- ──────────────────────────────────────────────────────────────────────

ALTER TABLE public.service_requests
  ADD COLUMN IF NOT EXISTS clarification_response text,
  ADD COLUMN IF NOT EXISTS sublet_cost numeric,
  ADD COLUMN IF NOT EXISTS recommended_repair text,
  ADD COLUMN IF NOT EXISTS inspection_item_id uuid
    REFERENCES public.safety_inspection_item_failures(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION public.decide_service_request(
  p_request_id uuid,
  p_decision text,
  p_note text DEFAULT NULL,
  p_spend_limit numeric DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_row public.service_requests%ROWTYPE;
  v_name text;
  v_authorized boolean;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'auth_required'; END IF;
  IF p_decision NOT IN ('approved','approved_limit','declined','clarify') THEN
    RAISE EXCEPTION 'invalid_decision';
  END IF;
  IF p_decision = 'approved_limit' AND (p_spend_limit IS NULL OR p_spend_limit <= 0) THEN
    RAISE EXCEPTION 'spend_limit_required';
  END IF;

  SELECT * INTO v_row FROM public.service_requests WHERE id = p_request_id;
  IF v_row.id IS NULL THEN RAISE EXCEPTION 'request_not_found'; END IF;

  -- Mirrors the can_approve_service_work capability matrix in
  -- dealerRoleCapabilities.ts — the UI button and this RPC must agree.
  SELECT EXISTS (
    SELECT 1 FROM public.tenant_members tm
    WHERE tm.tenant_id = v_row.tenant_id AND tm.user_id = v_uid AND tm.accepted_at IS NOT NULL
      AND lower(trim(tm.role)) IN (
        'owner','general_manager','gsm','admin','manager',
        'sales_manager','used_car_manager','service_manager')
  ) OR public.has_role(v_uid, 'admin'::public.app_role) INTO v_authorized;
  IF NOT v_authorized THEN RAISE EXCEPTION 'not_authorized_to_decide'; END IF;

  SELECT coalesce(nullif(trim(raw_user_meta_data ->> 'full_name'), ''), email)
    INTO v_name FROM auth.users WHERE id = v_uid;

  UPDATE public.service_requests SET
    status = p_decision,
    manager_note = coalesce(nullif(trim(coalesce(p_note, '')), ''), manager_note),
    spend_limit = CASE WHEN p_decision = 'approved_limit' THEN p_spend_limit ELSE spend_limit END,
    decided_by = v_uid,
    decided_by_name = v_name,
    decided_at = now(),
    updated_at = now()
  WHERE id = p_request_id;

  -- The decision is the auditable act — no exception swallow.
  INSERT INTO public.audit_log (action, entity_type, entity_id, store_id, user_id, details)
  VALUES ('service_request_decided', 'vehicle', v_row.vin, v_row.tenant_id::text, v_uid,
          jsonb_build_object(
            'request_id', p_request_id,
            'prev_status', v_row.status,
            'new_status', p_decision,
            'spend_limit', p_spend_limit,
            'note', nullif(trim(coalesce(p_note, '')), '')));

  -- Tell the requester; dedupe_key makes a retried decision a no-op.
  IF v_row.requested_by IS NOT NULL THEN
    INSERT INTO public.user_notifications (tenant_id, user_id, type, dedupe_key, vin, payload)
    VALUES (v_row.tenant_id, v_row.requested_by, 'service_request_decision',
            'service_request:' || p_request_id || ':' || p_decision,
            v_row.vin,
            jsonb_build_object('request_id', p_request_id, 'decision', p_decision,
                               'decided_by_name', v_name, 'spend_limit', p_spend_limit))
    ON CONFLICT (dedupe_key) DO NOTHING;
  END IF;

  RETURN jsonb_build_object('ok', true, 'id', p_request_id,
                            'prev_status', v_row.status, 'status', p_decision);
END;
$$;

REVOKE ALL ON FUNCTION public.decide_service_request(uuid, text, text, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.decide_service_request(uuid, text, text, numeric) TO authenticated, service_role;
