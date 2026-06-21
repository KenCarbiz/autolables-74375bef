-- Database-level immutability for generated documents that a customer has
-- already signed against. The app already respects this, but the DB should
-- enforce it: once a generated_document is referenced inside a completed
-- addendum_signings.canonical_payload, the fields that define WHAT THE CUSTOMER
-- REVIEWED can no longer change. Focused hardening — no schema/feature changes.
--
-- Actual payload shape (audited in MobileSigning.tsx / CustomerReview.tsx /
-- signingDocumentRefs): canonical_payload -> 'generated_documents' is an array
-- of objects each carrying 'generated_document_id' = the document's UUID string.
--
-- Idempotent: CREATE OR REPLACE FUNCTION + DROP TRIGGER IF EXISTS.

CREATE OR REPLACE FUNCTION public.enforce_generated_document_immutability()
RETURNS trigger
LANGUAGE plpgsql
-- SECURITY DEFINER so the reference check always sees addendum_signings,
-- independent of the updating caller's RLS (dealer JWT, edge function, etc.).
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_protected_change boolean;
  v_referenced       boolean;
BEGIN
  -- Only customer-visible documents can be "locked" by a signature.
  IF OLD.document_status NOT IN ('approved','printed','published') THEN
    RETURN NEW;
  END IF;

  -- Did any field that changes WHAT THE CUSTOMER REVIEWED change?
  --   Allowed (not protected): print_count, printed_at, published_at,
  --   approved_at, reviewed_by, rejected_at, reject_reason, superseded_by,
  --   updated_at — plus the retire transitions of document_status below.
  v_protected_change :=
       NEW.tenant_id        IS DISTINCT FROM OLD.tenant_id
    OR NEW.vehicle_id       IS DISTINCT FROM OLD.vehicle_id
    OR NEW.template_id      IS DISTINCT FROM OLD.template_id
    OR NEW.template_version IS DISTINCT FROM OLD.template_version
    OR NEW.document_type    IS DISTINCT FROM OLD.document_type
    OR NEW.version          IS DISTINCT FROM OLD.version
    OR NEW.label_mode       IS DISTINCT FROM OLD.label_mode
    OR NEW.pdf_url          IS DISTINCT FROM OLD.pdf_url
    OR NEW.png_url          IS DISTINCT FROM OLD.png_url
    OR NEW.online_url       IS DISTINCT FROM OLD.online_url
    OR NEW.data_snapshot    IS DISTINCT FROM OLD.data_snapshot
    -- document_status is protected EXCEPT for the retire transitions
    -- (superseded / archived). Retiring does not alter the reviewed content
    -- (snapshot/urls/version stay intact) and is required by the existing
    -- supersede/archive workflow, so it stays allowed; every other status
    -- change on a signed document is blocked.
    OR (NEW.document_status IS DISTINCT FROM OLD.document_status
        AND NEW.document_status NOT IN ('superseded','archived'));

  IF NOT v_protected_change THEN
    RETURN NEW;
  END IF;

  -- Is this document frozen by a completed customer signature?
  SELECT EXISTS (
    SELECT 1
    FROM public.addendum_signings s
    CROSS JOIN LATERAL jsonb_array_elements(
      COALESCE(s.canonical_payload -> 'generated_documents', '[]'::jsonb)
    ) AS e
    WHERE e ->> 'generated_document_id' = OLD.id::text
  ) INTO v_referenced;

  IF v_referenced THEN
    RAISE EXCEPTION 'generated_document_locked_by_signed_payload'
      USING ERRCODE = 'check_violation',
            HINT = 'This document was referenced by a completed customer signature and cannot be altered. Create a new version instead.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_generated_document_immutability ON public.generated_documents;
CREATE TRIGGER trg_generated_document_immutability
  BEFORE UPDATE ON public.generated_documents
  FOR EACH ROW EXECUTE FUNCTION public.enforce_generated_document_immutability();

-- ── Verification snippets (run manually; not executed by this migration) ─────
-- A. Trigger + function exist:
--    SELECT tgname FROM pg_trigger WHERE tgname = 'trg_generated_document_immutability';
--    SELECT proname FROM pg_proc WHERE proname = 'enforce_generated_document_immutability';
--
-- B. Protected update blocked when canonical_payload references the doc id:
--    -- with a generated_documents row D (status 'published') and an
--    -- addendum_signings row whose canonical_payload->'generated_documents'
--    -- contains {"generated_document_id":"<D.id>"}:
--    UPDATE public.generated_documents SET data_snapshot = '{"x":1}'::jsonb WHERE id = '<D.id>';
--    -- => ERROR: generated_document_locked_by_signed_payload
--
-- C. Print-metadata update allowed on the same signed doc:
--    UPDATE public.generated_documents
--       SET print_count = print_count + 1, printed_at = now() WHERE id = '<D.id>';
--    -- => UPDATE 1 (succeeds)
--
-- D. Non-referenced doc follows normal lifecycle:
--    UPDATE public.generated_documents SET document_status = 'published', online_url = 'https://x'
--     WHERE id = '<UNREFERENCED.id>';
--    -- => UPDATE 1 (succeeds)
--    -- And a signed doc may still be retired:
--    UPDATE public.generated_documents SET document_status = 'superseded' WHERE id = '<D.id>';
--    -- => UPDATE 1 (succeeds)
