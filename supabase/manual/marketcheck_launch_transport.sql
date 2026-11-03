-- MarketCheck launch: transport for the workload dispatcher (migration 0018).
-- Kept out of the migration because it reads Vault, which the Lovable
-- migration tool refuses. Apply from the Supabase SQL editor after 0018, with
-- the switch OFF. It sends nothing by itself: the dispatcher runs only while
-- the launch is on, and every call it triggers still passes the launch gate.
--
-- Prerequisites (shared with supabase/manual/files_inventory_worker_schedule.sql):
--   select vault.create_secret('https://<project-ref>.supabase.co', 'supabase_url');
--   select vault.create_secret('<service role key>', 'service_role_key');
--   pg_net enabled (Database > Extensions).
-- Check: select public.marketcheck_launch_transport_ready();

CREATE OR REPLACE FUNCTION public.marketcheck_launch_transport_ready() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_url text; v_key boolean;
BEGIN
  IF to_regproc('net.http_post') IS NULL OR to_regclass('net._http_response') IS NULL THEN
    RETURN jsonb_build_object('ready', false, 'reason', 'pg_net_missing');
  END IF;
  IF to_regclass('vault.decrypted_secrets') IS NULL THEN RETURN jsonb_build_object('ready', false, 'reason', 'vault_missing'); END IF;
  EXECUTE $q$SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_url' LIMIT 1$q$ INTO v_url;
  EXECUTE $q$SELECT EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'service_role_key' AND length(decrypted_secret) > 20)$q$ INTO v_key;
  IF v_url IS NULL OR v_url !~ '^https://[a-z0-9-]+\.supabase\.co$' THEN RETURN jsonb_build_object('ready', false, 'reason', 'vault_supabase_url_missing'); END IF;
  IF NOT v_key THEN RETURN jsonb_build_object('ready', false, 'reason', 'vault_service_role_key_missing'); END IF;
  RETURN jsonb_build_object('ready', true, 'host', substring(v_url from '^https://([^/]+)'));
END $$;

-- Calls only the workload function named by the active plan.
CREATE OR REPLACE FUNCTION public.marketcheck_launch_transport(p_function text, p_body jsonb) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_url text; v_key text; v_id bigint; v_fn text;
BEGIN
  SELECT p.workload->>'function' INTO v_fn FROM marketcheck_launch_control c JOIN marketcheck_launch_plans p ON p.version = c.plan_version WHERE c.id = 1;
  IF v_fn IS NULL OR p_function IS DISTINCT FROM v_fn THEN RAISE EXCEPTION 'transport_function_not_in_plan: %', p_function; END IF;
  EXECUTE $q$SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_url' LIMIT 1$q$ INTO v_url;
  EXECUTE $q$SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1$q$ INTO v_key;
  IF v_url IS NULL OR v_key IS NULL THEN RAISE EXCEPTION 'transport_not_configured'; END IF;
  EXECUTE $q$SELECT net.http_post(url := $1, body := $2, headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || $3),
                                  timeout_milliseconds := 60000)$q$
    INTO v_id USING v_url || '/functions/v1/' || p_function, p_body, v_key;
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.marketcheck_launch_transport_result(p_request_id bigint) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE r jsonb;
BEGIN
  IF p_request_id IS NULL OR to_regclass('net._http_response') IS NULL THEN RETURN NULL; END IF;
  EXECUTE $q$SELECT jsonb_build_object('status_code', status_code, 'error', COALESCE(error_msg, CASE WHEN timed_out THEN 'timed_out' END),
                 'body', CASE WHEN content ~ '^\s*\{' THEN content::jsonb END) FROM net._http_response WHERE id = $1$q$
    INTO r USING p_request_id;
  RETURN r;
END $$;

REVOKE ALL ON FUNCTION public.marketcheck_launch_transport_ready(), public.marketcheck_launch_transport(text, jsonb),
  public.marketcheck_launch_transport_result(bigint) FROM PUBLIC, anon, authenticated;
