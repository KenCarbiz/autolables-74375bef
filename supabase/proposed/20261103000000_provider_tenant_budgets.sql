-- PROPOSED, NOT APPLIED. Per-dealer provider budgets and super-admin alerts.
--
-- The provider gate (provider_call_admit, 20261027205000) kept one monthly
-- call cap per provider for the whole platform. This adds, per dealership:
--
--   provider_tenant_budgets   a monthly call cap and/or a monthly dollar cap per
--                             provider, or for all providers combined ('*').
--                             mode: off | alert_only | enforce. Enforce refuses
--                             non-essential calls over the cap; the inventory
--                             feed (essential) is refused only when
--                             block_essential is set. Alerts fire at the
--                             percentages in alert_thresholds.
--   provider_unit_prices      the estimated price per call for providers whose
--                             price is not built into the code (everything but
--                             MarketCheck), so dollar caps can count them.
--   platform_alert_settings   one row: send budget alerts by email, by text
--                             message, or both, and to whom.
--   provider_budget_alerts    one row per alert (deduplicated per dealership,
--                             provider, month, kind and threshold) with its
--                             delivery status. The provider-budget-alerts
--                             function delivers them.
--
-- provider_call_admit keeps its signature and return shape and adds the
-- dealership check before the platform check. Writes go through
-- platform_* functions that require a platform admin and write audit rows.
-- Nothing is scheduled: schedule_provider_budget_alerts() starts delivery
-- only when someone calls it.

-- ── Tables ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.provider_tenant_budgets (
  tenant_id         uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  provider          text NOT NULL CHECK (provider ~ '^(\*|[a-z0-9_]{2,40})$'),
  mode              text NOT NULL DEFAULT 'alert_only' CHECK (mode IN ('off', 'alert_only', 'enforce')),
  monthly_call_cap  integer CHECK (monthly_call_cap IS NULL OR monthly_call_cap >= 0),
  monthly_usd_cap   numeric(10,2) CHECK (monthly_usd_cap IS NULL OR monthly_usd_cap >= 0),
  alert_thresholds  integer[] NOT NULL DEFAULT '{80,100}',
  block_essential   boolean NOT NULL DEFAULT false,
  notes             text,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  updated_by        uuid,
  PRIMARY KEY (tenant_id, provider),
  CONSTRAINT provider_tenant_budgets_has_cap CHECK (mode = 'off' OR monthly_call_cap IS NOT NULL OR monthly_usd_cap IS NOT NULL),
  CONSTRAINT provider_tenant_budgets_thresholds CHECK (
    array_length(alert_thresholds, 1) IS NULL
    OR (array_length(alert_thresholds, 1) <= 5 AND 1 <= ALL (alert_thresholds) AND 200 >= ALL (alert_thresholds)))
);

CREATE TABLE IF NOT EXISTS public.provider_unit_prices (
  provider      text NOT NULL,
  product       text NOT NULL DEFAULT '*',
  usd_per_call  numeric(10,4) NOT NULL CHECK (usd_per_call >= 0),
  notes         text,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  updated_by    uuid,
  PRIMARY KEY (provider, product)
);

CREATE TABLE IF NOT EXISTS public.platform_alert_settings (
  id               boolean PRIMARY KEY DEFAULT true CHECK (id),
  email_enabled    boolean NOT NULL DEFAULT false,
  sms_enabled      boolean NOT NULL DEFAULT false,
  email_recipients text[] NOT NULL DEFAULT '{}',
  sms_recipients   text[] NOT NULL DEFAULT '{}',
  updated_at       timestamptz NOT NULL DEFAULT now(),
  updated_by       uuid
);
INSERT INTO public.platform_alert_settings (id) VALUES (true) ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.provider_budget_alerts (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  created_at      timestamptz NOT NULL DEFAULT now(),
  tenant_id       uuid NOT NULL,
  provider        text NOT NULL,
  month           date NOT NULL,
  kind            text NOT NULL CHECK (kind IN ('threshold', 'call_denied')),
  threshold       integer NOT NULL DEFAULT 0,
  mode            text NOT NULL,
  calls           integer NOT NULL,
  usd             numeric(10,2) NOT NULL,
  monthly_call_cap integer,
  monthly_usd_cap  numeric(10,2),
  caller          text,
  email_status    text,
  sms_status      text,
  attempts        integer NOT NULL DEFAULT 0,
  last_error      text,
  delivered_at    timestamptz,
  CONSTRAINT provider_budget_alerts_once UNIQUE (tenant_id, provider, month, kind, threshold)
);
CREATE INDEX IF NOT EXISTS idx_provider_budget_alerts_pending
  ON public.provider_budget_alerts (created_at) WHERE delivered_at IS NULL;

