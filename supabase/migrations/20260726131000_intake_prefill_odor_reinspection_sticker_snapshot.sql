-- Additive prefill completions against INTAKE_SPEC S1/S3:
--
-- 1. create_draft_get_ready — the seeded worklist was missing two S3 items:
--    "reinspection state" (service) and "odor (if instructed)" (prep/detail).
--    Both are appended to the seed lists; existing records are untouched (the
--    RPC still short-circuits on an existing row), so manager edits survive.
--
-- 2. create_draft_window_sticker — the S1 sticker snapshot carried no stock
--    number and no disclosures note. The snapshot now records stock_no and a
--    disclosures note alongside the existing identity/pricing fields.
--
-- Both are CREATE OR REPLACE with unchanged signatures and grants.

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

  -- Service list (spec S3). Oil & filter is seeded unconditionally: no dealer
  -- settings key governs it today (recon_canned_services carries it only as a
  -- recon estimate line), so the manager removes it where not wanted.
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

  -- Prep / detail list (spec S3).
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

  -- Unassigned vendor draft lines from the dealer's configured providers.
  -- Drafts until the manager confirms provider, pricing, and instructions.
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
