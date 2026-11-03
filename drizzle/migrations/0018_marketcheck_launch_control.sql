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
--     checks the emergency stop, launch state, the exact gate version the
--     plan requires, approved caller, approved catalog product, and one
--     server-resolved rooftop per request (the store that owns the VIN, or
--     for VIN-less requests the named store verified against the tenant):
--     active in the launch, identity mapped and matched, policy enabled for
--     that product. Then the canary ceiling and tripwires, then the budget.
--   * Every MarketCheck reservation in provider_requests passes the same
--     gate (trigger), whatever the path: provider_reserve, staff AI/MCP or a
--     direct insert. A REST reservation must also be bound to the unused
--     admission event v2 granted for the same caller, product and rooftop.
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
  -- Owner-approved dollar ceiling for the whole MarketCheck account while
  -- this plan runs. A call limit is not a dollar limit: activation copies it
  -- to provider_accounts.monthly_usd_cap and refuses to start without it.
  account_usd_cap numeric(10,2) CHECK (account_usd_cap IS NULL OR account_usd_cap > 0),
  -- Monthly dollar cap the canary store's policy must carry (at or below the
  -- account cap). Readiness refuses a canary policy above it.
  canary_store_usd_cap numeric(10,2) CHECK (canary_store_usd_cap IS NULL OR canary_store_usd_cap > 0),
  -- The bounded workload START begins: which caller decodes, at most how many
  -- vehicles per active store, at most how many paid calls per vehicle, how
  -- many in flight at once and how long a dispatch stays valid. When set,
  -- the gate admits a VIN only while the dispatcher has it in flight, so no
  -- sweep, backfill or manual click can spend outside the workload.
  workload jsonb CHECK (workload IS NULL OR (
    jsonb_typeof(workload) = 'object' AND workload->>'caller' IS NOT NULL AND workload->>'function' ~ '^[a-z0-9-]{3,60}$'
    AND (workload->>'max_vehicles_per_store')::int BETWEEN 1 AND 500 AND (workload->>'calls_per_vehicle')::int BETWEEN 1 AND 4
    AND (workload->>'batch_size')::int BETWEEN 1 AND 20 AND (workload->>'response_timeout_minutes')::int BETWEEN 1 AND 60)),
  -- [{"jobname":"...","schedule":"..."}]: the only cron jobs activation turns
  -- on, with the schedule it sets. Plan v1 turns on only the workload
  -- dispatcher, never a syndication feed or a global sweep.
  cron_jobs jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(cron_jobs) = 'array'),
  -- [{"store_id":..., "order":1, "min_hours_after_previous":24}] after the canary.
  rollout jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(rollout) = 'array'),
  notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  approved_by uuid,
  approved_at timestamptz,
  CHECK (hourly_call_ceiling <= daily_call_ceiling),
  CHECK (status <> 'approved' OR (approved_by IS NOT NULL AND approved_at IS NOT NULL)),
  CHECK (status = 'draft' OR account_usd_cap IS NOT NULL),
  CHECK (canary_store_usd_cap IS NULL OR account_usd_cap IS NULL OR canary_store_usd_cap <= account_usd_cap),
  CHECK (workload IS NULL OR workload->>'caller' = ANY (allowed_callers))
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

-- The workload START begins: one row per vehicle per plan, so a VIN is
-- queued, dispatched and decoded at most once per plan whatever runs.
CREATE TABLE public.marketcheck_launch_work (
  id bigserial PRIMARY KEY,
  plan_version integer NOT NULL REFERENCES public.marketcheck_launch_plans(version),
  store_id uuid NOT NULL,
  tenant_id uuid NOT NULL,
  vehicle_id uuid,
  vin text NOT NULL CHECK (vin ~ '^[A-HJ-NPR-Z0-9]{17}$'),
  product text NOT NULL,
  priority smallint NOT NULL DEFAULT 3,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','dispatched','done','failed','cancelled')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 2),
  admissions integer NOT NULL DEFAULT 0,
  request_id bigint,
  enqueued_at timestamptz NOT NULL DEFAULT now(),
  dispatched_at timestamptz,
  finished_at timestamptz,
  result jsonb,
  UNIQUE (plan_version, vin, product)
);
CREATE INDEX idx_marketcheck_launch_work_open ON public.marketcheck_launch_work (plan_version, status, priority, id);

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
ALTER TABLE public.marketcheck_launch_work ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.marketcheck_launch_work FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE public.marketcheck_launch_work_id_seq FROM PUBLIC, anon, authenticated;
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
      FROM cron.job WHERE command ~ '/functions/v1/(marketcheck-[a-z-]+|enrich-sweep|vehicle-enrich|specs-backfill|market-valuation-write|crawl-advertised-prices)'
         OR command ~ 'marketcheck_launch_dispatch'$q$ INTO r;
  RETURN r;
END $$;

-- ── The launch gate ─────────────────────────────────────────────────────

-- Admission events carry the rooftop and catalog product the gate verified,
-- and the gate version the caller ran, so a reservation can be bound to the
-- exact admission that allowed it.
ALTER TABLE public.provider_call_events
  ADD COLUMN IF NOT EXISTS store_id uuid,
  ADD COLUMN IF NOT EXISTS catalog_product text,
  ADD COLUMN IF NOT EXISTS gate_version text;

