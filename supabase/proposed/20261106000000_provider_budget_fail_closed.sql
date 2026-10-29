-- PROPOSED, NOT APPLIED. Fail-closed provider budgets with separate lanes for
-- essential inventory sync and optional enrichment. Requires
-- 20261103000000_provider_tenant_budgets.sql (dealership budgets, unit
-- prices) to be applied first; replaces its provider_call_admit.
--
-- The owner-approved policy (2026-10-29):
--   * a missing, disabled, unreadable or exhausted budget means no provider
--     call: provider_call_admit refuses, and the TypeScript gate refuses
--     whenever it cannot get an answer (providerBudget.ts);
--   * essential inventory sync (the MarketCheck feed pull and its rooftop
--     validation, p_essential = true) and optional enrichment (everything
--     else) have separate budgets that never share an allowance;
--   * a provider without a configured, enabled lane stays disabled. This
--     migration enables nothing and sets no limit: every lane starts
--     disabled with no cap, so applying it alone stops every gated provider
--     call until a platform admin sets a lane;
--   * there is no inventory exception: an enforced dealership budget refuses
--     the feed too (provider_tenant_budgets.block_essential is no longer
--     read).
--
-- Accounting: the admitted event is the reservation, counted from the
-- moment it is admitted; provider_call_record reconciles it with the
-- provider's answer and stamps reconciled_at; provider_call_unreconciled
-- lists reservations that never came back. Each lane row is locked for the
-- whole admission, so concurrent workers cannot each spend the same last
-- unit. Nothing here stores a URL, key or token.

DO $$ BEGIN
  IF to_regclass('public.provider_tenant_budgets') IS NULL OR to_regclass('public.provider_unit_prices') IS NULL THEN
    RAISE EXCEPTION '20261106000000 requires 20261103000000_provider_tenant_budgets.sql';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.provider_lane_budgets (
  provider         text NOT NULL CHECK (provider ~ '^[a-z0-9_]{2,40}$'),
  lane             text NOT NULL CHECK (lane IN ('essential_sync', 'enrichment')),
  enabled          boolean NOT NULL DEFAULT false,
  billing_unit     text NOT NULL DEFAULT 'call',
  monthly_call_cap integer CHECK (monthly_call_cap IS NULL OR monthly_call_cap >= 0),
  monthly_usd_cap  numeric(10,2) CHECK (monthly_usd_cap IS NULL OR monthly_usd_cap >= 0),
  notes            text,
  updated_at       timestamptz NOT NULL DEFAULT now(),
  updated_by       uuid,
  PRIMARY KEY (provider, lane),
  CONSTRAINT provider_lane_budgets_enabled_has_cap CHECK (NOT enabled OR monthly_call_cap IS NOT NULL OR monthly_usd_cap IS NOT NULL),
  CONSTRAINT provider_lane_budgets_feed_is_marketcheck CHECK (lane <> 'essential_sync' OR provider = 'marketcheck')
);

-- The providers the code gates, disabled, with no limit. Limits are the
-- owner's decision (ADMIN_V2_RELEASE_READINESS.md, provider table).
INSERT INTO public.provider_lane_budgets (provider, lane, billing_unit, notes) VALUES
  ('marketcheck',    'essential_sync', 'call', 'feed pull and rooftop validation'),
  ('marketcheck',    'enrichment',     'call', 'comps, specs, recalls, title, history, MDS, incentives, dealer lookups'),
  ('firecrawl',      'enrichment',     'request', 'VDP renders (credits per render vary by format), OEM document searches and operator page scrapes'),
  ('vinaudit',       'enrichment',     'call', 'window stickers'),
  ('monroneylabels', 'enrichment',     'call', 'window stickers'),
  ('blackbook',      'enrichment',     'call', 'used-car values'),
  ('google_places',  'enrichment',     'request', 'dealership rating refresh (place details, text search)')
ON CONFLICT (provider, lane) DO NOTHING;

ALTER TABLE public.provider_lane_budgets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "provider_lane_budgets platform admin read" ON public.provider_lane_budgets;
CREATE POLICY "provider_lane_budgets platform admin read"
  ON public.provider_lane_budgets FOR SELECT
  TO authenticated
  USING (public.has_role((SELECT auth.uid()), 'admin'));
REVOKE ALL ON public.provider_lane_budgets FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.provider_lane_budgets TO authenticated, service_role;

ALTER TABLE public.provider_call_events ADD COLUMN IF NOT EXISTS reconciled_at timestamptz;

