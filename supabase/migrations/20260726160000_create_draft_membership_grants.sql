-- Retry buttons + tenant scoping for the intake draft RPCs.
--
-- useCommandCenter.retryAutogenArtifact re-invokes the create_draft_* RPCs as
-- the signed-in manager, but four of the five were granted to service_role
-- only — every retry died on EXECUTE permission. Conversely
-- create_draft_get_ready was granted to authenticated with NO membership check
-- inside, so any signed-in user could seed rows into any tenant by guessing a
-- tenant id (SECURITY DEFINER bypasses RLS).
--
-- One rule for all five: the caller must be an accepted member of p_tenant_id
-- when auth.uid() is present; a NULL uid (service_role / definer contexts,
-- e.g. the nightly sweep and the ingest edge functions) passes. Then all five
-- are granted to authenticated + service_role.
--
-- This file guards addendum / buyers_guide / safety_inspection (bodies
-- unchanged from 20260721194248 / 20260722202328 / 20260722194135 apart from
-- the guard). 20260726161000 guards get_ready / window_sticker.

CREATE OR REPLACE FUNCTION public.assert_tenant_member_or_service(p_tenant_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := (SELECT auth.uid());
BEGIN
  -- No JWT uid = service context (service_role key, definer chain): pass.
  IF v_uid IS NULL THEN RETURN; END IF;
  IF EXISTS (
    SELECT 1 FROM public.tenant_members tm
    WHERE tm.tenant_id = p_tenant_id
      AND tm.user_id = v_uid
      AND tm.accepted_at IS NOT NULL
  ) OR public.has_role(v_uid, 'admin'::public.app_role) THEN
    RETURN;
  END IF;
  RAISE EXCEPTION 'not_a_tenant_member';
END;
$$;

REVOKE ALL ON FUNCTION public.assert_tenant_member_or_service(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.assert_tenant_member_or_service(uuid) TO authenticated, service_role;

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
  PERFORM public.assert_tenant_member_or_service(p_tenant_id);

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
      AND (nullif(r.year_min::text, '') IS NULL OR v_year IS NULL OR v_year >= nullif(r.year_min::text, '')::int)
      AND (nullif(r.year_max::text, '') IS NULL OR v_year IS NULL OR v_year <= nullif(r.year_max::text, '')::int)
      AND (r.makes IS NULL OR array_length(r.makes, 1) IS NULL OR lower(coalesce(v_make, '')) = ANY (SELECT lower(x) FROM unnest(r.makes) x))
      AND (r.models IS NULL OR array_length(r.models, 1) IS NULL OR lower(coalesce(v_model, '')) = ANY (SELECT lower(x) FROM unnest(r.models) x))
      AND (r.trims IS NULL OR array_length(r.trims, 1) IS NULL OR lower(coalesce(v_trim, '')) = ANY (SELECT lower(x) FROM unnest(r.trims) x))
      AND (r.condition IS NULL OR r.condition = 'all' OR lower(r.condition) = lower(coalesce(v_condition, 'used')))
      AND (r.mileage_max IS NULL OR v_mileage IS NULL OR v_mileage <= r.mileage_max)
  );

  IF v_products = '[]'::jsonb THEN RETURN NULL; END IF;

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

REVOKE ALL ON FUNCTION public.create_draft_addendum(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_draft_addendum(uuid, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.create_draft_buyers_guide(p_tenant_id uuid, p_vin text)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_vin text := upper(trim(p_vin));
  v_listing_id uuid; v_condition text; v_price numeric; v_ymm text;
  v_year int; v_make text; v_model text; v_mileage int;
  v_existing uuid; v_settings jsonb; v_state text; v_default text;
  v_price_n numeric := 0; v_miles_n int := 0; v_age int := 0;
  v_box text := 'as-is'; v_forced boolean := false;
  v_days int := 0; v_mi int := 0; v_pct int := 0; v_citation text := '';
  v_id uuid;
BEGIN
  IF p_tenant_id IS NULL OR v_vin = '' THEN RETURN NULL; END IF;
  PERFORM public.assert_tenant_member_or_service(p_tenant_id);

  SELECT id, lower(coalesce(condition, 'used')), price, ymm, mileage
    INTO v_listing_id, v_condition, v_price, v_ymm, v_mileage
    FROM public.vehicle_listings WHERE tenant_id = p_tenant_id AND vin = v_vin LIMIT 1;
  IF v_listing_id IS NULL THEN RETURN NULL; END IF;

  IF v_condition NOT IN ('used', 'cpo', 'certified') THEN RETURN NULL; END IF;

  SELECT id INTO v_existing FROM public.generated_documents
    WHERE tenant_id = p_tenant_id AND vehicle_id = v_listing_id AND document_type = 'buyers_guide' LIMIT 1;
  IF v_existing IS NOT NULL THEN RETURN v_existing; END IF;

  SELECT nullif(regexp_replace(coalesce(year, ''), '[^0-9]', '', 'g'), '')::int,
         make, model, mileage
    INTO v_year, v_make, v_model, v_mileage
    FROM public.vehicle_files WHERE tenant_id = p_tenant_id AND vin = v_vin LIMIT 1;

  v_price_n := COALESCE(v_price, 0);
  v_miles_n := COALESCE(v_mileage, 0);
  v_age := CASE WHEN v_year IS NULL THEN 0 ELSE (date_part('year', current_date)::int - v_year) END;

  SELECT settings INTO v_settings FROM public.dealer_profiles WHERE tenant_id = p_tenant_id;
  v_state := upper(trim(coalesce(v_settings->>'doc_fee_state', v_settings->>'dealer_state', '')));
  v_default := lower(coalesce(v_settings->>'default_ftc_warranty', ''));

  CASE v_state
    WHEN 'CT' THEN
      IF v_price_n < 3000 THEN v_box := 'as-is';
      ELSIF v_year IS NOT NULL AND v_age >= 7 THEN
        v_box := 'as-is'; v_citation := 'Conn. Gen. Stat. §42-221';
      ELSIF v_price_n >= 5000 THEN v_box := 'warranty'; v_forced := true; v_days := 60; v_mi := 3000; v_pct := 100; v_citation := 'Conn. Gen. Stat. §42-221';
      ELSE v_box := 'warranty'; v_forced := true; v_days := 30; v_mi := 1500; v_pct := 100; v_citation := 'Conn. Gen. Stat. §42-221';
      END IF;
    WHEN 'MA' THEN
      IF v_miles_n >= 125000 THEN v_box := 'as-is';
      ELSIF v_miles_n < 40000 THEN v_box := 'warranty'; v_forced := true; v_days := 90; v_mi := 3750; v_pct := 100; v_citation := 'M.G.L. c. 90 §7N¼';
      ELSIF v_miles_n < 80000 THEN v_box := 'warranty'; v_forced := true; v_days := 60; v_mi := 2500; v_pct := 100; v_citation := 'M.G.L. c. 90 §7N¼';
      ELSE v_box := 'warranty'; v_forced := true; v_days := 30; v_mi := 1250; v_pct := 100; v_citation := 'M.G.L. c. 90 §7N¼';
      END IF;
    WHEN 'NY' THEN
      IF v_price_n < 1500 OR v_miles_n > 100000 THEN v_box := 'as-is';
      ELSIF v_miles_n <= 36000 THEN v_box := 'warranty'; v_forced := true; v_days := 90; v_mi := 4000; v_pct := 100; v_citation := 'NY Gen. Bus. Law §198-b';
      ELSIF v_miles_n < 80000 THEN v_box := 'warranty'; v_forced := true; v_days := 60; v_mi := 3000; v_pct := 100; v_citation := 'NY Gen. Bus. Law §198-b';
      ELSE v_box := 'warranty'; v_forced := true; v_days := 30; v_mi := 1000; v_pct := 100; v_citation := 'NY Gen. Bus. Law §198-b';
      END IF;
    WHEN 'NJ' THEN
      IF v_price_n < 3000 OR v_miles_n >= 100000 THEN v_box := 'as-is';
      ELSIF v_miles_n <= 24000 THEN v_box := 'warranty'; v_forced := true; v_days := 90; v_mi := 3000; v_pct := 100; v_citation := 'N.J.S.A. 56:8-67';
      ELSIF v_miles_n < 60000 THEN v_box := 'warranty'; v_forced := true; v_days := 60; v_mi := 2000; v_pct := 100; v_citation := 'N.J.S.A. 56:8-67';
      ELSE v_box := 'warranty'; v_forced := true; v_days := 30; v_mi := 1000; v_pct := 100; v_citation := 'N.J.S.A. 56:8-67';
      END IF;
    WHEN 'ME' THEN v_box := 'implied'; v_forced := true; v_citation := 'Maine Used Car Information Act';
    WHEN 'WI' THEN v_box := 'implied'; v_forced := true; v_citation := 'Wis. Admin. Code Trans 139';
    WHEN 'CA' THEN v_box := 'implied'; v_forced := true; v_citation := 'Song-Beverly Consumer Warranty Act, Cal. Civ. Code §1792';
    WHEN 'DC' THEN v_box := 'implied'; v_forced := true; v_citation := 'D.C. Code §28:2-314';
    WHEN 'KS' THEN v_box := 'implied'; v_forced := true; v_citation := 'Kan. Stat. Ann. §50-639';
    WHEN 'LA' THEN v_box := 'implied'; v_forced := true; v_citation := 'La. Civ. Code art. 2520 (redhibition)';
    WHEN 'MD' THEN v_box := 'implied'; v_forced := true; v_citation := 'Md. Code, Com. Law §2-316.1';
    WHEN 'MN' THEN v_box := 'implied'; v_forced := true; v_citation := 'Minn. Stat. §325G.18 (used-vehicle warranty)';
    WHEN 'MS' THEN v_box := 'implied'; v_forced := true; v_citation := 'Miss. Code Ann. §11-7-18';
    WHEN 'OR' THEN v_box := 'implied'; v_forced := true; v_citation := 'Or. Rev. Stat. §72.3160';
    WHEN 'WA' THEN v_box := 'implied'; v_forced := true; v_citation := 'Wash. Rev. Code §62A.2-316 / §46.70';
    WHEN 'RI' THEN v_box := 'implied'; v_forced := true; v_citation := 'R.I. Gen. Laws §31-5.4 (used-vehicle warranty)';
    WHEN 'VT' THEN v_box := 'implied'; v_forced := true; v_citation := 'Vt. Stat. Ann. tit. 9 §4173';
    WHEN 'WV' THEN v_box := 'implied'; v_forced := true; v_citation := 'W. Va. Code §46A-6-107';
    ELSE v_box := 'as-is';
  END CASE;

  IF v_box <> 'warranty' AND NOT v_forced THEN
    IF v_default = 'implied' THEN v_box := 'implied';
    ELSIF v_default = 'dealer' THEN v_box := 'warranty';
    END IF;
  END IF;

  INSERT INTO public.generated_documents (
    tenant_id, vehicle_id, template_id, document_type, document_status, version, data_snapshot
  ) VALUES (
    p_tenant_id, v_listing_id, 'ftc-buyers-guide', 'buyers_guide', 'draft', 1,
    jsonb_build_object(
      'source', 'ingest_autogen',
      'box', v_box, 'forced', v_forced,
      'min_duration_days', v_days, 'min_miles', v_mi, 'min_pct', v_pct,
      'citation', v_citation, 'needs_verification', true,
      'operating_state', v_state, 'default_ftc_warranty', v_default,
      'vehicle', jsonb_build_object(
        'year', v_year, 'make', v_make, 'model', v_model, 'ymm', v_ymm,
        'vin', v_vin, 'mileage', v_miles_n, 'price', v_price
      ),
      'note', 'Auto-drafted at ingest from operating state + dealer default. Confirm the warranty box before publishing.'
    )
  ) RETURNING id INTO v_id;

  RETURN v_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.create_draft_buyers_guide(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_draft_buyers_guide(uuid, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.create_draft_safety_inspection(p_tenant_id uuid, p_vin text)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_vin text := upper(trim(p_vin));
  v_listing_id uuid; v_condition text; v_ymm text; v_stock text;
  v_existing uuid; v_id uuid;
BEGIN
  IF p_tenant_id IS NULL OR v_vin = '' THEN RETURN NULL; END IF;
  PERFORM public.assert_tenant_member_or_service(p_tenant_id);

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

REVOKE ALL ON FUNCTION public.create_draft_safety_inspection(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_draft_safety_inspection(uuid, text) TO authenticated, service_role;
