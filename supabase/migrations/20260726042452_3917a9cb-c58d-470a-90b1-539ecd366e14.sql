-- ──────────────────────────────────────────────────────────────────────
-- Server half of the "never execute with open failures" gate.
-- ──────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.certify_safety_inspection(
  p_inspection_id uuid,
  p_result_initial text,
  p_licensee_name text,
  p_signature_data text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid; v_status text; v_result text; v_vin text; v_uid uuid := (SELECT auth.uid());
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'auth_required'; END IF;
  SELECT tenant_id, status, result, vin INTO v_tenant, v_status, v_result, v_vin
    FROM public.safety_inspections WHERE id = p_inspection_id;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'inspection_not_found'; END IF;

  IF NOT public.k208_signer_allowed(v_tenant, v_uid) THEN
    RAISE EXCEPTION 'not_authorized_to_certify';
  END IF;

  IF v_status <> 'signed' THEN RAISE EXCEPTION 'inspection_not_completed'; END IF;
  IF v_result = 'fail' THEN RAISE EXCEPTION 'inspection_failed_items_open'; END IF;

  IF EXISTS (
    SELECT 1 FROM public.safety_inspection_item_failures f
    WHERE f.tenant_id = v_tenant
      AND ((f.vin IS NOT NULL AND v_vin IS NOT NULL AND upper(f.vin) = upper(v_vin))
           OR f.inspection_id = p_inspection_id)
      AND f.repair_state <> 'passed_on_reinspection'
  ) THEN
    RAISE EXCEPTION 'failed_items_open';
  END IF;

  IF p_result_initial NOT IN ('A','B','C') THEN RAISE EXCEPTION 'invalid_result'; END IF;

  UPDATE public.safety_inspections
    SET licensee_certified_by = v_uid,
        licensee_certified_at = now(),
        licensee_name = p_licensee_name,
        licensee_signature_data = p_signature_data,
        result_initial = p_result_initial
    WHERE id = p_inspection_id;

  INSERT INTO public.audit_log (action, entity_type, entity_id, store_id, user_id, details)
    VALUES ('k208_licensee_certified', 'vehicle', v_vin, v_tenant::text, v_uid,
            jsonb_build_object('inspection_id', p_inspection_id, 'result_initial', p_result_initial));

  RETURN p_inspection_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.certify_safety_inspection(uuid, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.certify_safety_inspection(uuid, text, text, text) TO authenticated;

-- ──────────────────────────────────────────────────────────────────────
-- K-208 publish gate requires execution
-- ──────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.enforce_k208_publish_requires_execution()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_vin text;
  v_newest_id uuid;
  v_newest_result text;
BEGIN
  IF NEW.document_type IS DISTINCT FROM 'k208' THEN RETURN NEW; END IF;
  IF NEW.document_status IS DISTINCT FROM 'published'
     OR OLD.document_status IS NOT DISTINCT FROM 'published' THEN
    RETURN NEW;
  END IF;

  SELECT vl.vin INTO v_vin FROM public.vehicle_listings vl
  WHERE vl.id = NEW.vehicle_id AND vl.tenant_id = NEW.tenant_id
  LIMIT 1;
  IF v_vin IS NULL THEN
    RAISE EXCEPTION 'k208_publish_requires_execution: no vehicle stands behind this K-208 document, so its inspection state cannot be verified';
  END IF;

  SELECT si.id, si.result INTO v_newest_id, v_newest_result
  FROM public.safety_inspections si
  WHERE si.tenant_id = NEW.tenant_id AND si.vin = v_vin AND si.status = 'signed'
  ORDER BY si.signed_at DESC NULLS LAST, si.created_at DESC
  LIMIT 1;

  IF v_newest_id IS NULL THEN
    RAISE EXCEPTION 'k208_publish_requires_execution: no signed K-208 inspection exists for this vehicle; an unexecuted K-208 is never customer-visible';
  END IF;
  IF v_newest_result IS NOT DISTINCT FROM 'fail' THEN
    RAISE EXCEPTION 'k208_publish_requires_execution: the newest signed K-208 inspection for this vehicle failed; a failed K-208 is never customer-visible';
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_k208_publish_requires_execution ON public.generated_documents;
CREATE TRIGGER trg_k208_publish_requires_execution
  BEFORE UPDATE ON public.generated_documents
  FOR EACH ROW
  WHEN (NEW.document_type = 'k208'
        AND NEW.document_status = 'published'
        AND OLD.document_status IS DISTINCT FROM 'published')
  EXECUTE FUNCTION public.enforce_k208_publish_requires_execution();

-- ──────────────────────────────────────────────────────────────────────
-- Intake prefill: reinspection + odor items; sticker snapshot stock_no + disclosures
-- ──────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.create_draft_get_ready(p_tenant_id uuid, p_vin text)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_vin text := upper(trim(p_vin));
  v_listing_id uuid; v_cond text; v_ymm text; v_stock text; v_existing uuid; v_id uuid;
  v_items jsonb;
  v_vendor record;
BEGIN
  IF p_tenant_id IS NULL OR v_vin = '' THEN RETURN NULL; END IF;

  SELECT id, lower(coalesce(condition, 'used')), coalesce(ymm, ''), coalesce(mc_attributes->>'stock_no', '')
    INTO v_listing_id, v_cond, v_ymm, v_stock
    FROM public.vehicle_listings WHERE tenant_id = p_tenant_id AND vin = v_vin LIMIT 1;
  IF v_listing_id IS NULL THEN RETURN NULL; END IF;
  IF v_cond NOT IN ('used', 'cpo', 'certified') THEN RETURN NULL; END IF;

  SELECT id INTO v_existing FROM public.get_ready_records
    WHERE tenant_id = p_tenant_id AND vin = v_vin LIMIT 1;
  IF v_existing IS NOT NULL THEN RETURN v_existing; END IF;

  v_items := jsonb_build_array(
    jsonb_build_object('id', gen_random_uuid()::text, 'category', 'inspection',     'department', 'service', 'label', 'CT K-208 safety inspection',      'status', 'pending', 'internal', true),
    jsonb_build_object('id', gen_random_uuid()::text, 'category', 'mechanical',     'department', 'service', 'label', 'Mechanical inspection',           'status', 'pending', 'internal', true),
    jsonb_build_object('id', gen_random_uuid()::text, 'category', 'tires',          'department', 'service', 'label', 'Tires: tread depth & condition',  'status', 'pending', 'internal', true),
    jsonb_build_object('id', gen_random_uuid()::text, 'category', 'brakes',         'department', 'service', 'label', 'Brakes: pads, rotors & lines',    'status', 'pending', 'internal', true),
    jsonb_build_object('id', gen_random_uuid()::text, 'category', 'fluids',         'department', 'service', 'label', 'Fluids: levels & leaks',          'status', 'pending', 'internal', true),
    jsonb_build_object('id', gen_random_uuid()::text, 'category', 'warning_lights', 'department', 'service', 'label', 'Warning lights & dash indicators','status', 'pending', 'internal', true),
    jsonb_build_object('id', gen_random_uuid()::text, 'category', 'recall',         'department', 'service', 'label', 'Open recall review',              'status', 'pending', 'internal', true),
    jsonb_build_object('id', gen_random_uuid()::text, 'category', 'diagnostics',    'department', 'service', 'label', 'Diagnostics scan',                'status', 'pending', 'internal', true),
    jsonb_build_object('id', gen_random_uuid()::text, 'category', 'oil',            'department', 'service', 'label', 'Oil & filter change',             'status', 'pending', 'internal', true),
    jsonb_build_object('id', gen_random_uuid()::text, 'category', 'battery',        'department', 'service', 'label', 'Battery test',                    'status', 'pending', 'internal', true),
    jsonb_build_object('id', gen_random_uuid()::text, 'category', 'maintenance',    'department', 'service', 'label', 'Scheduled maintenance review',    'status', 'pending', 'internal', true),
    jsonb_build_object('id', gen_random_uuid()::text, 'category', 'keys',           'department', 'service', 'label', 'Keys & remotes accounted for',    'status', 'pending', 'internal', true),
    jsonb_build_object('id', gen_random_uuid()::text, 'category', 'fuel',           'department', 'service', 'label', 'Fuel level / state of charge',    'status', 'pending', 'internal', true),
    jsonb_build_object('id', gen_random_uuid()::text, 'category', 'docs',           'department', 'service', 'label', 'Owner manuals & service records', 'status', 'pending', 'internal', true),
    jsonb_build_object('id', gen_random_uuid()::text, 'category', 'reinspection',   'department', 'service', 'label', 'Reinspection after repairs (if required)', 'status', 'pending', 'internal', true)
  );

  IF v_cond IN ('cpo', 'certified') THEN
    v_items := v_items || jsonb_build_array(
      jsonb_build_object('id', gen_random_uuid()::text, 'category', 'cpo', 'department', 'service', 'label', 'CPO certification inspection', 'status', 'pending', 'internal', true)
    );
  END IF;

  v_items := v_items || jsonb_build_array(
    jsonb_build_object('id', gen_random_uuid()::text, 'category', 'detail',   'department', 'detail', 'label', 'Interior detail',            'status', 'pending', 'internal', true),
    jsonb_build_object('id', gen_random_uuid()::text, 'category', 'detail',   'department', 'detail', 'label', 'Exterior detail',            'status', 'pending', 'internal', true),
    jsonb_build_object('id', gen_random_uuid()::text, 'category', 'wash',     'department', 'detail', 'label', 'Wash',                       'status', 'pending', 'internal', true),
    jsonb_build_object('id', gen_random_uuid()::text, 'category', 'decon',    'department', 'detail', 'label', 'Decontamination',            'status', 'pending', 'internal', true),
    jsonb_build_object('id', gen_random_uuid()::text, 'category', 'odor',     'department', 'detail', 'label', 'Odor treatment (if instructed)', 'status', 'pending', 'internal', true),
    jsonb_build_object('id', gen_random_uuid()::text, 'category', 'touch_up', 'department', 'detail', 'label', 'Paint touch-up',             'status', 'pending', 'internal', true),
    jsonb_build_object('id', gen_random_uuid()::text, 'category', 'dent',     'department', 'detail', 'label', 'Dent review',                'status', 'pending', 'internal', true),
    jsonb_build_object('id', gen_random_uuid()::text, 'category', 'wheels',   'department', 'detail', 'label', 'Wheel review',               'status', 'pending', 'internal', true),
    jsonb_build_object('id', gen_random_uuid()::text, 'category', 'glass',    'department', 'detail', 'label', 'Glass review',               'status', 'pending', 'internal', true),
    jsonb_build_object('id', gen_random_uuid()::text, 'category', 'photo',    'department', 'detail', 'label', 'Photo readiness',            'status', 'pending', 'internal', true),
    jsonb_build_object('id', gen_random_uuid()::text, 'category', 'lot',      'department', 'detail', 'label', 'Lot readiness',              'status', 'pending', 'internal', true),
    jsonb_build_object('id', gen_random_uuid()::text, 'category', 'fuel',     'department', 'detail', 'label', 'Fuel / charge for the lot',  'status', 'pending', 'internal', true)
  );

  FOR v_vendor IN
    SELECT company, product FROM public.installer_contacts
    WHERE tenant_id = p_tenant_id AND active
    ORDER BY company
  LOOP
    v_items := v_items || jsonb_build_array(
      jsonb_build_object(
        'id', gen_random_uuid()::text, 'category', 'vendor', 'department', 'vendor',
        'label', 'Vendor: ' || v_vendor.company || coalesce(' - ' || nullif(trim(v_vendor.product), ''), ''),
        'status', 'pending', 'internal', true,
        'vendor_company', v_vendor.company,
        'vendor_product', v_vendor.product,
        'vendor_confirmed', false
      )
    );
  END LOOP;

  INSERT INTO public.get_ready_records (
    tenant_id, store_id, vin, stock_number, ymm, condition,
    get_ready_start_date, items, accessories_to_install,
    inspection_required, inspection_form_type, status, created_by
  ) VALUES (
    p_tenant_id, p_tenant_id::text, v_vin, v_stock, v_ymm, 'used',
    now(), v_items, '[]'::jsonb,
    true, 'CT-K208', 'pending', 'ingest_autogen'
  ) RETURNING id INTO v_id;

  RETURN v_id;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.create_draft_get_ready(uuid, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.create_draft_window_sticker(p_tenant_id uuid, p_vin text)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_vin text := upper(trim(p_vin));
  v_listing_id uuid; v_cond text; v_ymm text; v_slug text; v_stock text;
  v_price numeric; v_mileage int;
  v_existing uuid; v_version int; v_id uuid;
BEGIN
  IF p_tenant_id IS NULL OR v_vin = '' THEN RETURN NULL; END IF;

  SELECT id, lower(coalesce(condition, 'used')), ymm, slug, price, mileage,
         nullif(trim(coalesce(mc_attributes->>'stock_no', '')), '')
    INTO v_listing_id, v_cond, v_ymm, v_slug, v_price, v_mileage, v_stock
    FROM public.vehicle_listings WHERE tenant_id = p_tenant_id AND vin = v_vin LIMIT 1;
  IF v_listing_id IS NULL THEN RETURN NULL; END IF;
  IF v_cond NOT IN ('used', 'cpo', 'certified') THEN RETURN NULL; END IF;

  SELECT id INTO v_existing FROM public.generated_documents
    WHERE tenant_id = p_tenant_id AND vehicle_id = v_listing_id AND document_type = 'window'
      AND document_status NOT IN ('superseded', 'archived', 'rejected')
    ORDER BY version DESC LIMIT 1;
  IF v_existing IS NOT NULL THEN RETURN v_existing; END IF;

  SELECT coalesce(max(version), 0) + 1 INTO v_version FROM public.generated_documents
    WHERE tenant_id = p_tenant_id AND vehicle_id = v_listing_id AND document_type = 'window';

  INSERT INTO public.generated_documents (
    tenant_id, vehicle_id, template_id, document_type, document_status, version, data_snapshot
  ) VALUES (
    p_tenant_id, v_listing_id, 'used-car-sticker', 'window', 'draft', v_version,
    jsonb_build_object(
      'source', 'ingest_autogen',
      'needs_verification', true,
      'qr_slug', v_slug,
      'vehicle', jsonb_build_object(
        'vin', v_vin, 'ymm', v_ymm, 'condition', v_cond,
        'stock_no', v_stock, 'mileage', v_mileage, 'price', v_price
      ),
      'disclosures', 'Required disclosures (FTC Buyers Guide reference, doc-fee and applicable state disclosures) are applied from dealer settings at render. Verify them on the rendered sticker before printing.',
      'note', 'Auto-drafted at ingest. Review pricing, equipment, and layout in the Used Car Sticker builder before printing.'
    )
  ) RETURNING id INTO v_id;

  RETURN v_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.create_draft_window_sticker(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_draft_window_sticker(uuid, text) TO service_role;