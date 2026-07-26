-- ──────────────────────────────────────────────────────────────────────
-- Vehicle lifecycle foundation (Phase 1 of the orchestration build).
--
-- One STORED, server-controlled lifecycle per used/CPO vehicle, spanning
-- nightly ingest through retail-ready. Until now the overall state was
-- derived client-side (deriveServiceStatus / deriveWorkspaceStatus) and
-- every screen re-derived its own truth — the root cause of the count
-- contradictions across Work Queue / Service Desk / Ready Board / Prep.
--
--   * vehicle_lifecycle — one row per (tenant, vehicle), 22 states.
--   * Gate states (AWAITING_MANAGER_AUTHORIZATION, ON_HOLD, WHOLESALE,
--     REMOVED, RETAIL_READY) move ONLY by explicit manager transitions.
--   * Operational states between the gates are recomputed from the same
--     stored facts the clearance machine already trusts — never invented.
--   * recompute_vehicle_lifecycle is the single writer for operational
--     states; set_vehicle_lifecycle_gate is the manager gate control.
--     Phase 2 adds authorize_vehicle_for_get_ready on top of this.
--   * Fact-table triggers keep the row fresh; they swallow their own
--     errors so lifecycle bookkeeping can NEVER break a legal write.
--   * Backfill: existing inventory is grandfathered as already
--     authorized (work is in flight); only vehicles ingested AFTER this
--     migration start at AWAITING_MANAGER_AUTHORIZATION. Nothing is
--     enforced against the gate yet, so rollout is behavior-safe.
--   * Cleanup: pending K-208s whose listing no longer exists are voided
--     (36 rows on the live project inflated every queue count), and a
--     delist trigger prevents new orphans.
-- ──────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.vehicle_lifecycle (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  vehicle_id uuid NOT NULL REFERENCES public.vehicle_listings(id) ON DELETE CASCADE,
  vin text NOT NULL,
  state text NOT NULL DEFAULT 'INGESTED',
  previous_state text,
  state_changed_at timestamptz NOT NULL DEFAULT now(),
  state_changed_by uuid REFERENCES auth.users(id),
  authorized_by uuid REFERENCES auth.users(id),
  authorized_at timestamptz,
  gate_reason text,
  retail_ready_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, vehicle_id),
  CONSTRAINT vehicle_lifecycle_state_check CHECK (state IN (
    'INGESTED','PRELOAD_RUNNING','PRELOAD_EXCEPTION',
    'AWAITING_MANAGER_AUTHORIZATION','AUTHORIZED_FOR_GET_READY',
    'SERVICE_UNASSIGNED','K208_IN_PROGRESS','SERVICE_FINDINGS_RECORDED',
    'WAITING_FOR_MANAGER_DECISION','RETURNED_FOR_CLARIFICATION',
    'WORK_AUTHORIZED','REPAIR_IN_PROGRESS','REPAIR_VERIFICATION_REQUIRED',
    'K208_READY_TO_CERTIFY','K208_FINALIZED',
    'DETAIL_PENDING','DETAIL_IN_PROGRESS','FINAL_READY_VERIFICATION',
    'RETAIL_READY','ON_HOLD','WHOLESALE','REMOVED'
  ))
);

CREATE INDEX IF NOT EXISTS idx_vehicle_lifecycle_tenant_state
  ON public.vehicle_lifecycle (tenant_id, state);
CREATE INDEX IF NOT EXISTS idx_vehicle_lifecycle_vin
  ON public.vehicle_lifecycle (tenant_id, vin);

ALTER TABLE public.vehicle_lifecycle ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "vehicle_lifecycle_read" ON public.vehicle_lifecycle;
CREATE POLICY "vehicle_lifecycle_read"
  ON public.vehicle_lifecycle FOR SELECT
  TO authenticated
  USING (
    tenant_id IN (
      SELECT tenant_id FROM public.tenant_members
      WHERE user_id = (SELECT auth.uid()) AND accepted_at IS NOT NULL
    )
  );
