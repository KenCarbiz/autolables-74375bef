-- Richer Get-Ready prefill at ingest (INTAKE_SPEC S3): seed the full service +
-- prep/detail checklists and unassigned vendor draft lines from the dealer's
-- configured providers (installer_contacts), so the manager reviews a complete
-- worklist instead of composing one. Existing records are never touched (the
-- RPC still short-circuits on an existing row), so manager edits survive
-- re-syncs and the nightly sweep.
--
-- Also adds get_ready_records.delivery_target + priority for the manager's
-- delivery-urgency review (S5). Additive; both NULL by default.

ALTER TABLE public.get_ready_records
  ADD COLUMN IF NOT EXISTS delivery_target timestamptz NULL,
  ADD COLUMN IF NOT EXISTS priority text NULL
    CHECK (priority IN ('high', 'normal', 'low'));

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
    jsonb_build_object('id', gen_random_uuid()::text, 'category', 'docs',           'department', 'service', 'label', 'Owner manuals & service records', 'status', 'pending', 'internal', true)
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
