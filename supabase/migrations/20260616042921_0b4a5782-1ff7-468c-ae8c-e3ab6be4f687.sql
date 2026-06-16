DROP FUNCTION IF EXISTS public.get_addendum_by_token(uuid);

CREATE FUNCTION public.get_addendum_by_token(_token uuid)
RETURNS TABLE (
  id uuid, status text, vehicle_ymm text, vehicle_vin text, vehicle_state text,
  vehicle_price numeric, vehicle_condition text, buyers_guide_id uuid,
  addendum_date date, products_snapshot jsonb, initials jsonb,
  optional_selections jsonb, financing_input jsonb, dealer_snapshot jsonb,
  sb766_financing_disclosure jsonb, sb766_three_day_return_ack boolean,
  sb766_add_on_precontract jsonb, price_overrides jsonb, listing_slug text,
  cobuyer_name text
) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT a.id, a.status::text, a.vehicle_ymm::text, a.vehicle_vin::text, a.vehicle_state::text,
    a.vehicle_price::numeric, NULL::text, NULL::uuid, a.addendum_date::date,
    a.products_snapshot, a.initials, a.optional_selections, a.financing_input, a.dealer_snapshot,
    a.sb766_financing_disclosure, a.sb766_three_day_return_ack, a.sb766_add_on_precontract,
    a.price_overrides, a.listing_slug::text, a.cobuyer_name::text
  FROM public.addendums a WHERE a.signing_token = _token LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_addendum_by_token(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.get_addendum_by_token(uuid) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';