-- No client write policies: all writes go through the SECURITY DEFINER
-- functions below (or service_role).

-- Gate states move only through set_vehicle_lifecycle_gate / the Phase 2
-- authorization RPC. The guard enforces the gate edges; operational states
-- flow freely because recompute derives them from stored facts.
CREATE OR REPLACE FUNCTION public.vehicle_lifecycle_transition_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.state = OLD.state THEN RETURN NEW; END IF;
  NEW.previous_state := OLD.state;
  NEW.state_changed_at := now();
  NEW.updated_at := now();
  -- Leaving REMOVED only re-enters review.
  IF OLD.state = 'REMOVED' AND NEW.state <> 'AWAITING_MANAGER_AUTHORIZATION' THEN
    RAISE EXCEPTION 'invalid lifecycle transition % -> %', OLD.state, NEW.state;
  END IF;
  -- AWAITING can only be released, parked, or removed — never skipped
  -- straight into mid-flow operational states.
  IF OLD.state = 'AWAITING_MANAGER_AUTHORIZATION'
     AND NEW.state NOT IN ('AUTHORIZED_FOR_GET_READY','ON_HOLD','WHOLESALE','REMOVED','PRELOAD_EXCEPTION') THEN
    RAISE EXCEPTION 'invalid lifecycle transition % -> %', OLD.state, NEW.state;
  END IF;
  -- RETAIL_READY only unwinds through review or a hold.
  IF OLD.state = 'RETAIL_READY' AND NEW.state NOT IN ('AWAITING_MANAGER_AUTHORIZATION','ON_HOLD','REMOVED','WHOLESALE') THEN
    RAISE EXCEPTION 'invalid lifecycle transition % -> %', OLD.state, NEW.state;
  END IF;
  IF NEW.state = 'RETAIL_READY' THEN NEW.retail_ready_at := now(); END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_vehicle_lifecycle_guard ON public.vehicle_lifecycle;
CREATE TRIGGER trg_vehicle_lifecycle_guard
  BEFORE UPDATE ON public.vehicle_lifecycle
  FOR EACH ROW EXECUTE FUNCTION public.vehicle_lifecycle_transition_guard();

