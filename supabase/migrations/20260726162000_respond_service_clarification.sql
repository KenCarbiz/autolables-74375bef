-- Closes the 'clarify' dead-end: decide_service_request can park a request at
-- status='clarify', but every consumer filtered status='pending', so the row
-- vanished from all surfaces and nothing could ever answer the question.
--
-- respond_service_clarification is the sanctioned reply path: the requester
-- (or a member whose role conducts service work, mirroring the
-- can_conduct_inspection matrix in dealerRoleCapabilities.ts) records the
-- answer, the request re-pends into the manager approval queue, the deciders
-- are notified (deduped per clarification round), and the act is audited.

CREATE OR REPLACE FUNCTION public.respond_service_clarification(
  p_request_id uuid,
  p_response text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_row public.service_requests%ROWTYPE;
  v_name text;
  v_authorized boolean;
  v_resp text := nullif(trim(coalesce(p_response, '')), '');
  v_round text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'auth_required'; END IF;
  IF v_resp IS NULL THEN RAISE EXCEPTION 'response_required'; END IF;

  SELECT * INTO v_row FROM public.service_requests WHERE id = p_request_id;
  IF v_row.id IS NULL THEN RAISE EXCEPTION 'request_not_found'; END IF;
  IF v_row.status <> 'clarify' THEN RAISE EXCEPTION 'not_awaiting_clarification'; END IF;

  SELECT (v_row.requested_by = v_uid) OR EXISTS (
    SELECT 1 FROM public.tenant_members tm
    WHERE tm.tenant_id = v_row.tenant_id AND tm.user_id = v_uid AND tm.accepted_at IS NOT NULL
      AND lower(trim(tm.role)) IN (
        'owner','general_manager','gsm','admin','manager',
        'service_manager','service_advisor','detail')
  ) OR public.has_role(v_uid, 'admin'::public.app_role) INTO v_authorized;
  IF NOT v_authorized THEN RAISE EXCEPTION 'not_authorized_to_respond'; END IF;

  SELECT coalesce(nullif(trim(raw_user_meta_data ->> 'full_name'), ''), email)
    INTO v_name FROM auth.users WHERE id = v_uid;

  UPDATE public.service_requests SET
    clarification_response = v_resp,
    status = 'pending',
    updated_at = now()
  WHERE id = p_request_id;

  -- The answer is the auditable act — no exception swallow.
  INSERT INTO public.audit_log (action, entity_type, entity_id, store_id, user_id, details)
  VALUES ('service_request_clarified', 'vehicle', v_row.vin, v_row.tenant_id::text, v_uid,
          jsonb_build_object(
            'request_id', p_request_id,
            'prev_status', 'clarify',
            'new_status', 'pending',
            'response', v_resp));

  -- Notify the deciders: the manager who asked, plus every member whose role
  -- can decide. Deduped per clarification round (decided_at stamps the round),
  -- so a retried reply is a no-op but a later round notifies again.
  v_round := coalesce(to_char(v_row.decided_at, 'YYYYMMDDHH24MISSMS'), '0');
  INSERT INTO public.user_notifications (tenant_id, user_id, type, dedupe_key, vin, payload)
  SELECT DISTINCT ON (tm.user_id)
         v_row.tenant_id, tm.user_id, 'service_request_clarified',
         'service_request_clarified:' || p_request_id || ':' || v_round || ':' || tm.user_id,
         v_row.vin,
         jsonb_build_object('request_id', p_request_id, 'responded_by_name', v_name)
  FROM public.tenant_members tm
  WHERE tm.tenant_id = v_row.tenant_id AND tm.accepted_at IS NOT NULL AND tm.user_id IS NOT NULL
    AND (tm.user_id = v_row.decided_by OR lower(trim(tm.role)) IN (
      'owner','general_manager','gsm','admin','manager',
      'sales_manager','used_car_manager','service_manager'))
  ON CONFLICT (dedupe_key) DO NOTHING;

  RETURN jsonb_build_object('ok', true, 'id', p_request_id,
                            'prev_status', 'clarify', 'status', 'pending');
END;
$$;

REVOKE ALL ON FUNCTION public.respond_service_clarification(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.respond_service_clarification(uuid, text) TO authenticated, service_role;
