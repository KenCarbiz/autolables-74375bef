-- ─────────────────────────────────────────────────────────────────────────
-- create_draft_addendum(tenant, vin): auto-build a DRAFT addendum at ingest by
-- matching the dealer's product_rules to the vehicle, so the addendum is
-- pre-populated and ready (no manual creation). Server-only (service role).
--
-- Mirrors the client matchesRule() logic (useProductRules.ts): a product is
-- included when the tenant has a product_rule for it whose year/make/model/trim/
-- condition/mileage predicates all match the vehicle. Empty predicate = any.
-- Skips if an addendum already exists for the VIN, or if nothing matches.
-- ─────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.create_draft_addendum(p_tenant_id uuid, p_vin text)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_vin text := upper(trim(p_vin));
  v_existing uuid;
  v_year int; v_make text; v_model text; v_trim text; v_condition text; v_mileage int;
  v_ymm text; v_stock text;
  v_products jsonb;
  v_id uuid;
BEGIN
  IF p_tenant_id IS NULL OR v_vin = '' THEN RETURN NULL; END IF;

  SELECT id INTO v_existing FROM public.addendums
    WHERE tenant_id = p_tenant_id AND vehicle_vin = v_vin LIMIT 1;
  IF v_existing IS NOT NULL THEN RETURN v_existing; END IF;

  SELECT nullif(regexp_replace(coalesce(year, ''), '[^0-9]', '', 'g'), '')::int,
         make, model, trim, condition, mileage, stock_number
    INTO v_year, v_make, v_model, v_trim, v_condition, v_mileage, v_stock
    FROM public.vehicle_files WHERE tenant_id = p_tenant_id AND vin = v_vin LIMIT 1;

  IF v_make IS NULL THEN
    SELECT ymm, condition INTO v_ymm, v_condition
      FROM public.vehicle_listings WHERE tenant_id = p_tenant_id AND vin = v_vin LIMIT 1;
  ELSE
    v_ymm := trim(concat_ws(' ', v_year::text, v_make, v_model));
  END IF;

  SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY p.sort_order), '[]'::jsonb) INTO v_products
  FROM public.products p
  WHERE p.is_active = true AND EXISTS (
    SELECT 1 FROM public.product_rules r
    WHERE r.tenant_id = p_tenant_id AND r.product_id = p.id
      AND (r.year_min IS NULL OR v_year IS NULL OR v_year >= r.year_min)
      AND (r.year_max IS NULL OR v_year IS NULL OR v_year <= r.year_max)
      AND (r.makes IS NULL OR array_length(r.makes, 1) IS NULL OR lower(coalesce(v_make, '')) = ANY (SELECT lower(x) FROM unnest(r.makes) x))
      AND (r.models IS NULL OR array_length(r.models, 1) IS NULL OR lower(coalesce(v_model, '')) = ANY (SELECT lower(x) FROM unnest(r.models) x))
      AND (r.trims IS NULL OR array_length(r.trims, 1) IS NULL OR lower(coalesce(v_trim, '')) = ANY (SELECT lower(x) FROM unnest(r.trims) x))
      AND (r.condition IS NULL OR r.condition = 'all' OR lower(r.condition) = lower(coalesce(v_condition, 'used')))
      AND (r.mileage_max IS NULL OR v_mileage IS NULL OR v_mileage <= r.mileage_max)
  );

  IF v_products = '[]'::jsonb THEN RETURN NULL; END IF;   -- nothing to disclose → skip

  INSERT INTO public.addendums (
    tenant_id, vehicle_vin, vehicle_ymm, vehicle_stock, addendum_date,
    products_snapshot, customer_info, status, lifecycle_status,
    price_verified, price_verification_status
  ) VALUES (
    p_tenant_id, v_vin, v_ymm, v_stock, current_date,
    v_products, '{}'::jsonb, 'draft', 'draft',
    false, 'pending'
  ) RETURNING id INTO v_id;

  RETURN v_id;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.create_draft_addendum(uuid, text) FROM public;
GRANT EXECUTE ON FUNCTION public.create_draft_addendum(uuid, text) TO service_role;
