-- Generated-document lifecycle: extend generated_documents (20260620060000)
-- with the full internal status set and the columns the approval/version
-- workflow needs. Additive + idempotent. Tenant ownership + RLS already on the
-- base table; status changes are audited through the canonical public.audit_log.

-- Widen the status check to the full lifecycle.
ALTER TABLE public.generated_documents DROP CONSTRAINT IF EXISTS generated_documents_document_status_check;
ALTER TABLE public.generated_documents
  ADD CONSTRAINT generated_documents_document_status_check
  CHECK (document_status IN ('draft','pending_approval','approved','printed','published','superseded','archived','rejected'));

ALTER TABLE public.generated_documents
  ADD COLUMN IF NOT EXISTS reviewed_by    uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS rejected_at    timestamptz,
  ADD COLUMN IF NOT EXISTS reject_reason  text,
  ADD COLUMN IF NOT EXISTS superseded_by  uuid REFERENCES public.generated_documents(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS template_version integer,
  ADD COLUMN IF NOT EXISTS print_count    integer NOT NULL DEFAULT 0;

-- Fast lookup of the live (non-superseded/archived) doc per vehicle + type.
CREATE INDEX IF NOT EXISTS idx_generated_documents_live
  ON public.generated_documents (vehicle_id, document_type, version DESC)
  WHERE document_status NOT IN ('superseded','archived','rejected');
