-- ─────────────────────────────────────────────────────────────────────
-- Phase 7 — generation orchestration, cost accounting and budget control.
--
-- Strictly additive. Existing description cases, jobs, versions, channel
-- variants and publication history are untouched.
--
-- The financial rule this migration encodes: a cost record must never claim
-- more certainty than it has. An estimate, a provider-reported charge and an
-- unknown are three different states, and collapsing them is how a dealer
-- gets billed for something a dashboard said was free.
-- ─────────────────────────────────────────────────────────────────────

-- ── 1. Model executions — one row per real provider request ──────────
-- Separate from description_jobs on purpose: a job is business work, an
-- execution is one billable call. A single job can produce several executions
-- (retry, repair, fallback) and each one costs money independently.
CREATE TABLE IF NOT EXISTS public.description_model_executions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  vehicle_id          uuid,
  description_case_id uuid REFERENCES public.description_cases(id) ON DELETE CASCADE,
  version_id          uuid REFERENCES public.description_versions(id) ON DELETE SET NULL,
  job_id              uuid REFERENCES public.description_jobs(id) ON DELETE SET NULL,
  channel             text,

  attempt_number      integer NOT NULL DEFAULT 1,
  execution_kind      text NOT NULL DEFAULT 'generation'
                        CHECK (execution_kind IN ('generation','repair','fallback','preview','evaluation')),

  provider            text NOT NULL,
  model               text NOT NULL,
  prompt_policy_version text,
  prompt_checksum     text,

  input_tokens        integer,
  output_tokens       integer,
  cached_input_tokens integer,
  reasoning_tokens    integer,

  -- Three-state cost truth. 'pending' is not zero, and 'calculated_estimate'
  -- is not a charge; the UI must render them differently.
  cost_state          text NOT NULL DEFAULT 'pending'
                        CHECK (cost_state IN ('provider_reported','calculated_estimate','pending','unavailable','reconciled')),
  cost_amount         numeric(12,6),
  currency            text NOT NULL DEFAULT 'USD',
  pricing_version     text,

  latency_ms          integer,
  outcome             text NOT NULL DEFAULT 'started'
                        CHECK (outcome IN ('started','succeeded','failed','timeout','cancelled')),
  error_category      text,
  error_code          text,
  -- Whether the provider may already have billed us despite the failure. A
  -- timeout is the case that matters: reporting "no cost" there is a lie.
  cost_may_have_occurred boolean NOT NULL DEFAULT false,

  is_preview          boolean NOT NULL DEFAULT false,
  correlation_id      text,
  requested_by        uuid REFERENCES auth.users(id),
  started_at          timestamptz NOT NULL DEFAULT now(),
  completed_at        timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_description_model_executions_tenant_month
  ON public.description_model_executions (tenant_id, is_preview, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_description_model_executions_case
  ON public.description_model_executions (description_case_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_description_model_executions_job
  ON public.description_model_executions (job_id);

-- ── 2. Tenant generation budgets ─────────────────────────────────────
-- NULL means "not configured", which is unlimited — NOT zero. Treating an
-- unset budget as zero would block every generation for every tenant that
-- never opened the settings page.
CREATE TABLE IF NOT EXISTS public.description_generation_budgets (
  tenant_id                  uuid PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
  monthly_generation_budget  numeric(12,2),
  monthly_preview_budget     numeric(12,2),
  max_cost_per_generation    numeric(12,4),
  max_repair_attempts        integer NOT NULL DEFAULT 2,
  max_channels_per_batch     integer NOT NULL DEFAULT 7,
  daily_generation_limit     integer,
  per_user_daily_limit       integer,
  warning_threshold_pct      integer NOT NULL DEFAULT 80
                               CHECK (warning_threshold_pct BETWEEN 1 AND 100),
  hard_stop_pct              integer NOT NULL DEFAULT 100
                               CHECK (hard_stop_pct BETWEEN 1 AND 200),
  currency                   text NOT NULL DEFAULT 'USD',
  updated_by                 uuid REFERENCES auth.users(id),
  created_at                 timestamptz NOT NULL DEFAULT now(),
  updated_at                 timestamptz NOT NULL DEFAULT now()
);

-- A budget override is its own record with a mandatory reason. An override
-- without one is unauditable, and the audit trail is the only thing that makes
-- the grant defensible after the invoice arrives.
CREATE TABLE IF NOT EXISTS public.description_budget_overrides (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  reason        text NOT NULL,
  actor_user_id uuid NOT NULL REFERENCES auth.users(id),
  actor_role    text,
  scope         text NOT NULL DEFAULT 'single_request'
                  CHECK (scope IN ('single_request','remainder_of_day','remainder_of_month')),
  expires_at    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT description_budget_overrides_reason_len CHECK (char_length(reason) >= 10)
);
CREATE INDEX IF NOT EXISTS idx_description_budget_overrides_tenant
  ON public.description_budget_overrides (tenant_id, created_at DESC);

-- ── 3. Preflight results ─────────────────────────────────────────────
-- Recorded even (especially) when generation was refused: a rejection that
-- cost nothing is still the answer to "why is this vehicle not described?".
CREATE TABLE IF NOT EXISTS public.description_preflight_results (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  vehicle_id          uuid,
  description_case_id uuid REFERENCES public.description_cases(id) ON DELETE CASCADE,
  channel             text,
  passed              boolean NOT NULL,
  blocking_codes      text[] NOT NULL DEFAULT '{}',
  findings_json       jsonb NOT NULL DEFAULT '[]'::jsonb,
  summary             text,
  requested_by        uuid REFERENCES auth.users(id),
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_description_preflight_results_case
  ON public.description_preflight_results (description_case_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_description_preflight_results_tenant
  ON public.description_preflight_results (tenant_id, passed, created_at DESC);

-- ── 4. Version linkage to the execution that produced it ─────────────
ALTER TABLE public.description_versions
  ADD COLUMN IF NOT EXISTS model_execution_id uuid
    REFERENCES public.description_model_executions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS prompt_checksum    text,
  ADD COLUMN IF NOT EXISTS candidate_json     jsonb,
  ADD COLUMN IF NOT EXISTS correlation_id     text;

-- ── 5. updated_at triggers ───────────────────────────────────────────
DROP TRIGGER IF EXISTS set_updated_at_description_generation_budgets
  ON public.description_generation_budgets;
CREATE TRIGGER set_updated_at_description_generation_budgets
  BEFORE UPDATE ON public.description_generation_budgets
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ── 6. RLS — read-only for members, service-role writes ──────────────
-- Cost, budget and preflight rows are written by the orchestrator. A browser
-- that could insert an execution row could understate spend, and a browser
-- that could edit a budget could lift its own ceiling.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['description_model_executions','description_generation_budgets',
                           'description_budget_overrides','description_preflight_results'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', t);
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename=t
                   AND policyname='tenant_members_read') THEN
      EXECUTE format($f$
        CREATE POLICY "tenant_members_read" ON public.%I FOR SELECT TO authenticated
        USING (tenant_id IN (SELECT tenant_id FROM public.tenant_members
                             WHERE user_id = (SELECT auth.uid()) AND accepted_at IS NOT NULL));$f$, t);
    END IF;
    EXECUTE format('REVOKE INSERT, UPDATE, DELETE ON public.%I FROM authenticated;', t);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated;', t);
  END LOOP;
END $$;

-- ─────────────────────────────────────────────────────────────────────
-- RPC — set a tenant's generation budget.
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.save_description_generation_budget(
  p_tenant_id uuid,
  p_budget    jsonb
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid  uuid := auth.uid();
  v_role text;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;

  SELECT lower(trim(role)) INTO v_role
  FROM public.tenant_members
  WHERE tenant_id = p_tenant_id AND user_id = v_uid AND accepted_at IS NOT NULL;

  IF v_role IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_a_member');
  END IF;
  -- Spending authority, not content authority: a sales manager who may approve
  -- copy still may not raise the store's AI bill.
  IF v_role NOT IN ('owner','general_manager','gsm','admin') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'insufficient_permission');
  END IF;

  INSERT INTO public.description_generation_budgets AS b (
    tenant_id, monthly_generation_budget, monthly_preview_budget,
    max_cost_per_generation, max_repair_attempts, max_channels_per_batch,
    daily_generation_limit, per_user_daily_limit,
    warning_threshold_pct, hard_stop_pct, updated_by
  ) VALUES (
    p_tenant_id,
    NULLIF(p_budget->>'monthlyGenerationBudget','')::numeric,
    NULLIF(p_budget->>'monthlyPreviewBudget','')::numeric,
    NULLIF(p_budget->>'maxCostPerGeneration','')::numeric,
    COALESCE(NULLIF(p_budget->>'maxRepairAttempts','')::integer, 2),
    COALESCE(NULLIF(p_budget->>'maxChannelsPerBatch','')::integer, 7),
    NULLIF(p_budget->>'dailyGenerationLimit','')::integer,
    NULLIF(p_budget->>'perUserDailyLimit','')::integer,
    COALESCE(NULLIF(p_budget->>'warningThresholdPct','')::integer, 80),
    COALESCE(NULLIF(p_budget->>'hardStopPct','')::integer, 100),
    v_uid
  )
  ON CONFLICT (tenant_id) DO UPDATE SET
    monthly_generation_budget = EXCLUDED.monthly_generation_budget,
    monthly_preview_budget    = EXCLUDED.monthly_preview_budget,
    max_cost_per_generation   = EXCLUDED.max_cost_per_generation,
    max_repair_attempts       = EXCLUDED.max_repair_attempts,
    max_channels_per_batch    = EXCLUDED.max_channels_per_batch,
    daily_generation_limit    = EXCLUDED.daily_generation_limit,
    per_user_daily_limit      = EXCLUDED.per_user_daily_limit,
    warning_threshold_pct     = EXCLUDED.warning_threshold_pct,
    hard_stop_pct             = EXCLUDED.hard_stop_pct,
    updated_by                = EXCLUDED.updated_by,
    updated_at                = now();

  INSERT INTO public.audit_log (action, entity_type, entity_id, store_id, details)
  VALUES ('generation_budget_updated', 'description_generation_budget', p_tenant_id, p_tenant_id,
          jsonb_build_object('actor_role', v_role, 'budget', p_budget));

  RETURN jsonb_build_object('ok', true, 'tenant_id', p_tenant_id);
END;
$$;

REVOKE ALL ON FUNCTION public.save_description_generation_budget(uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_description_generation_budget(uuid, jsonb) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────
-- Current-period spend, used by the orchestrator's preflight budget check.
-- SECURITY DEFINER so the caller cannot read another tenant's spend by
-- passing a different id: membership is verified inside.
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.description_generation_spend(p_tenant_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_ok  boolean;
  v_result jsonb;
BEGIN
  IF v_uid IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1 FROM public.tenant_members
      WHERE tenant_id = p_tenant_id AND user_id = v_uid AND accepted_at IS NOT NULL
    ) INTO v_ok;
    IF NOT v_ok THEN
      RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
    END IF;
  END IF;

  SELECT jsonb_build_object(
    'ok', true,
    'month_production_spend', COALESCE(SUM(cost_amount) FILTER (
        WHERE NOT is_preview AND created_at >= date_trunc('month', now())), 0),
    'month_preview_spend', COALESCE(SUM(cost_amount) FILTER (
        WHERE is_preview AND created_at >= date_trunc('month', now())), 0),
    'today_generation_count', COALESCE(COUNT(*) FILTER (
        WHERE NOT is_preview AND created_at >= date_trunc('day', now())), 0),
    -- Executions whose cost is still unknown are surfaced separately rather
    -- than counted as zero, so a budget check never reads as safer than it is.
    'pending_cost_executions', COALESCE(COUNT(*) FILTER (
        WHERE cost_state IN ('pending','unavailable')
          AND created_at >= date_trunc('month', now())), 0)
  ) INTO v_result
  FROM public.description_model_executions
  WHERE tenant_id = p_tenant_id;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.description_generation_spend(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.description_generation_spend(uuid) TO authenticated;