-- The one rooftop a VIN belongs to, from feed inventory and listings across
-- every tenant. More than one distinct store is ambiguous ownership.
CREATE OR REPLACE FUNCTION public.marketcheck_launch_vin_stores(p_vin text)
RETURNS uuid[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(array_agg(DISTINCT x), '{}') FROM (
    SELECT si.store_id x FROM store_inventory si WHERE si.vin = upper(trim(p_vin)) AND si.presence NOT IN ('retired','transferred')
    UNION ALL
    SELECT vl.owning_store_id FROM vehicle_listings vl WHERE upper(trim(vl.vin)) = upper(trim(p_vin)) AND vl.owning_store_id IS NOT NULL
  ) q WHERE x IS NOT NULL;
$$;

-- A store's MarketCheck identity is proven only by exactly one approved feed
-- mapping whose identity comparison matched, and whose DealerId is mapped to
-- no other store.
CREATE OR REPLACE FUNCTION public.marketcheck_launch_store_identity_ok(p_store_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT (SELECT count(*) FROM inventory_source_mappings m WHERE m.store_id = p_store_id AND m.status = 'approved') = 1
     AND EXISTS (SELECT 1 FROM inventory_source_mappings m WHERE m.store_id = p_store_id AND m.status = 'approved'
                  AND m.evidence->'approved_comparison'->>'verdict' = 'match'
                  AND NOT EXISTS (SELECT 1 FROM inventory_source_mappings o WHERE o.status = 'approved' AND o.store_id <> m.store_id
                                   AND o.provider = m.provider AND o.source_dealer_id = m.source_dealer_id));
$$;

-- The store's latest feed is clean: an applied snapshot within the plan's
-- freshness window and nothing held, quarantined, rejected or failed since.
CREATE OR REPLACE FUNCTION public.marketcheck_launch_store_feed_clean(p_store_id uuid, p_max_age_hours integer)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH last AS (SELECT max(applied_at) a FROM inventory_store_snapshots WHERE store_id = p_store_id AND status = 'applied')
  SELECT (SELECT a FROM last) IS NOT NULL AND (SELECT a FROM last) > now() - make_interval(hours => p_max_age_hours)
     AND NOT EXISTS (SELECT 1 FROM inventory_store_snapshots s WHERE s.store_id = p_store_id
                      AND s.status IN ('held','quarantined','rejected','failed') AND s.created_at > (SELECT a FROM last));
$$;

-- Decides one MarketCheck request. reason is NULL when it may proceed to the
-- budget; store_id is the rooftop the server resolved for it. Every request
-- is scoped to one rooftop: a VIN request to the single store that owns the
-- VIN (never the caller's claim), a VIN-less request (syndication, dealer
-- lookups, searches) to the store the caller names, verified against the
-- tenant. A shared tenant never authorises its other rooftops.
-- p_gate_version NULL is used only by the reservation guard, which proves the
-- version through the admission event instead. p_exclude_event keeps the
-- admission being reserved out of the ceiling counts.
CREATE OR REPLACE FUNCTION public.marketcheck_launch_gate(
  p_caller text, p_tenant_id uuid, p_channel text, p_store_id uuid, p_product text, p_vin text,
  p_gate_version text DEFAULT NULL, p_exclude_event bigint DEFAULT NULL,
  OUT reason text, OUT store_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  c marketcheck_launch_control%ROWTYPE; p marketcheck_launch_plans%ROWTYPE; s dealer_stores%ROWTYPE; pol store_enrichment_policies%ROWTYPE;
  v_vin text := NULLIF(upper(trim(COALESCE(p_vin, ''))), ''); v_stores uuid[]; v_store uuid; v_billing text; v_n integer; v_trip text;
  w marketcheck_launch_work%ROWTYPE;
BEGIN
  SELECT * INTO c FROM marketcheck_launch_control WHERE id = 1 FOR UPDATE;
  IF NOT FOUND THEN reason := 'launch_control_missing'; RETURN; END IF;
  IF c.emergency_stop THEN reason := 'emergency_stop'; RETURN; END IF;
  IF NOT marketcheck_launch_is_active_state(c.state) THEN reason := 'launch_inactive'; RETURN; END IF;
  SELECT * INTO p FROM marketcheck_launch_plans WHERE version = c.plan_version AND status = 'approved';
  IF NOT FOUND THEN reason := 'launch_plan_missing'; RETURN; END IF;
  IF p_gate_version IS NOT NULL AND p_gate_version <> p.required_gate_version THEN reason := 'launch_gate_version_mismatch'; RETURN; END IF;
  IF p_channel <> 'rest' AND NOT p.allow_staff_ai THEN reason := 'launch_staff_ai_not_approved'; RETURN; END IF;
  IF p_channel = 'rest' AND NOT (p_caller = ANY (p.allowed_callers)) THEN reason := 'launch_caller_not_approved'; RETURN; END IF;
  IF p_product IS NULL OR NOT (p_product = ANY (p.products)) THEN reason := 'launch_product_not_approved'; RETURN; END IF;
  SELECT billing_product INTO v_billing FROM provider_product_catalog WHERE account_ref = 'marketcheck_primary' AND product_key = p_product;
  IF v_billing IS NULL THEN reason := 'launch_product_not_in_catalog'; RETURN; END IF;
  IF p_tenant_id IS NULL THEN reason := 'launch_tenant_required'; RETURN; END IF;

  -- Rooftop scope, resolved server-side.
  IF v_vin IS NOT NULL THEN
    v_stores := marketcheck_launch_vin_stores(v_vin);
    IF cardinality(v_stores) = 0 THEN reason := 'launch_vin_not_store_inventory'; RETURN; END IF;
    IF cardinality(v_stores) > 1 THEN reason := 'launch_vin_ownership_ambiguous'; RETURN; END IF;
    v_store := v_stores[1];
    IF p_store_id IS NOT NULL AND p_store_id <> v_store THEN reason := 'launch_store_mismatch'; RETURN; END IF;
  ELSE
    IF p_store_id IS NULL THEN reason := 'launch_store_required'; RETURN; END IF;
    v_store := p_store_id;
  END IF;
  SELECT * INTO s FROM dealer_stores WHERE id = v_store;
  IF NOT FOUND OR s.tenant_id IS DISTINCT FROM p_tenant_id THEN reason := 'launch_store_tenant_mismatch'; RETURN; END IF;
  IF NOT (v_store = ANY (c.active_store_ids)) THEN reason := 'launch_store_not_active'; RETURN; END IF;
  IF s.status <> 'active' OR s.feed_import_paused THEN reason := 'launch_store_feed_not_live'; RETURN; END IF;
  IF NOT marketcheck_launch_store_identity_ok(v_store) THEN reason := 'launch_store_identity_unverified'; RETURN; END IF;
  SELECT * INTO pol FROM store_enrichment_policies sp WHERE sp.store_id = v_store;
  IF pol.store_id IS NULL OR pol.mode <> 'enrichment' OR pol.mc_rooftop_verified_at IS NULL OR pol.credential_ref IS NULL THEN
    reason := 'launch_store_policy_not_ready'; RETURN;
  END IF;
  IF NOT (v_billing = ANY (pol.allowed_products)) THEN reason := 'launch_store_product_not_allowed'; RETURN; END IF;
  store_id := v_store;

  -- Tripwires. Any one pauses the launch; nothing resumes it automatically.
  IF c.state = 'activating_canary' THEN
    SELECT count(*) INTO v_n FROM provider_call_events
     WHERE provider = 'marketcheck' AND at >= c.canary_started_at AND outcome <> 'budget_denied' AND id IS DISTINCT FROM p_exclude_event;
    IF v_n >= p.canary_max_calls THEN v_trip := 'canary_ceiling_reached';
    ELSIF now() > c.canary_started_at + make_interval(hours => p.canary_window_hours) THEN v_trip := 'canary_window_elapsed';
    END IF;
  END IF;
  IF v_trip IS NULL THEN
    SELECT count(*) INTO v_n FROM provider_call_events
     WHERE provider = 'marketcheck' AND at > now() - interval '1 hour' AND outcome <> 'budget_denied' AND id IS DISTINCT FROM p_exclude_event;
    IF v_n >= p.hourly_call_ceiling THEN v_trip := 'hourly_ceiling'; END IF;
  END IF;
  IF v_trip IS NULL THEN
    SELECT count(*) INTO v_n FROM provider_call_events
     WHERE provider = 'marketcheck' AND at > now() - interval '24 hours' AND outcome <> 'budget_denied' AND id IS DISTINCT FROM p_exclude_event;
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
       SELECT 1 FROM inventory_store_snapshots sn
        WHERE sn.store_id = ANY (c.active_store_ids) AND sn.status IN ('held','quarantined','rejected','failed')
          AND sn.created_at > COALESCE((SELECT max(a.applied_at) FROM inventory_store_snapshots a WHERE a.store_id = sn.store_id AND a.status = 'applied'), '-infinity')) THEN
    v_trip := 'feed_integrity_hold';
  END IF;

  IF v_trip IS NOT NULL THEN
    UPDATE marketcheck_launch_control SET state = 'paused', paused_reason = v_trip, paused_at = now(), updated_at = now() WHERE id = 1;
    PERFORM marketcheck_launch_log('tripwire_pause', 'ok', c.state, 'paused', c.plan_version,
      jsonb_build_object('tripwire', v_trip, 'caller', p_caller, 'store_id', v_store), 'gate');
    reason := 'launch_paused_' || v_trip; store_id := NULL;
    RETURN;
  END IF;

  -- A plan with a workload spends only on what its dispatcher sent: the VIN
  -- must be in flight for this plan, product and rooftop, and within its
  -- per-vehicle call allowance. Sweeps, backfills and manual clicks are
  -- refused here even for the canary's own VINs.
  IF p.workload IS NOT NULL THEN
    IF v_vin IS NULL THEN reason := 'launch_dispatch_required'; store_id := NULL; RETURN; END IF;
    SELECT * INTO w FROM marketcheck_launch_work mw
     WHERE mw.plan_version = p.version AND mw.vin = v_vin AND mw.product = p_product AND mw.store_id = v_store AND mw.status = 'dispatched'
       AND mw.dispatched_at > now() - make_interval(mins => (p.workload->>'response_timeout_minutes')::int);
    IF w.id IS NULL THEN reason := 'launch_vin_not_dispatched'; store_id := NULL; RETURN; END IF;
    -- An admission must leave room for itself; the reservation that follows
    -- it is checked against the count that already includes it.
    v_n := (p.workload->>'calls_per_vehicle')::int - (p_exclude_event IS NULL)::int;
    IF w.admissions > v_n THEN
      reason := 'launch_work_item_exhausted'; store_id := NULL; RETURN;
    END IF;
  END IF;
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

-- The only path that can admit MarketCheck. p_product is the billing product
-- the budget meters; p_catalog_product is the account catalog product the
-- plan approves, and the two must name the same catalog row.
CREATE OR REPLACE FUNCTION public.provider_call_admit_v2(
  p_provider text, p_product text, p_caller text, p_gate_version text, p_essential boolean DEFAULT false,
  p_tenant_id uuid DEFAULT NULL, p_vin text DEFAULT NULL, p_estimated_cost_usd numeric DEFAULT NULL,
  p_store_id uuid DEFAULT NULL, p_catalog_product text DEFAULT NULL
) RETURNS TABLE (admitted boolean, event_id bigint, month_calls integer, monthly_call_cap integer, reserve_for_essential integer, reason text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE g record; r record;
BEGIN
  IF p_gate_version IS NULL OR length(p_gate_version) NOT BETWEEN 1 AND 40 THEN
    RETURN QUERY SELECT * FROM public.provider_call_admit_refuse(p_provider, p_product, p_caller, p_essential, p_tenant_id, p_vin, p_estimated_cost_usd, 'gate_version_missing');
    RETURN;
  END IF;
  INSERT INTO public.provider_gate_heartbeats (caller, gate_version, last_seen) VALUES (left(p_caller, 80), p_gate_version, now())
  ON CONFLICT (caller) DO UPDATE SET gate_version = EXCLUDED.gate_version, last_seen = EXCLUDED.last_seen;
  IF p_provider <> 'marketcheck' THEN
    RETURN QUERY SELECT * FROM public.provider_call_admit_core(p_provider, p_product, p_caller, p_essential, p_tenant_id, p_vin, p_estimated_cost_usd);
    RETURN;
  END IF;
  IF p_catalog_product IS NULL OR NOT EXISTS (SELECT 1 FROM public.provider_product_catalog pc WHERE pc.account_ref = 'marketcheck_primary'
       AND pc.product_key = p_catalog_product AND pc.billing_product = p_product) THEN
    RETURN QUERY SELECT * FROM public.provider_call_admit_refuse(p_provider, p_product, p_caller, p_essential, p_tenant_id, p_vin, p_estimated_cost_usd, 'launch_product_mismatch');
    RETURN;
  END IF;
  SELECT * INTO g FROM public.marketcheck_launch_gate(p_caller, p_tenant_id, 'rest', p_store_id, p_catalog_product, p_vin, p_gate_version, NULL);
  IF g.reason IS NOT NULL THEN
    RETURN QUERY SELECT * FROM public.provider_call_admit_refuse(p_provider, p_product, p_caller, p_essential, p_tenant_id, p_vin, p_estimated_cost_usd, g.reason);
    RETURN;
  END IF;
  SELECT * INTO r FROM public.provider_call_admit_core(p_provider, p_product, p_caller, p_essential, p_tenant_id, p_vin, p_estimated_cost_usd);
  IF r.admitted AND r.event_id IS NOT NULL THEN
    UPDATE public.provider_call_events SET store_id = g.store_id, catalog_product = p_catalog_product, gate_version = p_gate_version WHERE id = r.event_id;
    UPDATE public.marketcheck_launch_work SET admissions = admissions + 1
     WHERE plan_version = (SELECT plan_version FROM public.marketcheck_launch_control WHERE id = 1)
       AND vin = upper(trim(p_vin)) AND product = p_catalog_product AND status = 'dispatched';
  END IF;
  RETURN QUERY SELECT r.admitted, r.event_id, r.month_calls, r.monthly_call_cap, r.reserve_for_essential, r.reason;
END $$;
REVOKE ALL ON FUNCTION public.provider_call_admit_v2(text, text, text, text, boolean, uuid, text, numeric, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.provider_call_admit_v2(text, text, text, text, boolean, uuid, text, numeric, uuid, text) TO service_role;

-- The account coordinator reserves a MarketCheck request only under the
-- same rooftop, product and caller rules, on every path into
-- provider_requests (provider_reserve, staff AI/MCP, or a direct insert).
-- A REST reservation must also be bound to the unused admission event that
-- provider_call_admit_v2 granted for the same caller, product and rooftop in
-- the last 10 minutes, so a reservation cannot stand in for an admission.
-- The resolved rooftop is written onto the row.
CREATE OR REPLACE FUNCTION public.provider_requests_launch_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE g record; e provider_call_events%ROWTYPE; v_reason text;
BEGIN
  IF NEW.account_ref <> 'marketcheck_primary' OR NEW.status <> 'reserved' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'reserved' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'launch_gate_closed: launch_reservation_reopen' USING ERRCODE = 'P0001';
  END IF;
  SELECT CASE WHEN emergency_stop THEN 'emergency_stop' WHEN NOT marketcheck_launch_is_active_state(state) THEN 'launch_inactive' END
    INTO v_reason FROM marketcheck_launch_control WHERE id = 1;
  IF v_reason IS NOT NULL THEN
    RAISE EXCEPTION 'launch_gate_closed: %', v_reason USING ERRCODE = 'P0001';
  END IF;
  IF NEW.channel = 'rest' THEN
    IF NEW.provider_event_id IS NULL THEN
      v_reason := 'launch_reservation_unbound';
    ELSE
      SELECT * INTO e FROM provider_call_events WHERE id = NEW.provider_event_id;
      IF e.id IS NULL OR e.provider <> 'marketcheck' OR e.outcome <> 'admitted' OR e.caller IS DISTINCT FROM NEW.caller
         OR e.catalog_product IS DISTINCT FROM NEW.product_key OR e.store_id IS NULL OR e.gate_version IS NULL
         OR e.tenant_id IS DISTINCT FROM NEW.tenant_id OR e.at < now() - interval '10 minutes'
         OR (NEW.store_id IS NOT NULL AND NEW.store_id <> e.store_id)
         OR upper(COALESCE(e.vin, '')) IS DISTINCT FROM upper(COALESCE(NEW.vin, '')) THEN
        v_reason := 'launch_reservation_unbound';
      ELSIF EXISTS (SELECT 1 FROM provider_requests r WHERE r.provider_event_id = NEW.provider_event_id
                     AND r.status NOT IN ('refused','joined','released')) THEN
        v_reason := 'launch_reservation_reused';
      END IF;
    END IF;
    IF v_reason IS NULL THEN
      SELECT * INTO g FROM marketcheck_launch_gate(NEW.caller, NEW.tenant_id, NEW.channel, e.store_id, NEW.product_key, NEW.vin, e.gate_version, NEW.provider_event_id);
      v_reason := g.reason;
    END IF;
  ELSE
    SELECT * INTO g FROM marketcheck_launch_gate(NEW.caller, NEW.tenant_id, NEW.channel, NEW.store_id, NEW.product_key, NEW.vin, NULL, NULL);
    v_reason := g.reason;
  END IF;
  IF v_reason IS NOT NULL THEN
    RAISE EXCEPTION 'launch_gate_closed: %', v_reason USING ERRCODE = 'P0001';
  END IF;
  NEW.store_id := g.store_id;
  NEW.group_id := (SELECT group_id FROM dealer_stores WHERE id = g.store_id);
  RETURN NEW;
END $$;
CREATE TRIGGER provider_requests_launch_guard BEFORE INSERT OR UPDATE OF status ON public.provider_requests
  FOR EACH ROW EXECUTE FUNCTION public.provider_requests_launch_guard();

-- ── The workload START begins ───────────────────────────────────────────
-- Vehicles of one rooftop that have never been decoded: no build sheet (or
-- only a generic one never asked for its own build), no stored NeoVIN
-- payload, no MarketCheck decode of the VIN in 90 days, and owned by that
-- rooftop alone. The specs_attempts counter is deliberately not used: on
-- 2026-11-01 it was stamped to the cap on vehicles that were never sent to
-- MarketCheck (the owner hold refused every call), so it is not evidence
-- that a VIN was asked. New cars first (stickers), then CPO, then used.
CREATE OR REPLACE FUNCTION public.marketcheck_launch_workload_candidates(p_store_id uuid, p_product text, p_limit integer)
RETURNS TABLE (vehicle_id uuid, tenant_id uuid, vin text, priority smallint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN QUERY
  SELECT vl.id, vl.tenant_id, upper(trim(vl.vin)),
         (CASE lower(COALESCE(vl.condition, '')) WHEN 'new' THEN 1 WHEN 'cpo' THEN 2 ELSE 3 END)::smallint
    FROM vehicle_listings vl
   WHERE vl.owning_store_id = p_store_id
     AND vl.tenant_id IS NOT NULL
     AND COALESCE(vl.status, '') <> 'archived'
     AND upper(trim(COALESCE(vl.vin, ''))) ~ '^[A-HJ-NPR-Z0-9]{17}$'
     AND (vl.mc_attributes->'build_sheet' IS NULL OR jsonb_typeof(vl.mc_attributes->'build_sheet') = 'null'
          OR (vl.mc_attributes->'build_sheet'->>'generic' = 'true' AND vl.mc_attributes->>'specs_strict_attempted' IS NULL))
     AND NOT EXISTS (SELECT 1 FROM neovin_snapshots ns WHERE upper(ns.vin) = upper(trim(vl.vin)))
     AND NOT EXISTS (SELECT 1 FROM provider_call_events e WHERE e.provider = 'marketcheck' AND upper(e.vin) = upper(trim(vl.vin))
                      AND e.product = 'neovin' AND e.outcome <> 'budget_denied' AND e.at > now() - interval '90 days')
     AND NOT EXISTS (SELECT 1 FROM marketcheck_launch_work w WHERE w.vin = upper(trim(vl.vin)) AND w.product = p_product
                      AND w.status IN ('queued','dispatched','done'))
     AND marketcheck_launch_vin_stores(vl.vin) = ARRAY[p_store_id]
   ORDER BY 4, vl.id
   LIMIT GREATEST(p_limit, 0);
END $$;

-- Queues one rooftop's share of the workload, at most the plan's
-- max_vehicles_per_store over the life of the plan. Returns rows queued.
CREATE OR REPLACE FUNCTION public.marketcheck_launch_enqueue(p_plan_version integer, p_store_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE p marketcheck_launch_plans%ROWTYPE; v_product text; v_room integer; v_n integer;
BEGIN
  SELECT * INTO p FROM marketcheck_launch_plans WHERE version = p_plan_version;
  IF p.workload IS NULL THEN RETURN 0; END IF;
  v_product := p.products[1];
  SELECT (p.workload->>'max_vehicles_per_store')::int - count(*) INTO v_room
    FROM marketcheck_launch_work WHERE plan_version = p.version AND store_id = p_store_id AND status <> 'cancelled';
  -- A vehicle cancelled by a rollback is queued again when the plan restarts.
  INSERT INTO marketcheck_launch_work AS mw (plan_version, store_id, tenant_id, vehicle_id, vin, product, priority)
  SELECT p.version, p_store_id, c.tenant_id, c.vehicle_id, c.vin, v_product, c.priority
    FROM marketcheck_launch_workload_candidates(p_store_id, v_product, v_room) c
  ON CONFLICT (plan_version, vin, product) DO UPDATE SET status = 'queued', attempts = 0, admissions = 0, request_id = NULL,
    dispatched_at = NULL, finished_at = NULL, result = NULL, enqueued_at = now(), store_id = EXCLUDED.store_id
    WHERE mw.status = 'cancelled';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END $$;

-- Transport for the dispatcher. These defaults refuse: the deployment
-- package (supabase/manual/marketcheck_launch_transport.sql) replaces them
-- with pg_net calls that read the project URL and service key from Vault at
-- run time, so no key is ever written into a cron command or this file.
CREATE OR REPLACE FUNCTION public.marketcheck_launch_transport_ready() RETURNS jsonb
LANGUAGE sql STABLE AS $$ SELECT jsonb_build_object('ready', false, 'reason', 'transport_not_installed') $$;
CREATE OR REPLACE FUNCTION public.marketcheck_launch_transport(p_function text, p_body jsonb) RETURNS bigint
LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'transport_not_configured'; END $$;
CREATE OR REPLACE FUNCTION public.marketcheck_launch_transport_result(p_request_id bigint) RETURNS jsonb
LANGUAGE sql STABLE AS $$ SELECT NULL::jsonb $$;

-- Run by the marketcheck-launch-dispatch cron job (and once by START). Only
-- while the launch is on: settles finished dispatches, then sends the next
-- vehicles to the workload caller, never more than the canary ceiling (or
-- the hourly and daily ceilings in the pilot) can absorb at the plan's
-- calls-per-vehicle. A canary that runs out of work, budget or time pauses
-- itself for review. It never contacts a provider itself: the caller it
-- invokes still passes the full gate for every call.
CREATE OR REPLACE FUNCTION public.marketcheck_launch_dispatch()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  c marketcheck_launch_control%ROWTYPE; p marketcheck_launch_plans%ROWTYPE; w marketcheck_launch_work%ROWTYPE;
  v_cpv integer; v_timeout integer; v_used integer; v_room integer; v_inflight integer; v_n integer; v_res jsonb; v_body jsonb;
  v_sent integer := 0; v_settled integer := 0; v_pause text; v_req bigint; v_ready jsonb;
BEGIN
  BEGIN
    SELECT * INTO c FROM marketcheck_launch_control WHERE id = 1 FOR UPDATE NOWAIT;
  EXCEPTION WHEN lock_not_available THEN RETURN jsonb_build_object('ok', false, 'reason', 'busy');
  END;
  IF c.emergency_stop THEN RETURN jsonb_build_object('ok', false, 'reason', 'emergency_stop', 'dispatched', 0); END IF;
  IF NOT marketcheck_launch_is_active_state(c.state) THEN RETURN jsonb_build_object('ok', false, 'reason', 'launch_inactive', 'dispatched', 0); END IF;
  SELECT * INTO p FROM marketcheck_launch_plans WHERE version = c.plan_version AND status = 'approved';
  IF p.version IS NULL OR p.workload IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'no_workload', 'dispatched', 0); END IF;
  v_cpv := (p.workload->>'calls_per_vehicle')::int;
  v_timeout := (p.workload->>'response_timeout_minutes')::int;

  -- 1. Settle what was sent.
  FOR w IN SELECT * FROM marketcheck_launch_work WHERE plan_version = p.version AND status = 'dispatched' ORDER BY id FOR UPDATE LOOP
    v_res := marketcheck_launch_transport_result(w.request_id);
    v_body := CASE WHEN jsonb_typeof(v_res->'body') = 'object' THEN v_res->'body' ELSE '{}'::jsonb END;
    IF v_res IS NULL THEN
      IF w.dispatched_at < now() - make_interval(mins => v_timeout) THEN
        UPDATE marketcheck_launch_work SET status = 'failed', finished_at = now(), result = jsonb_build_object('error', 'no_response') WHERE id = w.id;
        v_settled := v_settled + 1;
      END IF;
      CONTINUE;
    END IF;
    IF (v_res->>'status_code')::int = 200 AND v_body->>'ok' = 'true' THEN
      UPDATE marketcheck_launch_work SET status = 'done', finished_at = now(),
        result = jsonb_build_object('status_code', 200, 'endpoint', v_body->>'endpoint', 'admissions', w.admissions) WHERE id = w.id;
    ELSIF (v_body->>'retryable' = 'true' OR v_res->>'status_code' IS NULL) AND w.attempts < 2 THEN
      UPDATE marketcheck_launch_work SET status = 'queued', request_id = NULL, dispatched_at = NULL,
        result = jsonb_build_object('retry_after', COALESCE(v_body->>'error', v_res->>'error', 'transport_error')) WHERE id = w.id;
    ELSE
      UPDATE marketcheck_launch_work SET status = 'failed', finished_at = now(),
        result = jsonb_build_object('status_code', v_res->'status_code', 'error', COALESCE(v_body->>'error', v_res->>'error', 'unexpected_response')) WHERE id = w.id;
    END IF;
    v_settled := v_settled + 1;
  END LOOP;

  -- 2. How many more paid calls the ceilings can absorb.
  SELECT count(*) INTO v_inflight FROM marketcheck_launch_work WHERE plan_version = p.version AND status = 'dispatched';
  IF c.state = 'activating_canary' THEN
    IF now() > c.canary_started_at + make_interval(hours => p.canary_window_hours) THEN v_pause := 'canary_window_elapsed'; END IF;
    SELECT count(*) INTO v_used FROM provider_call_events
     WHERE provider = 'marketcheck' AND at >= c.canary_started_at AND outcome <> 'budget_denied';
    v_room := p.canary_max_calls - v_used;
  ELSE
    SELECT LEAST(p.hourly_call_ceiling - count(*) FILTER (WHERE at > now() - interval '1 hour'), p.daily_call_ceiling - count(*))
      INTO v_room FROM provider_call_events WHERE provider = 'marketcheck' AND at > now() - interval '24 hours' AND outcome <> 'budget_denied';
  END IF;
  v_n := GREATEST(0, LEAST((p.workload->>'batch_size')::int - v_inflight, (v_room - v_inflight * v_cpv) / v_cpv));

  -- 3. Send the next vehicles, each re-checked against the live rooftop scope.
  IF v_pause IS NULL AND v_n > 0 THEN
    v_ready := marketcheck_launch_transport_ready();
    IF NOT COALESCE((v_ready->>'ready')::boolean, false) THEN
      PERFORM marketcheck_launch_log('dispatch', 'failed', c.state, c.state, p.version, jsonb_build_object('reason', 'transport_not_ready', 'transport', v_ready), 'service');
      RETURN jsonb_build_object('ok', false, 'reason', 'transport_not_ready', 'dispatched', 0, 'settled', v_settled);
    END IF;
    FOR w IN SELECT * FROM marketcheck_launch_work WHERE plan_version = p.version AND status = 'queued' AND store_id = ANY (c.active_store_ids)
              ORDER BY priority, id LIMIT v_n FOR UPDATE SKIP LOCKED LOOP
      IF marketcheck_launch_vin_stores(w.vin) <> ARRAY[w.store_id] THEN
        UPDATE marketcheck_launch_work SET status = 'cancelled', finished_at = now(), result = jsonb_build_object('error', 'ownership_changed') WHERE id = w.id;
        CONTINUE;
      END IF;
      v_req := marketcheck_launch_transport(p.workload->>'function',
        jsonb_build_object('vin', w.vin, 'tenant_id', w.tenant_id, 'vehicle_id', w.vehicle_id, 'launch_work_id', w.id));
      UPDATE marketcheck_launch_work SET status = 'dispatched', attempts = attempts + 1, admissions = 0, request_id = v_req, dispatched_at = now() WHERE id = w.id;
      v_sent := v_sent + 1;
    END LOOP;
  END IF;

  -- 4. A canary with nothing left to do, no room left or no time left stops
  -- for review; promotion to the pilot is a separate, rechecked action.
  IF c.state = 'activating_canary' AND v_pause IS NULL AND v_sent = 0 AND v_inflight = 0
     AND NOT EXISTS (SELECT 1 FROM marketcheck_launch_work WHERE plan_version = p.version AND status = 'dispatched') THEN
    IF NOT EXISTS (SELECT 1 FROM marketcheck_launch_work WHERE plan_version = p.version AND status = 'queued' AND store_id = ANY (c.active_store_ids)) THEN
      v_pause := 'canary_workload_complete';
    ELSIF v_room < v_cpv THEN
      v_pause := 'canary_ceiling_reached';
    END IF;
  END IF;
  IF v_pause IS NOT NULL THEN
    UPDATE marketcheck_launch_control SET state = 'paused', paused_reason = v_pause, paused_at = now(), updated_at = now() WHERE id = 1;
    PERFORM marketcheck_launch_log('workload_pause', 'ok', c.state, 'paused', p.version, jsonb_build_object('reason', v_pause), 'service');
  END IF;
  IF v_sent > 0 OR v_settled > 0 THEN
    PERFORM marketcheck_launch_log('dispatch', 'ok', c.state, COALESCE(CASE WHEN v_pause IS NOT NULL THEN 'paused' END, c.state), p.version,
      jsonb_build_object('dispatched', v_sent, 'settled', v_settled, 'room', v_room, 'in_flight', v_inflight), 'service');
  END IF;
  RETURN jsonb_build_object('ok', true, 'dispatched', v_sent, 'settled', v_settled, 'room', v_room, 'paused', v_pause);
END $$;

-- The dispatcher's schedule is created OFF. Only activation turns it on, and
-- the emergency stop and rollback turn it off again.
DO $$
BEGIN
  IF to_regclass('cron.job') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'marketcheck-launch-dispatch') THEN
    PERFORM cron.schedule('marketcheck-launch-dispatch', '*/5 * * * *', 'SELECT public.marketcheck_launch_dispatch()');
    PERFORM cron.alter_job((SELECT jobid FROM cron.job WHERE jobname = 'marketcheck-launch-dispatch'), active => false);
  END IF;
END $$;

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
      'public.store_enrichment_admit(uuid,text,text,text,text,numeric)', 'public.provider_call_admit_v2(text,text,text,text,boolean,uuid,text,numeric,uuid,text)']) x
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

  -- 6. The canary rooftop's own feed identity. The pilot needs only this
  -- store: sister rooftops are reported (6b) but never block it, and each
  -- is revalidated when its own expansion is approved.
  v_ok := p.version IS NOT NULL AND marketcheck_launch_store_identity_ok(p.canary_store_id);
  v := v || jsonb_build_object('key','canary_mapping','label','Canary rooftop feed identity','mandatory',true,
    'status', CASE WHEN p.version IS NULL THEN 'unverified' WHEN v_ok THEN 'passed' ELSE 'failed' END,
    'summary', CASE WHEN p.version IS NULL THEN 'No canary store selected.'
      WHEN v_ok THEN format('%s has exactly one approved feed mapping whose identity matched, and its DealerId is mapped to no other store.',
        (SELECT display_name FROM dealer_stores WHERE id = p.canary_store_id))
      ELSE 'The canary store needs exactly one approved feed mapping with a matching identity, mapped to no other store.' END);

  -- 6b. All rooftops in the plan, for display. Not mandatory for the canary.
  SELECT COALESCE(jsonb_agg(jsonb_build_object('store_id', s.id, 'name', s.display_name, 'role', CASE WHEN s.id = p.canary_store_id THEN 'canary' ELSE 'expansion' END,
      'order', x.o, 'identity_verified', marketcheck_launch_store_identity_ok(s.id), 'feed_paused', s.feed_import_paused, 'store_status', s.status,
      'mapping', (SELECT jsonb_build_object('source_dealer_id', m.source_dealer_id, 'status', m.status, 'verdict', m.evidence->'approved_comparison'->>'verdict')
                    FROM inventory_source_mappings m WHERE m.store_id = s.id ORDER BY (m.status = 'approved') DESC, m.approved_at DESC NULLS LAST LIMIT 1),
      'feed_clean', marketcheck_launch_store_feed_clean(s.id, COALESCE(p.feed_max_age_hours, 9)),
      'policy_ready', EXISTS (SELECT 1 FROM store_enrichment_policies sp WHERE sp.store_id = s.id AND sp.mc_rooftop_verified_at IS NOT NULL AND sp.credential_ref IS NOT NULL),
      'active_in_launch', s.id = ANY (c.active_store_ids)) ORDER BY x.o), '[]'::jsonb)
    INTO v_detail
    FROM (SELECT p.canary_store_id sid, 0 o UNION ALL SELECT (e->>'store_id')::uuid, (e->>'order')::int FROM jsonb_array_elements(COALESCE(p.rollout, '[]'::jsonb)) e) x
    JOIN dealer_stores s ON s.id = x.sid;
  SELECT count(*) FILTER (WHERE (e->>'identity_verified')::boolean), count(*) INTO v_m, v_n FROM jsonb_array_elements(v_detail) e;
  v := v || jsonb_build_object('key','rooftop_mappings','label','All plan rooftops (expansion readiness)','mandatory',false,
    'status', CASE WHEN v_n > 0 AND v_m = v_n THEN 'passed' ELSE 'failed' END,
    'summary', format('%s of %s plan rooftops have a verified feed identity. Sister rooftops do not block the canary; each is revalidated at its own expansion.', v_m, v_n),
    'detail', jsonb_build_object('stores', v_detail));
  v_detail := NULL;

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
    EXECUTE $q$SELECT count(*) FROM cron.job WHERE active AND command ~ '(/functions/v1/files-inventory-worker|files_inventory_worker_tick)'$q$ INTO v_m;
    EXECUTE $q$SELECT count(*) FROM cron.job WHERE command ~ 'marketcheck_launch_dispatch'$q$ INTO v_txt;
    v := v || jsonb_build_object('key','schedulers','label','Schedulers and duplicate-job checks','mandatory',true,
      'status', CASE WHEN v_n = 0 AND v_m = 1 AND v_txt = '1' THEN 'passed' ELSE 'failed' END,
      'summary', CASE WHEN v_n > 0 THEN format('%s function(s) have more than one active cron job.', v_n)
        WHEN v_m = 0 THEN 'The Files.com inventory worker has no active schedule, so feeds are not imported on cadence.'
        WHEN v_m > 1 THEN format('The Files.com inventory worker is scheduled %s times.', v_m)
        WHEN v_txt <> '1' THEN format('Expected exactly one marketcheck-launch-dispatch job, found %s.', v_txt)
        ELSE 'One feed worker schedule, one workload dispatcher (off until START); no duplicate jobs.' END,
      'detail', jsonb_build_object('marketcheck_jobs', v_cron));
  END IF;

  -- 9b. The workload START begins: defined, its transport installed, and
  -- real canary vehicles waiting for a first decode.
  v_n := 0;
  IF p.version IS NOT NULL AND p.workload IS NOT NULL THEN
    -- Vehicles waiting for a first decode, plus the plan's own work already
    -- queued or finished (a running or paused launch has used its candidates).
    SELECT count(*) INTO v_n FROM marketcheck_launch_workload_candidates(p.canary_store_id, p.products[1], (p.workload->>'max_vehicles_per_store')::int);
    v_n := v_n + (SELECT count(*) FROM marketcheck_launch_work WHERE plan_version = p.version AND store_id = p.canary_store_id AND status <> 'cancelled');
    v_detail := marketcheck_launch_transport_ready();
  END IF;
  v_ok := p.workload IS NOT NULL AND COALESCE((v_detail->>'ready')::boolean, false) AND v_n > 0;
  v := v || jsonb_build_object('key','workload','label','Canary enrichment workload','mandatory',true,
    'status', CASE WHEN p.version IS NULL THEN 'unverified' WHEN v_ok THEN 'passed' ELSE 'failed' END,
    'summary', CASE WHEN p.version IS NULL THEN 'No plan.'
      WHEN p.workload IS NULL THEN 'The plan defines no workload, so START would only open the gate.'
      WHEN NOT COALESCE((v_detail->>'ready')::boolean, false) THEN 'The dispatcher transport is not installed or its Vault secrets are missing: ' || COALESCE(v_detail->>'reason', 'unknown')
      WHEN v_n = 0 THEN 'No canary vehicle is waiting for a first NeoVIN decode.'
      ELSE format('START queues %s canary vehicle(s) for NeoVIN, at most %s call(s) each, %s at a time, inside the %s-call canary ceiling.',
        v_n, p.workload->>'calls_per_vehicle', p.workload->>'batch_size', p.canary_max_calls) END,
    'detail', jsonb_build_object('candidates', v_n, 'workload', p.workload, 'transport', v_detail));
  v_detail := NULL;

  -- 10. Deployed gate version: every approved caller seen on the required
  -- version, from the admission heartbeat the deployed code writes itself.
  -- A refused admission records it too, so this needs no paid call.
  IF p.version IS NOT NULL THEN
    v_missing := ARRAY(SELECT x FROM unnest(p.allowed_callers) x WHERE NOT EXISTS (
      SELECT 1 FROM provider_gate_heartbeats h WHERE h.caller = x AND h.gate_version = p.required_gate_version AND h.last_seen > now() - interval '7 days'));
  END IF;
  v := v || jsonb_build_object('key','edge_versions','label','Edge function versions','mandatory',true,
    'status', CASE WHEN p.version IS NULL THEN 'unverified' WHEN cardinality(v_missing) = 0 THEN 'passed' ELSE 'unverified' END,
    'summary', CASE WHEN p.version IS NULL THEN 'No plan.' WHEN cardinality(v_missing) = 0 THEN format('All approved callers reported gate %s in the last 7 days.', p.required_gate_version)
      ELSE format('Not yet seen on gate %s: %s.', p.required_gate_version, array_to_string(v_missing, ', ')) END,
    'detail', (SELECT COALESCE(jsonb_agg(to_jsonb(h)), '[]'::jsonb) FROM provider_gate_heartbeats h WHERE h.caller = ANY (COALESCE(p.allowed_callers, '{}'))));

  -- 11. Cost controls: an owner-approved account dollar cap, verified prices
  -- for every plan product, and a dollar cap on the canary store.
  v_missing := ARRAY(SELECT x FROM unnest(COALESCE(p.products, '{}')) x
    WHERE NOT EXISTS (SELECT 1 FROM provider_product_catalog pc WHERE pc.account_ref = 'marketcheck_primary' AND pc.product_key = x
                       AND pc.rate_status = 'verified' AND pc.rate_usd IS NOT NULL));
  v_ok := p.version IS NOT NULL AND p.account_usd_cap IS NOT NULL AND cardinality(v_missing) = 0
          AND pol.store_id IS NOT NULL AND pol.monthly_usd_cap IS NOT NULL AND pol.monthly_usd_cap <= p.account_usd_cap
          AND (p.canary_store_usd_cap IS NULL OR pol.monthly_usd_cap <= p.canary_store_usd_cap);
  v := v || jsonb_build_object('key','cost_controls','label','Dollar caps and verified pricing','mandatory',true,
    'status', CASE WHEN p.version IS NULL THEN 'unverified' WHEN v_ok THEN 'passed' ELSE 'failed' END,
    'summary', CASE WHEN p.version IS NULL THEN 'No plan.'
      WHEN p.account_usd_cap IS NULL THEN 'The plan has no owner-approved account dollar cap.'
      WHEN cardinality(v_missing) > 0 THEN 'No verified account price for: ' || array_to_string(v_missing, ', ')
      WHEN pol.store_id IS NULL OR pol.monthly_usd_cap IS NULL THEN 'The canary store has no monthly dollar cap.'
      WHEN pol.monthly_usd_cap > p.account_usd_cap THEN 'The canary store dollar cap is above the account cap.'
      WHEN pol.monthly_usd_cap > p.canary_store_usd_cap THEN format('The canary store dollar cap $%s is above the plan''s $%s.', pol.monthly_usd_cap, p.canary_store_usd_cap)
      ELSE format('Account cap $%s; canary store cap $%s; plan products priced from the account.', p.account_usd_cap, pol.monthly_usd_cap) END,
    'detail', jsonb_build_object('account_usd_cap', p.account_usd_cap, 'current_account_usd_cap', a.monthly_usd_cap, 'canary_store_usd_cap', pol.monthly_usd_cap,
      'plan_canary_store_usd_cap', p.canary_store_usd_cap,
      'prices', (SELECT COALESCE(jsonb_object_agg(pc.product_key, jsonb_build_object('rate_usd', pc.rate_usd, 'rate_status', pc.rate_status)), '{}'::jsonb)
                   FROM provider_product_catalog pc WHERE pc.account_ref = 'marketcheck_primary' AND pc.product_key = ANY (COALESCE(p.products, '{}')))));

  -- 12. Real-data sticker generation on the canary store, from the
  -- orchestrator's own records: a rendered document whose MSRP reconciled
  -- and whose QR and visual QA passed, in the last 7 days.
  v_n := 0;
  IF p.version IS NOT NULL AND to_regclass('public.factory_sticker_records') IS NOT NULL THEN
    EXECUTE $q$SELECT count(*) FROM factory_sticker_records r JOIN vehicle_listings vl ON vl.id = r.vehicle_id
      WHERE vl.owning_store_id = $1 AND r.current_document_id IS NOT NULL AND r.reconciliation_status = 'MATCHED'
        AND r.qr_identity_qa_status = 'PASS' AND r.visual_qa_status = 'PASS' AND r.updated_at > now() - interval '7 days'$q$
      INTO v_n USING p.canary_store_id;
  END IF;
  v := v || jsonb_build_object('key','sticker_generation','label','Real-data sticker generation','mandatory',true,
    'status', CASE WHEN p.version IS NULL THEN 'unverified' WHEN v_n > 0 THEN 'passed' ELSE 'failed' END,
    'summary', CASE WHEN p.version IS NULL THEN 'No plan.' WHEN v_n > 0 THEN format('%s canary-store sticker(s) rendered with MSRP matched and QR/visual QA passed in the last 7 days.', v_n)
      ELSE 'No canary-store sticker has rendered with MSRP matched and QR/visual QA passed in the last 7 days.' END);

  -- 13. Emergency stop drill, written by marketcheck_launch_stop_drill only.
  v_att := NULL;
  SELECT * INTO v_att FROM marketcheck_launch_checks WHERE check_key = 'stop_drill' AND verified_at > now() - interval '7 days';
  v := v || jsonb_build_object('key','stop_drill','label','Emergency stop drill','mandatory',true,
    'status', COALESCE(v_att.status, 'unverified'),
    'summary', COALESCE(v_att.summary, 'No stop drill in the last 7 days.'),
    'detail', jsonb_build_object('verified_at', v_att.verified_at, 'verified_by', v_att.verified_by, 'boundaries', v_att.detail));

  -- 14-18. Evidence that SQL cannot compute, attested with a reference.
  FOREACH k IN ARRAY ARRAY['credentials','mcp_boundary','quota_concurrency','sticker_templates','print_passport_qa'] LOOP
    v_att := NULL;
    SELECT * INTO v_att FROM marketcheck_launch_checks WHERE check_key = k AND verified_at > now() - interval '7 days';
    v := v || jsonb_build_object('key', k, 'label', CASE k
        WHEN 'credentials' THEN 'MarketCheck account credentials'
        WHEN 'mcp_boundary' THEN 'Outside MarketCheck access (MCP connector, other keys)'
        WHEN 'quota_concurrency' THEN 'Quota reservation concurrency'
        WHEN 'sticker_templates' THEN 'Sticker template coverage'
        WHEN 'print_passport_qa' THEN 'Print and Passport QA' END,
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
    'workload', jsonb_build_object('definition', p.workload,
      'counts', (SELECT COALESCE(jsonb_object_agg(status, n), '{}'::jsonb) FROM (SELECT status, count(*) n FROM marketcheck_launch_work WHERE plan_version = p.version GROUP BY 1) q),
      'admissions', (SELECT COALESCE(sum(admissions), 0) FROM marketcheck_launch_work WHERE plan_version = p.version),
      'last_dispatch', (SELECT max(at) FROM marketcheck_launch_events WHERE action = 'dispatch' AND result = 'ok')),
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
  -- records credentials only.
  IF v_uid IS NULL THEN
    IF p_check_key <> 'credentials' THEN RAISE EXCEPTION 'platform_admin_required' USING ERRCODE = '42501'; END IF;
  ELSE PERFORM inv_require_platform_admin(); END IF;
  -- Gate version, sticker generation and the stop drill are machine evidence
  -- and cannot be attested by hand.
  IF p_check_key NOT IN ('credentials','mcp_boundary','quota_concurrency','sticker_templates','print_passport_qa') THEN
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
  IF NOT EXISTS (SELECT 1 FROM marketcheck_launch_plans WHERE version = p_version AND status = 'draft') THEN RAISE EXCEPTION 'plan_not_draft'; END IF;
  IF (SELECT account_usd_cap FROM marketcheck_launch_plans WHERE version = p_version) IS NULL THEN RAISE EXCEPTION 'usd_cap_required'; END IF;
  UPDATE marketcheck_launch_plans SET status = 'retired' WHERE status = 'approved' AND version <> p_version;
  UPDATE marketcheck_launch_plans SET status = 'approved', approved_by = v_uid, approved_at = now() WHERE version = p_version AND status = 'draft';
  PERFORM marketcheck_launch_log('approve_plan', 'ok', c.state, c.state, p_version, '{}'::jsonb);
  RETURN jsonb_build_object('ok', true, 'version', p_version);
END $$;

-- The owner's dollar ceiling for a draft plan. Approval refuses a plan
-- without one; an approved plan's cap changes only through a new version.
CREATE OR REPLACE FUNCTION public.marketcheck_launch_set_plan_usd_cap(p_version integer, p_usd_cap numeric)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := inv_require_platform_admin();
BEGIN
  IF p_usd_cap IS NULL OR p_usd_cap <= 0 OR p_usd_cap > 100000 THEN RAISE EXCEPTION 'invalid_usd_cap'; END IF;
  UPDATE marketcheck_launch_plans SET account_usd_cap = round(p_usd_cap, 2) WHERE version = p_version AND status = 'draft';
  IF NOT FOUND THEN RAISE EXCEPTION 'plan_not_draft'; END IF;
  PERFORM marketcheck_launch_log('set_plan_usd_cap', 'ok', NULL, NULL, p_version, jsonb_build_object('account_usd_cap', round(p_usd_cap, 2)));
  RETURN jsonb_build_object('ok', true, 'version', p_version, 'account_usd_cap', round(p_usd_cap, 2));
END $$;

-- Start MarketCheck & Inventory Intelligence. Rechecks everything server-side
-- and only then opens the gate for the canary store.
CREATE OR REPLACE FUNCTION public.marketcheck_launch_activate(p_plan_version integer, p_confirm text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := inv_require_platform_admin(); c marketcheck_launch_control%ROWTYPE; p marketcheck_launch_plans%ROWTYPE;
  a provider_accounts%ROWTYPE; r jsonb; v_failed jsonb; v_prev_budget jsonb; v_prev_pol jsonb; v_prev_cron jsonb := '[]'::jsonb; j jsonb;
  v_enq integer; v_disp jsonb;
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
  SELECT to_jsonb(b) || jsonb_build_object('account_usd_cap', a.monthly_usd_cap) INTO v_prev_budget FROM provider_call_budgets b WHERE provider = 'marketcheck';
  SELECT COALESCE(jsonb_agg(jsonb_build_object('store_id', store_id, 'mode', mode)), '[]'::jsonb) INTO v_prev_pol FROM store_enrichment_policies;
  FOR j IN SELECT * FROM jsonb_array_elements(p.cron_jobs) LOOP
    v_prev_cron := v_prev_cron || COALESCE(marketcheck_launch_cron_state(j->>'jobname'), jsonb_build_object('jobname', j->>'jobname', 'missing', true));
  END LOOP;

  -- The platform budget follows the account quota and reserve from now on.
  UPDATE provider_call_budgets SET monthly_call_cap = a.monthly_call_quota, reserve_for_essential = a.protected_reserve, enabled = true,
    notes = COALESCE(notes, '') || format(E'\n%s launch plan v%s activated by %s; previous row kept in marketcheck_launch_control.previous_budget.', now(), p.version, v_uid),
    updated_at = now()
  WHERE provider = 'marketcheck';
  UPDATE provider_accounts SET monthly_usd_cap = p.account_usd_cap, updated_by = v_uid, updated_at = now() WHERE account_ref = 'marketcheck_primary';
  UPDATE store_enrichment_policies SET mode = 'enrichment', budget_blocked = false, updated_by = v_uid, updated_at = now()
   WHERE store_id = p.canary_store_id;
  FOR j IN SELECT * FROM jsonb_array_elements(p.cron_jobs) LOOP
    IF NOT marketcheck_launch_cron_set(j->>'jobname', j->>'schedule', true) AND to_regclass('cron.job') IS NOT NULL THEN
      RAISE EXCEPTION 'cron_job_missing: %', j->>'jobname';
    END IF;
  END LOOP;
  UPDATE marketcheck_launch_control SET state = 'activating_canary', plan_version = p.version, active_store_ids = ARRAY[p.canary_store_id],
    activated_at = now(), activated_by = v_uid, canary_started_at = now(), pilot_started_at = NULL, last_expanded_at = NULL, paused_reason = NULL, paused_at = NULL,
    previous_budget = v_prev_budget, previous_policies = v_prev_pol, previous_cron = v_prev_cron, updated_at = now(), updated_by = v_uid
  WHERE id = 1;
  -- START begins the work: queue the canary's vehicles and send the first
  -- batch now; the dispatcher job carries on every few minutes. The calls
  -- leave only after this transaction commits.
  v_enq := marketcheck_launch_enqueue(p.version, p.canary_store_id);
  IF p.workload IS NOT NULL AND v_enq = 0 THEN
    RAISE EXCEPTION 'workload_empty';
  END IF;
  PERFORM marketcheck_launch_log('activate', 'ok', c.state, 'activating_canary', p.version,
    jsonb_build_object('canary_store_id', p.canary_store_id, 'canary_max_calls', p.canary_max_calls, 'products', p.products,
      'callers', p.allowed_callers, 'cron_jobs', p.cron_jobs, 'workload_queued', v_enq, 'readiness_evaluated_at', r->'evaluated_at'));
  v_disp := CASE WHEN p.workload IS NOT NULL THEN marketcheck_launch_dispatch() END;
  RETURN jsonb_build_object('ok', true, 'state', 'activating_canary', 'plan_version', p.version, 'workload_queued', v_enq, 'first_dispatch', v_disp);
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
  IF c.paused_reason IN ('canary_ceiling_reached','canary_window_elapsed','canary_workload_complete') THEN
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
-- plan order, only after the plan's waiting period, and only after the
-- rooftop's full policy, identity and latest feed are revalidated now.
CREATE OR REPLACE FUNCTION public.marketcheck_launch_expand(p_store_id uuid, p_confirm text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := inv_require_platform_admin(); c marketcheck_launch_control%ROWTYPE; p marketcheck_launch_plans%ROWTYPE;
  v_next jsonb; pol store_enrichment_policies%ROWTYPE; s dealer_stores%ROWTYPE; v_since timestamptz; v_reason text; v_billing text[];
BEGIN
  IF p_confirm IS DISTINCT FROM 'EXPAND' THEN RAISE EXCEPTION 'confirmation_required'; END IF;
  SELECT * INTO c FROM marketcheck_launch_control WHERE id = 1 FOR UPDATE;
  IF c.emergency_stop OR c.state NOT IN ('pilot_active','expanding') THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_in_pilot'); END IF;
  SELECT * INTO p FROM marketcheck_launch_plans WHERE version = c.plan_version AND status = 'approved';
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'plan_not_approved'); END IF;
  SELECT x INTO v_next FROM jsonb_array_elements(p.rollout) x
   WHERE NOT ((x->>'store_id')::uuid = ANY (c.active_store_ids)) ORDER BY (x->>'order')::int LIMIT 1;
  IF v_next IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'rollout_complete'); END IF;
  IF (v_next->>'store_id')::uuid <> p_store_id THEN RETURN jsonb_build_object('ok', false, 'reason', 'out_of_order', 'next_store_id', v_next->>'store_id'); END IF;
  v_since := COALESCE(c.last_expanded_at, c.pilot_started_at, c.activated_at);
  IF now() < v_since + make_interval(hours => COALESCE((v_next->>'min_hours_after_previous')::int, 24)) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'waiting_period', 'eligible_at', v_since + make_interval(hours => COALESCE((v_next->>'min_hours_after_previous')::int, 24)));
  END IF;
  SELECT * INTO s FROM dealer_stores WHERE id = p_store_id;
  SELECT * INTO pol FROM store_enrichment_policies WHERE store_id = p_store_id;
  v_billing := ARRAY(SELECT pc.billing_product FROM provider_product_catalog pc WHERE pc.account_ref = 'marketcheck_primary' AND pc.product_key = ANY (p.products));
  v_reason := CASE
    WHEN s.id IS NULL OR s.status <> 'active' OR s.feed_import_paused THEN 'store_feed_not_live'
    WHEN s.tenant_id IS DISTINCT FROM (SELECT tenant_id FROM dealer_stores WHERE id = p.canary_store_id) THEN 'store_outside_plan_tenant'
    WHEN NOT marketcheck_launch_store_identity_ok(p_store_id) THEN 'store_identity_unverified'
    WHEN pol.store_id IS NULL OR pol.mc_rooftop_verified_at IS NULL OR pol.credential_ref IS NULL THEN 'store_policy_not_ready'
    WHEN pol.daily_request_limit <= 0 OR pol.monthly_request_cap <= 0 OR pol.daily_request_limit > p.daily_call_ceiling THEN 'store_limits_invalid'
    WHEN pol.monthly_usd_cap IS NULL OR pol.monthly_usd_cap > p.account_usd_cap THEN 'store_usd_cap_missing'
    WHEN cardinality(v_billing) <> cardinality(p.products) OR NOT (pol.allowed_products @> v_billing) THEN 'store_products_not_allowed'
    WHEN NOT marketcheck_launch_store_feed_clean(p_store_id, p.feed_max_age_hours) THEN 'store_feed_not_clean'
    WHEN EXISTS (SELECT 1 FROM inventory_feed_controls WHERE emergency_stop OR ingestion_paused) THEN 'feed_paused_or_stopped'
    END;
  IF v_reason IS NOT NULL THEN
    PERFORM marketcheck_launch_log('expand', 'refused', c.state, c.state, c.plan_version, jsonb_build_object('store_id', p_store_id, 'reason', v_reason));
    RETURN jsonb_build_object('ok', false, 'reason', v_reason);
  END IF;
  UPDATE store_enrichment_policies SET mode = 'enrichment', budget_blocked = false, updated_by = v_uid, updated_at = now() WHERE store_id = p_store_id;
  UPDATE marketcheck_launch_control SET state = 'expanding', active_store_ids = active_store_ids || p_store_id, last_expanded_at = now(),
    updated_at = now(), updated_by = v_uid WHERE id = 1;
  v_reason := marketcheck_launch_enqueue(c.plan_version, p_store_id)::text;
  PERFORM marketcheck_launch_log('expand', 'ok', c.state, 'expanding', c.plan_version, jsonb_build_object('store_id', p_store_id, 'workload_queued', v_reason::int));
  RETURN jsonb_build_object('ok', true, 'state', 'expanding', 'workload_queued', v_reason::int);
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
    UPDATE provider_accounts SET monthly_usd_cap = (c.previous_budget->>'account_usd_cap')::numeric, updated_at = now() WHERE account_ref = 'marketcheck_primary';
  END IF;
  IF c.previous_policies IS NOT NULL THEN
    UPDATE store_enrichment_policies sp SET mode = COALESCE((SELECT x->>'mode' FROM jsonb_array_elements(c.previous_policies) x WHERE (x->>'store_id')::uuid = sp.store_id), 'feed_only'),
      updated_at = now();
  END IF;
  FOR j IN SELECT * FROM jsonb_array_elements(COALESCE(c.previous_cron, '[]'::jsonb)) LOOP
    IF NOT COALESCE((j->>'missing')::boolean, false) THEN PERFORM marketcheck_launch_cron_set(j->>'jobname', j->>'schedule', (j->>'active')::boolean); END IF;
  END LOOP;
  UPDATE marketcheck_launch_work SET status = 'cancelled', finished_at = now(), result = jsonb_build_object('error', 'rolled_back')
   WHERE status IN ('queued','dispatched');
  UPDATE marketcheck_launch_control SET state = 'not_ready', emergency_stop = false, active_store_ids = '{}', activated_at = NULL, activated_by = NULL,
    canary_started_at = NULL, pilot_started_at = NULL, last_expanded_at = NULL, paused_reason = NULL, paused_at = NULL,
    previous_budget = NULL, previous_policies = NULL, previous_cron = NULL, updated_at = now(), updated_by = v_uid WHERE id = 1;
  PERFORM marketcheck_launch_log('rollback', 'ok', c.state, 'not_ready', c.plan_version,
    jsonb_build_object('restored_budget', c.previous_budget IS NOT NULL, 'restored_policies', c.previous_policies IS NOT NULL, 'restored_cron', c.previous_cron));
  RETURN jsonb_build_object('ok', true, 'state', 'not_ready');
END $$;

-- Drill, only while OFF: engages the real emergency stop inside a
-- subtransaction, then tries the real boundaries a paid call would cross:
-- provider_call_admit_v2 for every approved caller, the pre-release
-- provider_call_admit, provider_reserve, and a direct reservation insert. It
-- reads the cron table while the stop holds, then rolls the subtransaction
-- back, so nothing it did persists except the evidence row and audit event.
-- No provider is contacted.
CREATE OR REPLACE FUNCTION public.marketcheck_launch_stop_drill()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := inv_require_platform_admin(); c marketcheck_launch_control%ROWTYPE; p marketcheck_launch_plans%ROWTYPE;
  v_tenant uuid; v_product text; v_billing text; v_caller text; v_admit jsonb := '{}'::jsonb; v_old text; v_reserve text; v_direct text;
  v_cron_before jsonb; v_cron_during jsonb; v_cron_after jsonb; v_flag boolean; v_ok boolean; v_detail jsonb; v_summary text; v_dispatch text;
BEGIN
  SELECT * INTO c FROM marketcheck_launch_control WHERE id = 1 FOR UPDATE;
  IF c.state NOT IN ('not_ready','ready_to_activate') OR c.emergency_stop THEN RETURN jsonb_build_object('ok', false, 'reason', 'drill_only_when_off'); END IF;
  SELECT * INTO p FROM marketcheck_launch_plans WHERE version = COALESCE(c.plan_version,
    (SELECT max(version) FROM marketcheck_launch_plans WHERE status = 'approved'), (SELECT max(version) FROM marketcheck_launch_plans WHERE status = 'draft'));
  v_product := COALESCE(p.products[1], 'neovin');
  SELECT billing_product INTO v_billing FROM provider_product_catalog WHERE account_ref = 'marketcheck_primary' AND product_key = v_product;
  SELECT tenant_id INTO v_tenant FROM dealer_stores WHERE id = p.canary_store_id;
  v_cron_before := marketcheck_launch_cron_jobs();
  BEGIN
    PERFORM marketcheck_emergency_stop('stop drill (rolled back)');
    SELECT emergency_stop INTO v_flag FROM marketcheck_launch_control WHERE id = 1;
    FOREACH v_caller IN ARRAY COALESCE(p.allowed_callers, ARRAY['marketcheck-specs']) LOOP
      v_admit := v_admit || jsonb_build_object(v_caller, (SELECT reason FROM provider_call_admit_v2('marketcheck', COALESCE(v_billing, 'neovin'), v_caller,
        COALESCE(p.required_gate_version, 'drill'), true, v_tenant, NULL, 0, p.canary_store_id, v_product)));
    END LOOP;
    SELECT reason INTO v_old FROM provider_call_admit('marketcheck', COALESCE(v_billing, 'neovin'), 'stop-drill', true, v_tenant, NULL, 0);
    BEGIN
      v_reserve := 'not_refused: ' || provider_reserve('marketcheck_primary', v_product, COALESCE(p.allowed_callers[1], 'marketcheck-specs'), 'stop_drill', 1,
        v_tenant, p.canary_store_id, NULL, 'stop-drill-' || gen_random_uuid(), 0, false, NULL, 30, '{}'::jsonb)::text;
    EXCEPTION WHEN raise_exception THEN v_reserve := SQLERRM; END;
    BEGIN
      INSERT INTO provider_requests (account_ref, product_key, caller, reason, priority, channel, tenant_id, store_id, status)
      VALUES ('marketcheck_primary', v_product, 'stop-drill', 'stop_drill', 1, 'mcp', v_tenant, p.canary_store_id, 'reserved');
      v_direct := 'not_refused';
    EXCEPTION WHEN raise_exception THEN v_direct := SQLERRM; END;
    v_dispatch := marketcheck_launch_dispatch()->>'reason';
    v_cron_during := marketcheck_launch_cron_jobs();
    RAISE EXCEPTION 'stop_drill_rollback';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'stop_drill_rollback' THEN RAISE; END IF;
  END;
  v_cron_after := marketcheck_launch_cron_jobs();
  v_ok := v_flag IS TRUE
    AND NOT EXISTS (SELECT 1 FROM jsonb_each_text(v_admit) e WHERE e.value IS DISTINCT FROM 'emergency_stop')
    AND v_old = 'gate_upgrade_required'
    AND v_reserve = 'launch_gate_closed: emergency_stop'
    AND v_direct = 'launch_gate_closed: emergency_stop'
    AND v_dispatch = 'emergency_stop'
    AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_cron_during) j WHERE (j->>'active')::boolean)
    AND v_cron_after = v_cron_before
    AND (SELECT state = c.state AND NOT emergency_stop FROM marketcheck_launch_control WHERE id = 1);
  v_detail := jsonb_build_object('admission_v2', v_admit, 'admission_pre_release', v_old, 'provider_reserve', v_reserve, 'direct_reservation', v_direct, 'workload_dispatcher', v_dispatch,
    'cron_before', v_cron_before, 'cron_during_stop', v_cron_during, 'cron_after', v_cron_after, 'stop_flag_set', v_flag, 'paid_calls', 0);
  v_summary := CASE WHEN v_ok THEN format('Stop refused %s admission(s), the pre-release entry point, provider_reserve, a direct reservation and the workload dispatcher; parked %s cron job(s); all restored.',
      (SELECT count(*) FROM jsonb_object_keys(v_admit)), jsonb_array_length(v_cron_during))
    ELSE 'The stop did not refuse at every boundary; see detail.' END;
  INSERT INTO marketcheck_launch_checks (check_key, status, summary, evidence_ref, detail, verified_by, verified_at)
  VALUES ('stop_drill', CASE WHEN v_ok THEN 'passed' ELSE 'failed' END, v_summary, 'marketcheck_launch_stop_drill', v_detail, v_uid, now())
  ON CONFLICT (check_key) DO UPDATE SET status = EXCLUDED.status, summary = EXCLUDED.summary, evidence_ref = EXCLUDED.evidence_ref,
    detail = EXCLUDED.detail, verified_by = EXCLUDED.verified_by, verified_at = EXCLUDED.verified_at;
  PERFORM marketcheck_launch_log('stop_drill', CASE WHEN v_ok THEN 'ok' ELSE 'failed' END, c.state, c.state, p.version, v_detail);
  RETURN jsonb_build_object('ok', v_ok, 'detail', v_detail, 'summary', v_summary);