-- ── Row-level security: platform admins only ────────────────────────────

ALTER TABLE public.provider_tenant_budgets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.provider_unit_prices    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_alert_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.provider_budget_alerts  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "provider_tenant_budgets platform admin read" ON public.provider_tenant_budgets;
CREATE POLICY "provider_tenant_budgets platform admin read"
  ON public.provider_tenant_budgets FOR SELECT
  TO authenticated
  USING (public.has_role((SELECT auth.uid()), 'admin'));

DROP POLICY IF EXISTS "provider_unit_prices platform admin read" ON public.provider_unit_prices;
CREATE POLICY "provider_unit_prices platform admin read"
  ON public.provider_unit_prices FOR SELECT
  TO authenticated
  USING (public.has_role((SELECT auth.uid()), 'admin'));

DROP POLICY IF EXISTS "platform_alert_settings platform admin read" ON public.platform_alert_settings;
CREATE POLICY "platform_alert_settings platform admin read"
  ON public.platform_alert_settings FOR SELECT
  TO authenticated
  USING (public.has_role((SELECT auth.uid()), 'admin'));

DROP POLICY IF EXISTS "provider_budget_alerts platform admin read" ON public.provider_budget_alerts;
CREATE POLICY "provider_budget_alerts platform admin read"
  ON public.provider_budget_alerts FOR SELECT
  TO authenticated
  USING (public.has_role((SELECT auth.uid()), 'admin'));

-- Reads only; every write goes through the functions below.
REVOKE ALL ON public.provider_tenant_budgets, public.provider_unit_prices,
  public.platform_alert_settings, public.provider_budget_alerts FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.provider_tenant_budgets, public.provider_unit_prices,
  public.platform_alert_settings, public.provider_budget_alerts TO authenticated;
GRANT ALL ON public.provider_tenant_budgets, public.provider_unit_prices,
  public.platform_alert_settings, public.provider_budget_alerts TO service_role;

-- ── The gate ────────────────────────────────────────────────────────────

-- Month to date for one dealership: calls admitted (refusals excluded) and the
-- estimated dollars of those calls, for one provider or for all ('*').
CREATE OR REPLACE FUNCTION public.provider_tenant_month_usage(p_tenant_id uuid, p_provider text)
RETURNS TABLE (calls integer, usd numeric)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
  SELECT count(*)::integer, coalesce(sum(e.estimated_cost_usd), 0)::numeric
  FROM public.provider_call_events e
  WHERE e.tenant_id = p_tenant_id
    AND e.at >= date_trunc('month', now())
    AND e.outcome <> 'budget_denied'
    AND (p_provider = '*' OR e.provider = p_provider);
