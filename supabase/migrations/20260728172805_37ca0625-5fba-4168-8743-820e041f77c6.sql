DO $$ BEGIN
  ALTER TABLE public.generated_documents DROP CONSTRAINT IF EXISTS generated_documents_status_check;
  ALTER TABLE public.generated_documents
    ADD CONSTRAINT generated_documents_status_check
    CHECK (document_status IN ('draft','pending_approval','in_review','approved','printed','rejected','published','superseded','archived'));
END $$;