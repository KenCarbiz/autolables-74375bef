-- ── 20260727010000: service_request_lines + line-aware decide RPC ──
CREATE TABLE IF NOT EXISTS public.service_request_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  request_id uuid NOT NULL REFERENCES public.service_requests(id) ON DELETE CASCADE,
  item text NOT NULL,
  line_type text NOT NULL DEFAULT 'parts' CHECK (line_type IN ('parts','labor','sublet')),
  qty numeric,
  rate numeric,
  amount numeric NOT NULL CHECK (amount >= 0),
  approved boolean,
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_service_request_lines_request ON public.service_request_lines (request_id);
CREATE INDEX IF NOT EXISTS idx_service_request_lines_tenant ON public.service_request_lines (tenant_id);
GRANT SELECT, INSERT ON public.service_request_lines TO authenticated;
GRANT ALL ON public.service_request_lines TO service_role;
ALTER TABLE public.service_request_lines ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "request_lines_read" ON public.service_request_lines;
CREATE POLICY "request_lines_read" ON public.service_request_lines FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT tenant_id FROM public.tenant_members WHERE user_id = (SELECT auth.uid()) AND accepted_at IS NOT NULL));
DROP POLICY IF EXISTS "request_lines_insert" ON public.service_request_lines;
CREATE POLICY "request_lines_insert" ON public.service_request_lines FOR INSERT TO authenticated
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM public.tenant_members WHERE user_id = (SELECT auth.uid()) AND accepted_at IS NOT NULL));

CREATE OR REPLACE FUNCTION public.service_request_lines_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_status text;
BEGIN
  SELECT status INTO v_status FROM public.service_requests WHERE id = NEW.request_id;
  IF v_status IS NULL THEN RAISE EXCEPTION 'request_not_found'; END IF;
  IF TG_OP = 'INSERT' AND v_status NOT IN ('pending','clarify') THEN
    RAISE EXCEPTION 'request_already_decided';
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS trg_service_request_lines_guard ON public.service_request_lines;
CREATE TRIGGER trg_service_request_lines_guard BEFORE INSERT ON public.service_request_lines
  FOR EACH ROW EXECUTE FUNCTION public.service_request_lines_guard();

