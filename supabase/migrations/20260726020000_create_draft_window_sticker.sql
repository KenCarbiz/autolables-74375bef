-- create_draft_window_sticker(tenant, vin): file a DRAFT used-car window
-- sticker generated_documents row at ingest for used/CPO vehicles, so the
-- sticker is tracked from the moment a car lands (INTAKE_SPEC S1). Keyed
-- one-live-draft like generate-vehicle-forms: any non-retired 'window' row for
-- the vehicle short-circuits, so re-syncs and sweeps never pile up versions.
-- New vehicles follow the dealer's new/OEM-sticker rules and are skipped here.

CREATE OR REPLACE FUNCTION public.create_draft_window_sticker(p_tenant_id uuid, p_vin text)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_vin text := upper(trim(p_vin));
  v_listing_id uuid; v_cond text; v_ymm text; v_slug text;
  v_price numeric; v_mileage int;
  v_existing uuid; v_version int; v_id uuid;
BEGIN
  IF p_tenant_id IS NULL OR v_vin = '' THEN RETURN NULL; END IF;

  SELECT id, lower(coalesce(condition, 'used')), ymm, slug, price, mileage
    INTO v_listing_id, v_cond, v_ymm, v_slug, v_price, v_mileage
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
        'mileage', v_mileage, 'price', v_price
      ),
      'note', 'Auto-drafted at ingest. Review pricing, equipment, and layout in the Used Car Sticker builder before printing.'
    )
  ) RETURNING id INTO v_id;

  RETURN v_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.create_draft_window_sticker(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_draft_window_sticker(uuid, text) TO service_role;