CREATE OR REPLACE FUNCTION public.provider_call_admit(p_provider text, p_product text, p_caller text, p_essential boolean DEFAULT false, p_tenant_id uuid DEFAULT NULL::uuid, p_vin text DEFAULT NULL::text, p_estimated_cost_usd numeric DEFAULT NULL::numeric)
 RETURNS TABLE(admitted boolean, event_id bigint, month_calls integer, monthly_call_cap integer, reserve_for_essential integer, reason text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_lane   text := CASE WHEN p_essential THEN 'essential_sync' ELSE 'enrichment' END;
  v_lb     public.provider_lane_budgets%ROWTYPE;
  v_plat   public.provider_call_budgets%ROWTYPE;
  v_tb     public.provider_tenant_budgets%ROWTYPE;
  v_month  timestamptz := date_trunc('month', now());
  v_est    numeric := p_estimated_cost_usd;
  v_calls  integer := 0;
  v_usd    numeric := 0;
  v_total  integer;
  v_tcalls integer;
  v_tusd   numeric;
  v_reason text;
  v_detail text;
  v_id     bigint;
BEGIN
  IF v_est IS NULL THEN
    SELECT u.usd_per_call INTO v_est FROM public.provider_unit_prices u
     WHERE u.provider = p_provider AND u.product IN (p_product, '*')
     ORDER BY (u.product = p_product) DESC LIMIT 1;
  END IF;

  -- 1. The lane. Locked for the rest of the transaction: every admission to
  --    this provider and lane waits here, so the count below is exact.
  SELECT * INTO v_lb FROM public.provider_lane_budgets b
   WHERE b.provider = p_provider AND b.lane = v_lane FOR UPDATE;
  IF NOT FOUND THEN
    v_reason := 'unconfigured';
  ELSIF NOT v_lb.enabled THEN
    v_reason := 'disabled';
  ELSE
    SELECT count(*)::integer, coalesce(sum(e.estimated_cost_usd), 0) INTO v_calls, v_usd
      FROM public.provider_call_events e
     WHERE e.provider = p_provider AND e.essential = p_essential AND e.at >= v_month AND e.outcome <> 'budget_denied';
    IF v_lb.monthly_call_cap IS NOT NULL AND v_calls >= v_lb.monthly_call_cap THEN
      v_reason := 'lane_cap';
    ELSIF v_lb.monthly_usd_cap IS NOT NULL AND v_est IS NULL THEN
      v_reason := 'unpriced';
    ELSIF v_lb.monthly_usd_cap IS NOT NULL AND v_usd + v_est > v_lb.monthly_usd_cap THEN
      v_reason := 'lane_usd_cap';
    END IF;
  END IF;

  -- 2. The provider's plan ceiling across both lanes, where one is set.
  IF v_reason IS NULL THEN
    SELECT * INTO v_plat FROM public.provider_call_budgets WHERE provider = p_provider FOR UPDATE;
    IF FOUND AND v_plat.enabled THEN
      SELECT count(*)::integer INTO v_total FROM public.provider_call_events
       WHERE provider = p_provider AND at >= v_month AND outcome <> 'budget_denied';
      IF v_total >= v_plat.monthly_call_cap THEN v_reason := 'monthly_cap'; END IF;
    END IF;
  END IF;

  -- 3. Dealership budgets. Enforce refuses the feed as well; there is no
  --    inventory exception.
  IF v_reason IS NULL AND p_tenant_id IS NOT NULL THEN
    FOR v_tb IN
      SELECT * FROM public.provider_tenant_budgets b
       WHERE b.tenant_id = p_tenant_id AND b.provider IN (p_provider, '*') AND b.mode = 'enforce'
       ORDER BY b.provider FOR UPDATE
    LOOP
      SELECT u.calls, u.usd INTO v_tcalls, v_tusd FROM public.provider_tenant_month_usage(p_tenant_id, v_tb.provider) u;
      IF (v_tb.monthly_call_cap IS NOT NULL AND v_tcalls >= v_tb.monthly_call_cap)
         OR (v_tb.monthly_usd_cap IS NOT NULL AND (v_est IS NULL OR v_tusd + v_est > v_tb.monthly_usd_cap)) THEN
        v_reason := 'tenant_budget';
        v_detail := v_tb.provider;
        INSERT INTO public.provider_budget_alerts
          (tenant_id, provider, month, kind, threshold, mode, calls, usd, monthly_call_cap, monthly_usd_cap, caller)
        VALUES (p_tenant_id, v_tb.provider, v_month::date, 'call_denied', 0, v_tb.mode, v_tcalls, v_tusd,
                v_tb.monthly_call_cap, v_tb.monthly_usd_cap, p_caller)
        ON CONFLICT ON CONSTRAINT provider_budget_alerts_once DO NOTHING;
        EXIT;
      END IF;
    END LOOP;
  END IF;

  IF v_reason IS NOT NULL THEN
    INSERT INTO public.provider_call_events
      (provider, product, caller, essential, tenant_id, vin, outcome, estimated_cost_usd, month_calls_before, note)
    VALUES
      (p_provider, p_product, p_caller, p_essential, p_tenant_id, p_vin, 'budget_denied', v_est, v_calls,
       v_reason || ':' || v_lane || coalesce(':' || v_detail, ''))
    RETURNING id INTO v_id;
    RETURN QUERY SELECT false, v_id, v_calls, v_lb.monthly_call_cap, NULL::integer, v_reason;
    RETURN;
  END IF;

  INSERT INTO public.provider_call_events
    (provider, product, caller, essential, tenant_id, vin, outcome, estimated_cost_usd, month_calls_before, note)
  VALUES
    (p_provider, p_product, p_caller, p_essential, p_tenant_id, p_vin, 'admitted', v_est, v_calls, 'reserved:' || v_lane)
  RETURNING id INTO v_id;
  PERFORM public.provider_tenant_budget_thresholds(p_tenant_id, p_provider, p_caller);
  RETURN QUERY SELECT true, v_id, v_calls, v_lb.monthly_call_cap, NULL::integer, 'admitted'::text;
END
$function$;

-- Reconciliation: the reservation takes the provider's answer and a time.
CREATE OR REPLACE FUNCTION public.provider_call_record(
  p_event_id bigint, p_http_status integer, p_outcome text, p_note text DEFAULT NULL)
RETURNS void
LANGUAGE sql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  UPDATE public.provider_call_events
     SET http_status = p_http_status, outcome = p_outcome, note = COALESCE(p_note, note), reconciled_at = now()
   WHERE id = p_event_id AND outcome = 'admitted';
$$;

-- Reservations that never came back (the worker died, timed out or never
-- recorded). They stay counted against the lane.
CREATE OR REPLACE FUNCTION public.provider_call_unreconciled(p_older_than interval DEFAULT interval '15 minutes')
RETURNS TABLE (id bigint, at timestamptz, provider text, product text, caller text, essential boolean, tenant_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT e.id, e.at, e.provider, e.product, e.caller, e.essential, e.tenant_id
  FROM public.provider_call_events e
  WHERE e.outcome = 'admitted' AND e.reconciled_at IS NULL AND e.at < now() - p_older_than
  ORDER BY e.at;
$$;
REVOKE ALL ON FUNCTION public.provider_call_unreconciled(interval) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.provider_call_unreconciled(interval) TO service_role;

-- Platform admins set a lane; every change is audited.
CREATE OR REPLACE FUNCTION public.platform_set_provider_lane_budget(
  p_provider text, p_lane text, p_enabled boolean, p_monthly_call_cap integer, p_monthly_usd_cap numeric,
  p_billing_unit text, p_notes text, p_reason text)
RETURNS public.provider_lane_budgets
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
DECLARE
  v_uid uuid := public.platform_require_admin();
  v_before jsonb;
  v_row public.provider_lane_budgets;
BEGIN
  IF nullif(btrim(p_reason), '') IS NULL THEN
    RAISE EXCEPTION 'a reason is required' USING ERRCODE = '22023';
  END IF;
  SELECT to_jsonb(b) INTO v_before FROM public.provider_lane_budgets b WHERE b.provider = p_provider AND b.lane = p_lane FOR UPDATE;
  INSERT INTO public.provider_lane_budgets AS b
    (provider, lane, enabled, monthly_call_cap, monthly_usd_cap, billing_unit, notes, updated_at, updated_by)
  VALUES (p_provider, p_lane, coalesce(p_enabled, false), p_monthly_call_cap, p_monthly_usd_cap,
          coalesce(nullif(btrim(p_billing_unit), ''), 'call'), nullif(btrim(p_notes), ''), now(), v_uid)
  ON CONFLICT (provider, lane) DO UPDATE SET
    enabled = EXCLUDED.enabled, monthly_call_cap = EXCLUDED.monthly_call_cap, monthly_usd_cap = EXCLUDED.monthly_usd_cap,
    billing_unit = EXCLUDED.billing_unit, notes = coalesce(EXCLUDED.notes, b.notes), updated_at = now(), updated_by = v_uid
  RETURNING * INTO v_row;
  INSERT INTO public.audit_log (action, entity_type, entity_id, user_id, details)
  VALUES ('provider_lane_budget_changed', 'provider_lane_budget', p_provider || ':' || p_lane, v_uid,
          jsonb_build_object('before', v_before, 'after', to_jsonb(v_row), 'reason', btrim(p_reason)));
  RETURN v_row;
END $$;
REVOKE ALL ON FUNCTION public.platform_set_provider_lane_budget(text, text, boolean, integer, numeric, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_set_provider_lane_budget(text, text, boolean, integer, numeric, text, text, text) TO authenticated;

COMMENT ON COLUMN public.provider_tenant_budgets.block_essential IS
  'Not read since 20261106000000: an enforced dealership budget refuses the inventory feed as well.';
