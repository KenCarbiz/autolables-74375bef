-- Read-only. Must return one row with result = 'PASS' before step S01 and
-- again before S05. Raises with the reason otherwise.
DO $iso$
DECLARE
  v_jobs bigint := 0;
  v_bad boolean;
BEGIN
  IF to_regclass('cron.job') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM cron.job' INTO v_jobs;
    IF v_jobs > 0 THEN RAISE EXCEPTION 'isolation: % scheduled job(s); the staging project must have none', v_jobs; END IF;
  END IF;
  IF to_regclass('public.vehicle_listings') IS NOT NULL THEN
    EXECUTE $q$SELECT EXISTS (SELECT 1 FROM public.vehicle_listings WHERE vin NOT LIKE 'EXAMPLEVIN%')$q$ INTO v_bad;
    IF v_bad THEN RAISE EXCEPTION 'isolation: non-synthetic vehicles present'; END IF;
  END IF;
  IF to_regclass('public.tenants') IS NOT NULL THEN
    EXECUTE $q$SELECT EXISTS (SELECT 1 FROM public.tenants WHERE slug NOT LIKE '%example-motors')$q$ INTO v_bad;
    IF v_bad THEN RAISE EXCEPTION 'isolation: non-synthetic dealerships present'; END IF;
  END IF;
  IF to_regclass('public.integration_inbox') IS NOT NULL THEN
    RAISE EXCEPTION 'isolation: the RooftopOS staging tables are present; use a separate empty project for policy B';
  END IF;
END
$iso$;
SELECT jsonb_build_object(
  'result', 'PASS',
  'database', current_database(),
  'server_version', current_setting('server_version'),
  'vehicle_listings', CASE WHEN to_regclass('public.vehicle_listings') IS NULL THEN 'absent' ELSE 'synthetic only' END,
  'checked_at', now()) AS result;
