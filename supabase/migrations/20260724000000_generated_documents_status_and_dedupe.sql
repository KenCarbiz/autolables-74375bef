-- generated_documents: allow the full lifecycle status set + de-duplicate.
--
-- Root cause of the piled-up v1/v2/v3 drafts and the "dead" second K-208: the
-- document_status CHECK constraint did NOT permit 'superseded' (nor the other
-- terminal states), so generate-vehicle-forms' "retire the prior version" step
-- errored silently and the old rows were never retired. Every re-fill (each
-- nightly sync + every manual click) then left another live draft behind.
--
-- 1) Widen the constraint to the full documentWorkflow lifecycle so retirement
--    (and approve/print/publish) actually persist.
-- 2) One-time consolidation: collapse the existing duplicate live drafts to a
--    single row per (tenant, vehicle, document_type) — keep the best copy (a
--    real signed URL first, then the highest version) and supersede the rest.
--
-- After this, the keyed-upsert in generate-vehicle-forms keeps exactly one live
-- draft per doc through the whole draft phase; immutable versioning only begins
-- once a doc is approved/printed/published.

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
