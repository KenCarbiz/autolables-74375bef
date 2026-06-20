-- Stale document flags. When a vehicle's live data drifts from what a printed/
-- published sticker froze in its data_snapshot, a flag is raised for manager
-- review. Tenant-scoped; the canonical RLS pattern. One open flag per
-- (document, changed_field) is enforced so re-checks don't pile up duplicates.

CREATE TABLE IF NOT EXISTS public.stale_document_flags (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid NOT NULL,
  vehicle_id            uuid NOT NULL,
  generated_document_id uuid REFERENCES public.generated_documents(id) ON DELETE CASCADE,
  severity              text NOT NULL DEFAULT 'warning' CHECK (severity IN ('info','warning','compliance_block')),
  reason                text NOT NULL,
  changed_field         text,
  old_value             jsonb,
  new_value             jsonb,
  status                text NOT NULL DEFAULT 'open' CHECK (status IN ('open','reviewed','resolved','ignored','superseded')),
  reviewed_by           uuid REFERENCES auth.users(id),
  reviewed_at           timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_stale_flags_tenant_open
  ON public.stale_document_flags (tenant_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_stale_flags_vehicle ON public.stale_document_flags (vehicle_id);
-- One open flag per document + field (re-checks update instead of duplicating).
CREATE UNIQUE INDEX IF NOT EXISTS uq_stale_flag_open
  ON public.stale_document_flags (generated_document_id, changed_field)
  WHERE status = 'open';

DROP TRIGGER IF EXISTS trg_stale_flags_updated ON public.stale_document_flags;
CREATE TRIGGER trg_stale_flags_updated BEFORE UPDATE ON public.stale_document_flags
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.stale_document_flags ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant stale_document_flags" ON public.stale_document_flags FOR ALL TO authenticated
  USING (tenant_id IN (SELECT tenant_id FROM public.tenant_members WHERE user_id = (SELECT auth.uid())))
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM public.tenant_members WHERE user_id = (SELECT auth.uid())));
