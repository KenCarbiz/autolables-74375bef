-- ──────────────────────────────────────────────────────────────────────
-- Automatic Recall → Service Get Ready workflow.
--
-- Whenever ANY path writes recall data to vehicle_listings (marketcheck-recalls,
-- vehicle-enrich, marketcheck-sync, manual refresh), a trigger automatically
-- raises a required "Open Recall Review Required" service task when an open
-- recall is present. The task blocks readiness/publish until the service
-- department records one of three outcomes. The original recall record and a
-- full audit trail are preserved — nothing is deleted.
--
-- Applies to every vehicle type (new/used/cpo/demo/loaner/service loaner/
-- in-transit) — the trigger keys only on open_recall_count, never on condition.
-- ──────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.recall_service_tasks (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL,
  vehicle_listing_id uuid NOT NULL REFERENCES public.vehicle_listings(id) ON DELETE CASCADE,
  vin                text NOT NULL,
  ymm                text,

  -- Recall snapshot at task creation / last refresh.
  open_recall_count  integer NOT NULL DEFAULT 0,
  recall_payload     jsonb,
  -- Signature of the campaigns this task covers (sorted campaign numbers), so a
  -- nightly re-pull of the SAME recall doesn't recreate a task service already
  -- resolved — but a NEW campaign does.
  recall_signature   text,

  -- Lifecycle. open_review = awaiting the service department.
  status             text NOT NULL DEFAULT 'open_review'
                       CHECK (status IN ('open_review', 'resolved')),
  -- One of the three approved service outcomes (null while open).
  outcome            text
                       CHECK (outcome IS NULL OR outcome IN ('recall_completed', 'no_fix_available', 'does_not_apply')),

  -- Service sign-off detail (required when an outcome is recorded).
  employee_name      text,
  service_date       timestamptz,
  ro_number          text,
  notes              text,
  documents          jsonb NOT NULL DEFAULT '[]'::jsonb,   -- service-docs URLs

  created_at         timestamptz NOT NULL DEFAULT now(),
  completed_at       timestamptz,
  created_by         uuid,
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_recall_tasks_tenant   ON public.recall_service_tasks (tenant_id);
CREATE INDEX IF NOT EXISTS idx_recall_tasks_vin      ON public.recall_service_tasks (vin);
CREATE INDEX IF NOT EXISTS idx_recall_tasks_listing  ON public.recall_service_tasks (vehicle_listing_id);
-- At most one OPEN task per vehicle.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_open_recall_task_per_vehicle
  ON public.recall_service_tasks (vehicle_listing_id) WHERE status = 'open_review';

ALTER TABLE public.recall_service_tasks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "recall tasks readable by tenant" ON public.recall_service_tasks;
CREATE POLICY "recall tasks readable by tenant"
  ON public.recall_service_tasks FOR SELECT
  TO authenticated
  USING (
    tenant_id IN (
      SELECT tenant_id FROM public.tenant_members
      WHERE user_id = (SELECT auth.uid())
    )
  );

-- Writes go through the SECURITY DEFINER RPC / trigger only; no direct
-- client INSERT/UPDATE policy (service-role bypasses RLS for the trigger).

-- ── Campaign signature helper ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.recall_payload_signature(p jsonb)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT string_agg(c, ',' ORDER BY c)
  FROM (
    SELECT DISTINCT COALESCE(
             elem->>'nhtsaCampaignNumber', elem->>'NHTSACampaignNumber',
             elem->>'campaignId', elem->>'campaign_id', elem->>'campaign_number'
           ) AS c
    FROM jsonb_array_elements(
           COALESCE(p->'campaigns', p->'recalls', '[]'::jsonb)
         ) elem
  ) s
  WHERE c IS NOT NULL AND c <> '';
$$;

-- ── Auto-fire trigger ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fire_recall_service_task()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sig text;
BEGIN
  IF COALESCE(NEW.open_recall_count, 0) <= 0 THEN
    RETURN NEW;   -- no open recall → nothing to raise
  END IF;

  v_sig := public.recall_payload_signature(NEW.recall_payload);

  -- Refresh the snapshot on an already-open task for this vehicle.
  IF EXISTS (SELECT 1 FROM public.recall_service_tasks t
             WHERE t.vehicle_listing_id = NEW.id AND t.status = 'open_review') THEN
    UPDATE public.recall_service_tasks
       SET open_recall_count = NEW.open_recall_count,
           recall_payload    = NEW.recall_payload,
           recall_signature  = v_sig,
           ymm               = COALESCE(NEW.ymm, ymm),
           updated_at        = now()
     WHERE vehicle_listing_id = NEW.id AND status = 'open_review';
    RETURN NEW;
  END IF;

  -- Don't recreate a task the service department already resolved for this same
  -- recall set (same signature). A NEW campaign signature DOES raise a new task.
  IF v_sig IS NOT NULL AND EXISTS (
       SELECT 1 FROM public.recall_service_tasks t
       WHERE t.vehicle_listing_id = NEW.id
         AND t.status = 'resolved'
         AND t.recall_signature IS NOT DISTINCT FROM v_sig
     ) THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.recall_service_tasks
    (tenant_id, vehicle_listing_id, vin, ymm, open_recall_count, recall_payload, recall_signature, status)
  VALUES
    (NEW.tenant_id, NEW.id, NEW.vin, NEW.ymm, NEW.open_recall_count, NEW.recall_payload, v_sig, 'open_review')
  ON CONFLICT DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_fire_recall_service_task ON public.vehicle_listings;
CREATE TRIGGER trg_fire_recall_service_task
  AFTER INSERT OR UPDATE OF open_recall_count, recall_payload, recall_status
  ON public.vehicle_listings
  FOR EACH ROW
  EXECUTE FUNCTION public.fire_recall_service_task();

-- ── Service outcome RPC ──────────────────────────────────────────────────
-- Records one of the three approved outcomes with the required service detail,
-- resolves the task (preserving the row + audit trail), and writes an audit_log
-- event so the activity feed reflects it. Authorized to tenant members/admins.
CREATE OR REPLACE FUNCTION public.submit_recall_service_outcome(
  _task_id       uuid,
  _outcome       text,
  _employee_name text,
  _service_date  timestamptz,
  _ro_number     text,
  _notes         text,
  _documents     jsonb DEFAULT '[]'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_task   public.recall_service_tasks%ROWTYPE;
BEGIN
  IF _outcome NOT IN ('recall_completed', 'no_fix_available', 'does_not_apply') THEN
    RAISE EXCEPTION 'invalid outcome %', _outcome;
  END IF;
  IF COALESCE(btrim(_employee_name), '') = '' THEN
    RAISE EXCEPTION 'employee_name is required';
  END IF;

  SELECT * INTO v_task FROM public.recall_service_tasks WHERE id = _task_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'recall task % not found', _task_id;
  END IF;

  IF NOT (
    EXISTS (SELECT 1 FROM public.tenant_members WHERE tenant_id = v_task.tenant_id AND user_id = (SELECT auth.uid()))
    OR EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = (SELECT auth.uid()) AND role = 'admin')
  ) THEN
    RAISE EXCEPTION 'not authorized for tenant %', v_task.tenant_id;
  END IF;

  -- "No fix available yet" keeps the recall visible but records the review;
  -- completed / does-not-apply clear the blocker. All three resolve the task
  -- row (the original recall data + this audit row are preserved).
  UPDATE public.recall_service_tasks
     SET status        = 'resolved',
         outcome       = _outcome,
         employee_name = _employee_name,
         service_date  = COALESCE(_service_date, now()),
         ro_number     = _ro_number,
         notes         = _notes,
         documents     = COALESCE(_documents, '[]'::jsonb),
         completed_at  = now(),
         created_by    = COALESCE(created_by, (SELECT auth.uid())),
         updated_at    = now()
   WHERE id = _task_id;

  INSERT INTO public.audit_log (action, entity_type, entity_id, store_id, user_id, details)
  VALUES (
    'recall_service_outcome_recorded', 'vehicle_listing', v_task.vin, v_task.tenant_id::text, (SELECT auth.uid()),
    jsonb_build_object('outcome', _outcome, 'employee_name', _employee_name, 'ro_number', _ro_number,
                       'recall_signature', v_task.recall_signature, 'task_id', _task_id)
  );

  RETURN _task_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.submit_recall_service_outcome(uuid, text, text, timestamptz, text, text, jsonb) TO authenticated;

-- Backfill: raise tasks for vehicles that ALREADY have an open recall on file.
INSERT INTO public.recall_service_tasks
  (tenant_id, vehicle_listing_id, vin, ymm, open_recall_count, recall_payload, recall_signature, status)
SELECT vl.tenant_id, vl.id, vl.vin, vl.ymm, vl.open_recall_count, vl.recall_payload,
       public.recall_payload_signature(vl.recall_payload), 'open_review'
FROM public.vehicle_listings vl
WHERE COALESCE(vl.open_recall_count, 0) > 0
  AND NOT EXISTS (
    SELECT 1 FROM public.recall_service_tasks t WHERE t.vehicle_listing_id = vl.id AND t.status = 'open_review'
  )
ON CONFLICT DO NOTHING;
