-- Auto-capture CT MVP lifecycle events for FTC Buyers Guide and K208-style
-- disclosure generation from archive/generated document tables. Uses JSONB
-- row inspection so it remains resilient across existing schema variations.

CREATE OR REPLACE FUNCTION public.ct_mvp_capture_document_generation_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  row_json jsonb := to_jsonb(NEW);
  tenant uuid;
  vehicle uuid;
  vin_value text;
  stock_value text;
  doc_type text;
  event_name text;
  occurred timestamptz;
BEGIN
  tenant := NULLIF(COALESCE(row_json->>'tenant_id', row_json->>'store_id'), '')::uuid;
  vehicle := NULLIF(COALESCE(row_json->>'vehicle_id', row_json->>'listing_id'), '')::uuid;
  vin_value := COALESCE(row_json->>'vin', row_json->>'vehicle_vin');
  stock_value := COALESCE(row_json->>'stock', row_json->>'stock_number');
  doc_type := lower(COALESCE(row_json->>'doc_type', row_json->>'document_type', row_json->>'type', row_json->>'template_id', ''));
  occurred := COALESCE(
    NULLIF(row_json->>'created_at', '')::timestamptz,
    NULLIF(row_json->>'generated_at', '')::timestamptz,
    NULLIF(row_json->>'archived_at', '')::timestamptz,
    now()
  );

  IF tenant IS NULL THEN
    RETURN NEW;
  END IF;

  IF doc_type IN ('buyers_guide', 'buyer_guide', 'ftc_buyers_guide', 'ftc-buyers-guide')
     OR doc_type LIKE '%buyers_guide%'
     OR doc_type LIKE '%buyers-guide%'
     OR doc_type LIKE '%ftc%' THEN
    event_name := 'ftc_buyers_guide_generated';
  ELSIF doc_type IN ('k208', 'k-208', 'ct_k208', 'ct-k208')
     OR doc_type LIKE '%k208%'
     OR doc_type LIKE '%k-208%'
     OR doc_type LIKE '%connecticut_disclosure%'
     OR doc_type LIKE '%ct_disclosure%' THEN
    event_name := 'k208_generated';
  ELSE
    RETURN NEW;
  END IF;

  INSERT INTO public.document_lifecycle_events (
    tenant_id,
    vehicle_id,
    vin,
    stock,
    event_type,
    occurred_at,
    source,
    metadata
  ) VALUES (
    tenant,
    vehicle,
    vin_value,
    stock_value,
    event_name,
    occurred,
    TG_TABLE_NAME,
    jsonb_build_object(
      'source_table', TG_TABLE_NAME,
      'source_row_id', row_json->>'id',
      'doc_type', doc_type,
      'template_id', row_json->>'template_id',
      'entity_id', row_json->>'entity_id'
    )
  );

  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF to_regclass('public.generated_documents') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_ct_mvp_generated_documents_lifecycle ON public.generated_documents;
    CREATE TRIGGER trg_ct_mvp_generated_documents_lifecycle
      AFTER INSERT ON public.generated_documents
      FOR EACH ROW
      EXECUTE FUNCTION public.ct_mvp_capture_document_generation_event();
  END IF;

  IF to_regclass('public.signed_document_archive') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_ct_mvp_archive_document_lifecycle ON public.signed_document_archive;
    CREATE TRIGGER trg_ct_mvp_archive_document_lifecycle
      AFTER INSERT ON public.signed_document_archive
      FOR EACH ROW
      EXECUTE FUNCTION public.ct_mvp_capture_document_generation_event();
  END IF;

  IF to_regclass('public.buyers_guides') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_ct_mvp_buyers_guides_lifecycle ON public.buyers_guides;
    CREATE TRIGGER trg_ct_mvp_buyers_guides_lifecycle
      AFTER INSERT ON public.buyers_guides
      FOR EACH ROW
      EXECUTE FUNCTION public.ct_mvp_capture_document_generation_event();
  END IF;

  IF to_regclass('public.k208_disclosures') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_ct_mvp_k208_lifecycle ON public.k208_disclosures;
    CREATE TRIGGER trg_ct_mvp_k208_lifecycle
      AFTER INSERT ON public.k208_disclosures
      FOR EACH ROW
      EXECUTE FUNCTION public.ct_mvp_capture_document_generation_event();
  END IF;
END $$;
