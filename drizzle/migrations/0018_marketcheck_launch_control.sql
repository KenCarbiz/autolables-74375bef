-- MarketCheck launch control (release/marketcheck-2026-11-02-ready).
--
-- One database-held switch decides whether any MarketCheck call may be
-- admitted. Applying this migration changes no live behaviour that spends
-- calls: the switch starts OFF and every MarketCheck admission is refused
-- until a platform admin activates an approved plan whose mandatory readiness
-- checks pass server-side. Production was already refusing every MarketCheck
-- call (provider_call_budgets cap 0, owner hold of 2026-10-31), so the
-- provider-call impact of applying this with the switch OFF is zero.
--
--   marketcheck_launch_plans      versioned, approved rollout plans: canary
--                                 store, call ceilings, tripwires, products,
--                                 approved callers, cron jobs, rollout order.
--   marketcheck_launch_control    the single switch row: state, emergency
--                                 stop, active stores, rollback snapshots.
--   marketcheck_launch_events     append-only audit of every launch action.
--   marketcheck_launch_checks     attested readiness evidence that SQL cannot
--                                 compute (renders, print QA, test runs).
--   provider_gate_heartbeats      which gate version each caller runs, seen
--                                 at admission time (proves deployed code).
--
-- Enforcement is in the database, not in callers:
--   * provider_call_admit (the signature every deployed function calls today)
--     keeps its exact body as provider_call_admit_core. The old name now
--     refuses every MarketCheck admission ("gate_upgrade_required"), so a
--     function deployed before this release cannot spend a MarketCheck call
--     even if its cron is re-enabled. Other providers are unchanged.
--   * provider_call_admit_v2 is the only path that can admit MarketCheck. It
--     checks the emergency stop, launch state, approved caller, approved
--     tenant, canary ceiling and tripwires before the existing budget.
--   * provider_reserve (the account coordinator) refuses to create a
--     reservation while the launch gate is closed (trigger on
--     provider_requests), which also covers staff AI/MCP requests.
--   * The emergency stop is a column. Setting it, by RPC or by a single
--     UPDATE from the SQL editor, refuses the next admission; no deploy and
--     no scheduler cooperation is needed.
--
-- Nothing here deletes inventory, documents, leads or audit history.

-- ── Tables ──────────────────────────────────────────────────────────────

CREATE TABLE public.marketcheck_launch_plans (
  version integer PRIMARY KEY CHECK (version > 0),
  title text NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','retired')),
  canary_store_id uuid NOT NULL REFERENCES public.dealer_stores(id),
  -- Hard ceiling on provider calls admitted during the canary. Reaching it
  -- pauses the launch for review; it is never raised automatically.
  canary_max_calls integer NOT NULL CHECK (canary_max_calls BETWEEN 1 AND 1000),
  canary_window_hours integer NOT NULL DEFAULT 24 CHECK (canary_window_hours BETWEEN 1 AND 336),
  hourly_call_ceiling integer NOT NULL CHECK (hourly_call_ceiling BETWEEN 1 AND 1000),
  daily_call_ceiling integer NOT NULL CHECK (daily_call_ceiling BETWEEN 1 AND 5000),
  error_tripwire_per_hour integer NOT NULL DEFAULT 5 CHECK (error_tripwire_per_hour BETWEEN 1 AND 1000),
  uncertain_tripwire_per_hour integer NOT NULL DEFAULT 3 CHECK (uncertain_tripwire_per_hour BETWEEN 1 AND 1000),
  feed_max_age_hours integer NOT NULL DEFAULT 9 CHECK (feed_max_age_hours BETWEEN 1 AND 168),
  required_gate_version text NOT NULL,
  products text[] NOT NULL CHECK (cardinality(products) > 0),
  allowed_callers text[] NOT NULL CHECK (cardinality(allowed_callers) > 0),
  allow_staff_ai boolean NOT NULL DEFAULT false,
  -- [{"jobname":"marketcheck-sync","schedule":"7 */4 * * *"}]: the only cron
  -- jobs activation turns on, with the schedule it sets.
  cron_jobs jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(cron_jobs) = 'array'),
  -- [{"store_id":..., "order":1, "min_hours_after_previous":24}] after the canary.
  rollout jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(rollout) = 'array'),
  notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  approved_by uuid,
  approved_at timestamptz,
  CHECK (hourly_call_ceiling <= daily_call_ceiling),
  CHECK (status <> 'approved' OR (approved_by IS NOT NULL AND approved_at IS NOT NULL))
);

CREATE TABLE public.marketcheck_launch_control (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  state text NOT NULL DEFAULT 'not_ready' CHECK (state IN (
    'not_ready','ready_to_activate','activating_canary','pilot_active','expanding','paused','emergency_stop','activation_failed')),
  emergency_stop boolean NOT NULL DEFAULT false,
  plan_version integer REFERENCES public.marketcheck_launch_plans(version),
  active_store_ids uuid[] NOT NULL DEFAULT '{}',
  activated_at timestamptz,
  activated_by uuid,
  canary_started_at timestamptz,
  pilot_started_at timestamptz,
  last_expanded_at timestamptz,
  paused_reason text,
  paused_at timestamptz,
  stopped_at timestamptz,
  stopped_by uuid,
  stop_reason text,
  -- Rollback snapshots taken at activation: the provider_call_budgets row,
  -- the store policy modes and the cron job states this release changed.
  previous_budget jsonb,
  previous_policies jsonb,
  previous_cron jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  CHECK (NOT emergency_stop OR state = 'emergency_stop')
);
INSERT INTO public.marketcheck_launch_control (id) VALUES (1) ON CONFLICT DO NOTHING;

