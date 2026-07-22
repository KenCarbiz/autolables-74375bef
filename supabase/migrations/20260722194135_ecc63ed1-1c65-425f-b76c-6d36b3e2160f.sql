ALTER TABLE public.generated_documents
  DROP CONSTRAINT IF EXISTS generated_documents_document_type_check;
ALTER TABLE public.generated_documents
  ADD CONSTRAINT generated_documents_document_type_check
  CHECK (document_type IN ('window','addendum','passport','cpo_sheet','buyers_guide','k208'));

ALTER TABLE public.signed_document_archive
  DROP CONSTRAINT IF EXISTS signed_document_archive_doc_type_check;
ALTER TABLE public.signed_document_archive
  ADD CONSTRAINT signed_document_archive_doc_type_check
  CHECK (doc_type IN ('addendum','deal','sticker','buyers_guide','prep_signoff','disclosure','k208'));

CREATE OR REPLACE FUNCTION public.create_draft_safety_inspection(p_tenant_id uuid, p_vin text)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_vin text := upper(trim(p_vin));
  v_listing_id uuid; v_condition text; v_ymm text; v_stock text;
  v_existing uuid; v_id uuid;
BEGIN
  IF p_tenant_id IS NULL OR v_vin = '' THEN RETURN NULL; END IF;

  SELECT id, lower(coalesce(condition,'used')), ymm
    INTO v_listing_id, v_condition, v_ymm
    FROM public.vehicle_listings WHERE tenant_id = p_tenant_id AND vin = v_vin LIMIT 1;
  IF v_listing_id IS NULL THEN RETURN NULL; END IF;

  IF v_condition NOT IN ('used','cpo','certified') THEN RETURN NULL; END IF;

  SELECT id INTO v_existing FROM public.safety_inspections
    WHERE tenant_id = p_tenant_id AND vin = v_vin LIMIT 1;
  IF v_existing IS NOT NULL THEN RETURN v_existing; END IF;

  SELECT stock_number INTO v_stock FROM public.vehicle_files
    WHERE tenant_id = p_tenant_id AND vin = v_vin LIMIT 1;

  INSERT INTO public.safety_inspections
    (tenant_id, vehicle_listing_id, vin, ymm, stock_number, form_type, checklist, status)
  VALUES
    (p_tenant_id, v_listing_id, v_vin, v_ymm, v_stock, 'CT-K208', '[]'::jsonb, 'pending')
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.create_draft_safety_inspection(uuid, text) FROM public;
GRANT EXECUTE ON FUNCTION public.create_draft_safety_inspection(uuid, text) TO service_role;

CREATE OR REPLACE FUNCTION public.submit_safety_inspection(
  _token text,
  _checklist jsonb,
  _result text,
  _failure_notes text,
  _notes text,
  _documents jsonb,
  _inspector_name text,
  _signature_data text,
  _content_hash text,
  _esign_consent jsonb,
  _ip text,
  _user_agent text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r public.dept_signoff_tokens%ROWTYPE;
  v_id uuid;
BEGIN
  SELECT * INTO r FROM public.dept_signoff_tokens WHERE token = _token LIMIT 1;
  IF r.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found'); END IF;
  IF r.status <> 'pending' THEN RETURN jsonb_build_object('ok', false, 'reason', 'used_or_revoked'); END IF;
  IF r.expires_at <= now() THEN RETURN jsonb_build_object('ok', false, 'reason', 'expired'); END IF;
  IF r.department <> 'service' THEN RETURN jsonb_build_object('ok', false, 'reason', 'wrong_department'); END IF;
  IF coalesce(trim(_inspector_name), '') = '' THEN RETURN jsonb_build_object('ok', false, 'reason', 'inspector_name_required'); END IF;

  SELECT id INTO v_id FROM public.safety_inspections
    WHERE tenant_id = r.tenant_id AND vin = r.vin AND status = 'pending'
    ORDER BY created_at DESC LIMIT 1;

  IF v_id IS NOT NULL THEN
    UPDATE public.safety_inspections SET
      vehicle_listing_id = coalesce(vehicle_listing_id, r.vehicle_listing_id),
      ymm = coalesce(ymm, r.ymm),
      checklist = coalesce(_checklist, '[]'::jsonb), result = _result,
      failure_notes = _failure_notes, notes = _notes, documents = coalesce(_documents, '[]'::jsonb),
      inspector_name = _inspector_name, inspector_role = 'service',
      signature_data = _signature_data, signature_type = 'type', content_hash = _content_hash,
      esign_consent = _esign_consent, customer_ip = _ip, user_agent = _user_agent,
      submitted_via = 'qr', status = 'signed', signed_at = now(), updated_at = now()
    WHERE id = v_id;
  ELSE
    INSERT INTO public.safety_inspections
      (tenant_id, vehicle_listing_id, vin, ymm, form_type, checklist, result, failure_notes, notes,
       documents, inspector_name, inspector_role, signature_data, signature_type, content_hash,
       esign_consent, customer_ip, user_agent, submitted_via, status, signed_at)
    VALUES
      (r.tenant_id, r.vehicle_listing_id, r.vin, r.ymm, 'CT-K208',
       coalesce(_checklist, '[]'::jsonb), _result, _failure_notes, _notes,
       coalesce(_documents, '[]'::jsonb), _inspector_name, 'service', _signature_data, 'type',
       _content_hash, _esign_consent, _ip, _user_agent, 'qr', 'signed', now())
    RETURNING id INTO v_id;
  END IF;

  UPDATE public.dept_signoff_tokens SET status = 'used', used_at = now(), updated_at = now() WHERE id = r.id;

  BEGIN
    INSERT INTO public.audit_log (action, entity_type, entity_id, store_id, details)
    VALUES ('safety_inspection_signed', 'vehicle', r.vin, r.tenant_id,
            jsonb_build_object('inspection_id', v_id, 'department', 'service', 'result', _result, 'via', 'qr'));
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN jsonb_build_object('ok', true, 'id', v_id);
END;
$$;