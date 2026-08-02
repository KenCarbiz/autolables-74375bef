ALTER VIEW public.vehicle_identity_duplicates SET (security_invoker = true);

ALTER FUNCTION public.oem_make_from_ymm(text) SET search_path = public;
ALTER FUNCTION public.oem_franchise_min_new_units() SET search_path = public;