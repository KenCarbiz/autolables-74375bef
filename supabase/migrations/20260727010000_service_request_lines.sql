-- ──────────────────────────────────────────────────────────────────────
-- Phase 3b: per-line repair authorization (Recon Approvals spec).
--
-- A service_request was one indivisible blob of work; the approved spec
-- requires line items with amounts the manager can approve selectively
-- ("Select Items — choose specific line items", each line a parts /
-- labor / sublet amount).
--
--   * service_request_lines — line items under a request. Members create
--     lines while the request is still open; a decision freezes them.
--   * decide_service_request gains p_line_decisions: [{id, approved}].
--     On approve/approve-with-limit, listed lines take their verdict and
--     unlisted lines default to approved; on decline every line is
--     rejected. The approved total is audited and carried to the
--     requester's notification so service sees exactly what was
--     authorized, by whom, and for how much.
-- ──────────────────────────────────────────────────────────────────────

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

CREATE INDEX IF NOT EXISTS idx_service_request_lines_request
  ON public.service_request_lines (request_id);
CREATE INDEX IF NOT EXISTS idx_service_request_lines_tenant
  ON public.service_request_lines (tenant_id);

ALTER TABLE public.service_request_lines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "request_lines_read" ON public.service_request_lines;
CREATE POLICY "request_lines_read"
  ON public.service_request_lines FOR SELECT
  TO authenticated
  USING (
    tenant_id IN (
      SELECT tenant_id FROM public.tenant_members
      WHERE user_id = (SELECT auth.uid()) AND accepted_at IS NOT NULL
    )
  );

DROP POLICY IF EXISTS "request_lines_insert" ON public.service_request_lines;
CREATE POLICY "request_lines_insert"
  ON public.service_request_lines FOR INSERT
  TO authenticated
  WITH CHECK (
    tenant_id IN (
      SELECT tenant_id FROM public.tenant_members
      WHERE user_id = (SELECT auth.uid()) AND accepted_at IS NOT NULL
    )
  );
-- No UPDATE/DELETE policies: verdicts are written only by
-- decide_service_request (SECURITY DEFINER); the guard below freezes
-- lines once the parent request is decided.

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
CREATE TRIGGER trg_service_request_lines_guard
  BEFORE INSERT ON public.service_request_lines
  FOR EACH ROW EXECUTE FUNCTION public.service_request_lines_guard();

-- Line-aware decision: identical to 20260726107000 plus p_line_decisions.
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
      AND lower(trim(tm.role)) IN (
        'owner','general_manager','gsm','admin','manager',
        'sales_manager','used_car_manager','service_manager')
  ) OR public.has_role(v_uid, 'admin'::public.app_role) INTO v_authorized;
  IF NOT v_authorized THEN RAISE EXCEPTION 'not_authorized_to_decide'; END IF;

  SELECT coalesce(nullif(trim(raw_user_meta_data ->> 'full_name'), ''), email)
    INTO v_name FROM auth.users WHERE id = v_uid;

  -- Per-line verdicts. A clarify round leaves lines untouched.
  IF p_decision IN ('approved','approved_limit','declined') THEN
    IF p_line_decisions IS NOT NULL THEN
      FOR v_line IN SELECT * FROM jsonb_array_elements(p_line_decisions) LOOP
        UPDATE public.service_request_lines
        SET approved = coalesce((v_line ->> 'approved')::boolean, false), decided_at = now()
        WHERE id = (v_line ->> 'id')::uuid AND request_id = p_request_id;
      END LOOP;
    END IF;
    -- Unlisted lines follow the overall decision.
    UPDATE public.service_request_lines
    SET approved = (p_decision <> 'declined'), decided_at = now()
    WHERE request_id = p_request_id AND decided_at IS NULL;
    SELECT coalesce(sum(amount), 0) INTO v_approved_total
      FROM public.service_request_lines
      WHERE request_id = p_request_id AND approved;
  END IF;

  UPDATE public.service_requests SET
    status = p_decision,
    manager_note = coalesce(nullif(trim(coalesce(p_note, '')), ''), manager_note),
    spend_limit = CASE WHEN p_decision = 'approved_limit' THEN p_spend_limit ELSE spend_limit END,
    decided_by = v_uid,
    decided_by_name = v_name,
    decided_at = now(),
    updated_at = now()
  WHERE id = p_request_id;

  INSERT INTO public.audit_log (action, entity_type, entity_id, store_id, user_id, details)
  VALUES ('service_request_decided', 'vehicle', v_row.vin, v_row.tenant_id::text, v_uid,
          jsonb_build_object(
            'request_id', p_request_id,
            'prev_status', v_row.status,
            'new_status', p_decision,
            'spend_limit', p_spend_limit,
            'approved_total', v_approved_total,
            'line_decisions', p_line_decisions,
            'note', nullif(trim(coalesce(p_note, '')), '')));

  IF v_row.requested_by IS NOT NULL THEN
    INSERT INTO public.user_notifications (tenant_id, user_id, type, dedupe_key, vin, payload)
    VALUES (v_row.tenant_id, v_row.requested_by, 'service_request_decision',
            'service_request:' || p_request_id || ':' || p_decision,
            v_row.vin,
            jsonb_build_object('request_id', p_request_id, 'decision', p_decision,
                               'decided_by_name', v_name, 'spend_limit', p_spend_limit,
                               'approved_total', v_approved_total))
    ON CONFLICT (dedupe_key) DO NOTHING;
  END IF;

  RETURN jsonb_build_object('ok', true, 'id', p_request_id,
                            'prev_status', v_row.status, 'status', p_decision,
                            'approved_total', v_approved_total);
END;
$function$;

REVOKE ALL ON FUNCTION public.decide_service_request(uuid, text, text, numeric, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.decide_service_request(uuid, text, text, numeric, jsonb) TO authenticated, service_role;
