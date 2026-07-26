-- ──────────────────────────────────────────────────────────────────────
-- Phase 2a: the manager release transaction + the arrival notice.
--
--   * authorize_vehicle_for_get_ready(p_vehicle_id, p_note) — ONE atomic,
--     server-side release. Until now authorization was a ~230-line
--     non-transactional client sequence (useCommandCenter) with a second
--     competing path on the Ready Board; a partial failure could dispatch
--     work orders twice or release documents without a recorded release.
--     This RPC is the single source of the release decision:
--       manager authority → lifecycle release (AWAITING → AUTHORIZED, or
--       first-authorization stamp on grandfathered rows) → double-release
--       guard → audit → deduped bell notifications to the service team.
--     Emails/PDF fan-out stay in the notify-* edge functions, but they
--     now key off authorized_at, which only this RPC can set — so the
--     fan-out can be re-run safely and can never run before the decision
--     is durable.
--   * New-VIN arrival notice: when a lifecycle row is born waiting at the
--     manager gate, every intake-authority member gets ONE bell item per
--     VIN (dedupe_key unique), fixing "nobody is told a car arrived" in
--     the default manual dispatch mode.
-- ──────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.authorize_vehicle_for_get_ready(p_vehicle_id uuid, p_note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_row public.vehicle_lifecycle%ROWTYPE;
  v_authorized boolean;
  v_member record;
  v_settled text;
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

  -- Settle into the derived operational state (usually SERVICE_UNASSIGNED).
  v_settled := public.recompute_vehicle_lifecycle(v_row.tenant_id, p_vehicle_id);
  RETURN jsonb_build_object('ok', true, 'state', coalesce(v_settled, 'AUTHORIZED_FOR_GET_READY'));
END; $$;

REVOKE ALL ON FUNCTION public.authorize_vehicle_for_get_ready(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.authorize_vehicle_for_get_ready(uuid, text) TO authenticated, service_role;

-- Re-review must clear the one-shot stamp so a deliberate second release
-- is possible after the vehicle is pulled back to the gate.
CREATE OR REPLACE FUNCTION public.lifecycle_clear_authorization_on_rereview()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.state = 'AWAITING_MANAGER_AUTHORIZATION' AND OLD.state <> 'AWAITING_MANAGER_AUTHORIZATION' THEN
    NEW.authorized_at := NULL;
    NEW.authorized_by := NULL;
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_lifecycle_clear_authorization ON public.vehicle_lifecycle;
CREATE TRIGGER trg_lifecycle_clear_authorization
  BEFORE UPDATE ON public.vehicle_lifecycle
  FOR EACH ROW EXECUTE FUNCTION public.lifecycle_clear_authorization_on_rereview();

-- ── New-VIN arrival notice: one bell item per VIN to every member with
--    intake authority, the moment the lifecycle row is born at the gate. ─
CREATE OR REPLACE FUNCTION public.notify_vehicle_arrival()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_member record;
BEGIN
  IF NEW.state <> 'AWAITING_MANAGER_AUTHORIZATION' THEN RETURN NEW; END IF;
  BEGIN
    FOR v_member IN
      SELECT tm.user_id FROM public.tenant_members tm
      WHERE tm.tenant_id = NEW.tenant_id AND tm.accepted_at IS NOT NULL
        AND lower(trim(tm.role)) IN ('owner','general_manager','gsm','admin','manager','used_car_manager','inventory_manager')
    LOOP
      INSERT INTO public.user_notifications (tenant_id, user_id, type, dedupe_key, vin, payload)
      VALUES (NEW.tenant_id, v_member.user_id, 'new_vehicle_arrived',
              'new_vehicle_arrived:' || NEW.tenant_id || ':' || NEW.vin || ':' || v_member.user_id,
              NEW.vin, '{}'::jsonb)
      ON CONFLICT (dedupe_key) DO NOTHING;
    END LOOP;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_lifecycle_arrival_notice ON public.vehicle_lifecycle;
CREATE TRIGGER trg_lifecycle_arrival_notice
  AFTER INSERT ON public.vehicle_lifecycle
  FOR EACH ROW EXECUTE FUNCTION public.notify_vehicle_arrival();
