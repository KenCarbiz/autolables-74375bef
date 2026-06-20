-- Re-affirm column-level revoke so anonymous (public) reads of vehicle_listings
-- can never include install_token. This is idempotent and survives if any
-- earlier migration accidentally restored a broad column grant.
REVOKE SELECT (install_token) ON public.vehicle_listings FROM anon;
REVOKE SELECT (install_token) ON public.vehicle_listings FROM PUBLIC;