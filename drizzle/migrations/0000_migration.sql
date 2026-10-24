CREATE OR REPLACE FUNCTION public.recalc_tenant_doc_fee(p_tenant_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_fee   numeric;
  v_count integer;
BEGIN
  IF NOT (
    EXISTS (
      SELECT 1 FROM public.tenant_members
      WHERE tenant_id = p_tenant_id AND user_id = (SELECT auth.uid())
        AND lower(coalesce(role, '')) IN ('owner','admin','general_manager','gsm')
    )
    OR EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = (SELECT auth.uid()) AND role = 'admin'
    )
  ) THEN
    RAISE EXCEPTION 'not authorized for tenant %', p_tenant_id;
  END IF;

  SELECT CASE
           WHEN (settings->>'doc_fee_enabled')::boolean
           THEN COALESCE((settings->>'doc_fee_amount')::numeric, 0)
           ELSE 0
         END
    INTO v_fee
  FROM public.dealer_profiles
  WHERE tenant_id = p_tenant_id;
  v_fee := COALESCE(v_fee, 0);

  UPDATE public.vehicle_listings
  SET doc_fee                = v_fee,
      website_sale_price     = advertised_price_before_doc + v_fee,
      price_parse_status     = 'ok',
      price_parse_notes      = 'Doc fee updated in admin; sale price = advertised + doc fee.',
      price_last_verified_at = now()
  WHERE tenant_id = p_tenant_id
    AND advertised_price_before_doc IS NOT NULL
    AND (doc_fee IS DISTINCT FROM v_fee
         OR website_sale_price IS DISTINCT FROM advertised_price_before_doc + v_fee);

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.recalc_tenant_doc_fee(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.recalc_tenant_doc_fee(uuid) TO authenticated;