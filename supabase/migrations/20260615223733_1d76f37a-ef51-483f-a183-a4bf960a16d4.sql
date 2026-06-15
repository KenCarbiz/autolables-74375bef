-- 3a: ensure audit_log is append-only for authenticated (and anon)
REVOKE UPDATE, DELETE, TRUNCATE ON public.audit_log FROM authenticated;
REVOKE UPDATE, DELETE, TRUNCATE ON public.audit_log FROM anon;

-- 3b: narrow get_addendum_by_token to only the columns the public signing page needs.
-- Drop required because return type changes.
DROP FUNCTION IF EXISTS public.get_addendum_by_token(uuid);

CREATE OR REPLACE FUNCTION public.get_addendum_by_token(_token uuid)
RETURNS TABLE (
  id uuid,
  status text,
  vehicle_ymm text,
  vehicle_vin text,
  vehicle_state text,
  vehicle_price numeric,
  vehicle_condition text,
  buyers_guide_id uuid,
  addendum_date date,
  products_snapshot jsonb,
  initials jsonb,
  optional_selections jsonb,
  financing_input jsonb,
  dealer_snapshot jsonb,
  sb766_financing_disclosure jsonb,
  sb766_three_day_return_ack boolean,
  sb766_add_on_precontract jsonb,
  price_overrides jsonb,
  listing_slug text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    a.id,
    a.status,
    a.vehicle_ymm,
    a.vehicle_vin,
    a.vehicle_state,
    a.vehicle_price,
    -- vehicle_condition / buyers_guide_id are not columns on addendums today;
    -- expose nulls so the signing page typing stays stable if they're added later.
    NULL::text AS vehicle_condition,
    NULL::uuid AS buyers_guide_id,
    a.addendum_date,
    a.products_snapshot,
    a.initials,
    a.optional_selections,
    a.financing_input,
    a.dealer_snapshot,
    a.sb766_financing_disclosure,
    a.sb766_three_day_return_ack,
    a.sb766_add_on_precontract,
    a.price_overrides,
    a.listing_slug
  FROM public.addendums a
  WHERE a.signing_token = _token
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_addendum_by_token(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_addendum_by_token(uuid) TO anon, authenticated;