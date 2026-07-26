-- ──────────────────────────────────────────────────────────────────────
-- Dealer-configurable auto-assignment of K-208 inspections at release.
--
-- When dealer_profiles.settings->>'service_auto_assign' = 'round_robin',
-- authorize_vehicle_for_get_ready routes the vehicle's pending, unassigned
-- safety_inspection to the accepted service/service_advisor/detail member
-- carrying the fewest pending assigned inspections (ties by user_id).
-- The block is best-effort: any failure inside it is swallowed so the
-- release itself can never be blocked by assignment. Manual assignment via
-- assign_safety_inspection is unchanged and remains the default ('off').
-- ──────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.authorize_vehicle_for_get_ready(p_vehicle_id uuid, p_note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_row public.vehicle_lifecycle%ROWTYPE;
  v_authorized boolean;
  v_member record;
  v_settled text;
  v_assignee uuid;
BEGIN
  SELECT * INTO v_row FROM public.vehicle_lifecycle WHERE vehicle_id = p_vehicle_id FOR UPDATE;
  IF v_row.id IS NULL THEN RAISE EXCEPTION 'lifecycle row not found'; END IF;

  IF v_uid IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1 FROM public.tenant_members tm
      WHERE tm.tenant_id = v_row.tenant_id AND tm.user_id = v_uid AND tm.accepted_at IS NOT NULL
        AND lower(trim(tm.role)) IN ('owner','general_manager','gsm','admin','manager','used_car_manager','inventory_manager','sales_manager')
    ) OR public.has_role(v_uid, 'admin'::public.app_role) INTO v_authorized;
    IF NOT v_authorized THEN RAISE EXCEPTION 'not_authorized'; END IF;
  END IF;

  -- Double-release guard: one authorization per vehicle, ever. Re-review
  -- (gate back to AWAITING) clears authorized_at deliberately via
  -- set_vehicle_lifecycle_gate before a second release can happen.
  IF v_row.authorized_at IS NOT NULL AND v_row.state <> 'AWAITING_MANAGER_AUTHORIZATION' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_authorized',
      'authorized_at', v_row.authorized_at, 'authorized_by', v_row.authorized_by);
  END IF;
  IF v_row.state NOT IN ('AWAITING_MANAGER_AUTHORIZATION','INGESTED','PRELOAD_RUNNING','PRELOAD_EXCEPTION') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_awaiting', 'state', v_row.state);
  END IF;

  UPDATE public.vehicle_lifecycle
  SET state = 'AUTHORIZED_FOR_GET_READY',
      state_changed_by = v_uid,
      authorized_by = v_uid,
      authorized_at = now(),
      gate_reason = p_note
  WHERE id = v_row.id;

  INSERT INTO public.audit_log (action, entity_type, entity_id, store_id, user_id, details)
  VALUES ('vehicle_authorized_for_get_ready', 'vehicle', v_row.vin, v_row.tenant_id::text, v_uid,
          jsonb_build_object('prev_state', v_row.state, 'note', p_note));

  -- Tell the service team the vehicle is released — once per VIN.
  FOR v_member IN
    SELECT tm.user_id FROM public.tenant_members tm
    WHERE tm.tenant_id = v_row.tenant_id AND tm.accepted_at IS NOT NULL
      AND lower(trim(tm.role)) IN ('service_manager','service_advisor','service')
  LOOP
    INSERT INTO public.user_notifications (tenant_id, user_id, type, dedupe_key, vin, payload)
    VALUES (v_row.tenant_id, v_member.user_id, 'vehicle_released_to_service',
            'vehicle_released:' || v_row.tenant_id || ':' || v_row.vin || ':' || v_member.user_id,
            v_row.vin, jsonb_build_object('note', p_note))
    ON CONFLICT (dedupe_key) DO NOTHING;
  END LOOP;

  -- Round-robin auto-assignment of the vehicle's pending K-208. Best-effort:
  -- assignment can inform the release but must never fail it.
  BEGIN
    IF (SELECT dp.settings->>'service_auto_assign' FROM public.dealer_profiles dp
        WHERE dp.tenant_id = v_row.tenant_id) = 'round_robin' THEN
      UPDATE public.safety_inspections si
      SET assigned_to = (
            SELECT tm.user_id
            FROM public.tenant_members tm
            LEFT JOIN public.safety_inspections open_si
              ON open_si.tenant_id = tm.tenant_id
             AND open_si.assigned_to = tm.user_id
             AND open_si.status = 'pending'
            WHERE tm.tenant_id = v_row.tenant_id AND tm.accepted_at IS NOT NULL
              AND lower(trim(tm.role)) IN ('service','service_advisor','detail')
            GROUP BY tm.user_id
            ORDER BY count(open_si.id) ASC, tm.user_id ASC
            LIMIT 1
          ),
          updated_at = now()
      WHERE si.id = (
              SELECT id FROM public.safety_inspections
              WHERE tenant_id = v_row.tenant_id AND vin = v_row.vin
                AND status = 'pending' AND assigned_to IS NULL
              ORDER BY created_at ASC
              LIMIT 1
            )
        AND EXISTS (
              SELECT 1 FROM public.tenant_members tm
              WHERE tm.tenant_id = v_row.tenant_id AND tm.accepted_at IS NOT NULL
                AND lower(trim(tm.role)) IN ('service','service_advisor','detail')
            )
      RETURNING si.assigned_to INTO v_assignee;

      IF v_assignee IS NOT NULL THEN
        INSERT INTO public.audit_log (action, entity_type, entity_id, store_id, user_id, details)
        VALUES ('inspection_auto_assigned', 'vehicle', v_row.vin, v_row.tenant_id::text, v_uid,
                jsonb_build_object('assigned_to', v_assignee, 'strategy', 'round_robin'));

        INSERT INTO public.user_notifications (tenant_id, user_id, type, dedupe_key, vin, payload)
        VALUES (v_row.tenant_id, v_assignee, 'inspection_assigned',
                'auto_assign:' || v_row.tenant_id || ':' || v_row.vin,
                v_row.vin, jsonb_build_object('strategy', 'round_robin'))
        ON CONFLICT (dedupe_key) DO NOTHING;
      END IF;
    END IF;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  -- Settle into the derived operational state (usually SERVICE_UNASSIGNED).
  v_settled := public.recompute_vehicle_lifecycle(v_row.tenant_id, p_vehicle_id);
  RETURN jsonb_build_object('ok', true, 'state', coalesce(v_settled, 'AUTHORIZED_FOR_GET_READY'));
END; $$;

REVOKE ALL ON FUNCTION public.authorize_vehicle_for_get_ready(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.authorize_vehicle_for_get_ready(uuid, text) TO authenticated, service_role;
