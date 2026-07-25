-- ──────────────────────────────────────────────────────────────────────
-- S2: additive controlled workflow state for safety inspections.
--
-- safety_inspections.status is the LEGAL record of signature
-- (pending/signed/voided) and is never repurposed. inspection_state is the
-- operational Service Desk state machine layered beside it:
--   not_started -> in_progress -> (sign) passed | failed_items_open
--   failed_items_open <-> repairs_in_progress -> ready_for_reinspection
--   any -> voided (authorized, documented reason)
-- 'passed' and 'failed_items_open' are entered ONLY by the signing paths (a
-- status trigger keeps every write path — QR RPC and desktop RLS insert —
-- consistent); the transition RPC below performs the workflow moves and writes
-- audit_log with prev/new state.
-- ──────────────────────────────────────────────────────────────────────

ALTER TABLE public.safety_inspections
  ADD COLUMN IF NOT EXISTS inspection_state text NOT NULL DEFAULT 'not_started',
  ADD COLUMN IF NOT EXISTS assigned_to uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS started_at timestamptz,
  ADD COLUMN IF NOT EXISTS superseded_by uuid REFERENCES public.safety_inspections(id),
  ADD COLUMN IF NOT EXISTS doc_version integer NOT NULL DEFAULT 1;

ALTER TABLE public.safety_inspections
  DROP CONSTRAINT IF EXISTS safety_inspections_inspection_state_check;
ALTER TABLE public.safety_inspections
  ADD CONSTRAINT safety_inspections_inspection_state_check
  CHECK (inspection_state IN (
    'not_started','in_progress','failed_items_open','repairs_in_progress',
    'ready_for_reinspection','passed','voided'));

-- Backfill from the legal record: executed semantics, same as everywhere else.
UPDATE public.safety_inspections SET inspection_state = CASE
    WHEN status = 'voided' THEN 'voided'
    WHEN status = 'signed' AND result IS DISTINCT FROM 'fail' THEN 'passed'
    WHEN status = 'signed' THEN 'failed_items_open'
    ELSE 'not_started'
  END
WHERE inspection_state = 'not_started';

CREATE INDEX IF NOT EXISTS safety_inspections_tenant_state_idx
  ON public.safety_inspections (tenant_id, inspection_state);

-- Every signing path (submit_safety_inspection, ServiceDesk's direct RLS
-- insert/update) lands here, so the workflow state can never disagree with a
-- freshly signed or voided legal status.
CREATE OR REPLACE FUNCTION public.sync_inspection_state_from_status()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM NEW.status THEN
    IF NEW.status = 'voided' THEN
      NEW.inspection_state := 'voided';
    ELSIF NEW.status = 'signed' THEN
      NEW.inspection_state := CASE
        WHEN NEW.result IS DISTINCT FROM 'fail' THEN 'passed'
        ELSE 'failed_items_open' END;
      NEW.started_at := coalesce(NEW.started_at, NEW.signed_at, now());
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_sync_inspection_state ON public.safety_inspections;
CREATE TRIGGER trg_sync_inspection_state
  BEFORE INSERT OR UPDATE ON public.safety_inspections
  FOR EACH ROW EXECUTE FUNCTION public.sync_inspection_state_from_status();

-- Workflow transition RPC. The jsonb map below is the single machine
-- definition; src/lib/service/transitions.ts mirrors it verbatim and a test
-- compares the two literals. Signing outcomes (passed / failed_items_open) are
-- deliberately absent — only a signature enters them, via the trigger above.
CREATE OR REPLACE FUNCTION public.transition_safety_inspection(
  p_inspection_id uuid,
  p_new_state text,
  p_reason text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_row public.safety_inspections%ROWTYPE;
  v_allowed jsonb := '{
    "not_started": ["in_progress","voided"],
    "in_progress": ["voided"],
    "failed_items_open": ["repairs_in_progress","voided"],
    "repairs_in_progress": ["ready_for_reinspection","failed_items_open","voided"],
    "ready_for_reinspection": ["repairs_in_progress","voided"],
    "passed": ["voided"],
    "voided": []
  }'::jsonb;
  v_can_void boolean;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'auth_required'; END IF;
  SELECT * INTO v_row FROM public.safety_inspections WHERE id = p_inspection_id;
  IF v_row.id IS NULL THEN RAISE EXCEPTION 'inspection_not_found'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.tenant_members tm
    WHERE tm.tenant_id = v_row.tenant_id AND tm.user_id = v_uid AND tm.accepted_at IS NOT NULL
  ) AND NOT public.has_role(v_uid, 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'not_a_member';
  END IF;

  IF NOT (coalesce(v_allowed -> v_row.inspection_state, '[]'::jsonb) ? p_new_state) THEN
    RAISE EXCEPTION 'invalid_transition from % to %', v_row.inspection_state, p_new_state;
  END IF;

  IF p_new_state = 'voided' THEN
    -- Voiding retires a legal record: manager authority + documented reason.
    SELECT EXISTS (
      SELECT 1 FROM public.tenant_members tm
      WHERE tm.tenant_id = v_row.tenant_id AND tm.user_id = v_uid AND tm.accepted_at IS NOT NULL
        AND lower(trim(tm.role)) IN ('owner','general_manager','gsm','admin','manager','service_manager')
    ) OR public.has_role(v_uid, 'admin'::public.app_role) INTO v_can_void;
    IF NOT v_can_void THEN RAISE EXCEPTION 'not_authorized_to_void'; END IF;
    IF coalesce(trim(p_reason), '') = '' THEN RAISE EXCEPTION 'void_reason_required'; END IF;
    UPDATE public.safety_inspections
       SET inspection_state = 'voided', status = 'voided', updated_at = now()
     WHERE id = p_inspection_id;
  ELSE
    UPDATE public.safety_inspections
       SET inspection_state = p_new_state,
           started_at = CASE WHEN p_new_state = 'in_progress' THEN coalesce(started_at, now()) ELSE started_at END,
           updated_at = now()
     WHERE id = p_inspection_id;
  END IF;

  -- The transition IS the auditable act — if the audit row cannot be written,
  -- the transition must not stand, so no exception swallow here.
  INSERT INTO public.audit_log (action, entity_type, entity_id, store_id, user_id, details)
  VALUES ('safety_inspection_state_changed', 'vehicle', v_row.vin, v_row.tenant_id::text, v_uid,
          jsonb_build_object(
            'inspection_id', p_inspection_id,
            'prev_state', v_row.inspection_state,
            'new_state', p_new_state,
            'reason', nullif(trim(coalesce(p_reason, '')), '')));

  RETURN jsonb_build_object('ok', true, 'id', p_inspection_id,
                            'prev_state', v_row.inspection_state, 'new_state', p_new_state);
END;
$$;

REVOKE ALL ON FUNCTION public.transition_safety_inspection(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.transition_safety_inspection(uuid, text, text) TO authenticated, service_role;
