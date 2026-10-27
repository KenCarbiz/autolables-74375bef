-- ── Provider call budget: a hard monthly ceiling with a reserve for the feed ──
--
-- The MarketCheck plan is 5,000 calls a month, hard-enforced, reset on the
-- 1st. On 2026-10-27 the enrichment sweep alone was making 2,000-4,000 calls
-- a day, so each month's quota was gone within three days (Jul 29, Sep 11,
-- Oct 4) and the nightly syndication feed, the one call inventory depends on,
-- was refused until the next 1st. Nothing in the code counted calls against
-- the month; the provider's own counter was the first thing to notice.
--
-- This adds the counter and the gate.
--   provider_call_budgets   one row per provider: the cap, a reserve kept for
--                           essential calls (the feed and its rooftop
--                           validation), and an enable switch.
--   provider_call_events    append-only: every admitted call and every
--                           refusal, with product, caller, tenant, VIN,
--                           status and outcome, so the month's spend can be
--                           read per product and per vehicle.
--   provider_call_admit     decides one call. An essential call is admitted
--                           while the month's count is under the cap; any
--                           other call only while it is under cap minus
--                           reserve. Serialised on the budget row so two
--                           callers cannot both take the last slot. Writes
--                           the event either way.
--   provider_call_record    completes an admitted event with what the
--                           provider answered.
--   provider_call_month     the month so far, per product, for the operator.
--
-- A deploy may land ahead of this migration: callers fail OPEN when the RPC
-- is missing and say so in their logs, so a gate that is not there yet can
-- never stop the feed.