-- ── Operational derivation: stored facts in, one state out ────────────
-- Never touches gate states (except archive → REMOVED). First match wins,
-- mirroring the service derivations the screens already trust:
-- removed → pending/clarify request → failure loop → K-208 in progress →
-- certified (detail sub-flow) → signed-pass awaiting certification →
-- assigned/unassigned release states.
CREATE OR REPLACE FUNCTION public.recompute_vehicle_lifecycle(p_tenant_id uuid, p_vehicle_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_listing record; v_row public.vehicle_lifecycle%ROWTYPE;
  v_si record; v_open int := 0; v_ready int := 0;
  v_req text; v_next text;
  v_gr record; v_cleared boolean := false;
BEGIN
  SELECT id, vin, lower(coalesce(condition,'used')) AS condition, status, deal_processed_at
    INTO v_listing FROM public.vehicle_listings
    WHERE tenant_id = p_tenant_id AND id = p_vehicle_id;
  IF v_listing.id IS NULL THEN RETURN NULL; END IF;
  IF v_listing.condition NOT IN ('used','cpo','certified') THEN RETURN NULL; END IF;

  SELECT * INTO v_row FROM public.vehicle_lifecycle
    WHERE tenant_id = p_tenant_id AND vehicle_id = p_vehicle_id;

  IF v_listing.status = 'archived' THEN
    IF v_row.id IS NOT NULL AND v_row.state <> 'REMOVED' THEN
      UPDATE public.vehicle_lifecycle SET state = 'REMOVED' WHERE id = v_row.id;
    END IF;
    RETURN 'REMOVED';
  END IF;

  -- New row: post-rollout vehicles wait at the manager gate.
  IF v_row.id IS NULL THEN
    INSERT INTO public.vehicle_lifecycle (tenant_id, vehicle_id, vin, state)
    VALUES (p_tenant_id, p_vehicle_id, upper(v_listing.vin), 'AWAITING_MANAGER_AUTHORIZATION')
    ON CONFLICT (tenant_id, vehicle_id) DO NOTHING;
    RETURN 'AWAITING_MANAGER_AUTHORIZATION';
  END IF;

  -- Gate states are the manager's, not the recompute's.
  IF v_row.state IN ('AWAITING_MANAGER_AUTHORIZATION','ON_HOLD','WHOLESALE','REMOVED','RETAIL_READY') THEN
    RETURN v_row.state;
  END IF;

  SELECT s.status, s.result, s.inspection_state, s.assigned_to, s.licensee_certified_at, s.id
    INTO v_si FROM public.safety_inspections s
    WHERE s.tenant_id = p_tenant_id AND s.vin = upper(v_listing.vin) AND s.status <> 'voided'
    ORDER BY s.created_at DESC LIMIT 1;

  IF v_si.id IS NOT NULL THEN
    SELECT count(*) FILTER (WHERE f.repair_state <> 'passed_on_reinspection'),
           count(*) FILTER (WHERE f.repair_state = 'ready_for_reinspection')
      INTO v_open, v_ready
      FROM public.safety_inspection_item_failures f
      WHERE f.tenant_id = p_tenant_id AND f.inspection_id = v_si.id;
  END IF;

  SELECT r.status INTO v_req FROM public.service_requests r
    WHERE r.tenant_id = p_tenant_id AND r.vin = upper(v_listing.vin)
      AND r.status IN ('pending','clarify','approved','approved_limit')
    ORDER BY CASE r.status WHEN 'pending' THEN 1 WHEN 'clarify' THEN 2 ELSE 3 END, r.updated_at DESC
    LIMIT 1;

  SELECT c.state = 'cleared_for_delivery' INTO v_cleared
    FROM public.vehicle_delivery_clearance c
    WHERE c.tenant_id = p_tenant_id AND c.vin = upper(v_listing.vin);

  SELECT g.status, g.get_ready_complete_date INTO v_gr
    FROM public.get_ready_records g
    WHERE g.tenant_id = p_tenant_id AND g.vin = upper(v_listing.vin)
    ORDER BY g.created_at DESC LIMIT 1;

  v_next := CASE
    WHEN v_req = 'pending' THEN 'WAITING_FOR_MANAGER_DECISION'
    WHEN v_req = 'clarify' THEN 'RETURNED_FOR_CLARIFICATION'
    WHEN (v_si.status = 'signed' AND lower(coalesce(v_si.result,'')) = 'fail') OR v_open > 0 THEN
      CASE
        WHEN v_open > 0 AND v_ready = v_open THEN 'REPAIR_VERIFICATION_REQUIRED'
        WHEN v_req IN ('approved','approved_limit') THEN 'REPAIR_IN_PROGRESS'
        ELSE 'SERVICE_FINDINGS_RECORDED'
      END
    WHEN v_si.inspection_state = 'in_progress' THEN 'K208_IN_PROGRESS'
    WHEN v_si.status = 'signed' AND v_si.licensee_certified_at IS NOT NULL THEN
      CASE
        WHEN coalesce(v_cleared, false) AND (v_gr.get_ready_complete_date IS NOT NULL OR v_gr.status IN ('ready','inventory')) THEN 'FINAL_READY_VERIFICATION'
        WHEN v_gr.status = 'in_progress' THEN 'DETAIL_IN_PROGRESS'
        ELSE 'DETAIL_PENDING'
      END
    WHEN v_si.status = 'signed' THEN 'K208_READY_TO_CERTIFY'
    WHEN v_si.assigned_to IS NOT NULL THEN 'AUTHORIZED_FOR_GET_READY'
    ELSE 'SERVICE_UNASSIGNED'
  END;

  IF v_next IS DISTINCT FROM v_row.state THEN
    UPDATE public.vehicle_lifecycle SET state = v_next WHERE id = v_row.id;
  END IF;
  RETURN v_next;
END; $$;

REVOKE ALL ON FUNCTION public.recompute_vehicle_lifecycle(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.recompute_vehicle_lifecycle(uuid, uuid) TO authenticated, service_role;

-- ── Manager gate control (hold / wholesale / remove / re-review /
--    interim release until the Phase 2 authorization RPC lands) ────────
CREATE OR REPLACE FUNCTION public.set_vehicle_lifecycle_gate(p_vehicle_id uuid, p_state text, p_reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_row public.vehicle_lifecycle%ROWTYPE;
  v_authorized boolean;
BEGIN
  IF p_state NOT IN ('ON_HOLD','WHOLESALE','REMOVED','AWAITING_MANAGER_AUTHORIZATION','AUTHORIZED_FOR_GET_READY') THEN
    RAISE EXCEPTION 'invalid gate state %', p_state;
  END IF;
  SELECT * INTO v_row FROM public.vehicle_lifecycle WHERE vehicle_id = p_vehicle_id;
  IF v_row.id IS NULL THEN RAISE EXCEPTION 'lifecycle row not found'; END IF;

  IF v_uid IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1 FROM public.tenant_members tm
      WHERE tm.tenant_id = v_row.tenant_id AND tm.user_id = v_uid AND tm.accepted_at IS NOT NULL
        AND lower(trim(tm.role)) IN ('owner','general_manager','gsm','admin','manager','used_car_manager','inventory_manager','sales_manager')
    ) OR public.has_role(v_uid, 'admin'::public.app_role) INTO v_authorized;
    IF NOT v_authorized THEN RAISE EXCEPTION 'not_authorized'; END IF;
  END IF;

  UPDATE public.vehicle_lifecycle
  SET state = p_state,
      state_changed_by = v_uid,
      gate_reason = p_reason,
      authorized_by = CASE WHEN p_state = 'AUTHORIZED_FOR_GET_READY' THEN v_uid ELSE authorized_by END,
      authorized_at = CASE WHEN p_state = 'AUTHORIZED_FOR_GET_READY' THEN now() ELSE authorized_at END
  WHERE id = v_row.id;

  INSERT INTO public.audit_log (action, entity_type, entity_id, store_id, user_id, details)
  VALUES ('vehicle_lifecycle_gate_set', 'vehicle', v_row.vin, v_row.tenant_id::text, v_uid,
          jsonb_build_object('prev_state', v_row.state, 'new_state', p_state, 'reason', p_reason));

  -- A release immediately settles into the derived operational state.
  IF p_state = 'AUTHORIZED_FOR_GET_READY' THEN
    PERFORM public.recompute_vehicle_lifecycle(v_row.tenant_id, p_vehicle_id);
  END IF;
  RETURN jsonb_build_object('ok', true, 'state', p_state);
END; $$;

REVOKE ALL ON FUNCTION public.set_vehicle_lifecycle_gate(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_vehicle_lifecycle_gate(uuid, text, text) TO authenticated, service_role;

-- ── Freshness triggers on the fact tables. Lifecycle bookkeeping must
--    NEVER break a signing/decision write, so every trigger swallows its
--    own errors. ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.touch_vehicle_lifecycle()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tenant uuid; v_vin text; v_vehicle uuid;
BEGIN
  BEGIN
    v_tenant := NEW.tenant_id;
    v_vin := upper(coalesce(NEW.vin, ''));
    IF v_tenant IS NULL OR v_vin = '' THEN RETURN NEW; END IF;
    SELECT id INTO v_vehicle FROM public.vehicle_listings
      WHERE tenant_id = v_tenant AND vin = v_vin LIMIT 1;
    IF v_vehicle IS NOT NULL THEN
      PERFORM public.recompute_vehicle_lifecycle(v_tenant, v_vehicle);
    END IF;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_lifecycle_touch_inspections ON public.safety_inspections;
CREATE TRIGGER trg_lifecycle_touch_inspections
  AFTER INSERT OR UPDATE ON public.safety_inspections
  FOR EACH ROW EXECUTE FUNCTION public.touch_vehicle_lifecycle();

DROP TRIGGER IF EXISTS trg_lifecycle_touch_failures ON public.safety_inspection_item_failures;
CREATE TRIGGER trg_lifecycle_touch_failures
  AFTER INSERT OR UPDATE ON public.safety_inspection_item_failures
  FOR EACH ROW EXECUTE FUNCTION public.touch_vehicle_lifecycle();

DROP TRIGGER IF EXISTS trg_lifecycle_touch_requests ON public.service_requests;
CREATE TRIGGER trg_lifecycle_touch_requests
  AFTER INSERT OR UPDATE ON public.service_requests
  FOR EACH ROW EXECUTE FUNCTION public.touch_vehicle_lifecycle();

DROP TRIGGER IF EXISTS trg_lifecycle_touch_clearance ON public.vehicle_delivery_clearance;
CREATE TRIGGER trg_lifecycle_touch_clearance
  AFTER INSERT OR UPDATE ON public.vehicle_delivery_clearance
  FOR EACH ROW EXECUTE FUNCTION public.touch_vehicle_lifecycle();

DROP TRIGGER IF EXISTS trg_lifecycle_touch_getready ON public.get_ready_records;
CREATE TRIGGER trg_lifecycle_touch_getready
  AFTER INSERT OR UPDATE ON public.get_ready_records
  FOR EACH ROW EXECUTE FUNCTION public.touch_vehicle_lifecycle();

-- Feed prune / delist: void the still-pending K-208 so it cannot orphan,
-- and mark the lifecycle REMOVED before the cascade clears it.
CREATE OR REPLACE FUNCTION public.lifecycle_on_listing_delete()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  BEGIN
    UPDATE public.safety_inspections
    SET status = 'voided', voided_at = now(),
        void_reason = 'listing removed from inventory; auto-voided on delist'
    WHERE tenant_id = OLD.tenant_id AND vin = upper(OLD.vin) AND status = 'pending';
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  RETURN OLD;
END; $$;

DROP TRIGGER IF EXISTS trg_lifecycle_on_listing_delete ON public.vehicle_listings;
CREATE TRIGGER trg_lifecycle_on_listing_delete
  BEFORE DELETE ON public.vehicle_listings
  FOR EACH ROW EXECUTE FUNCTION public.lifecycle_on_listing_delete();

-- ── One-time cleanup + backfill ───────────────────────────────────────
-- Void orphaned pending K-208s (VINs with no listing).
UPDATE public.safety_inspections si
SET status = 'voided', voided_at = now(),
    void_reason = 'listing removed from inventory; auto-voided by lifecycle reconciliation'
WHERE si.status = 'pending'
  AND NOT EXISTS (
    SELECT 1 FROM public.vehicle_listings v
    WHERE v.tenant_id = si.tenant_id AND v.vin = si.vin
  );

-- Grandfather existing inventory as already authorized, then settle every
-- vehicle into its derived operational state.
INSERT INTO public.vehicle_lifecycle (tenant_id, vehicle_id, vin, state, authorized_at, gate_reason)
SELECT v.tenant_id, v.id, upper(v.vin), 'AUTHORIZED_FOR_GET_READY', now(),
       'grandfathered at lifecycle rollout'
FROM public.vehicle_listings v
WHERE lower(coalesce(v.condition,'used')) IN ('used','cpo','certified')
  AND v.vin IS NOT NULL AND v.status <> 'archived'
ON CONFLICT (tenant_id, vehicle_id) DO NOTHING;

DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT tenant_id, vehicle_id FROM public.vehicle_lifecycle LOOP
    PERFORM public.recompute_vehicle_lifecycle(r.tenant_id, r.vehicle_id);
  END LOOP;
END $$;
