-- 20260723040000 create_draft_get_ready
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

-- 20260723050000 backfill get-ready
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT tenant_id, vin FROM public.vehicle_listings
    WHERE lower(coalesce(condition, 'used')) IN ('used', 'cpo', 'certified')
      AND tenant_id IS NOT NULL
      AND coalesce(trim(vin), '') <> ''
  LOOP
    BEGIN
      PERFORM public.create_draft_get_ready(r.tenant_id, r.vin);
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
  END LOOP;
END $$;

-- 20260723060000 getready_addendum_line
CREATE OR REPLACE FUNCTION public.getready_upsert_addendum_line(p_tenant_id uuid, p_vin text, p_product_id text)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_vin text := upper(trim(p_vin));
  v_on boolean; v_add_id uuid; v_snapshot jsonb; v_prod jsonb; v_line jsonb; v_exists boolean;
BEGIN
  IF p_tenant_id IS NULL OR v_vin = '' OR coalesce(p_product_id, '') = '' THEN RETURN NULL; END IF;

  SELECT (settings ->> 'getready_drives_addendum')::boolean INTO v_on
    FROM public.dealer_profiles WHERE tenant_id = p_tenant_id;
  IF v_on IS NOT TRUE THEN RETURN NULL; END IF;

  SELECT to_jsonb(p) INTO v_prod FROM public.products p
    WHERE (p.tenant_id = p_tenant_id OR p.tenant_id IS NULL) AND p.id::text = p_product_id LIMIT 1;
  IF v_prod IS NULL THEN RETURN NULL; END IF;
  v_line := v_prod || jsonb_build_object(
    'badge_type', 'installed', 'install_pending', true,
    'installed_source', 'getready', 'price_in_advertised', false
  );

  SELECT id, products_snapshot INTO v_add_id, v_snapshot
    FROM public.addendums
    WHERE tenant_id = p_tenant_id AND vehicle_vin = v_vin
      AND accepted_at IS NULL AND coalesce(status, 'draft') <> 'signed'
    ORDER BY created_at DESC LIMIT 1;

  IF v_add_id IS NULL THEN
    INSERT INTO public.addendums (
      tenant_id, vehicle_vin, addendum_date, products_snapshot, customer_info,
      status, lifecycle_status, price_verified, price_verification_status
    ) VALUES (
      p_tenant_id, v_vin, current_date, jsonb_build_array(v_line), '{}'::jsonb,
      'draft', 'draft', false, 'pending'
    ) RETURNING id INTO v_add_id;
    RETURN v_add_id;
  END IF;

  v_snapshot := coalesce(v_snapshot, '[]'::jsonb);
  SELECT EXISTS (SELECT 1 FROM jsonb_array_elements(v_snapshot) e WHERE e ->> 'id' = p_product_id) INTO v_exists;
  IF v_exists THEN
    SELECT jsonb_agg(
      CASE WHEN e ->> 'id' = p_product_id
        THEN e || jsonb_build_object('badge_type', 'installed', 'install_pending', true, 'installed_source', 'getready')
        ELSE e END)
      INTO v_snapshot FROM jsonb_array_elements(v_snapshot) e;
  ELSE
    v_snapshot := v_snapshot || jsonb_build_array(v_line);
  END IF;

  UPDATE public.addendums SET products_snapshot = v_snapshot, updated_at = now() WHERE id = v_add_id;
  RETURN v_add_id;
END;
$function$;
GRANT EXECUTE ON FUNCTION public.getready_upsert_addendum_line(uuid, text, text) TO authenticated, service_role;

-- 20260723070000 install_safety_net
CREATE OR REPLACE FUNCTION public.sweep_getready_install_safety_net()
 RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  a record; e jsonb; v_new jsonb; v_changed boolean; v_has_proof boolean; v_flipped int := 0;
BEGIN
  FOR a IN
    SELECT ad.id, ad.tenant_id, ad.vehicle_vin, ad.products_snapshot, ad.getready_dispatched_at,
           coalesce((dp.settings ->> 'install_safety_net_days')::int, 3) AS days
    FROM public.addendums ad
    LEFT JOIN public.dealer_profiles dp ON dp.tenant_id = ad.tenant_id
    WHERE ad.getready_dispatched_at IS NOT NULL
      AND coalesce(ad.status, '') <> 'signed'
      AND ad.products_snapshot::text LIKE '%"install_pending"%'
  LOOP
    IF a.getready_dispatched_at > now() - make_interval(days => greatest(a.days, 0)) THEN CONTINUE; END IF;

    v_changed := false;
    v_new := '[]'::jsonb;
    FOR e IN SELECT * FROM jsonb_array_elements(coalesce(a.products_snapshot, '[]'::jsonb))
    LOOP
      IF (e ->> 'install_pending')::boolean IS TRUE AND coalesce(e ->> 'badge_type', '') = 'installed' THEN
        SELECT EXISTS (
          SELECT 1 FROM public.install_proofs ip
          WHERE ip.tenant_id = a.tenant_id AND upper(ip.vin) = upper(a.vehicle_vin)
            AND ip.is_verified = true
            AND (ip.product_id = (e ->> 'id') OR lower(ip.product_name) = lower(coalesce(e ->> 'name', '')))
        ) INTO v_has_proof;

        IF v_has_proof THEN
          v_new := v_new || jsonb_build_array(e - 'install_pending');
        ELSE
          v_new := v_new || jsonb_build_array(e || jsonb_build_object('badge_type', 'optional', 'install_pending', false, 'flipped_to_optional', true));
          v_changed := true; v_flipped := v_flipped + 1;
        END IF;
      ELSE
        v_new := v_new || jsonb_build_array(e);
      END IF;
    END LOOP;

    IF v_changed THEN
      UPDATE public.addendums SET products_snapshot = v_new, updated_at = now() WHERE id = a.id;
      BEGIN
        INSERT INTO public.audit_log (action, entity_type, entity_id, store_id, details)
        VALUES ('install_safety_net_flip', 'vehicle', a.vehicle_vin, a.tenant_id::text, jsonb_build_object('addendum_id', a.id));
      EXCEPTION WHEN OTHERS THEN NULL; END;
    END IF;
  END LOOP;

  RETURN v_flipped;
END;
$function$;
GRANT EXECUTE ON FUNCTION public.sweep_getready_install_safety_net() TO service_role;

DO $$
BEGIN
  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'getready-install-safety-net';
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

DO $$
BEGIN
  PERFORM cron.schedule('getready-install-safety-net', '30 4 * * *', 'SELECT public.sweep_getready_install_safety_net();');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;