DROP FUNCTION IF EXISTS public.decide_service_request(uuid, text, text, numeric);
CREATE OR REPLACE FUNCTION public.decide_service_request(
  p_request_id uuid, p_decision text, p_note text DEFAULT NULL,
  p_spend_limit numeric DEFAULT NULL, p_line_decisions jsonb DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_row public.service_requests%ROWTYPE;
  v_name text;
  v_authorized boolean;
  v_line jsonb;
  v_approved_total numeric := 0;
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
  SELECT EXISTS (
    SELECT 1 FROM public.tenant_members tm
    WHERE tm.tenant_id = v_row.tenant_id AND tm.user_id = v_uid AND tm.accepted_at IS NOT NULL
      AND lower(trim(tm.role)) IN ('owner','general_manager','gsm','admin','manager',
        'sales_manager','used_car_manager','service_manager')
  ) OR public.has_role(v_uid, 'admin'::public.app_role) INTO v_authorized;
  IF NOT v_authorized THEN RAISE EXCEPTION 'not_authorized_to_decide'; END IF;
  SELECT coalesce(nullif(trim(raw_user_meta_data ->> 'full_name'), ''), email)
    INTO v_name FROM auth.users WHERE id = v_uid;
  IF p_decision IN ('approved','approved_limit','declined') THEN
    IF p_line_decisions IS NOT NULL THEN
      FOR v_line IN SELECT * FROM jsonb_array_elements(p_line_decisions) LOOP
        UPDATE public.service_request_lines
        SET approved = coalesce((v_line ->> 'approved')::boolean, false), decided_at = now()
        WHERE id = (v_line ->> 'id')::uuid AND request_id = p_request_id;
      END LOOP;
    END IF;
    UPDATE public.service_request_lines
    SET approved = (p_decision <> 'declined'), decided_at = now()
    WHERE request_id = p_request_id AND decided_at IS NULL;
    SELECT coalesce(sum(amount), 0) INTO v_approved_total
      FROM public.service_request_lines WHERE request_id = p_request_id AND approved;
  END IF;
  UPDATE public.service_requests SET
    status = p_decision,
    manager_note = coalesce(nullif(trim(coalesce(p_note, '')), ''), manager_note),
    spend_limit = CASE WHEN p_decision = 'approved_limit' THEN p_spend_limit ELSE spend_limit END,
    decided_by = v_uid, decided_by_name = v_name, decided_at = now(), updated_at = now()
  WHERE id = p_request_id;
  INSERT INTO public.audit_log (action, entity_type, entity_id, store_id, user_id, details)
  VALUES ('service_request_decided', 'vehicle', v_row.vin, v_row.tenant_id::text, v_uid,
          jsonb_build_object('request_id', p_request_id, 'prev_status', v_row.status,
            'new_status', p_decision, 'spend_limit', p_spend_limit,
            'approved_total', v_approved_total, 'line_decisions', p_line_decisions,
            'note', nullif(trim(coalesce(p_note, '')), '')));
  IF v_row.requested_by IS NOT NULL THEN
    INSERT INTO public.user_notifications (tenant_id, user_id, type, dedupe_key, vin, payload)
    VALUES (v_row.tenant_id, v_row.requested_by, 'service_request_decision',
            'service_request:' || p_request_id || ':' || p_decision, v_row.vin,
            jsonb_build_object('request_id', p_request_id, 'decision', p_decision,
              'decided_by_name', v_name, 'spend_limit', p_spend_limit,
              'approved_total', v_approved_total))
    ON CONFLICT (dedupe_key) DO NOTHING;
  END IF;
  RETURN jsonb_build_object('ok', true, 'id', p_request_id,
    'prev_status', v_row.status, 'status', p_decision, 'approved_total', v_approved_total);
END; $function$;
REVOKE ALL ON FUNCTION public.decide_service_request(uuid, text, text, numeric, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.decide_service_request(uuid, text, text, numeric, jsonb) TO authenticated, service_role;

-- ── 20260727020000: seed_service_request_lines trigger + backfill ──
CREATE OR REPLACE FUNCTION public.seed_service_request_lines()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.service_request_lines WHERE request_id = NEW.id) THEN
      IF coalesce(NEW.est_parts, 0) > 0 THEN
        INSERT INTO public.service_request_lines (tenant_id, request_id, item, line_type, amount)
        VALUES (NEW.tenant_id, NEW.id, coalesce(nullif(NEW.work_requested, ''), 'Parts') || ' (parts)', 'parts', NEW.est_parts);
      END IF;
      IF coalesce(NEW.est_labor, 0) > 0 THEN
        INSERT INTO public.service_request_lines (tenant_id, request_id, item, line_type, amount)
        VALUES (NEW.tenant_id, NEW.id, coalesce(nullif(NEW.work_requested, ''), 'Labor') || ' (labor)', 'labor', NEW.est_labor);
      END IF;
      IF coalesce(NEW.sublet_cost, 0) > 0 THEN
        INSERT INTO public.service_request_lines (tenant_id, request_id, item, line_type, amount)
        VALUES (NEW.tenant_id, NEW.id, coalesce(nullif(NEW.work_requested, ''), 'Sublet') || ' (sublet)', 'sublet', NEW.sublet_cost);
      END IF;
    END IF;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS trg_seed_service_request_lines ON public.service_requests;
CREATE TRIGGER trg_seed_service_request_lines AFTER INSERT ON public.service_requests
  FOR EACH ROW EXECUTE FUNCTION public.seed_service_request_lines();

INSERT INTO public.service_request_lines (tenant_id, request_id, item, line_type, amount)
SELECT r.tenant_id, r.id, coalesce(nullif(r.work_requested, ''), 'Parts') || ' (parts)', 'parts', r.est_parts
FROM public.service_requests r
WHERE r.status IN ('pending','clarify') AND coalesce(r.est_parts, 0) > 0
  AND NOT EXISTS (SELECT 1 FROM public.service_request_lines l WHERE l.request_id = r.id);
INSERT INTO public.service_request_lines (tenant_id, request_id, item, line_type, amount)
SELECT r.tenant_id, r.id, coalesce(nullif(r.work_requested, ''), 'Labor') || ' (labor)', 'labor', r.est_labor
FROM public.service_requests r
WHERE r.status IN ('pending','clarify') AND coalesce(r.est_labor, 0) > 0
  AND NOT EXISTS (SELECT 1 FROM public.service_request_lines l WHERE l.request_id = r.id AND l.line_type = 'labor');
INSERT INTO public.service_request_lines (tenant_id, request_id, item, line_type, amount)
SELECT r.tenant_id, r.id, coalesce(nullif(r.work_requested, ''), 'Sublet') || ' (sublet)', 'sublet', r.sublet_cost
FROM public.service_requests r
WHERE r.status IN ('pending','clarify') AND coalesce(r.sublet_cost, 0) > 0
  AND NOT EXISTS (SELECT 1 FROM public.service_request_lines l WHERE l.request_id = r.id AND l.line_type = 'sublet');

-- ── 20260727030000: mark_vehicle_retail_ready RPC ──
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
  IF v_row.state IN ('AWAITING_MANAGER_AUTHORIZATION','ON_HOLD','WHOLESALE','REMOVED') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_eligible', 'state', v_row.state);
  END IF;
  SELECT c.state, c.reason_codes INTO v_cl_state, v_cl_codes
    FROM public.vehicle_delivery_clearance c
    WHERE c.tenant_id = v_row.tenant_id AND c.vin = v_row.vin;
  IF coalesce(v_cl_state, '') <> 'cleared_for_delivery' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_cleared',
      'blockers', to_jsonb(coalesce(v_cl_codes, '{}'::text[])));
  END IF;
  SELECT s.licensee_certified_at INTO v_certified_at
    FROM public.safety_inspections s
    WHERE s.tenant_id = v_row.tenant_id AND s.vin = v_row.vin
      AND s.status = 'signed' AND lower(coalesce(s.result, '')) <> 'fail'
    ORDER BY s.signed_at DESC NULLS LAST, s.created_at DESC LIMIT 1;
  IF v_certified_at IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_certified');
  END IF;
  UPDATE public.vehicle_lifecycle
  SET state = 'RETAIL_READY', state_changed_by = v_uid, gate_reason = p_note
  WHERE id = v_row.id;
  INSERT INTO public.audit_log (action, entity_type, entity_id, store_id, user_id, details)
  VALUES ('vehicle_marked_retail_ready', 'vehicle', v_row.vin, v_row.tenant_id::text, v_uid,
          jsonb_build_object('prev_state', v_row.state, 'note', p_note));
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