-- RooftopOS staging: isolation check. READ-ONLY. Run it before anything is applied
-- and again after the spine is applied; it must pass both times.
-- Paste-safe: plain SQL, no psql meta-commands. Every failed assertion raises
-- an exception, so a red run stops with the reason in the error text. The last
-- statement returns one row identifying the database it ran against.

DO $$
DECLARE
  v_has_cron boolean := EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron');
  v_has_net  boolean := EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net');
  v_jobs     bigint := 0;
BEGIN
  IF to_regclass('cron.job') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM cron.job' INTO v_jobs;
  END IF;
  IF (v_has_cron OR v_has_net) AND v_jobs <> 0 THEN
    RAISE EXCEPTION 'isolation: % cron job(s) scheduled (pg_cron=%, pg_net=%); staging must have none', v_jobs, v_has_cron, v_has_net;
  END IF;
  RAISE NOTICE 'isolation: pg_cron=% pg_net=% cron.job rows=%', v_has_cron, v_has_net, v_jobs;
END $$;

-- No stored code or expression anywhere may name a production project or MarketCheck.
DO $$
DECLARE
  v_hits text;
BEGIN
  WITH needles(n) AS (
    VALUES ('onnbmmdbrsgytfozfozn'), ('ptiwdwfdckfqivoocyvp'), ('hciluddranlphtekspzk'), ('marketcheck')
  ),
  haystack(kind, name, body) AS (
    SELECT 'function', p.oid::regprocedure::text, p.prosrc
      FROM pg_proc p
    UNION ALL
    SELECT 'view', schemaname || '.' || viewname, definition FROM pg_views
    UNION ALL
    SELECT 'matview', schemaname || '.' || matviewname, definition FROM pg_matviews
    UNION ALL
    SELECT 'policy', schemaname || '.' || tablename || ':' || policyname,
           coalesce(qual, '') || ' ' || coalesce(with_check, '')
      FROM pg_policies
    UNION ALL
    SELECT 'trigger', t.tgrelid::regclass::text || ':' || t.tgname, pg_get_triggerdef(t.oid)
      FROM pg_trigger t WHERE NOT t.tgisinternal
    UNION ALL
    SELECT 'column default', d.adrelid::regclass::text || '.' || a.attname, pg_get_expr(d.adbin, d.adrelid)
      FROM pg_attrdef d
      JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
  )
  SELECT string_agg(DISTINCT h.kind || ' ' || h.name || ' contains ' || n.n, '; ')
    INTO v_hits
    FROM haystack h JOIN needles n ON position(n.n IN lower(coalesce(h.body, ''))) > 0;
  IF v_hits IS NOT NULL THEN
    RAISE EXCEPTION 'isolation: production reference found: %', v_hits;
  END IF;
END $$;

-- No trigger on a public table may reach the network (pg_net), so no insert the
-- runner makes can call out of staging.
DO $$
DECLARE
  v_hits text;
BEGIN
  SELECT string_agg(DISTINCT t.tgrelid::regclass::text || ':' || t.tgname, ', ')
    INTO v_hits
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace ns ON ns.oid = c.relnamespace
    JOIN pg_proc p ON p.oid = t.tgfoid
   WHERE NOT t.tgisinternal
     AND ns.nspname = 'public'
     AND (p.prosrc ~* 'net\.http_' OR p.prosrc ~* 'http_post');
  IF v_hits IS NOT NULL THEN
    RAISE EXCEPTION 'isolation: public trigger(s) call the network: %', v_hits;
  END IF;
END $$;

-- Vault may hold only the staging keys this kit creates.
DO $$
DECLARE
  v_other bigint := 0;
  v_names text;
BEGIN
  IF to_regclass('vault.secrets') IS NOT NULL THEN
    EXECUTE $q$SELECT count(*), string_agg(coalesce(name, '<unnamed>'), ', ')
                 FROM vault.secrets
                WHERE name IS NULL OR name NOT LIKE 'rooftopos-staging-%'$q$
      INTO v_other, v_names;
  END IF;
  IF v_other <> 0 THEN
    RAISE EXCEPTION 'isolation: vault holds % secret(s) not named rooftopos-staging-*: %', v_other, v_names;
  END IF;
END $$;

SELECT
  'PASS'                                   AS isolation_check,
  current_database()                       AS database,
  current_user                             AS connected_as,
  inet_server_addr()::text                 AS server_addr,
  inet_server_port()                       AS server_port,
  pg_postmaster_start_time()               AS postmaster_started,
  split_part(version(), ' on ', 1)         AS server_version,
  (SELECT count(*) FROM pg_extension WHERE extname IN ('pg_cron', 'pg_net')) AS cron_or_net_extensions,
  (SELECT count(*) FROM pg_namespace WHERE nspname = 'vault')               AS vault_schema_present,
  to_regclass('public.tenants') IS NOT NULL                                 AS deps_present,
  to_regclass('public.integration_inbox') IS NOT NULL                       AS spine_present,
  (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p'))                 AS public_tables,
  now()                                    AS checked_at;
