-- Auto-capture CT MVP signature evidence from the existing signing flows.
-- This is intentionally database-side so customer signature evidence is captured
-- even if an older client path falls back to legacy addendum updates.

CREATE OR REPLACE FUNCTION public.ct_mvp_capture_signature_evidence_from_row()
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
  signer_role text;
  signed_at_value timestamptz;
  signer_name_value text;
  signer_email_value text;
  ip_value text;
  ua_value text;
  consent_value text;
  docs_value text[];
BEGIN
  tenant := NULLIF(row_json->>'tenant_id', '')::uuid;
  IF tenant IS NULL THEN
    tenant := NULLIF(row_json->>'store_id', '')::uuid;
  END IF;
  IF tenant IS NULL THEN
    RETURN NEW;
  END IF;

  vehicle := NULLIF(COALESCE(row_json->>'vehicle_id', row_json->>'listing_id'), '')::uuid;
  vin_value := COALESCE(row_json->>'vehicle_vin', row_json->>'vin');
  stock_value := COALESCE(row_json->>'stock', row_json->>'stock_number');
  signer_role := COALESCE(row_json->>'signer_type', row_json->>'role', 'customer');
  signed_at_value := NULLIF(COALESCE(row_json->>'signed_at', row_json->>'customer_signed_at'), '')::timestamptz;

  IF signed_at_value IS NULL THEN
    RETURN NEW;
  END IF;

  signer_name_value := COALESCE(row_json->>'signer_name', row_json->>'customer_name');
  signer_email_value := COALESCE(row_json->>'signer_email', row_json->>'customer_email');
  ip_value := COALESCE(row_json->>'ip_address', row_json->>'customer_ip');
  ua_value := COALESCE(row_json->>'user_agent', row_json#>>'{esign_consent,user_agent}');
  consent_value := COALESCE(row_json#>>'{esign_consent,text}', row_json#>>'{esign_consent,disclosure_text}', 'Electronic signature consent captured');

  docs_value := ARRAY['window_sticker', 'addendum'];
  IF (row_json->'canonical_payload'->'generated_documents') IS NOT NULL THEN
    docs_value := ARRAY(
      SELECT DISTINCT COALESCE(value->>'document_type', value->>'type', value->>'key')
      FROM jsonb_array_elements(row_json->'canonical_payload'->'generated_documents') value
      WHERE COALESCE(value->>'document_type', value->>'type', value->>'key') IS NOT NULL
    );
    IF array_length(docs_value, 1) IS NULL THEN
      docs_value := ARRAY['window_sticker', 'addendum'];
    END IF;
  END IF;

  INSERT INTO public.signature_evidence (
    tenant_id,
    vehicle_id,
    vin,
    stock,
    role,
    signer_name,
    signer_email,
    signed_at,
    ip_address,
    user_agent,
    consent_text,
    document_keys,
    metadata
  ) VALUES (
    tenant,
    vehicle,
    vin_value,
    stock_value,
    signer_role,
    signer_name_value,
    signer_email_value,
    signed_at_value,
    ip_value,
    ua_value,
    consent_value,
    docs_value,
    jsonb_build_object(
      'source_table', TG_TABLE_NAME,
      'source_row_id', row_json->>'id',
      'content_hash', row_json->>'content_hash'
    )
  );

  INSERT INTO public.document_lifecycle_events (
    tenant_id,
    vehicle_id,
    vin,
    stock,
    event_type,
    occurred_at,
    actor_name,
    source,
    metadata
  ) VALUES (
    tenant,
    vehicle,
    vin_value,
    stock_value,
    'customer_signed',
    signed_at_value,
    signer_name_value,
    TG_TABLE_NAME,
    jsonb_build_object('source_row_id', row_json->>'id', 'role', signer_role)
  );

  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF to_regclass('public.addendum_signings') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_ct_mvp_capture_addendum_signing_evidence ON public.addendum_signings;
    CREATE TRIGGER trg_ct_mvp_capture_addendum_signing_evidence
      AFTER INSERT ON public.addendum_signings
      FOR EACH ROW
      EXECUTE FUNCTION public.ct_mvp_capture_signature_evidence_from_row();
  END IF;

  IF to_regclass('public.addendums') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_ct_mvp_capture_signed_addendum_evidence ON public.addendums;
    CREATE TRIGGER trg_ct_mvp_capture_signed_addendum_evidence
      AFTER UPDATE ON public.addendums
      FOR EACH ROW
      WHEN ((to_jsonb(NEW)->>'status') = 'signed' AND NULLIF(COALESCE(to_jsonb(NEW)->>'customer_signed_at', to_jsonb(NEW)->>'signed_at'), '') IS NOT NULL)
      EXECUTE FUNCTION public.ct_mvp_capture_signature_evidence_from_row();
  END IF;
END $$;
