-- ──────────────────────────────────────────────────────────────────────
-- S4: stored delivery clearance per vehicle, with reason codes.
--
-- The clearance state is COMPUTED (never hand-set) from the pieces that
-- already gate delivery: the inspection state machine, open item failures,
-- the finalize gate (get_ready_blocks_finalize — dealer settings, authority,
-- certification, installs) and a do-not-drive recall. Stored so the queue and
-- the Ready Board read one word instead of re-deriving it, and audited on
-- every change. src/lib/service/clearance.ts mirrors the decision order.
-- ──────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.vehicle_delivery_clearance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  vin text NOT NULL,
  state text NOT NULL CHECK (state IN (
    'blocked_inspection_not_started','blocked_inspection_in_progress',
    'blocked_failed_items','blocked_k208_not_executed','cleared_for_delivery')),
  reason_codes text[] NOT NULL DEFAULT '{}',
  computed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, vin)
);

CREATE INDEX IF NOT EXISTS delivery_clearance_state_idx
  ON public.vehicle_delivery_clearance (tenant_id, state);

ALTER TABLE public.vehicle_delivery_clearance ENABLE ROW LEVEL SECURITY;

-- Read-only for members: rows are written exclusively by the recompute RPC
-- (SECURITY DEFINER) and service-role automation, never hand-edited.
DROP POLICY IF EXISTS "delivery clearance tenant read" ON public.vehicle_delivery_clearance;
CREATE POLICY "delivery clearance tenant read"
  ON public.vehicle_delivery_clearance FOR SELECT
  TO authenticated
  USING (
    tenant_id IN (
      SELECT tenant_id FROM public.tenant_members
      WHERE user_id = (SELECT auth.uid()) AND accepted_at IS NOT NULL
    )
  );

CREATE OR REPLACE FUNCTION public.recompute_delivery_clearance(p_tenant_id uuid, p_vin text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_vin text := upper(trim(coalesce(p_vin, '')));
  v_condition text;
  v_recall text;
  v_latest_signed public.safety_inspections%ROWTYPE;
  v_workflow_state text;
  v_any boolean;
  v_open_failures boolean;
  v_gate_blocked boolean;
  v_state text;
  v_codes text[] := '{}';
  v_prev text;
BEGIN
  IF p_tenant_id IS NULL OR v_vin = '' THEN RAISE EXCEPTION 'tenant_and_vin_required'; END IF;
  -- auth.uid() is NULL under the service-role key (automation); an interactive
  -- caller must be an accepted member of this exact tenant.
  IF v_uid IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.tenant_members
    WHERE tenant_id = p_tenant_id AND user_id = v_uid AND accepted_at IS NOT NULL
  ) AND NOT public.has_role(v_uid, 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'not_a_member';
  END IF;

  SELECT lower(coalesce(condition, 'used')), coalesce(recall_status, '')
    INTO v_condition, v_recall
    FROM public.vehicle_listings WHERE tenant_id = p_tenant_id AND vin = v_vin LIMIT 1;

  SELECT * INTO v_latest_signed FROM public.safety_inspections
    WHERE tenant_id = p_tenant_id AND vin = v_vin AND status = 'signed'
    ORDER BY signed_at DESC NULLS LAST LIMIT 1;

  SELECT inspection_state INTO v_workflow_state FROM public.safety_inspections
    WHERE tenant_id = p_tenant_id AND vin = v_vin AND status <> 'voided'
    ORDER BY created_at DESC LIMIT 1;
  v_any := FOUND;

  v_open_failures := EXISTS (
    SELECT 1 FROM public.safety_inspection_item_failures
    WHERE tenant_id = p_tenant_id AND vin = v_vin
      AND repair_state <> 'passed_on_reinspection');

  v_gate_blocked := public.get_ready_blocks_finalize(p_tenant_id, v_vin);

  IF v_condition IS NOT NULL AND v_condition NOT IN ('used','cpo','certified') THEN
    -- No K-208 requirement on a new unit; other gates (installs) still apply.
    IF v_gate_blocked THEN
      v_state := 'blocked_k208_not_executed';
      v_codes := array_append(v_codes, 'FINALIZE_GATE_BLOCKED');
    ELSE
      v_state := 'cleared_for_delivery';
      v_codes := array_append(v_codes, 'NOT_APPLICABLE_NEW_VEHICLE');
    END IF;
  ELSIF (v_latest_signed.id IS NOT NULL AND v_latest_signed.result = 'fail') OR v_open_failures THEN
    v_state := 'blocked_failed_items';
    IF v_latest_signed.id IS NOT NULL AND v_latest_signed.result = 'fail' THEN
      v_codes := array_append(v_codes, 'SIGNED_INSPECTION_FAILED');
    END IF;
    IF v_open_failures THEN v_codes := array_append(v_codes, 'FAILED_ITEMS_OPEN'); END IF;
  ELSIF v_recall ILIKE '%do_not_drive%' OR v_recall ILIKE '%do-not-drive%' THEN
    -- A do-not-drive recall is an open safety failure in substance; the spec
    -- enum has no recall state, so the reason code carries the specifics.
    v_state := 'blocked_failed_items';
    v_codes := array_append(v_codes, 'RECALL_DO_NOT_DRIVE');
  ELSIF NOT v_any OR coalesce(v_workflow_state, 'not_started') = 'not_started' THEN
    v_state := 'blocked_inspection_not_started';
    v_codes := array_append(v_codes, 'INSPECTION_NOT_STARTED');
  ELSIF v_workflow_state IN ('in_progress','repairs_in_progress','ready_for_reinspection') THEN
    v_state := 'blocked_inspection_in_progress';
    v_codes := array_append(v_codes,
      CASE WHEN v_workflow_state = 'ready_for_reinspection'
           THEN 'REINSPECTION_REQUIRED' ELSE 'INSPECTION_IN_PROGRESS' END);
  ELSIF v_gate_blocked THEN
    -- Inspection passed but the dealer's configured gate (authority,
    -- certification, installs) is not yet satisfied.
    v_state := 'blocked_k208_not_executed';
    v_codes := array_append(v_codes, 'K208_READY_NOT_EXECUTED');
  ELSIF v_latest_signed.id IS NULL THEN
    v_state := 'blocked_k208_not_executed';
    v_codes := array_append(v_codes, 'K208_READY_NOT_EXECUTED');
  ELSE
    v_state := 'cleared_for_delivery';
  END IF;

  SELECT state INTO v_prev FROM public.vehicle_delivery_clearance
    WHERE tenant_id = p_tenant_id AND vin = v_vin;

  INSERT INTO public.vehicle_delivery_clearance AS c (tenant_id, vin, state, reason_codes, computed_at)
  VALUES (p_tenant_id, v_vin, v_state, v_codes, now())
  ON CONFLICT (tenant_id, vin) DO UPDATE
    SET state = EXCLUDED.state, reason_codes = EXCLUDED.reason_codes, computed_at = now();

  IF v_prev IS DISTINCT FROM v_state THEN
    BEGIN
      INSERT INTO public.audit_log (action, entity_type, entity_id, store_id, user_id, details)
      VALUES ('delivery_clearance_changed', 'vehicle', v_vin, p_tenant_id::text, v_uid,
              jsonb_build_object('prev_state', v_prev, 'new_state', v_state, 'reason_codes', to_jsonb(v_codes)));
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
  END IF;

  RETURN jsonb_build_object('ok', true, 'state', v_state, 'reason_codes', to_jsonb(v_codes));
END;
$$;

REVOKE ALL ON FUNCTION public.recompute_delivery_clearance(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.recompute_delivery_clearance(uuid, text) TO authenticated, service_role;
