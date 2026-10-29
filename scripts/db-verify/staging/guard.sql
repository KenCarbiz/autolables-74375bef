-- Refuse to run anywhere but an empty or synthetic-only staging database.
DO $guard$
DECLARE
  v_bad boolean;
BEGIN
  IF to_regclass('public.vehicle_listings') IS NOT NULL THEN
    EXECUTE $q$SELECT EXISTS (SELECT 1 FROM public.vehicle_listings WHERE vin NOT LIKE 'EXAMPLEVIN%')$q$ INTO v_bad;
    IF v_bad THEN RAISE EXCEPTION 'staging guard: non-synthetic vehicles present; this is not the policy B staging database'; END IF;
  END IF;
  IF to_regclass('public.tenants') IS NOT NULL THEN
    EXECUTE $q$SELECT EXISTS (SELECT 1 FROM public.tenants WHERE slug NOT LIKE '%example-motors')$q$ INTO v_bad;
    IF v_bad THEN RAISE EXCEPTION 'staging guard: non-synthetic dealerships present; this is not the policy B staging database'; END IF;
  END IF;
END
$guard$;
