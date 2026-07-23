-- ──────────────────────────────────────────────────────────────────────
-- Auto-wire a get-ready accessory onto the addendum as an installed line.
--
-- When the manager adds an install (ceramic coat, door edge guards, tires…) to
-- a get-ready, it should immediately show on the addendum as an INSTALLED
-- product with the math recomputed — flagged `install_pending` until the
-- installer submits proof. A nightly safety-net (separate migration) flips any
-- still-pending line to OPTIONAL after the dealer's window, so a car never sells
-- as "installed" for work that never happened.
--
-- Opt-in: only runs when settings.getready_drives_addendum is true (the same
-- gate as the proof-driven self-aware addendum). Only mutates an UN-accepted
-- draft addendum — an accepted addendum is never silently changed.
-- Pricing math is client-side off products_snapshot, so adding the line is
-- enough for the installed total to update.
-- ──────────────────────────────────────────────────────────────────────

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