CREATE TABLE public.marketcheck_launch_events (
  id bigserial PRIMARY KEY,
  at timestamptz NOT NULL DEFAULT now(),
  actor uuid,
  actor_kind text NOT NULL DEFAULT 'user' CHECK (actor_kind IN ('user','service','gate')),
  action text NOT NULL,
  from_state text,
  to_state text,
  plan_version integer,
  result text NOT NULL CHECK (result IN ('ok','refused','failed','info')),
  detail jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX idx_marketcheck_launch_events_at ON public.marketcheck_launch_events (at DESC);

CREATE TABLE public.marketcheck_launch_checks (
  check_key text PRIMARY KEY CHECK (check_key ~ '^[a-z0-9_]{3,60}$'),
  status text NOT NULL CHECK (status IN ('passed','failed')),
  summary text NOT NULL,
  evidence_ref text,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  verified_by uuid,
  verified_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.provider_gate_heartbeats (
  caller text PRIMARY KEY,
  gate_version text NOT NULL,
  last_seen timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.marketcheck_launch_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketcheck_launch_control ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketcheck_launch_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketcheck_launch_checks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.provider_gate_heartbeats ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.marketcheck_launch_plans, public.marketcheck_launch_control, public.marketcheck_launch_events,
  public.marketcheck_launch_checks, public.provider_gate_heartbeats FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.marketcheck_launch_plans, public.marketcheck_launch_control, public.marketcheck_launch_events,
  public.marketcheck_launch_checks, public.provider_gate_heartbeats TO authenticated;
CREATE POLICY "launch plans platform admin read" ON public.marketcheck_launch_plans FOR SELECT TO authenticated
  USING (public.has_role((SELECT auth.uid()), 'admin'::public.app_role));
CREATE POLICY "launch control platform admin read" ON public.marketcheck_launch_control FOR SELECT TO authenticated
  USING (public.has_role((SELECT auth.uid()), 'admin'::public.app_role));
CREATE POLICY "launch events platform admin read" ON public.marketcheck_launch_events FOR SELECT TO authenticated
  USING (public.has_role((SELECT auth.uid()), 'admin'::public.app_role));
CREATE POLICY "launch checks platform admin read" ON public.marketcheck_launch_checks FOR SELECT TO authenticated
  USING (public.has_role((SELECT auth.uid()), 'admin'::public.app_role));
CREATE POLICY "gate heartbeats platform admin read" ON public.provider_gate_heartbeats FOR SELECT TO authenticated
  USING (public.has_role((SELECT auth.uid()), 'admin'::public.app_role));

-- Audit rows are never edited or removed.
CREATE OR REPLACE FUNCTION public.marketcheck_launch_events_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'marketcheck_launch_events is append-only'; END $$;
CREATE TRIGGER marketcheck_launch_events_append_only BEFORE UPDATE OR DELETE ON public.marketcheck_launch_events
  FOR EACH ROW EXECUTE FUNCTION public.marketcheck_launch_events_append_only();

-- ── Helpers ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.marketcheck_launch_log(p_action text, p_result text, p_from text, p_to text, p_plan integer, p_detail jsonb, p_kind text DEFAULT NULL)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO marketcheck_launch_events (actor, actor_kind, action, from_state, to_state, plan_version, result, detail)
  VALUES ((SELECT auth.uid()), COALESCE(p_kind, CASE WHEN (SELECT auth.uid()) IS NULL THEN 'service' ELSE 'user' END),
          p_action, p_from, p_to, p_plan, p_result, COALESCE(p_detail, '{}'::jsonb));
$$;

-- Platform admin, or the service role (edge functions, SQL editor) for the
-- stop path only.
CREATE OR REPLACE FUNCTION public.marketcheck_launch_actor_is_admin() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT (SELECT auth.uid()) IS NOT NULL AND has_role((SELECT auth.uid()), 'admin'::app_role);
$$;

CREATE OR REPLACE FUNCTION public.marketcheck_launch_is_active_state(p_state text) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$ SELECT p_state IN ('activating_canary','pilot_active','expanding') $$;

-- Cron is optional in scratch databases; every cron touch goes through these.
CREATE OR REPLACE FUNCTION public.marketcheck_launch_cron_state(p_jobname text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE r jsonb;
BEGIN
  IF to_regclass('cron.job') IS NULL THEN RETURN NULL; END IF;
  EXECUTE 'SELECT jsonb_build_object(''jobid'', jobid, ''jobname'', jobname, ''schedule'', schedule, ''active'', active) FROM cron.job WHERE jobname = $1 ORDER BY jobid LIMIT 1'
    INTO r USING p_jobname;
  RETURN r;
END $$;

CREATE OR REPLACE FUNCTION public.marketcheck_launch_cron_set(p_jobname text, p_schedule text, p_active boolean) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id bigint;
BEGIN
  IF to_regclass('cron.job') IS NULL THEN RETURN false; END IF;
  EXECUTE 'SELECT jobid FROM cron.job WHERE jobname = $1 ORDER BY jobid LIMIT 1' INTO v_id USING p_jobname;
  IF v_id IS NULL THEN RETURN false; END IF;
  EXECUTE 'SELECT cron.alter_job($1, schedule => $2, active => $3)' USING v_id, p_schedule, p_active;
  RETURN true;
END $$;

-- Every cron job that can reach a MarketCheck caller. The emergency stop
-- deactivates all of them, not only the ones the plan enabled.
CREATE OR REPLACE FUNCTION public.marketcheck_launch_cron_jobs() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE r jsonb;
BEGIN
  IF to_regclass('cron.job') IS NULL THEN RETURN '[]'::jsonb; END IF;
  EXECUTE $q$SELECT COALESCE(jsonb_agg(jsonb_build_object('jobid', jobid, 'jobname', jobname, 'schedule', schedule, 'active', active,
             'target', substring(command from '/functions/v1/([a-z0-9-]+)')) ORDER BY jobid), '[]'::jsonb)
      FROM cron.job WHERE command ~ '/functions/v1/(marketcheck-[a-z-]+|enrich-sweep|vehicle-enrich|specs-backfill|market-valuation-write|crawl-advertised-prices)'$q$ INTO r;
  RETURN r;
END $$;

-- ── The launch gate ─────────────────────────────────────────────────────

-- Returns NULL when a MarketCheck call may proceed to the budget, otherwise
-- the refusal reason. Locks the control row so canary counting is exact
-- under concurrency, and pauses the launch itself when a tripwire fires.
CREATE OR REPLACE FUNCTION public.marketcheck_launch_gate(p_caller text, p_tenant_id uuid, p_channel text DEFAULT 'rest')
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  c marketcheck_launch_control%ROWTYPE; p marketcheck_launch_plans%ROWTYPE;
  v_tenants uuid[]; v_n integer; v_trip text;
BEGIN
  SELECT * INTO c FROM marketcheck_launch_control WHERE id = 1 FOR UPDATE;
  IF NOT FOUND THEN RETURN 'launch_control_missing'; END IF;
  IF c.emergency_stop THEN RETURN 'emergency_stop'; END IF;
  IF NOT marketcheck_launch_is_active_state(c.state) THEN RETURN 'launch_inactive'; END IF;
  SELECT * INTO p FROM marketcheck_launch_plans WHERE version = c.plan_version AND status = 'approved';
  IF NOT FOUND THEN RETURN 'launch_plan_missing'; END IF;
  IF p_channel <> 'rest' AND NOT p.allow_staff_ai THEN RETURN 'launch_staff_ai_not_approved'; END IF;
  IF p_channel = 'rest' AND NOT (p_caller = ANY (p.allowed_callers)) THEN RETURN 'launch_caller_not_approved'; END IF;
  SELECT array_agg(DISTINCT tenant_id) INTO v_tenants FROM dealer_stores WHERE id = ANY (c.active_store_ids) AND status = 'active';
  IF p_tenant_id IS NULL OR v_tenants IS NULL OR NOT (p_tenant_id = ANY (v_tenants)) THEN RETURN 'launch_tenant_not_approved'; END IF;

  -- Tripwires. Any one pauses the launch; nothing resumes it automatically.
  IF c.state = 'activating_canary' THEN
    SELECT count(*) INTO v_n FROM provider_call_events
     WHERE provider = 'marketcheck' AND at >= c.canary_started_at AND outcome <> 'budget_denied';
    IF v_n >= p.canary_max_calls THEN v_trip := 'canary_ceiling_reached';
    ELSIF now() > c.canary_started_at + make_interval(hours => p.canary_window_hours) THEN v_trip := 'canary_window_elapsed';
    END IF;
  END IF;
  IF v_trip IS NULL THEN
    SELECT count(*) INTO v_n FROM provider_call_events
     WHERE provider = 'marketcheck' AND at > now() - interval '1 hour' AND outcome <> 'budget_denied';
    IF v_n >= p.hourly_call_ceiling THEN v_trip := 'hourly_ceiling'; END IF;
  END IF;
  IF v_trip IS NULL THEN
    SELECT count(*) INTO v_n FROM provider_call_events
     WHERE provider = 'marketcheck' AND at > now() - interval '24 hours' AND outcome <> 'budget_denied';
    IF v_n >= p.daily_call_ceiling THEN v_trip := 'daily_ceiling'; END IF;
  END IF;
  IF v_trip IS NULL THEN
    SELECT count(*) INTO v_n FROM provider_call_events
     WHERE provider = 'marketcheck' AND at > now() - interval '1 hour'
       AND outcome IN ('refused_quota','refused_rate','refused_auth','provider_error','transport_error');
    IF v_n >= p.error_tripwire_per_hour THEN v_trip := 'provider_errors'; END IF;
  END IF;
  IF v_trip IS NULL AND to_regclass('public.provider_requests') IS NOT NULL THEN
    SELECT count(*) INTO v_n FROM provider_requests
     WHERE account_ref = 'marketcheck_primary' AND status = 'billing_uncertain' AND settled_at > now() - interval '1 hour';
    IF v_n >= p.uncertain_tripwire_per_hour THEN v_trip := 'billing_uncertain'; END IF;
  END IF;
  IF v_trip IS NULL AND EXISTS (SELECT 1 FROM inventory_feed_controls WHERE emergency_stop OR ingestion_paused) THEN
    v_trip := 'feed_paused_or_stopped';
  END IF;
  IF v_trip IS NULL AND EXISTS (
       SELECT 1 FROM inventory_store_snapshots s
        WHERE s.store_id = ANY (c.active_store_ids) AND s.status IN ('held','quarantined','rejected','failed')
          AND s.created_at > COALESCE((SELECT max(a.applied_at) FROM inventory_store_snapshots a WHERE a.store_id = s.store_id AND a.status = 'applied'), '-infinity')) THEN
    v_trip := 'feed_integrity_hold';
  END IF;

  IF v_trip IS NOT NULL THEN
    UPDATE marketcheck_launch_control SET state = 'paused', paused_reason = v_trip, paused_at = now(), updated_at = now() WHERE id = 1;
    PERFORM marketcheck_launch_log('tripwire_pause', 'ok', c.state, 'paused', c.plan_version,
      jsonb_build_object('tripwire', v_trip, 'caller', p_caller), 'gate');
    RETURN 'launch_paused_' || v_trip;
  END IF;
  RETURN NULL;
END $$;

-- ── Admission: the old entry point keeps its body under a new name ───────

ALTER FUNCTION public.provider_call_admit(text, text, text, boolean, uuid, text, numeric) RENAME TO provider_call_admit_core;
REVOKE ALL ON FUNCTION public.provider_call_admit_core(text, text, text, boolean, uuid, text, numeric) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.provider_call_admit_refuse(p_provider text, p_product text, p_caller text, p_essential boolean, p_tenant_id uuid, p_vin text, p_cost numeric, p_reason text)
RETURNS TABLE (admitted boolean, event_id bigint, month_calls integer, monthly_call_cap integer, reserve_for_essential integer, reason text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_id bigint;
BEGIN
  INSERT INTO public.provider_call_events (provider, product, caller, essential, tenant_id, vin, outcome, estimated_cost_usd, note)
  VALUES (p_provider, p_product, p_caller, p_essential, p_tenant_id, p_vin, 'budget_denied', p_cost, p_reason)
  RETURNING id INTO v_id;
  RETURN QUERY SELECT false, v_id, NULL::integer, NULL::integer, NULL::integer, p_reason;
END $$;
REVOKE ALL ON FUNCTION public.provider_call_admit_refuse(text, text, text, boolean, uuid, text, numeric, text) FROM PUBLIC, anon, authenticated;

-- Functions deployed before this release still call this signature. They may
-- keep using other providers, but never MarketCheck.
CREATE FUNCTION public.provider_call_admit(
  p_provider text, p_product text, p_caller text, p_essential boolean DEFAULT false,
  p_tenant_id uuid DEFAULT NULL, p_vin text DEFAULT NULL, p_estimated_cost_usd numeric DEFAULT NULL
) RETURNS TABLE (admitted boolean, event_id bigint, month_calls integer, monthly_call_cap integer, reserve_for_essential integer, reason text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF p_provider = 'marketcheck' THEN
    RETURN QUERY SELECT * FROM public.provider_call_admit_refuse(p_provider, p_product, p_caller, p_essential, p_tenant_id, p_vin, p_estimated_cost_usd, 'gate_upgrade_required');
    RETURN;
  END IF;
  RETURN QUERY SELECT * FROM public.provider_call_admit_core(p_provider, p_product, p_caller, p_essential, p_tenant_id, p_vin, p_estimated_cost_usd);
END $$;
REVOKE ALL ON FUNCTION public.provider_call_admit(text, text, text, boolean, uuid, text, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.provider_call_admit(text, text, text, boolean, uuid, text, numeric) TO service_role;

CREATE OR REPLACE FUNCTION public.provider_call_admit_v2(
  p_provider text, p_product text, p_caller text, p_gate_version text, p_essential boolean DEFAULT false,
  p_tenant_id uuid DEFAULT NULL, p_vin text DEFAULT NULL, p_estimated_cost_usd numeric DEFAULT NULL
) RETURNS TABLE (admitted boolean, event_id bigint, month_calls integer, monthly_call_cap integer, reserve_for_essential integer, reason text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_reason text;
BEGIN
  IF p_gate_version IS NULL OR length(p_gate_version) NOT BETWEEN 1 AND 40 THEN
    RETURN QUERY SELECT * FROM public.provider_call_admit_refuse(p_provider, p_product, p_caller, p_essential, p_tenant_id, p_vin, p_estimated_cost_usd, 'gate_version_missing');
    RETURN;
  END IF;
  INSERT INTO public.provider_gate_heartbeats (caller, gate_version, last_seen) VALUES (left(p_caller, 80), p_gate_version, now())
  ON CONFLICT (caller) DO UPDATE SET gate_version = EXCLUDED.gate_version, last_seen = EXCLUDED.last_seen;
  IF p_provider = 'marketcheck' THEN
    v_reason := public.marketcheck_launch_gate(p_caller, p_tenant_id, 'rest');
    IF v_reason IS NOT NULL THEN
      RETURN QUERY SELECT * FROM public.provider_call_admit_refuse(p_provider, p_product, p_caller, p_essential, p_tenant_id, p_vin, p_estimated_cost_usd, v_reason);
      RETURN;
    END IF;
  END IF;
  RETURN QUERY SELECT * FROM public.provider_call_admit_core(p_provider, p_product, p_caller, p_essential, p_tenant_id, p_vin, p_estimated_cost_usd);
END $$;
REVOKE ALL ON FUNCTION public.provider_call_admit_v2(text, text, text, text, boolean, uuid, text, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.provider_call_admit_v2(text, text, text, text, boolean, uuid, text, numeric) TO service_role;

-- The account coordinator cannot reserve while the gate is closed. This
-- covers any path into provider_reserve, including staff AI/MCP requests.
CREATE OR REPLACE FUNCTION public.provider_requests_launch_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_reason text;
BEGIN
  IF NEW.status <> 'reserved' OR NEW.account_ref <> 'marketcheck_primary' THEN RETURN NEW; END IF;
  IF NEW.channel = 'rest' THEN
    -- REST callers were already admitted by provider_call_admit_v2 in this
    -- request; re-check only the stop and the state so a stop between the two
    -- calls still refuses.
    IF EXISTS (SELECT 1 FROM marketcheck_launch_control WHERE id = 1 AND (emergency_stop OR NOT marketcheck_launch_is_active_state(state))) THEN
      v_reason := 'launch_gate_closed';
    END IF;
  ELSE
    v_reason := marketcheck_launch_gate(NEW.caller, NEW.tenant_id, NEW.channel);
  END IF;
  IF v_reason IS NOT NULL THEN
    RAISE EXCEPTION 'launch_gate_closed: %', v_reason USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER provider_requests_launch_guard BEFORE INSERT ON public.provider_requests
  FOR EACH ROW EXECUTE FUNCTION public.provider_requests_launch_guard();

-- ── Budget reconciliation ───────────────────────────────────────────────
-- The older gate's essential reserve (250) and the coordinator's protected
-- reserve (1,000) disagreed. The coordinator is the one account meter; the
-- older row follows it. The cap stays where the owner put it (0 = hold) until
-- activation sets it from the account quota.
UPDATE public.provider_call_budgets b SET reserve_for_essential = LEAST(a.protected_reserve, GREATEST(b.monthly_call_cap, a.protected_reserve)),
  notes = COALESCE(b.notes, '') || E'\n0018: essential reserve reconciled to the account coordinator protected reserve (' || a.protected_reserve || ').',
  updated_at = now()
FROM public.provider_accounts a WHERE b.provider = 'marketcheck' AND a.account_ref = 'marketcheck_primary' AND b.reserve_for_essential <> a.protected_reserve;

CREATE OR REPLACE FUNCTION public.provider_accounts_sync_budget_reserve() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.account_ref = 'marketcheck_primary' AND NEW.protected_reserve IS DISTINCT FROM OLD.protected_reserve THEN
    UPDATE provider_call_budgets SET reserve_for_essential = NEW.protected_reserve, updated_at = now() WHERE provider = 'marketcheck';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER provider_accounts_sync_budget_reserve AFTER UPDATE OF protected_reserve ON public.provider_accounts
  FOR EACH ROW EXECUTE FUNCTION public.provider_accounts_sync_budget_reserve();

-- ── Readiness ───────────────────────────────────────────────────────────

-- Attested checks are valid for 7 days. Each entry: key, label, mandatory,
-- status (passed | failed | unverified), summary, detail.
CREATE OR REPLACE FUNCTION public.marketcheck_launch_readiness(p_plan_version integer DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  c marketcheck_launch_control%ROWTYPE; p marketcheck_launch_plans%ROWTYPE; a provider_accounts%ROWTYPE; b provider_call_budgets%ROWTYPE;
  pol store_enrichment_policies%ROWTYPE; v jsonb := '[]'::jsonb; v_ok boolean; v_detail jsonb; v_n integer; v_m integer; v_txt text;
  v_last_applied timestamptz; v_missing text[]; v_att marketcheck_launch_checks%ROWTYPE; v_cron jsonb; k text;
BEGIN
  SELECT * INTO c FROM marketcheck_launch_control WHERE id = 1;
  SELECT * INTO p FROM marketcheck_launch_plans WHERE version = COALESCE(p_plan_version, c.plan_version,
    (SELECT max(version) FROM marketcheck_launch_plans WHERE status = 'approved'));
  SELECT * INTO a FROM provider_accounts WHERE account_ref = 'marketcheck_primary';
  SELECT * INTO b FROM provider_call_budgets WHERE provider = 'marketcheck';

  -- 1. Database objects this release depends on.
  v_missing := ARRAY(SELECT x FROM unnest(ARRAY[
      'public.provider_reserve(text,text,text,text,integer,uuid,uuid,text,text,numeric,boolean,bigint,integer,jsonb)',
      'public.provider_settle_event(bigint,text,integer,jsonb)', 'public.provider_reconcile_account(text,integer,integer,integer,timestamp with time zone)',
      'public.store_enrichment_admit(uuid,text,text,text,text,numeric)', 'public.provider_call_admit_v2(text,text,text,text,boolean,uuid,text,numeric)']) x
    WHERE to_regprocedure(x) IS NULL)
    || ARRAY(SELECT x FROM unnest(ARRAY['public.inventory_store_snapshots','public.inventory_source_mappings','public.store_enrichment_policies',
      'public.provider_requests','public.provider_product_catalog']) x WHERE to_regclass(x) IS NULL);
  v := v || jsonb_build_object('key','migrations','label','Database migrations','mandatory',true,
    'status', CASE WHEN cardinality(v_missing) = 0 THEN 'passed' ELSE 'failed' END,
    'summary', CASE WHEN cardinality(v_missing) = 0 THEN 'Coordinator, store gate, feed guards and launch gate are installed.' ELSE 'Missing: ' || array_to_string(v_missing, ', ') END);

  -- 2. Account coordinator configured and the two meters agree.
  v_ok := a.account_ref IS NOT NULL AND a.monthly_call_quota > 0 AND b.provider IS NOT NULL AND b.enabled AND b.reserve_for_essential = a.protected_reserve;
  v := v || jsonb_build_object('key','coordinator','label','Account budget coordinator','mandatory',true,
    'status', CASE WHEN v_ok THEN 'passed' ELSE 'failed' END,
    'summary', CASE WHEN a.account_ref IS NULL THEN 'No marketcheck_primary account row.'
      WHEN b.provider IS NULL THEN 'No provider_call_budgets row for marketcheck.'
      WHEN NOT b.enabled THEN 'The platform budget gate is disabled.'
      WHEN b.reserve_for_essential <> a.protected_reserve THEN format('Reserves disagree: budget %s, coordinator %s.', b.reserve_for_essential, a.protected_reserve)
      ELSE format('Quota %s, protected reserve %s, floors %s, USD cap %s.', a.monthly_call_quota, a.protected_reserve, a.priority_floors, COALESCE(a.monthly_usd_cap::text, 'none')) END);

  -- 3. Provider-evidenced quota for the current period.
  v_ok := a.provider_reported_at IS NOT NULL AND a.provider_reported_at > now() - interval '3 days'
          AND a.provider_reported_remaining IS NOT NULL AND (a.provider_reset_at IS NULL OR a.provider_reset_at > now());
  v := v || jsonb_build_object('key','quota_known','label','Monthly quota and remaining calls','mandatory',true,
    'status', CASE WHEN v_ok THEN 'passed' WHEN a.provider_reported_at IS NULL THEN 'unverified' ELSE 'failed' END,
    'summary', CASE WHEN a.provider_reported_at IS NULL THEN 'MarketCheck has never reported usage. Record the figures from the provider account page (no API call).'
      WHEN NOT v_ok THEN format('Provider figures are stale (reported %s).', a.provider_reported_at)
      ELSE format('Provider reports %s remaining of %s (reported %s).', a.provider_reported_remaining, COALESCE(a.provider_reported_limit::text, '?'), a.provider_reported_at) END,
    'detail', jsonb_build_object('limit', a.provider_reported_limit, 'used', a.provider_reported_used, 'remaining', a.provider_reported_remaining, 'reset_at', a.provider_reset_at, 'reported_at', a.provider_reported_at));

  -- 4. Plan approved.
  v := v || jsonb_build_object('key','plan','label','Approved rollout plan','mandatory',true,
    'status', CASE WHEN p.version IS NOT NULL AND p.status = 'approved' THEN 'passed' WHEN p.version IS NULL THEN 'unverified' ELSE 'failed' END,
    'summary', CASE WHEN p.version IS NULL THEN 'No rollout plan.' WHEN p.status <> 'approved' THEN format('Plan v%s is %s.', p.version, p.status)
      ELSE format('Plan v%s approved %s.', p.version, p.approved_at) END);

  -- 5. Provider entitlements for the plan's products.
  v_missing := ARRAY(SELECT x FROM unnest(COALESCE(p.products, '{}')) x
    WHERE NOT EXISTS (SELECT 1 FROM provider_product_catalog pc WHERE pc.account_ref = 'marketcheck_primary' AND pc.product_key = x AND pc.verified_at IS NOT NULL));
  v := v || jsonb_build_object('key','entitlements','label','Provider entitlements for enabled products','mandatory',true,
    'status', CASE WHEN p.version IS NULL THEN 'unverified' WHEN cardinality(v_missing) = 0 THEN 'passed' ELSE 'failed' END,
    'summary', CASE WHEN p.version IS NULL THEN 'No plan products to verify.' WHEN cardinality(v_missing) = 0 THEN 'Every plan product has a verified catalog entry.'
      ELSE 'Not verified in the product catalog: ' || array_to_string(v_missing, ', ') END);

  -- 6. Six rooftop feed mappings: one approved, matching mapping per active store.
  SELECT count(*), count(*) FILTER (WHERE m.evidence->'approved_comparison'->>'verdict' = 'match')
    INTO v_n, v_m
    FROM inventory_source_mappings m JOIN dealer_stores s ON s.id = m.store_id
   WHERE m.status = 'approved' AND s.status = 'active';
  v_ok := NOT EXISTS (
    SELECT store_id FROM inventory_source_mappings WHERE status = 'approved' GROUP BY store_id HAVING count(*) > 1
    UNION ALL SELECT NULL FROM inventory_source_mappings WHERE status = 'approved' GROUP BY provider, source_dealer_id HAVING count(*) > 1);
  v := v || jsonb_build_object('key','feed_mappings','label','Six rooftop feed mappings','mandatory',true,
    'status', CASE WHEN v_n >= 6 AND v_m = v_n AND v_ok THEN 'passed' ELSE 'failed' END,
    'summary', format('%s approved mappings to active stores, %s with a matching identity%s.', v_n, v_m, CASE WHEN v_ok THEN '' ELSE '; a store or DealerId is mapped twice' END));

  -- 7. Canary store feed fresh and not held.
  IF p.version IS NOT NULL THEN
    SELECT max(applied_at) INTO v_last_applied FROM inventory_store_snapshots WHERE store_id = p.canary_store_id AND status = 'applied';
    SELECT count(*) INTO v_n FROM inventory_store_snapshots WHERE store_id = p.canary_store_id AND status IN ('held','quarantined','rejected','failed')
       AND created_at > COALESCE(v_last_applied, '-infinity');
    v_ok := v_last_applied IS NOT NULL AND v_last_applied > now() - make_interval(hours => p.feed_max_age_hours) AND v_n = 0;
  ELSE v_ok := false; END IF;
  v := v || jsonb_build_object('key','primary_feed','label','Primary feed reconciliation','mandatory',true,
    'status', CASE WHEN p.version IS NULL THEN 'unverified' WHEN v_ok THEN 'passed' ELSE 'failed' END,
    'summary', CASE WHEN p.version IS NULL THEN 'No canary store selected.' WHEN v_last_applied IS NULL THEN 'The canary store has never applied a feed snapshot.'
      WHEN v_n > 0 THEN format('%s held or rejected snapshot(s) newer than the last applied one.', v_n)
      WHEN NOT v_ok THEN format('Last applied snapshot %s is older than %s hours.', v_last_applied, p.feed_max_age_hours)
      ELSE format('Last applied snapshot %s.', v_last_applied) END);

  -- 8. Canary store MarketCheck policy prepared (rooftop verified, limits set).
  IF p.version IS NOT NULL THEN SELECT * INTO pol FROM store_enrichment_policies WHERE store_id = p.canary_store_id; END IF;
  v_ok := pol.store_id IS NOT NULL AND pol.mc_rooftop_verified_at IS NOT NULL AND pol.credential_ref IS NOT NULL
          AND pol.allowed_products @> p.products AND pol.daily_request_limit > 0 AND pol.monthly_request_cap > 0
          AND pol.daily_request_limit <= p.daily_call_ceiling;
  v := v || jsonb_build_object('key','canary_policy','label','Canary store MarketCheck policy','mandatory',true,
    'status', CASE WHEN p.version IS NULL THEN 'unverified' WHEN v_ok THEN 'passed' ELSE 'failed' END,
    'summary', CASE WHEN p.version IS NULL THEN 'No canary store selected.' WHEN pol.store_id IS NULL THEN 'No store enrichment policy for the canary store.'
      WHEN pol.mc_rooftop_verified_at IS NULL THEN 'The canary store MarketCheck rooftop ID is not verified.'
      WHEN NOT (pol.allowed_products @> p.products) THEN 'The store policy does not allow every plan product.'
      WHEN NOT v_ok THEN 'Store daily/monthly limits are missing or above the plan ceiling.'
      ELSE format('Rooftop %s verified; %s/day, %s/month, mode %s.', pol.mc_rooftop_id, pol.daily_request_limit, pol.monthly_request_cap, pol.mode) END);

  -- 9. Schedulers: no duplicate MarketCheck or feed jobs; feed worker scheduled.
  v_cron := marketcheck_launch_cron_jobs();
  IF to_regclass('cron.job') IS NULL THEN
    v := v || jsonb_build_object('key','schedulers','label','Schedulers and duplicate-job checks','mandatory',true,'status','unverified','summary','pg_cron is not installed here.');
  ELSE
    EXECUTE $q$SELECT count(*) FROM (SELECT substring(command from '/functions/v1/([a-z0-9-]+)') t FROM cron.job WHERE active AND command ~ '/functions/v1/'
              GROUP BY 1 HAVING count(*) > 1) d$q$ INTO v_n;
    EXECUTE $q$SELECT count(*) FROM cron.job WHERE active AND command ~ '/functions/v1/files-inventory-worker'$q$ INTO v_m;
    v := v || jsonb_build_object('key','schedulers','label','Schedulers and duplicate-job checks','mandatory',true,
      'status', CASE WHEN v_n = 0 AND v_m = 1 THEN 'passed' ELSE 'failed' END,
      'summary', CASE WHEN v_n > 0 THEN format('%s function(s) have more than one active cron job.', v_n)
        WHEN v_m = 0 THEN 'The Files.com inventory worker has no active schedule, so feeds are not imported on cadence.'
        ELSE 'One feed worker schedule; no duplicate jobs.' END,
      'detail', jsonb_build_object('marketcheck_jobs', v_cron));
  END IF;

  -- 10. Deployed gate version: every approved caller seen on the required version.
  IF p.version IS NOT NULL THEN
    v_missing := ARRAY(SELECT x FROM unnest(p.allowed_callers) x WHERE NOT EXISTS (
      SELECT 1 FROM provider_gate_heartbeats h WHERE h.caller = x AND h.gate_version = p.required_gate_version AND h.last_seen > now() - interval '7 days'));
  END IF;
  SELECT * INTO v_att FROM marketcheck_launch_checks WHERE check_key = 'edge_versions' AND verified_at > now() - interval '7 days';
  v := v || jsonb_build_object('key','edge_versions','label','Edge function versions','mandatory',true,
    'status', CASE WHEN p.version IS NULL THEN 'unverified'
      WHEN cardinality(v_missing) = 0 THEN 'passed'
      WHEN v_att.status = 'passed' AND v_att.detail->>'gate_version' = p.required_gate_version THEN 'passed'
      ELSE 'unverified' END,
    'summary', CASE WHEN p.version IS NULL THEN 'No plan.' WHEN cardinality(v_missing) = 0 THEN format('All approved callers run gate %s.', p.required_gate_version)
      WHEN v_att.status = 'passed' THEN v_att.summary
      ELSE format('Not yet seen on gate %s: %s.', p.required_gate_version, array_to_string(v_missing, ', ')) END);

  -- 11-17. Evidence that SQL cannot compute, attested with a reference.
  FOREACH k IN ARRAY ARRAY['credentials','quota_concurrency','sticker_templates','auto_generation','print_passport_qa','rollback_tested'] LOOP
    v_att := NULL;
    SELECT * INTO v_att FROM marketcheck_launch_checks WHERE check_key = k AND verified_at > now() - interval '7 days';
    v := v || jsonb_build_object('key', k, 'label', CASE k
        WHEN 'credentials' THEN 'MarketCheck account credentials'
        WHEN 'quota_concurrency' THEN 'Quota reservation concurrency'
        WHEN 'sticker_templates' THEN 'Sticker template coverage'
        WHEN 'auto_generation' THEN 'Automatic generation'
        WHEN 'print_passport_qa' THEN 'Print and Passport QA'
        WHEN 'rollback_tested' THEN 'Rollback / Emergency Stop' END,
      'mandatory', true,
      'status', COALESCE(v_att.status, 'unverified'),
      'summary', COALESCE(v_att.summary, 'No evidence recorded in the last 7 days.'),
      'detail', jsonb_build_object('evidence_ref', v_att.evidence_ref, 'verified_at', v_att.verified_at, 'verified_by', v_att.verified_by));
  END LOOP;

  RETURN jsonb_build_object(
    'checks', v,
    'all_mandatory_passed', NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v) e WHERE (e->>'mandatory')::boolean AND e->>'status' <> 'passed'),
    'evaluated_at', now(),
    'plan_version', p.version);
END $$;

-- ── Read model for the Launch Control screen ────────────────────────────

CREATE OR REPLACE FUNCTION public.marketcheck_launch_status()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  c marketcheck_launch_control%ROWTYPE; p marketcheck_launch_plans%ROWTYPE; r jsonb; a provider_accounts%ROWTYPE; b provider_call_budgets%ROWTYPE;
  per record; u record; v_display text; v_month timestamptz;
BEGIN
  PERFORM inv_require_platform_admin();
  SELECT * INTO c FROM marketcheck_launch_control WHERE id = 1;
  SELECT * INTO p FROM marketcheck_launch_plans WHERE version = COALESCE(c.plan_version, (SELECT max(version) FROM marketcheck_launch_plans WHERE status <> 'retired'));
  r := marketcheck_launch_readiness(p.version);
  SELECT * INTO a FROM provider_accounts WHERE account_ref = 'marketcheck_primary';
  SELECT * INTO b FROM provider_call_budgets WHERE provider = 'marketcheck';
  SELECT * INTO per FROM provider_period('marketcheck_primary');
  SELECT * INTO u FROM provider_local_usage('marketcheck_primary');
  v_month := per.period_start;
  v_display := CASE WHEN c.state IN ('not_ready','ready_to_activate') THEN
      CASE WHEN (r->>'all_mandatory_passed')::boolean AND p.status = 'approved' THEN 'ready_to_activate' ELSE 'not_ready' END
    ELSE c.state END;
  RETURN jsonb_build_object(
    'state', v_display,
    'stored_state', c.state,
    'activation_on', marketcheck_launch_is_active_state(c.state),
    'activation_allowed', v_display = 'ready_to_activate' AND NOT c.emergency_stop,
    'emergency_stop', c.emergency_stop,
    'control', to_jsonb(c) - 'previous_budget' - 'previous_policies' - 'previous_cron',
    'has_rollback_snapshot', c.previous_budget IS NOT NULL,
    'plan', CASE WHEN p.version IS NULL THEN NULL ELSE to_jsonb(p) || jsonb_build_object(
      'canary_store_name', (SELECT display_name FROM dealer_stores WHERE id = p.canary_store_id),
      'rollout_stores', (SELECT COALESCE(jsonb_agg(jsonb_build_object('store_id', s.id, 'name', s.display_name, 'order', (e->>'order')::int,
          'min_hours_after_previous', (e->>'min_hours_after_previous')::int, 'active', s.id = ANY (c.active_store_ids),
          'policy_ready', EXISTS (SELECT 1 FROM store_enrichment_policies sp WHERE sp.store_id = s.id AND sp.mc_rooftop_verified_at IS NOT NULL AND sp.daily_request_limit > 0))
          ORDER BY (e->>'order')::int), '[]'::jsonb)
        FROM jsonb_array_elements(p.rollout) e JOIN dealer_stores s ON s.id = (e->>'store_id')::uuid)) END,
    'readiness', r,
    'consumption', jsonb_build_object(
      'period_start', per.period_start, 'period_end', per.period_end, 'period_source', per.source,
      'quota', a.monthly_call_quota, 'protected_reserve', a.protected_reserve, 'priority_floors', a.priority_floors,
      'usd_cap', a.monthly_usd_cap,
      'local_consumed', u.consumed, 'local_reserved', u.reserved, 'local_uncertain', u.uncertain,
      'usd_spent_estimated', u.usd_spent, 'usd_committed_estimated', u.usd_committed,
      'provider_reported', jsonb_build_object('limit', a.provider_reported_limit, 'used', a.provider_reported_used,
        'remaining', a.provider_reported_remaining, 'reset_at', a.provider_reset_at, 'reported_at', a.provider_reported_at),
      'remaining_local', a.monthly_call_quota - u.consumed - u.reserved - u.uncertain - GREATEST(0, COALESCE(a.provider_reported_used, 0) - (u.consumed + u.uncertain)),
      'budget_gate', jsonb_build_object('cap', b.monthly_call_cap, 'reserve', b.reserve_for_essential, 'enabled', b.enabled),
      'calls_this_month', (SELECT count(*) FROM provider_call_events WHERE provider = 'marketcheck' AND at >= v_month AND outcome NOT IN ('budget_denied','admitted')),
      'denied_this_month', (SELECT count(*) FROM provider_call_events WHERE provider = 'marketcheck' AND at >= v_month AND outcome = 'budget_denied'),
      'per_product', (SELECT COALESCE(jsonb_object_agg(product, n), '{}'::jsonb) FROM (SELECT product, count(*) n FROM provider_call_events
          WHERE provider = 'marketcheck' AND at >= v_month AND outcome NOT IN ('budget_denied','admitted') GROUP BY 1) q),
      'denials_by_reason', (SELECT COALESCE(jsonb_object_agg(COALESCE(note, 'unspecified'), n), '{}'::jsonb) FROM (SELECT left(note, 60) note, count(*) n FROM provider_call_events
          WHERE provider = 'marketcheck' AND at >= v_month AND outcome = 'budget_denied' GROUP BY 1) q),
      'per_store', (SELECT COALESCE(jsonb_agg(jsonb_build_object('store_id', s.id, 'name', s.display_name, 'mode', sp.mode,
          'daily_limit', sp.daily_request_limit, 'monthly_cap', sp.monthly_request_cap,
          'used_month', (SELECT count(*) FROM store_provider_usage su WHERE su.store_id = s.id AND su.outcome = 'admitted' AND su.at >= v_month))
          ORDER BY s.display_name), '[]'::jsonb) FROM dealer_stores s LEFT JOIN store_enrichment_policies sp ON sp.store_id = s.id WHERE s.status = 'active'),
      'last_success', (SELECT max(at) FROM provider_call_events WHERE provider = 'marketcheck' AND outcome = 'ok'),
      'last_error', (SELECT jsonb_build_object('at', at, 'outcome', outcome, 'http_status', http_status, 'caller', caller) FROM provider_call_events
          WHERE provider = 'marketcheck' AND outcome IN ('refused_quota','refused_rate','refused_auth','provider_error','transport_error') ORDER BY at DESC LIMIT 1),
      'marketcheck_cron', marketcheck_launch_cron_jobs()),
    'heartbeats', (SELECT COALESCE(jsonb_agg(to_jsonb(h) ORDER BY h.caller), '[]'::jsonb) FROM provider_gate_heartbeats h),
    'events', (SELECT COALESCE(jsonb_agg(to_jsonb(e) ORDER BY e.at DESC), '[]'::jsonb) FROM (SELECT * FROM marketcheck_launch_events ORDER BY at DESC LIMIT 25) e));
END $$;

-- ── Owner actions ───────────────────────────────────────────────────────

-- Record provider figures read from the MarketCheck account page. Goes into
-- the same account row the coordinator already enforces against.
CREATE OR REPLACE FUNCTION public.marketcheck_launch_record_quota(p_limit integer, p_used integer, p_remaining integer, p_reset_at timestamptz, p_evidence text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := inv_require_platform_admin();
BEGIN
  IF p_limit IS NULL OR p_used IS NULL OR p_remaining IS NULL OR p_limit <= 0 OR p_used < 0 OR p_remaining < 0 OR p_used + p_remaining > p_limit + 5 THEN
    RAISE EXCEPTION 'invalid_quota_figures';
  END IF;
  IF p_evidence IS NULL OR length(trim(p_evidence)) < 5 THEN RAISE EXCEPTION 'evidence_required'; END IF;
  PERFORM provider_reconcile_account('marketcheck_primary', p_limit, p_used, p_remaining, p_reset_at);
  PERFORM marketcheck_launch_log('record_quota', 'ok', NULL, NULL, NULL,
    jsonb_build_object('limit', p_limit, 'used', p_used, 'remaining', p_remaining, 'reset_at', p_reset_at, 'evidence', left(p_evidence, 500)));
  RETURN jsonb_build_object('ok', true);
END $$;

CREATE OR REPLACE FUNCTION public.marketcheck_launch_attest(p_check_key text, p_status text, p_summary text, p_evidence_ref text, p_detail jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := (SELECT auth.uid());
BEGIN
  -- Platform admins attest from the screen; the probe function (service role)
  -- records credentials and gate version only.
  IF v_uid IS NULL THEN
    IF p_check_key NOT IN ('credentials','edge_versions') THEN RAISE EXCEPTION 'platform_admin_required' USING ERRCODE = '42501'; END IF;
  ELSE PERFORM inv_require_platform_admin(); END IF;
  IF p_check_key NOT IN ('credentials','edge_versions','quota_concurrency','sticker_templates','auto_generation','print_passport_qa','rollback_tested') THEN
    RAISE EXCEPTION 'unknown_check';
  END IF;
  IF p_status NOT IN ('passed','failed') OR p_summary IS NULL OR length(trim(p_summary)) < 5 THEN RAISE EXCEPTION 'invalid_attestation'; END IF;
  IF p_status = 'passed' AND (p_evidence_ref IS NULL OR length(trim(p_evidence_ref)) < 5) THEN RAISE EXCEPTION 'evidence_required'; END IF;
  INSERT INTO marketcheck_launch_checks (check_key, status, summary, evidence_ref, detail, verified_by, verified_at)
  VALUES (p_check_key, p_status, left(p_summary, 500), left(p_evidence_ref, 500), COALESCE(p_detail, '{}'::jsonb), v_uid, now())
  ON CONFLICT (check_key) DO UPDATE SET status = EXCLUDED.status, summary = EXCLUDED.summary, evidence_ref = EXCLUDED.evidence_ref,
    detail = EXCLUDED.detail, verified_by = EXCLUDED.verified_by, verified_at = EXCLUDED.verified_at;
  PERFORM marketcheck_launch_log('attest', 'ok', NULL, NULL, NULL, jsonb_build_object('check', p_check_key, 'status', p_status, 'evidence', left(p_evidence_ref, 500)));
  RETURN jsonb_build_object('ok', true);
END $$;

CREATE OR REPLACE FUNCTION public.marketcheck_launch_approve_plan(p_version integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := inv_require_platform_admin(); c marketcheck_launch_control%ROWTYPE;
BEGIN
  SELECT * INTO c FROM marketcheck_launch_control WHERE id = 1 FOR UPDATE;
  IF marketcheck_launch_is_active_state(c.state) OR c.state = 'paused' THEN RAISE EXCEPTION 'launch_in_progress'; END IF;
  UPDATE marketcheck_launch_plans SET status = 'retired' WHERE status = 'approved' AND version <> p_version;
  UPDATE marketcheck_launch_plans SET status = 'approved', approved_by = v_uid, approved_at = now() WHERE version = p_version AND status = 'draft';
  IF NOT FOUND THEN RAISE EXCEPTION 'plan_not_draft'; END IF;
  PERFORM marketcheck_launch_log('approve_plan', 'ok', c.state, c.state, p_version, '{}'::jsonb);
  RETURN jsonb_build_object('ok', true, 'version', p_version);
END $$;

-- Start MarketCheck & Inventory Intelligence. Rechecks everything server-side
-- and only then opens the gate for the canary store.
CREATE OR REPLACE FUNCTION public.marketcheck_launch_activate(p_plan_version integer, p_confirm text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := inv_require_platform_admin(); c marketcheck_launch_control%ROWTYPE; p marketcheck_launch_plans%ROWTYPE;
  a provider_accounts%ROWTYPE; r jsonb; v_failed jsonb; v_prev_budget jsonb; v_prev_pol jsonb; v_prev_cron jsonb := '[]'::jsonb; j jsonb;
BEGIN
  IF p_confirm IS DISTINCT FROM 'START' THEN RAISE EXCEPTION 'confirmation_required'; END IF;
  BEGIN
    SELECT * INTO c FROM marketcheck_launch_control WHERE id = 1 FOR UPDATE NOWAIT;
  EXCEPTION WHEN lock_not_available THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'launch_in_progress');
  END;
  IF c.emergency_stop THEN
    PERFORM marketcheck_launch_log('activate', 'refused', c.state, c.state, p_plan_version, jsonb_build_object('reason', 'emergency_stop'));
    RETURN jsonb_build_object('ok', false, 'reason', 'emergency_stop');
  END IF;
  IF c.state NOT IN ('not_ready','ready_to_activate','activation_failed') THEN
    PERFORM marketcheck_launch_log('activate', 'refused', c.state, c.state, p_plan_version, jsonb_build_object('reason', 'state_' || c.state));
    RETURN jsonb_build_object('ok', false, 'reason', 'already_' || c.state);
  END IF;
  SELECT * INTO p FROM marketcheck_launch_plans WHERE version = p_plan_version AND status = 'approved';
  IF NOT FOUND THEN
    PERFORM marketcheck_launch_log('activate', 'refused', c.state, c.state, p_plan_version, jsonb_build_object('reason', 'plan_not_approved'));
    RETURN jsonb_build_object('ok', false, 'reason', 'plan_not_approved');
  END IF;
  r := marketcheck_launch_readiness(p.version);
  IF NOT (r->>'all_mandatory_passed')::boolean THEN
    SELECT jsonb_agg(jsonb_build_object('key', e->>'key', 'status', e->>'status', 'summary', e->>'summary')) INTO v_failed
      FROM jsonb_array_elements(r->'checks') e WHERE (e->>'mandatory')::boolean AND e->>'status' <> 'passed';
    PERFORM marketcheck_launch_log('activate', 'refused', c.state, c.state, p.version, jsonb_build_object('reason', 'readiness_failed', 'failed', v_failed));
    RETURN jsonb_build_object('ok', false, 'reason', 'readiness_failed', 'failed', v_failed);
  END IF;

  SELECT * INTO a FROM provider_accounts WHERE account_ref = 'marketcheck_primary';
  SELECT to_jsonb(b) INTO v_prev_budget FROM provider_call_budgets b WHERE provider = 'marketcheck';
  SELECT COALESCE(jsonb_agg(jsonb_build_object('store_id', store_id, 'mode', mode)), '[]'::jsonb) INTO v_prev_pol FROM store_enrichment_policies;
  FOR j IN SELECT * FROM jsonb_array_elements(p.cron_jobs) LOOP
    v_prev_cron := v_prev_cron || COALESCE(marketcheck_launch_cron_state(j->>'jobname'), jsonb_build_object('jobname', j->>'jobname', 'missing', true));
  END LOOP;

  -- The platform budget follows the account quota and reserve from now on.
  UPDATE provider_call_budgets SET monthly_call_cap = a.monthly_call_quota, reserve_for_essential = a.protected_reserve, enabled = true,
    notes = COALESCE(notes, '') || format(E'\n%s launch plan v%s activated by %s; previous row kept in marketcheck_launch_control.previous_budget.', now(), p.version, v_uid),
    updated_at = now()
  WHERE provider = 'marketcheck';
  UPDATE store_enrichment_policies SET mode = 'enrichment', budget_blocked = false, updated_by = v_uid, updated_at = now()
   WHERE store_id = p.canary_store_id;
  FOR j IN SELECT * FROM jsonb_array_elements(p.cron_jobs) LOOP
    PERFORM marketcheck_launch_cron_set(j->>'jobname', j->>'schedule', true);
  END LOOP;
  UPDATE marketcheck_launch_control SET state = 'activating_canary', plan_version = p.version, active_store_ids = ARRAY[p.canary_store_id],
    activated_at = now(), activated_by = v_uid, canary_started_at = now(), pilot_started_at = NULL, last_expanded_at = NULL, paused_reason = NULL, paused_at = NULL,
    previous_budget = v_prev_budget, previous_policies = v_prev_pol, previous_cron = v_prev_cron, updated_at = now(), updated_by = v_uid
  WHERE id = 1;
  PERFORM marketcheck_launch_log('activate', 'ok', c.state, 'activating_canary', p.version,
    jsonb_build_object('canary_store_id', p.canary_store_id, 'canary_max_calls', p.canary_max_calls, 'products', p.products,
      'callers', p.allowed_callers, 'cron_jobs', p.cron_jobs, 'readiness_evaluated_at', r->'evaluated_at'));
  RETURN jsonb_build_object('ok', true, 'state', 'activating_canary', 'plan_version', p.version);
END $$;

-- Stop All MarketCheck Paid Calls. Usable by a platform admin from the
-- screen, by the service role, or from the SQL editor as postgres. Never
-- deletes anything; it refuses admissions and parks the MarketCheck crons.
CREATE OR REPLACE FUNCTION public.marketcheck_emergency_stop(p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE c marketcheck_launch_control%ROWTYPE; j jsonb; v_parked jsonb := '[]'::jsonb;
BEGIN
  IF (SELECT auth.uid()) IS NOT NULL THEN PERFORM inv_require_platform_admin(); END IF;
  SELECT * INTO c FROM marketcheck_launch_control WHERE id = 1 FOR UPDATE;
  UPDATE marketcheck_launch_control SET emergency_stop = true, state = 'emergency_stop', stopped_at = now(), stopped_by = (SELECT auth.uid()),
    stop_reason = left(COALESCE(NULLIF(trim(p_reason), ''), 'unspecified'), 500), updated_at = now(), updated_by = (SELECT auth.uid())
  WHERE id = 1;
  UPDATE store_enrichment_policies SET mode = 'paused', updated_at = now() WHERE mode = 'enrichment';
  FOR j IN SELECT * FROM jsonb_array_elements(marketcheck_launch_cron_jobs()) LOOP
    IF (j->>'active')::boolean THEN
      PERFORM marketcheck_launch_cron_set(j->>'jobname', j->>'schedule', false);
      v_parked := v_parked || j;
    END IF;
  END LOOP;
  PERFORM marketcheck_launch_log('emergency_stop', 'ok', c.state, 'emergency_stop', c.plan_version,
    jsonb_build_object('reason', p_reason, 'crons_parked', v_parked));
  RETURN jsonb_build_object('ok', true, 'state', 'emergency_stop', 'crons_parked', v_parked);
END $$;

-- Releasing a stop never resumes calls: it lands in PAUSED (if a plan was
-- active) or NOT READY, and resuming is a separate, rechecked action.
CREATE OR REPLACE FUNCTION public.marketcheck_launch_release_stop(p_confirm text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := inv_require_platform_admin(); c marketcheck_launch_control%ROWTYPE; v_to text;
BEGIN
  IF p_confirm IS DISTINCT FROM 'RELEASE' THEN RAISE EXCEPTION 'confirmation_required'; END IF;
  SELECT * INTO c FROM marketcheck_launch_control WHERE id = 1 FOR UPDATE;
  IF NOT c.emergency_stop THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_stopped'); END IF;
  v_to := CASE WHEN c.activated_at IS NOT NULL AND c.previous_budget IS NOT NULL THEN 'paused' ELSE 'not_ready' END;
  UPDATE marketcheck_launch_control SET emergency_stop = false, state = v_to, paused_reason = CASE WHEN v_to = 'paused' THEN 'released_from_emergency_stop' END,
    paused_at = CASE WHEN v_to = 'paused' THEN now() END, updated_at = now(), updated_by = v_uid WHERE id = 1;
  PERFORM marketcheck_launch_log('release_stop', 'ok', c.state, v_to, c.plan_version, '{}'::jsonb);
  RETURN jsonb_build_object('ok', true, 'state', v_to);
END $$;

CREATE OR REPLACE FUNCTION public.marketcheck_launch_pause(p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := inv_require_platform_admin(); c marketcheck_launch_control%ROWTYPE;
BEGIN
  SELECT * INTO c FROM marketcheck_launch_control WHERE id = 1 FOR UPDATE;
  IF NOT marketcheck_launch_is_active_state(c.state) THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_active'); END IF;
  UPDATE marketcheck_launch_control SET state = 'paused', paused_reason = left(COALESCE(p_reason, 'paused by admin'), 300), paused_at = now(),
    updated_at = now(), updated_by = v_uid WHERE id = 1;
  PERFORM marketcheck_launch_log('pause', 'ok', c.state, 'paused', c.plan_version, jsonb_build_object('reason', p_reason));
  RETURN jsonb_build_object('ok', true, 'state', 'paused');
END $$;

-- Resume from PAUSED. A canary that reached its ceiling or window resumes as
-- PILOT ACTIVE only when the provider has reported usage since the canary
-- started (real consumption reconciled); otherwise it stays paused.
CREATE OR REPLACE FUNCTION public.marketcheck_launch_resume(p_confirm text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := inv_require_platform_admin(); c marketcheck_launch_control%ROWTYPE; r jsonb; a provider_accounts%ROWTYPE; v_to text;
BEGIN
  IF p_confirm IS DISTINCT FROM 'RESUME' THEN RAISE EXCEPTION 'confirmation_required'; END IF;
  SELECT * INTO c FROM marketcheck_launch_control WHERE id = 1 FOR UPDATE;
  IF c.state <> 'paused' OR c.emergency_stop THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_paused'); END IF;
  r := marketcheck_launch_readiness(c.plan_version);
  IF NOT (r->>'all_mandatory_passed')::boolean THEN
    PERFORM marketcheck_launch_log('resume', 'refused', c.state, c.state, c.plan_version, jsonb_build_object('reason', 'readiness_failed'));
    RETURN jsonb_build_object('ok', false, 'reason', 'readiness_failed');
  END IF;
  IF c.paused_reason IN ('canary_ceiling_reached','canary_window_elapsed') THEN
    -- Promotion to the pilot needs the provider's own usage figures taken
    -- after the canary started, so real consumption can be compared.
    SELECT * INTO a FROM provider_accounts WHERE account_ref = 'marketcheck_primary';
    IF a.provider_reported_at IS NULL OR a.provider_reported_at < c.canary_started_at THEN
      PERFORM marketcheck_launch_log('resume', 'refused', c.state, c.state, c.plan_version, jsonb_build_object('reason', 'canary_consumption_not_reconciled'));
      RETURN jsonb_build_object('ok', false, 'reason', 'canary_consumption_not_reconciled');
    END IF;
    v_to := 'pilot_active';
  ELSIF c.pilot_started_at IS NULL THEN
    -- Still in the canary: the ceiling counts from the original start.
    v_to := 'activating_canary';
  ELSIF cardinality(c.active_store_ids) > 1 THEN v_to := 'expanding';
  ELSE v_to := 'pilot_active';
  END IF;
  UPDATE marketcheck_launch_control SET state = v_to, paused_reason = NULL, paused_at = NULL,
    pilot_started_at = CASE WHEN v_to = 'pilot_active' AND pilot_started_at IS NULL THEN now() ELSE pilot_started_at END,
    updated_at = now(), updated_by = v_uid WHERE id = 1;
  UPDATE store_enrichment_policies SET mode = 'enrichment', updated_at = now() WHERE store_id = ANY (c.active_store_ids) AND mode = 'paused' AND mc_rooftop_verified_at IS NOT NULL;
  PERFORM marketcheck_launch_log('resume', 'ok', c.state, v_to, c.plan_version, '{}'::jsonb);
  RETURN jsonb_build_object('ok', true, 'state', v_to);
END $$;

-- Add the next approved rooftop, only from PILOT ACTIVE / EXPANDING, only in
-- plan order, only after the plan's waiting period and with no tripwire.
CREATE OR REPLACE FUNCTION public.marketcheck_launch_expand(p_store_id uuid, p_confirm text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := inv_require_platform_admin(); c marketcheck_launch_control%ROWTYPE; p marketcheck_launch_plans%ROWTYPE;
  e jsonb; v_next jsonb; pol store_enrichment_policies%ROWTYPE; v_since timestamptz;
BEGIN
  IF p_confirm IS DISTINCT FROM 'EXPAND' THEN RAISE EXCEPTION 'confirmation_required'; END IF;
  SELECT * INTO c FROM marketcheck_launch_control WHERE id = 1 FOR UPDATE;
  IF c.state NOT IN ('pilot_active','expanding') THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_in_pilot'); END IF;
  SELECT * INTO p FROM marketcheck_launch_plans WHERE version = c.plan_version;
  SELECT x INTO v_next FROM jsonb_array_elements(p.rollout) x
   WHERE NOT ((x->>'store_id')::uuid = ANY (c.active_store_ids)) ORDER BY (x->>'order')::int LIMIT 1;
  IF v_next IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'rollout_complete'); END IF;
  IF (v_next->>'store_id')::uuid <> p_store_id THEN RETURN jsonb_build_object('ok', false, 'reason', 'out_of_order', 'next_store_id', v_next->>'store_id'); END IF;
  v_since := COALESCE(c.last_expanded_at, c.pilot_started_at, c.activated_at);
  IF now() < v_since + make_interval(hours => COALESCE((v_next->>'min_hours_after_previous')::int, 24)) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'waiting_period', 'eligible_at', v_since + make_interval(hours => COALESCE((v_next->>'min_hours_after_previous')::int, 24)));
  END IF;
  SELECT * INTO pol FROM store_enrichment_policies WHERE store_id = p_store_id;
  IF pol.store_id IS NULL OR pol.mc_rooftop_verified_at IS NULL OR pol.daily_request_limit <= 0 OR pol.monthly_request_cap <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'store_policy_not_ready');
  END IF;
  IF EXISTS (SELECT 1 FROM dealer_stores WHERE id = p_store_id AND (status <> 'active' OR feed_import_paused)) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'store_feed_not_live');
  END IF;
  UPDATE store_enrichment_policies SET mode = 'enrichment', budget_blocked = false, updated_by = v_uid, updated_at = now() WHERE store_id = p_store_id;
  UPDATE marketcheck_launch_control SET state = 'expanding', active_store_ids = active_store_ids || p_store_id, last_expanded_at = now(),
    updated_at = now(), updated_by = v_uid WHERE id = 1;
  PERFORM marketcheck_launch_log('expand', 'ok', c.state, 'expanding', c.plan_version, jsonb_build_object('store_id', p_store_id));
  RETURN jsonb_build_object('ok', true, 'state', 'expanding');
END $$;

-- Return to the pre-activation configuration: budget row, store policy modes
-- and cron states as they were, switch OFF. Inventory, documents and audit
-- rows are untouched.
CREATE OR REPLACE FUNCTION public.marketcheck_launch_rollback(p_confirm text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := inv_require_platform_admin(); c marketcheck_launch_control%ROWTYPE; j jsonb;
BEGIN
  IF p_confirm IS DISTINCT FROM 'ROLLBACK' THEN RAISE EXCEPTION 'confirmation_required'; END IF;
  SELECT * INTO c FROM marketcheck_launch_control WHERE id = 1 FOR UPDATE;
  IF marketcheck_launch_is_active_state(c.state) THEN RETURN jsonb_build_object('ok', false, 'reason', 'stop_or_pause_first'); END IF;
  IF c.previous_budget IS NOT NULL THEN
    UPDATE provider_call_budgets SET monthly_call_cap = (c.previous_budget->>'monthly_call_cap')::int,
      reserve_for_essential = (c.previous_budget->>'reserve_for_essential')::int, enabled = (c.previous_budget->>'enabled')::boolean,
      notes = c.previous_budget->>'notes', updated_at = now()
    WHERE provider = 'marketcheck';
  END IF;
  IF c.previous_policies IS NOT NULL THEN
    UPDATE store_enrichment_policies sp SET mode = COALESCE((SELECT x->>'mode' FROM jsonb_array_elements(c.previous_policies) x WHERE (x->>'store_id')::uuid = sp.store_id), 'feed_only'),
      updated_at = now();
  END IF;
  FOR j IN SELECT * FROM jsonb_array_elements(COALESCE(c.previous_cron, '[]'::jsonb)) LOOP
    IF NOT COALESCE((j->>'missing')::boolean, false) THEN PERFORM marketcheck_launch_cron_set(j->>'jobname', j->>'schedule', (j->>'active')::boolean); END IF;
  END LOOP;
  UPDATE marketcheck_launch_control SET state = 'not_ready', emergency_stop = false, active_store_ids = '{}', activated_at = NULL, activated_by = NULL,
    canary_started_at = NULL, pilot_started_at = NULL, last_expanded_at = NULL, paused_reason = NULL, paused_at = NULL,
    previous_budget = NULL, previous_policies = NULL, previous_cron = NULL, updated_at = now(), updated_by = v_uid WHERE id = 1;
  PERFORM marketcheck_launch_log('rollback', 'ok', c.state, 'not_ready', c.plan_version,
    jsonb_build_object('restored_budget', c.previous_budget IS NOT NULL, 'restored_policies', c.previous_policies IS NOT NULL, 'restored_cron', c.previous_cron));
  RETURN jsonb_build_object('ok', true, 'state', 'not_ready');
END $$;

-- Drill: engage and release the stop while OFF, proving the path end to end
-- on the real database without opening the gate. Records evidence.
CREATE OR REPLACE FUNCTION public.marketcheck_launch_stop_drill()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := inv_require_platform_admin(); c marketcheck_launch_control%ROWTYPE; v_reason text; v_cron_before jsonb; v_cron_after jsonb;
BEGIN
  SELECT * INTO c FROM marketcheck_launch_control WHERE id = 1 FOR UPDATE;
  IF c.state NOT IN ('not_ready','ready_to_activate') OR c.emergency_stop THEN RETURN jsonb_build_object('ok', false, 'reason', 'drill_only_when_off'); END IF;
  v_cron_before := marketcheck_launch_cron_jobs();
  UPDATE marketcheck_launch_control SET emergency_stop = true, state = 'emergency_stop' WHERE id = 1;
  v_reason := marketcheck_launch_gate('marketcheck-sync', NULL, 'rest');
  v_cron_after := marketcheck_launch_cron_jobs();
  UPDATE marketcheck_launch_control SET emergency_stop = false, state = c.state, updated_at = now(), updated_by = v_uid WHERE id = 1;
  IF v_reason IS DISTINCT FROM 'emergency_stop' THEN
    PERFORM marketcheck_launch_log('stop_drill', 'failed', c.state, c.state, c.plan_version, jsonb_build_object('gate_answer', v_reason));
    RETURN jsonb_build_object('ok', false, 'reason', 'gate_did_not_refuse', 'gate_answer', v_reason);
  END IF;
  PERFORM marketcheck_launch_log('stop_drill', 'ok', c.state, c.state, c.plan_version, jsonb_build_object('gate_answer', v_reason, 'marketcheck_cron', v_cron_before));
  RETURN jsonb_build_object('ok', true, 'gate_answer', v_reason);
END $$;

REVOKE ALL ON FUNCTION
  public.marketcheck_launch_log(text, text, text, text, integer, jsonb, text),
  public.marketcheck_launch_actor_is_admin(),
  public.marketcheck_launch_cron_state(text), public.marketcheck_launch_cron_set(text, text, boolean), public.marketcheck_launch_cron_jobs(),
  public.marketcheck_launch_gate(text, uuid, text),
  public.marketcheck_launch_readiness(integer)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.marketcheck_launch_readiness(integer) TO service_role;
REVOKE ALL ON FUNCTION
  public.marketcheck_launch_status(), public.marketcheck_launch_record_quota(integer, integer, integer, timestamptz, text),
  public.marketcheck_launch_attest(text, text, text, text, jsonb), public.marketcheck_launch_approve_plan(integer),
  public.marketcheck_launch_activate(integer, text), public.marketcheck_emergency_stop(text), public.marketcheck_launch_release_stop(text),
  public.marketcheck_launch_pause(text), public.marketcheck_launch_resume(text), public.marketcheck_launch_expand(uuid, text),
  public.marketcheck_launch_rollback(text), public.marketcheck_launch_stop_drill()
FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION
  public.marketcheck_launch_status(), public.marketcheck_launch_record_quota(integer, integer, integer, timestamptz, text),
  public.marketcheck_launch_attest(text, text, text, text, jsonb), public.marketcheck_launch_approve_plan(integer),
  public.marketcheck_launch_activate(integer, text), public.marketcheck_emergency_stop(text), public.marketcheck_launch_release_stop(text),
  public.marketcheck_launch_pause(text), public.marketcheck_launch_resume(text), public.marketcheck_launch_expand(uuid, text),
  public.marketcheck_launch_rollback(text), public.marketcheck_launch_stop_drill()
TO authenticated, service_role;

-- ── Draft plan v1 (not approved) ────────────────────────────────────────
-- Seeded only where the Harte stores exist. Approval is a separate owner act.
INSERT INTO public.marketcheck_launch_plans (version, title, canary_store_id, canary_max_calls, canary_window_hours, hourly_call_ceiling,
  daily_call_ceiling, error_tripwire_per_hour, uncertain_tripwire_per_hour, feed_max_age_hours, required_gate_version, products, allowed_callers,
  cron_jobs, rollout, notes)
SELECT 1, 'Harte INFINITI canary, then five Harte rooftops', '45cdc1e0-7e88-4b44-9d07-27369d74ab21'::uuid, 40, 24, 15, 120, 5, 3, 9,
  'launch-2026-11-02', ARRAY['neovin'], ARRAY['marketcheck-sync','marketcheck-specs','vehicle-enrich'],
  '[{"jobname":"marketcheck-sync","schedule":"7 */4 * * *"}]'::jsonb,
  (SELECT COALESCE(jsonb_agg(jsonb_build_object('store_id', id, 'order', o, 'min_hours_after_previous', 48) ORDER BY o), '[]'::jsonb)
     FROM (VALUES ('35d5584b-93d4-4419-9a50-6daead08e7a9'::uuid, 1), ('e400e636-0909-4b36-822e-caa2b5ae7381'::uuid, 2),
                  ('12e1d831-166d-48e9-87b5-536d7c0980dc'::uuid, 3), ('17a9f6f2-29ff-4ff1-bf72-1519df10b7d5'::uuid, 4),
                  ('02b4f1ac-e15a-40a7-9c49-811fd043ef53'::uuid, 5)) v(id, o)
    WHERE EXISTS (SELECT 1 FROM public.dealer_stores s WHERE s.id = v.id)),
  'Canary: at most 40 MarketCheck calls in 24 hours for Harte INFINITI only (feed sync plus new-vehicle NeoVIN decodes). Then pilot, then one rooftop at a time, 48 hours apart.'
WHERE EXISTS (SELECT 1 FROM public.dealer_stores WHERE id = '45cdc1e0-7e88-4b44-9d07-27369d74ab21')
ON CONFLICT (version) DO NOTHING;
