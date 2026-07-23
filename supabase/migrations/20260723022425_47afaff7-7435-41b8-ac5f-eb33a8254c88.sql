CREATE TABLE IF NOT EXISTS public.safety_inspection_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inspection_id uuid NOT NULL REFERENCES public.safety_inspections(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL,
  vin text,
  form_type text,
  checklist jsonb,
  result text,
  result_initial text,
  status text,
  failure_notes text,
  inspector_name text,
  inspector_role text,
  licensee_name text,
  licensee_certified_at timestamptz,
  captured_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_safety_inspection_revisions_inspection
  ON public.safety_inspection_revisions (inspection_id, captured_at DESC);

GRANT SELECT ON public.safety_inspection_revisions TO authenticated;
GRANT ALL ON public.safety_inspection_revisions TO service_role;

ALTER TABLE public.safety_inspection_revisions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members read inspection revisions" ON public.safety_inspection_revisions;
CREATE POLICY "Members read inspection revisions"
  ON public.safety_inspection_revisions FOR SELECT
  TO authenticated
  USING (
    tenant_id IN (
      SELECT tenant_id FROM public.tenant_members
      WHERE user_id = (SELECT auth.uid()) AND accepted_at IS NOT NULL
    )
  );

CREATE OR REPLACE FUNCTION public.snapshot_safety_inspection_revision()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF OLD.checklist IS DISTINCT FROM NEW.checklist
     OR OLD.result IS DISTINCT FROM NEW.result
     OR OLD.result_initial IS DISTINCT FROM NEW.result_initial
     OR OLD.status IS DISTINCT FROM NEW.status THEN
    INSERT INTO public.safety_inspection_revisions (
      inspection_id, tenant_id, vin, form_type, checklist, result, result_initial,
      status, failure_notes, inspector_name, inspector_role, licensee_name, licensee_certified_at
    ) VALUES (
      OLD.id, OLD.tenant_id, OLD.vin, OLD.form_type, OLD.checklist, OLD.result, OLD.result_initial,
      OLD.status, OLD.failure_notes, OLD.inspector_name, OLD.inspector_role, OLD.licensee_name, OLD.licensee_certified_at
    );
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_snapshot_safety_inspection ON public.safety_inspections;
CREATE TRIGGER trg_snapshot_safety_inspection
  BEFORE UPDATE ON public.safety_inspections
  FOR EACH ROW EXECUTE FUNCTION public.snapshot_safety_inspection_revision();