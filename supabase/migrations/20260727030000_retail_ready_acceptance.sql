-- ──────────────────────────────────────────────────────────────────────
-- Phase 4: the final-ready acceptance — mark_vehicle_retail_ready.
--
--   * One atomic, server-side acceptance that moves a vehicle into the
--     RETAIL_READY gate state. Until now nothing could reach RETAIL_READY
--     at all (recompute never writes gate states, and set_vehicle_lifecycle_gate
--     deliberately excludes it), so the lifecycle topped out at
--     FINAL_READY_VERIFICATION with no recorded acceptance decision.
--   * Mirrors authorize_vehicle_for_get_ready: row lock, the same manager
--     authority matrix, audit, deduped bell notifications — but the
--     preconditions are the two facts the store already trusts:
--       1. vehicle_delivery_clearance.state = 'cleared_for_delivery'
--          (reject 'not_cleared' with the stored blocker codes), and
--       2. the newest signed non-fail K-208 carries licensee_certified_at
--          (reject 'not_certified').
--   * retail_ready_at is stamped by the existing lifecycle guard trigger
--     on entry to RETAIL_READY; this RPC never sets it directly. The same
--     guard means RETAIL_READY can only unwind through review or a hold.
--   * Double-click safe: an already retail-ready vehicle returns ok
--     without re-running the acceptance or re-notifying anyone.
-- ──────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.mark_vehicle_retail_ready(p_vehicle_id uuid, p_note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_row public.vehicle_lifecycle%ROWTYPE;
  v_authorized boolean;
  v_cl_state text;
  v_cl_codes text[];
  v_certified_at timestamptz;
  v_member record;
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

  IF v_row.state = 'RETAIL_READY' THEN
    RETURN jsonb_build_object('ok', true, 'already', true, 'retail_ready_at', v_row.retail_ready_at);
  END IF;

  -- Gate states are held by an explicit manager decision (review, hold,
  -- wholesale, removed); acceptance only applies to a vehicle in flow.
  IF v_row.state IN ('AWAITING_MANAGER_AUTHORIZATION','ON_HOLD','WHOLESALE','REMOVED') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_eligible', 'state', v_row.state);
  END IF;

  -- Precondition 1: the stored delivery clearance must read cleared. On a
  -- reject, hand back the stored blocker codes so the screen can name them.
  SELECT c.state, c.reason_codes INTO v_cl_state, v_cl_codes
    FROM public.vehicle_delivery_clearance c
    WHERE c.tenant_id = v_row.tenant_id AND c.vin = v_row.vin;
  IF coalesce(v_cl_state, '') <> 'cleared_for_delivery' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_cleared',
      'blockers', to_jsonb(coalesce(v_cl_codes, '{}'::text[])));
  END IF;

  -- Precondition 2: the newest signed non-fail inspection must carry the
  -- licensee certification stamp.
  SELECT s.licensee_certified_at INTO v_certified_at
    FROM public.safety_inspections s
    WHERE s.tenant_id = v_row.tenant_id AND s.vin = v_row.vin
      AND s.status = 'signed' AND lower(coalesce(s.result, '')) <> 'fail'
    ORDER BY s.signed_at DESC NULLS LAST, s.created_at DESC
    LIMIT 1;
  IF v_certified_at IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_certified');
  END IF;

  -- retail_ready_at is stamped by the lifecycle guard trigger on this write.
  UPDATE public.vehicle_lifecycle
  SET state = 'RETAIL_READY',
      state_changed_by = v_uid,
      gate_reason = p_note
  WHERE id = v_row.id;

  INSERT INTO public.audit_log (action, entity_type, entity_id, store_id, user_id, details)
  VALUES ('vehicle_marked_retail_ready', 'vehicle', v_row.vin, v_row.tenant_id::text, v_uid,
          jsonb_build_object('prev_state', v_row.state, 'note', p_note));

  -- Tell sales leadership the vehicle is on the lot for retail — once per VIN.
  FOR v_member IN
    SELECT tm.user_id FROM public.tenant_members tm
    WHERE tm.tenant_id = v_row.tenant_id AND tm.accepted_at IS NOT NULL
      AND lower(trim(tm.role)) IN ('sales_manager','gsm','general_manager','owner')
  LOOP
    INSERT INTO public.user_notifications (tenant_id, user_id, type, dedupe_key, vin, payload)
    VALUES (v_row.tenant_id, v_member.user_id, 'vehicle_retail_ready',
            'vehicle_retail_ready:' || v_row.tenant_id || ':' || v_row.vin || ':' || v_member.user_id,
            v_row.vin, jsonb_build_object('note', p_note))
    ON CONFLICT (dedupe_key) DO NOTHING;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'state', 'RETAIL_READY');
END; $$;

REVOKE ALL ON FUNCTION public.mark_vehicle_retail_ready(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_vehicle_retail_ready(uuid, text) TO authenticated, service_role;
