-- ──────────────────────────────────────────────────────────────────────
-- S3: per-item failure workflow for the K-208.
--
-- A failed checklist item gets its own tracked row: required explanation,
-- evidence photos, RO reference, assignee, and a repair state that can NEVER
-- resolve to "passed" by repair alone — passed_on_reinspection requires a
-- recorded reinspector, and the inspection result itself only flips through a
-- new signed inspection. Append-only history of the original failure stays in
-- safety_inspection_revisions; this table is the live work queue.
-- ──────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.safety_inspection_item_failures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  inspection_id uuid NOT NULL REFERENCES public.safety_inspections(id) ON DELETE CASCADE,
  vin text,
  item_id text NOT NULL,           -- checklist item key from the existing K-208 form
  explanation text NOT NULL CHECK (length(btrim(explanation)) > 0),
  photos jsonb NOT NULL DEFAULT '[]'::jsonb,
  ro_number text,
  assignee uuid REFERENCES auth.users(id),
  repair_state text NOT NULL DEFAULT 'repair_needed'
    CHECK (repair_state IN (
      'repair_needed','parts_ordered','repair_in_progress','repair_completed',
      'ready_for_reinspection','passed_on_reinspection')),
  reinspected_by uuid REFERENCES auth.users(id),
  reinspected_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- A failure only passes when a named reinspector stands behind it.
  CONSTRAINT item_failure_reinspector_required
    CHECK (repair_state <> 'passed_on_reinspection'
           OR (reinspected_by IS NOT NULL AND reinspected_at IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS inspection_item_failures_inspection_idx
  ON public.safety_inspection_item_failures (tenant_id, inspection_id);
CREATE INDEX IF NOT EXISTS inspection_item_failures_vin_idx
  ON public.safety_inspection_item_failures (tenant_id, vin, repair_state);

ALTER TABLE public.safety_inspection_item_failures ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "item failures tenant access" ON public.safety_inspection_item_failures;
CREATE POLICY "item failures tenant access"
  ON public.safety_inspection_item_failures FOR ALL
  TO authenticated
  USING (
    tenant_id IN (
      SELECT tenant_id FROM public.tenant_members
      WHERE user_id = (SELECT auth.uid()) AND accepted_at IS NOT NULL
    )
  )
  WITH CHECK (
    tenant_id IN (
      SELECT tenant_id FROM public.tenant_members
      WHERE user_id = (SELECT auth.uid()) AND accepted_at IS NOT NULL
    )
  );

DROP TRIGGER IF EXISTS trg_item_failures_updated ON public.safety_inspection_item_failures;
CREATE TRIGGER trg_item_failures_updated
  BEFORE UPDATE ON public.safety_inspection_item_failures
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