CREATE TABLE IF NOT EXISTS public.provider_call_budgets (
  provider              text PRIMARY KEY,
  monthly_call_cap      integer NOT NULL CHECK (monthly_call_cap >= 0),
  reserve_for_essential integer NOT NULL DEFAULT 0 CHECK (reserve_for_essential >= 0),
  enabled               boolean NOT NULL DEFAULT true,
  notes                 text,
  updated_at            timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.provider_call_budgets (provider, monthly_call_cap, reserve_for_essential, enabled, notes)
VALUES ('marketcheck', 5000, 250, true,
        'Basic plan: 5,000 calls a month, reset on the 1st. The reserve keeps the nightly syndication feed and its rooftop validation inside the cap whatever else is spent.')
ON CONFLICT (provider) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.provider_call_events (
  id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  at                 timestamptz NOT NULL DEFAULT now(),
  provider           text NOT NULL,
  product            text NOT NULL,
  caller             text NOT NULL,
  essential          boolean NOT NULL DEFAULT false,
  tenant_id          uuid,
  vin                text,
  outcome            text NOT NULL DEFAULT 'admitted',
  http_status        integer,
  estimated_cost_usd numeric(8,4),
  month_calls_before integer,
  note               text,
  CONSTRAINT provider_call_events_outcome_check CHECK (outcome IN (
    'admitted', 'ok', 'no_result', 'refused_quota', 'refused_rate', 'refused_auth',
    'provider_error', 'transport_error', 'budget_denied'
  ))
);

CREATE INDEX IF NOT EXISTS idx_provider_call_events_provider_at
  ON public.provider_call_events (provider, at DESC);
CREATE INDEX IF NOT EXISTS idx_provider_call_events_tenant_at
  ON public.provider_call_events (tenant_id, at DESC);

ALTER TABLE public.provider_call_budgets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.provider_call_events  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "provider_call_budgets read" ON public.provider_call_budgets;
CREATE POLICY "provider_call_budgets read"
  ON public.provider_call_budgets FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "provider_call_events tenant read" ON public.provider_call_events;
CREATE POLICY "provider_call_events tenant read"
  ON public.provider_call_events FOR SELECT
  TO authenticated
  USING (
    tenant_id IN (
      SELECT tenant_id FROM public.tenant_members
      WHERE user_id = (SELECT auth.uid())
    )
  );

REVOKE ALL ON public.provider_call_budgets FROM PUBLIC, anon;
REVOKE ALL ON public.provider_call_events  FROM PUBLIC, anon;
-- Default privileges hand authenticated TRUNCATE, REFERENCES and TRIGGER as
-- well; RLS does not govern TRUNCATE, so an append-only ledger must lose it.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.provider_call_budgets FROM authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.provider_call_events  FROM authenticated;
GRANT SELECT ON public.provider_call_budgets TO authenticated;
GRANT SELECT ON public.provider_call_events  TO authenticated;

-- The sandbox role reads, never writes, as on the other evidence tables.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sandbox_exec') THEN
    REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
      ON TABLE public.provider_call_budgets, public.provider_call_events FROM sandbox_exec;
    GRANT SELECT ON TABLE public.provider_call_budgets, public.provider_call_events TO sandbox_exec;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.provider_call_admit(
  p_provider           text,
  p_product            text,
  p_caller             text,
  p_essential          boolean DEFAULT false,
  p_tenant_id          uuid DEFAULT NULL,
  p_vin                text DEFAULT NULL,
  p_estimated_cost_usd numeric DEFAULT NULL
)
RETURNS TABLE (
  admitted              boolean,
  event_id              bigint,
  month_calls           integer,
  monthly_call_cap      integer,
  reserve_for_essential integer,
  reason                text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_budget public.provider_call_budgets%ROWTYPE;
  v_count  integer := 0;
  v_month  timestamptz := date_trunc('month', now());
  v_id     bigint;
  v_reason text;
BEGIN
  -- Serialise every decision for this provider, so two callers cannot both
  -- read the same remaining count and both spend it.
  SELECT * INTO v_budget FROM public.provider_call_budgets
   WHERE provider = p_provider FOR UPDATE;

  IF NOT FOUND OR v_budget.enabled IS NOT TRUE THEN
    INSERT INTO public.provider_call_events
      (provider, product, caller, essential, tenant_id, vin, outcome, estimated_cost_usd, note)
    VALUES
      (p_provider, p_product, p_caller, p_essential, p_tenant_id, p_vin, 'admitted', p_estimated_cost_usd, 'ungated: no budget row or gate disabled')
    RETURNING id INTO v_id;
    RETURN QUERY SELECT true, v_id, NULL::integer, NULL::integer, NULL::integer, 'ungated'::text;
    RETURN;
  END IF;

  -- Refusals by this gate are not provider calls and do not count.
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
      (p_provider, p_product, p_caller, p_essential, p_tenant_id, p_vin, 'budget_denied', p_estimated_cost_usd, v_count, v_reason)
    RETURNING id INTO v_id;
    RETURN QUERY SELECT false, v_id, v_count, v_budget.monthly_call_cap, v_budget.reserve_for_essential, v_reason;
    RETURN;
  END IF;

  INSERT INTO public.provider_call_events
    (provider, product, caller, essential, tenant_id, vin, outcome, estimated_cost_usd, month_calls_before)
  VALUES
    (p_provider, p_product, p_caller, p_essential, p_tenant_id, p_vin, 'admitted', p_estimated_cost_usd, v_count)
  RETURNING id INTO v_id;
  RETURN QUERY SELECT true, v_id, v_count, v_budget.monthly_call_cap, v_budget.reserve_for_essential, 'admitted'::text;
END
$$;

CREATE OR REPLACE FUNCTION public.provider_call_record(
  p_event_id    bigint,
  p_http_status integer,
  p_outcome     text,
  p_note        text DEFAULT NULL
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  UPDATE public.provider_call_events
     SET http_status = p_http_status,
         outcome     = p_outcome,
         note        = COALESCE(p_note, note)
   WHERE id = p_event_id AND outcome = 'admitted';
$$;

CREATE OR REPLACE FUNCTION public.provider_call_month(p_provider text DEFAULT 'marketcheck')
RETURNS TABLE (
  product   text,
  calls     bigint,
  denied    bigint,
  refused   bigint,
  last_call timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT e.product,
         count(*) FILTER (WHERE e.outcome <> 'budget_denied')                                   AS calls,
         count(*) FILTER (WHERE e.outcome = 'budget_denied')                                    AS denied,
         count(*) FILTER (WHERE e.outcome IN ('refused_quota', 'refused_rate', 'refused_auth')) AS refused,
         max(e.at) FILTER (WHERE e.outcome <> 'budget_denied')                                  AS last_call
    FROM public.provider_call_events e
   WHERE e.provider = p_provider AND e.at >= date_trunc('month', now())
   GROUP BY e.product
   ORDER BY calls DESC;
$$;

REVOKE ALL ON FUNCTION public.provider_call_admit(text, text, text, boolean, uuid, text, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.provider_call_admit(text, text, text, boolean, uuid, text, numeric) TO service_role;
REVOKE ALL ON FUNCTION public.provider_call_record(bigint, integer, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.provider_call_record(bigint, integer, text, text) TO service_role;
REVOKE ALL ON FUNCTION public.provider_call_month(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.provider_call_month(text) TO authenticated, service_role;

COMMENT ON TABLE public.provider_call_budgets IS
  'Per-provider monthly call cap and the reserve held back for essential calls (the syndication feed and its rooftop validation). The gate is provider_call_admit.';
COMMENT ON TABLE public.provider_call_events IS
  'Append-only ledger of provider calls admitted by provider_call_admit and of the refusals it issued, with product, caller, tenant, VIN, HTTP status and outcome. The month''s count against the cap is the rows whose outcome is not budget_denied.';
