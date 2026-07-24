ALTER TABLE public.generated_documents
  DROP CONSTRAINT IF EXISTS generated_documents_document_status_check;

ALTER TABLE public.generated_documents
  ADD CONSTRAINT generated_documents_document_status_check
  CHECK (document_status IN (
    'draft', 'pending_approval', 'approved', 'printed',
    'published', 'superseded', 'archived', 'rejected'
  ));

WITH ranked AS (
  SELECT id,
    first_value(id) OVER w AS keeper_id,
    row_number()  OVER w AS rn
  FROM public.generated_documents
  WHERE document_status IN ('draft', 'pending_approval')
  WINDOW w AS (
    PARTITION BY tenant_id, vehicle_id, document_type
    ORDER BY ((online_url IS NOT NULL AND online_url <> '')) DESC, version DESC, created_at DESC
  )
)
UPDATE public.generated_documents g
SET document_status = 'superseded',
    superseded_by = r.keeper_id,
    updated_at = now()
FROM ranked r
WHERE g.id = r.id AND r.rn > 1;