$$;
REVOKE ALL ON FUNCTION public.provider_tenant_month_usage(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.provider_tenant_month_usage(uuid, text) TO service_role;

-- Queues an alert for every threshold the dealership has now reached, measured
-- after the admitted call was recorded. Each alert is queued once a month.
CREATE OR REPLACE FUNCTION public.provider_tenant_budget_thresholds(p_tenant_id uuid, p_provider text, p_caller text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
DECLARE
  v_tb    public.provider_tenant_budgets%ROWTYPE;
  v_calls integer;
  v_usd   numeric;
  v_pct   numeric;
  v_t     integer;
BEGIN
  IF p_tenant_id IS NULL THEN RETURN; END IF;
  FOR v_tb IN
    SELECT * FROM public.provider_tenant_budgets b
     WHERE b.tenant_id = p_tenant_id AND b.provider IN (p_provider, '*') AND b.mode <> 'off'
  LOOP
    SELECT u.calls, u.usd INTO v_calls, v_usd FROM public.provider_tenant_month_usage(p_tenant_id, v_tb.provider) u;
    v_pct := greatest(
      CASE WHEN v_tb.monthly_call_cap > 0 THEN 100.0 * v_calls / v_tb.monthly_call_cap
           WHEN v_tb.monthly_call_cap = 0 THEN 100 ELSE 0 END,
      CASE WHEN v_tb.monthly_usd_cap > 0 THEN 100.0 * v_usd / v_tb.monthly_usd_cap
           WHEN v_tb.monthly_usd_cap = 0 THEN 100 ELSE 0 END);
    FOREACH v_t IN ARRAY v_tb.alert_thresholds LOOP
      IF v_pct >= v_t THEN
        INSERT INTO public.provider_budget_alerts
          (tenant_id, provider, month, kind, threshold, mode, calls, usd, monthly_call_cap, monthly_usd_cap, caller)
        VALUES (p_tenant_id, v_tb.provider, date_trunc('month', now())::date, 'threshold', v_t, v_tb.mode, v_calls, v_usd,
                v_tb.monthly_call_cap, v_tb.monthly_usd_cap, p_caller)
        ON CONFLICT ON CONSTRAINT provider_budget_alerts_once DO NOTHING;
      END IF;
    END LOOP;
  END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.provider_tenant_budget_thresholds(uuid, text, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.provider_call_admit(p_provider text, p_product text, p_caller text, p_essential boolean DEFAULT false, p_tenant_id uuid DEFAULT NULL::uuid, p_vin text DEFAULT NULL::text, p_estimated_cost_usd numeric DEFAULT NULL::numeric)
 RETURNS TABLE(admitted boolean, event_id bigint, month_calls integer, monthly_call_cap integer, reserve_for_essential integer, reason text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_budget public.provider_call_budgets%ROWTYPE;
  v_tb     public.provider_tenant_budgets%ROWTYPE;
  v_count  integer := 0;
  v_month  timestamptz := date_trunc('month', now());
  v_id     bigint;
  v_reason text;
  v_est    numeric := p_estimated_cost_usd;
  v_calls  integer;
  v_usd    numeric;
  v_over   boolean;
BEGIN
  IF v_est IS NULL THEN
    SELECT u.usd_per_call INTO v_est FROM public.provider_unit_prices u
     WHERE u.provider = p_provider AND u.product IN (p_product, '*')
     ORDER BY (u.product = p_product) DESC LIMIT 1;
  END IF;

  -- Dealership budgets: the provider's own row and the all-providers row,
  -- serialised on the budget rows so two callers cannot both take the last
  -- slot.
  IF p_tenant_id IS NOT NULL THEN
    FOR v_tb IN
      SELECT * FROM public.provider_tenant_budgets b
       WHERE b.tenant_id = p_tenant_id AND b.provider IN (p_provider, '*') AND b.mode <> 'off'
       ORDER BY b.provider
       FOR UPDATE
    LOOP
      SELECT u.calls, u.usd INTO v_calls, v_usd FROM public.provider_tenant_month_usage(p_tenant_id, v_tb.provider) u;
      v_over := (v_tb.monthly_call_cap IS NOT NULL AND v_calls >= v_tb.monthly_call_cap)
             OR (v_tb.monthly_usd_cap IS NOT NULL AND v_usd + coalesce(v_est, 0) > v_tb.monthly_usd_cap);
      IF v_over AND v_tb.mode = 'enforce' AND (NOT p_essential OR v_tb.block_essential) THEN
        INSERT INTO public.provider_call_events
          (provider, product, caller, essential, tenant_id, vin, outcome, estimated_cost_usd, month_calls_before, note)
        VALUES
          (p_provider, p_product, p_caller, p_essential, p_tenant_id, p_vin, 'budget_denied', v_est, v_calls,
           'tenant_budget:' || v_tb.provider)
        RETURNING id INTO v_id;
        INSERT INTO public.provider_budget_alerts
          (tenant_id, provider, month, kind, threshold, mode, calls, usd, monthly_call_cap, monthly_usd_cap, caller)
        VALUES (p_tenant_id, v_tb.provider, v_month::date, 'call_denied', 0, v_tb.mode, v_calls, v_usd,
                v_tb.monthly_call_cap, v_tb.monthly_usd_cap, p_caller)
        ON CONFLICT ON CONSTRAINT provider_budget_alerts_once DO NOTHING;
        RETURN QUERY SELECT false, v_id, v_calls, v_tb.monthly_call_cap, NULL::integer, 'tenant_budget'::text;
        RETURN;
      END IF;
    END LOOP;
  END IF;

  -- Platform budget, as before.
  SELECT * INTO v_budget FROM public.provider_call_budgets
   WHERE provider = p_provider FOR UPDATE;

  IF NOT FOUND OR v_budget.enabled IS NOT TRUE THEN
    INSERT INTO public.provider_call_events
      (provider, product, caller, essential, tenant_id, vin, outcome, estimated_cost_usd, note)
    VALUES
      (p_provider, p_product, p_caller, p_essential, p_tenant_id, p_vin, 'admitted', v_est, 'ungated: no budget row or gate disabled')
    RETURNING id INTO v_id;
    PERFORM public.provider_tenant_budget_thresholds(p_tenant_id, p_provider, p_caller);
    RETURN QUERY SELECT true, v_id, NULL::integer, NULL::integer, NULL::integer, 'ungated'::text;
    RETURN;
  END IF;

  SELECT count(*)::integer INTO v_count FROM public.provider_call_events
   WHERE provider = p_provider AND at >= v_month AND outcome <> 'budget_denied';

  IF v_count >= v_budget.monthly_call_cap THEN
    v_reason := 'monthly_cap';
  ELSIF NOT p_essential AND v_count >= v_budget.monthly_call_cap - v_budget.reserve_for_essential THEN
    v_reason := 'reserve_for_essential';
  END IF;

  IF v_reason IS NOT NULL THEN
    INSERT INTO public.provider_call_events
      (provider, product, caller, essential, tenant_id, vin, outcome, estimated_cost_usd, month_calls_before, note)
    VALUES
      (p_provider, p_product, p_caller, p_essential, p_tenant_id, p_vin, 'budget_denied', v_est, v_count, v_reason)
    RETURNING id INTO v_id;
    RETURN QUERY SELECT false, v_id, v_count, v_budget.monthly_call_cap, v_budget.reserve_for_essential, v_reason;
    RETURN;
  END IF;

  INSERT INTO public.provider_call_events
    (provider, product, caller, essential, tenant_id, vin, outcome, estimated_cost_usd, month_calls_before)
  VALUES
    (p_provider, p_product, p_caller, p_essential, p_tenant_id, p_vin, 'admitted', v_est, v_count)
  RETURNING id INTO v_id;
  PERFORM public.provider_tenant_budget_thresholds(p_tenant_id, p_provider, p_caller);
  RETURN QUERY SELECT true, v_id, v_count, v_budget.monthly_call_cap, v_budget.reserve_for_essential, 'admitted'::text;
END
$function$;

-- ── Platform-admin writes, each audited ─────────────────────────────────

CREATE OR REPLACE FUNCTION public.platform_require_admin()
RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
DECLARE v_uid uuid := (SELECT auth.uid());
BEGIN
  IF v_uid IS NULL OR NOT public.has_role(v_uid, 'admin') THEN
    RAISE EXCEPTION 'platform admin required' USING ERRCODE = '42501';
  END IF;
  RETURN v_uid;
END $$;

CREATE OR REPLACE FUNCTION public.platform_set_tenant_budget(
  p_tenant_id uuid, p_provider text, p_mode text,
  p_monthly_call_cap integer DEFAULT NULL, p_monthly_usd_cap numeric DEFAULT NULL,
  p_alert_thresholds integer[] DEFAULT '{80,100}', p_block_essential boolean DEFAULT false, p_notes text DEFAULT NULL)
RETURNS public.provider_tenant_budgets
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
DECLARE
  v_uid uuid := public.platform_require_admin();
  v_before jsonb;
  v_row public.provider_tenant_budgets;
BEGIN
  SELECT to_jsonb(b) INTO v_before FROM public.provider_tenant_budgets b WHERE b.tenant_id = p_tenant_id AND b.provider = p_provider;
  INSERT INTO public.provider_tenant_budgets AS b
    (tenant_id, provider, mode, monthly_call_cap, monthly_usd_cap, alert_thresholds, block_essential, notes, updated_at, updated_by)
  VALUES (p_tenant_id, p_provider, p_mode, p_monthly_call_cap, p_monthly_usd_cap,
          coalesce((SELECT array_agg(DISTINCT t ORDER BY t) FROM unnest(p_alert_thresholds) t), '{}'),
          coalesce(p_block_essential, false), nullif(btrim(p_notes), ''), now(), v_uid)
  ON CONFLICT (tenant_id, provider) DO UPDATE SET
    mode = EXCLUDED.mode, monthly_call_cap = EXCLUDED.monthly_call_cap, monthly_usd_cap = EXCLUDED.monthly_usd_cap,
    alert_thresholds = EXCLUDED.alert_thresholds, block_essential = EXCLUDED.block_essential, notes = EXCLUDED.notes,
    updated_at = now(), updated_by = v_uid
  RETURNING * INTO v_row;
  INSERT INTO public.audit_log (action, entity_type, entity_id, store_id, user_id, details)
  VALUES ('provider_budget_changed', 'provider_tenant_budget', p_tenant_id::text || ':' || p_provider, p_tenant_id::text, v_uid,
          jsonb_build_object('before', v_before, 'after', to_jsonb(v_row)));
  RETURN v_row;
END $$;

CREATE OR REPLACE FUNCTION public.platform_delete_tenant_budget(p_tenant_id uuid, p_provider text)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
DECLARE
  v_uid uuid := public.platform_require_admin();
  v_before jsonb;
BEGIN
  DELETE FROM public.provider_tenant_budgets b WHERE b.tenant_id = p_tenant_id AND b.provider = p_provider
  RETURNING to_jsonb(b) INTO v_before;
  IF v_before IS NULL THEN RETURN false; END IF;
  INSERT INTO public.audit_log (action, entity_type, entity_id, store_id, user_id, details)
  VALUES ('provider_budget_removed', 'provider_tenant_budget', p_tenant_id::text || ':' || p_provider, p_tenant_id::text, v_uid,
          jsonb_build_object('before', v_before));
  RETURN true;
END $$;

CREATE OR REPLACE FUNCTION public.platform_set_unit_price(p_provider text, p_product text, p_usd_per_call numeric, p_notes text DEFAULT NULL)
RETURNS public.provider_unit_prices
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
DECLARE
  v_uid uuid := public.platform_require_admin();
  v_before jsonb;
  v_row public.provider_unit_prices;
BEGIN
  SELECT to_jsonb(u) INTO v_before FROM public.provider_unit_prices u WHERE u.provider = p_provider AND u.product = coalesce(nullif(p_product, ''), '*');
  INSERT INTO public.provider_unit_prices AS u (provider, product, usd_per_call, notes, updated_at, updated_by)
  VALUES (p_provider, coalesce(nullif(p_product, ''), '*'), p_usd_per_call, nullif(btrim(p_notes), ''), now(), v_uid)
  ON CONFLICT (provider, product) DO UPDATE SET usd_per_call = EXCLUDED.usd_per_call, notes = EXCLUDED.notes, updated_at = now(), updated_by = v_uid
  RETURNING * INTO v_row;
  INSERT INTO public.audit_log (action, entity_type, entity_id, user_id, details)
  VALUES ('provider_unit_price_changed', 'provider_unit_price', v_row.provider || ':' || v_row.product, v_uid,
          jsonb_build_object('before', v_before, 'after', to_jsonb(v_row)));
  RETURN v_row;
END $$;

CREATE OR REPLACE FUNCTION public.platform_set_alert_settings(
  p_email_enabled boolean, p_sms_enabled boolean, p_email_recipients text[], p_sms_recipients text[])
RETURNS public.platform_alert_settings
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
DECLARE
  v_uid uuid := public.platform_require_admin();
  v_emails text[] := coalesce((SELECT array_agg(DISTINCT lower(btrim(e))) FROM unnest(p_email_recipients) e WHERE btrim(e) <> ''), '{}');
  v_phones text[] := coalesce((SELECT array_agg(DISTINCT btrim(p)) FROM unnest(p_sms_recipients) p WHERE btrim(p) <> ''), '{}');
  v_before jsonb;
  v_row public.platform_alert_settings;
BEGIN
  IF EXISTS (SELECT 1 FROM unnest(v_emails) e WHERE e !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$') THEN
    RAISE EXCEPTION 'invalid email recipient' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(v_phones) p WHERE p !~ '^\+[1-9][0-9]{7,14}$') THEN
    RAISE EXCEPTION 'text message recipients must be in +15551234567 form' USING ERRCODE = '22023';
  END IF;
  IF p_email_enabled AND cardinality(v_emails) = 0 THEN
    RAISE EXCEPTION 'email alerts need at least one recipient' USING ERRCODE = '22023';
  END IF;
  IF p_sms_enabled AND cardinality(v_phones) = 0 THEN
    RAISE EXCEPTION 'text message alerts need at least one recipient' USING ERRCODE = '22023';
  END IF;
  SELECT to_jsonb(s) INTO v_before FROM public.platform_alert_settings s WHERE s.id;
  UPDATE public.platform_alert_settings SET
    email_enabled = p_email_enabled, sms_enabled = p_sms_enabled,
    email_recipients = v_emails, sms_recipients = v_phones, updated_at = now(), updated_by = v_uid
  WHERE id RETURNING * INTO v_row;
  INSERT INTO public.audit_log (action, entity_type, entity_id, user_id, details)
  VALUES ('platform_alert_settings_changed', 'platform_alert_settings', 'budget_alerts', v_uid,
          jsonb_build_object('before', v_before, 'after', to_jsonb(v_row)));
  RETURN v_row;
END $$;

-- Every dealership with a budget or with provider calls this month, per
-- provider, with month-to-date use.
CREATE OR REPLACE FUNCTION public.platform_provider_budget_overview()
RETURNS TABLE (tenant_id uuid, tenant_name text, provider text, mode text, monthly_call_cap integer,
               monthly_usd_cap numeric, alert_thresholds integer[], block_essential boolean, notes text,
               calls integer, usd numeric, denied integer, updated_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
BEGIN
  PERFORM public.platform_require_admin();
  RETURN QUERY
  WITH used AS (
    SELECT e.tenant_id, e.provider,
           count(*) FILTER (WHERE e.outcome <> 'budget_denied')::integer AS calls,
           coalesce(sum(e.estimated_cost_usd) FILTER (WHERE e.outcome <> 'budget_denied'), 0)::numeric AS usd,
           count(*) FILTER (WHERE e.outcome = 'budget_denied')::integer AS denied
    FROM public.provider_call_events e
    WHERE e.tenant_id IS NOT NULL AND e.at >= date_trunc('month', now())
    GROUP BY e.tenant_id, e.provider
  ), used_all AS (
    SELECT u.tenant_id, '*'::text AS provider, sum(u.calls)::integer AS calls, sum(u.usd)::numeric AS usd, sum(u.denied)::integer AS denied
    FROM used u GROUP BY u.tenant_id
  ), keys AS (
    SELECT b.tenant_id, b.provider FROM public.provider_tenant_budgets b
    UNION SELECT u.tenant_id, u.provider FROM used u
  )
  SELECT k.tenant_id, t.name, k.provider, b.mode, b.monthly_call_cap, b.monthly_usd_cap, b.alert_thresholds,
         b.block_essential, b.notes,
         coalesce(u.calls, ua.calls, 0), coalesce(u.usd, ua.usd, 0), coalesce(u.denied, ua.denied, 0), b.updated_at
  FROM keys k
  LEFT JOIN public.tenants t ON t.id = k.tenant_id
  LEFT JOIN public.provider_tenant_budgets b ON b.tenant_id = k.tenant_id AND b.provider = k.provider
  LEFT JOIN used u ON u.tenant_id = k.tenant_id AND u.provider = k.provider
  LEFT JOIN used_all ua ON ua.tenant_id = k.tenant_id AND k.provider = '*'
  ORDER BY t.name NULLS LAST, k.provider;
END $$;

REVOKE ALL ON FUNCTION public.platform_require_admin(), public.platform_set_tenant_budget(uuid, text, text, integer, numeric, integer[], boolean, text),
  public.platform_delete_tenant_budget(uuid, text), public.platform_set_unit_price(text, text, numeric, text),
  public.platform_set_alert_settings(boolean, boolean, text[], text[]), public.platform_provider_budget_overview()
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_set_tenant_budget(uuid, text, text, integer, numeric, integer[], boolean, text),
  public.platform_delete_tenant_budget(uuid, text), public.platform_set_unit_price(text, text, numeric, text),
  public.platform_set_alert_settings(boolean, boolean, text[], text[]), public.platform_provider_budget_overview()
  TO authenticated;

-- ── Delivery schedule: defined, not started ─────────────────────────────

CREATE OR REPLACE FUNCTION public.schedule_provider_budget_alerts(
  _cron_expr TEXT DEFAULT '*/10 * * * *', _supabase_url TEXT DEFAULT NULL, _service_key TEXT DEFAULT NULL)
RETURNS BIGINT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, vault, cron AS $$
DECLARE url TEXT; key TEXT; job_id BIGINT;
BEGIN
  IF _supabase_url IS NULL THEN
    SELECT decrypted_secret INTO url FROM vault.decrypted_secrets WHERE name = 'supabase_url' LIMIT 1;
  ELSE url := _supabase_url; END IF;
  IF _service_key IS NULL THEN
    SELECT decrypted_secret INTO key FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1;
  ELSE key := _service_key; END IF;
  IF url IS NULL OR key IS NULL THEN
    RAISE EXCEPTION 'supabase_url and service_role_key required (via args or Vault entries)';
  END IF;
  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'provider-budget-alerts';
  SELECT cron.schedule('provider-budget-alerts', _cron_expr, format(
    $job$
      SELECT net.http_post(
        url := %L,
        headers := jsonb_build_object('Content-Type','application/json','Authorization',%L),
        body := '{}'::jsonb,
        timeout_milliseconds := 60000
      );
    $job$,
    url || '/functions/v1/provider-budget-alerts',
    'Bearer ' || key
  )) INTO job_id;
  RETURN job_id;
END $$;
REVOKE ALL ON FUNCTION public.schedule_provider_budget_alerts(TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.schedule_provider_budget_alerts(TEXT, TEXT, TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public.unschedule_provider_budget_alerts()
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, cron AS $$
BEGIN DELETE FROM cron.job WHERE jobname = 'provider-budget-alerts'; END $$;
REVOKE ALL ON FUNCTION public.unschedule_provider_budget_alerts() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.unschedule_provider_budget_alerts() TO service_role;