END $$;

REVOKE ALL ON FUNCTION
  public.marketcheck_launch_log(text, text, text, text, integer, jsonb, text),
  public.marketcheck_launch_actor_is_admin(),
  public.marketcheck_launch_cron_state(text), public.marketcheck_launch_cron_set(text, text, boolean), public.marketcheck_launch_cron_jobs(),
  public.marketcheck_launch_gate(text, uuid, text, uuid, text, text, text, bigint),
  public.marketcheck_launch_vin_stores(text), public.marketcheck_launch_store_identity_ok(uuid), public.marketcheck_launch_store_feed_clean(uuid, integer),
  public.marketcheck_launch_readiness(integer),
  public.marketcheck_launch_workload_candidates(uuid, text, integer), public.marketcheck_launch_enqueue(integer, uuid),
  public.marketcheck_launch_transport_ready(), public.marketcheck_launch_transport(text, jsonb), public.marketcheck_launch_transport_result(bigint),
  public.marketcheck_launch_dispatch()
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.marketcheck_launch_readiness(integer), public.marketcheck_launch_dispatch() TO service_role;
REVOKE ALL ON FUNCTION
  public.marketcheck_launch_status(), public.marketcheck_launch_record_quota(integer, integer, integer, timestamptz, text),
  public.marketcheck_launch_attest(text, text, text, text, jsonb), public.marketcheck_launch_approve_plan(integer), public.marketcheck_launch_set_plan_usd_cap(integer, numeric),
  public.marketcheck_launch_activate(integer, text), public.marketcheck_emergency_stop(text), public.marketcheck_launch_release_stop(text),
  public.marketcheck_launch_pause(text), public.marketcheck_launch_resume(text), public.marketcheck_launch_expand(uuid, text),
  public.marketcheck_launch_rollback(text), public.marketcheck_launch_stop_drill()
FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION
  public.marketcheck_launch_status(), public.marketcheck_launch_record_quota(integer, integer, integer, timestamptz, text),
  public.marketcheck_launch_attest(text, text, text, text, jsonb), public.marketcheck_launch_approve_plan(integer), public.marketcheck_launch_set_plan_usd_cap(integer, numeric),
  public.marketcheck_launch_activate(integer, text), public.marketcheck_emergency_stop(text), public.marketcheck_launch_release_stop(text),
  public.marketcheck_launch_pause(text), public.marketcheck_launch_resume(text), public.marketcheck_launch_expand(uuid, text),
  public.marketcheck_launch_rollback(text), public.marketcheck_launch_stop_drill()
TO authenticated, service_role;

-- ── Draft plan v1 (not approved) ────────────────────────────────────────
-- Seeded only where the Harte stores exist. Approval is a separate owner act.
INSERT INTO public.marketcheck_launch_plans (version, title, canary_store_id, canary_max_calls, canary_window_hours, hourly_call_ceiling,
  daily_call_ceiling, error_tripwire_per_hour, uncertain_tripwire_per_hour, feed_max_age_hours, required_gate_version, products, allowed_callers,
  cron_jobs, rollout, notes, account_usd_cap, canary_store_usd_cap, workload)
SELECT 1, 'Harte INFINITI canary, then five Harte rooftops', '45cdc1e0-7e88-4b44-9d07-27369d74ab21'::uuid, 40, 24, 15, 120, 5, 3, 9,
  'launch-2026-11-02', ARRAY['neovin'], ARRAY['marketcheck-specs'],
  '[{"jobname":"marketcheck-launch-dispatch","schedule":"*/5 * * * *"}]'::jsonb,
  (SELECT COALESCE(jsonb_agg(jsonb_build_object('store_id', id, 'order', o, 'min_hours_after_previous', 48) ORDER BY o), '[]'::jsonb)
     FROM (VALUES ('35d5584b-93d4-4419-9a50-6daead08e7a9'::uuid, 1), ('e400e636-0909-4b36-822e-caa2b5ae7381'::uuid, 2),
                  ('12e1d831-166d-48e9-87b5-536d7c0980dc'::uuid, 3), ('17a9f6f2-29ff-4ff1-bf72-1519df10b7d5'::uuid, 4),
                  ('02b4f1ac-e15a-40a7-9c49-811fd043ef53'::uuid, 5)) v(id, o)
    WHERE EXISTS (SELECT 1 FROM public.dealer_stores s WHERE s.id = v.id)),
  'Canary: at most 40 NeoVIN decodes in 24 hours, Harte INFINITI vehicles only, through marketcheck-specs. Then pilot, then one rooftop at a time, 48 hours apart. '
  || 'marketcheck-sync is not an approved caller: it pulls the syndication and dealer-directory products, which are not verified entitlements, and inventory '
  || 'already arrives from vAuto through Files.com. Adding it needs a new plan version naming those products with verified entitlement and pricing. '
  || 'START queues up to 20 never-decoded Harte INFINITI vehicles (new first) and the dispatcher sends them two at a time to marketcheck-specs; '
  || 'at most 2 NeoVIN calls per vehicle, so 20 vehicles fit the 40-call ceiling. No global backfill or sweep can spend: the gate admits only dispatched VINs. '
  || 'Dollar caps $25/month account and $10/month Harte INFINITI are the owner''s provisional figures (2026-11-03), not final spending authorizations '
  || 'until account pricing, quota and outside connector access are verified.',
  25.00, 10.00,
  '{"kind":"neovin_decode","caller":"marketcheck-specs","function":"marketcheck-specs","max_vehicles_per_store":20,"calls_per_vehicle":2,"batch_size":2,"response_timeout_minutes":10}'::jsonb
WHERE EXISTS (SELECT 1 FROM public.dealer_stores WHERE id = '45cdc1e0-7e88-4b44-9d07-27369d74ab21')
ON CONFLICT (version) DO NOTHING;
