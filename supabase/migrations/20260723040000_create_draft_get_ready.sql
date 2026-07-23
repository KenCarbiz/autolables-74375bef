-- ──────────────────────────────────────────────────────────────────────
-- Pre-start the Get-Ready record at ingest.
--
-- Today a get_ready_records row is created only when a human clicks "Start
-- Get-Ready"; ingest just mints a QR token + recon estimate. This seeds the
-- record for every used/CPO vehicle at ingest so the manager opens the car to a
-- ready-to-compose checklist. VIN-idempotent (skips if a record already exists),
-- so re-syncs safely backfill existing inventory. Each seeded item carries a
-- `department` (service/detail/vendor) so the compose + dispatch flow can route
-- by department.
-- ──────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.create_draft_get_ready(p_tenant_id uuid, p_vin text)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_vin text := upper(trim(p_vin));
  v_listing_id uuid; v_cond text; v_ymm text; v_stock text; v_existing uuid; v_id uuid;
  v_items jsonb;
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

  -- Sensible default checklist the manager edits: safety inspection (service),
  -- detail-for-inventory + photos (detail). Accessories/vendor lines are added
  -- by the manager in compose.
  v_items := jsonb_build_array(
    jsonb_build_object('id', gen_random_uuid()::text, 'category', 'inspection', 'department', 'service', 'label', 'CT K-208 safety inspection', 'status', 'pending', 'internal', true),
    jsonb_build_object('id', gen_random_uuid()::text, 'category', 'detail', 'department', 'detail', 'label', 'Detail for inventory', 'status', 'pending', 'internal', true),
    jsonb_build_object('id', gen_random_uuid()::text, 'category', 'photo', 'department', 'detail', 'label', 'Inventory photos', 'status', 'pending', 'internal', true)
  );

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
