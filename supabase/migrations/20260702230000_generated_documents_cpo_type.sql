-- Allow the CPO information sheet to persist as its own document type so it
-- gets a version chain separate from the window sticker (the supersede logic
-- keys on vehicle_id + document_type; sharing 'window' would retire the
-- used-car sticker every time a CPO sheet prints).
ALTER TABLE public.generated_documents
  DROP CONSTRAINT IF EXISTS generated_documents_document_type_check;
ALTER TABLE public.generated_documents
  ADD CONSTRAINT generated_documents_document_type_check
  CHECK (document_type IN ('window','addendum','passport','cpo_sheet'));
