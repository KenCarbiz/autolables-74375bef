-- ═══════════════════════════════════════════════════════════════════════
-- AutoLabels.io — Description V3 → V7 database changes (Part 1 + Part 2)
-- ═══════════════════════════════════════════════════════════════════════

-- ── 1. Dealership voice profile ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.description_voice_profiles (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  version       text NOT NULL,
  status        text NOT NULL DEFAULT 'draft'
                  CHECK (status IN ('draft','approved','archived')),
  profile_json  jsonb NOT NULL DEFAULT '{}'::jsonb,
  dealer_name   text,
  city          text,
  state         text,
  approved_claims text[] NOT NULL DEFAULT '{}',
  change_reason text,
  created_by    uuid REFERENCES auth.users(id),
  approved_by   uuid REFERENCES auth.users(id),
  approved_at   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_description_voice_profiles_tenant
  ON public.description_voice_profiles (tenant_id, status, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_description_voice_profile_approved
  ON public.description_voice_profiles (tenant_id) WHERE status = 'approved';

-- ── 2. Channel policy overrides ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.description_channel_policies (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  channel       text NOT NULL,
  active        boolean NOT NULL DEFAULT true,
  policy_json   jsonb NOT NULL DEFAULT '{}'::jsonb,
  policy_version text,
  last_reviewed timestamptz,
  reviewed_by   uuid REFERENCES auth.users(id),
  change_reason text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT description_channel_policies_tenant_channel_key UNIQUE (tenant_id, channel)
);
CREATE INDEX IF NOT EXISTS idx_description_channel_policies_tenant
  ON public.description_channel_policies (tenant_id, channel);

-- ── 3. Feature selection per version ─────────────────────────────────
CREATE TABLE IF NOT EXISTS public.description_feature_selections (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  vehicle_id          uuid NOT NULL,
  description_case_id uuid NOT NULL REFERENCES public.description_cases(id) ON DELETE CASCADE,
  version_id          uuid REFERENCES public.description_versions(id) ON DELETE CASCADE,
  canonical_feature_id text NOT NULL,
  display_name        text NOT NULL,
  category            text NOT NULL,
  origin              text NOT NULL
                        CHECK (origin IN ('factory_standard','factory_option','factory_package','dealer_added')),
  source              text,
  confidence          integer,
  package_id          text,
  package_name        text,
  conflict            boolean NOT NULL DEFAULT false,
  description_eligible boolean NOT NULL DEFAULT true,
  public_eligible     boolean NOT NULL DEFAULT true,
  priority_rank       integer,
  priority_score      numeric,
  selected            boolean NOT NULL DEFAULT false,
  selection_reason    text,
  selection_actor     text NOT NULL DEFAULT 'automation'
                        CHECK (selection_actor IN ('automation','user')),
  selection_user_id   uuid REFERENCES auth.users(id),
  aliases_seen        text[] NOT NULL DEFAULT '{}',
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_description_feature_selections_version
  ON public.description_feature_selections (version_id, selected, priority_rank);
CREATE INDEX IF NOT EXISTS idx_description_feature_selections_case
  ON public.description_feature_selections (description_case_id, created_at DESC);

-- ── 4. Governance columns on existing tables ─────────────────────────
ALTER TABLE public.description_versions
  ADD COLUMN IF NOT EXISTS tone                    text,
  ADD COLUMN IF NOT EXISTS seo_targeting_json      jsonb,
  ADD COLUMN IF NOT EXISTS voice_profile_version   text,
  ADD COLUMN IF NOT EXISTS channel_policy_version  text,
  ADD COLUMN IF NOT EXISTS selected_feature_checksum text,
  ADD COLUMN IF NOT EXISTS input_checksum          text,
  ADD COLUMN IF NOT EXISTS score_breakdown_json    jsonb,
  ADD COLUMN IF NOT EXISTS readability_json        jsonb,
  ADD COLUMN IF NOT EXISTS uniqueness_json         jsonb,
  ADD COLUMN IF NOT EXISTS score_version           text,
  ADD COLUMN IF NOT EXISTS read_time_seconds       integer;

CREATE INDEX IF NOT EXISTS idx_description_versions_input_checksum
  ON public.description_versions (description_case_id, input_checksum)
  WHERE input_checksum IS NOT NULL;

ALTER TABLE public.description_deliveries
  DROP CONSTRAINT IF EXISTS description_deliveries_status_check;
ALTER TABLE public.description_deliveries
  ADD CONSTRAINT description_deliveries_status_check
  CHECK (status IN ('pending','queued','delivered','failed','skipped','unavailable','recorded'));

ALTER TABLE public.description_channel_versions
  ADD COLUMN IF NOT EXISTS channel_policy_version text,
  ADD COLUMN IF NOT EXISTS score_breakdown_json   jsonb,
  ADD COLUMN IF NOT EXISTS quality_score          integer,
  ADD COLUMN IF NOT EXISTS word_count             integer,
  ADD COLUMN IF NOT EXISTS read_time_seconds      integer;

-- ── 5. updated_at triggers ───────────────────────────────────────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['description_voice_profiles','description_channel_policies'] LOOP
    EXECUTE format(
      'DROP TRIGGER IF EXISTS set_updated_at_%1$s ON public.%1$s;
       CREATE TRIGGER set_updated_at_%1$s BEFORE UPDATE ON public.%1$s
       FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();', t);
  END LOOP;
END $$;

-- ── 6. Grants + RLS ──────────────────────────────────────────────────
GRANT SELECT ON public.description_voice_profiles TO authenticated;
GRANT SELECT ON public.description_channel_policies TO authenticated;
GRANT SELECT ON public.description_feature_selections TO authenticated;
GRANT ALL ON public.description_voice_profiles TO service_role;
GRANT ALL ON public.description_channel_policies TO service_role;
GRANT ALL ON public.description_feature_selections TO service_role;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['description_voice_profiles','description_channel_policies',
                           'description_feature_selections'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', t);
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename=t AND policyname='tenant_members_read') THEN
      EXECUTE format($f$
        CREATE POLICY "tenant_members_read" ON public.%I FOR SELECT TO authenticated
        USING (tenant_id IN (SELECT tenant_id FROM public.tenant_members
                             WHERE user_id = (SELECT auth.uid()) AND accepted_at IS NOT NULL));$f$, t);
    END IF;
  END LOOP;
END $$;

-- ── RPC: save voice profile ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.save_description_voice_profile(
  p_tenant_id uuid,
  p_profile   jsonb,
  p_version   text,
  p_approve   boolean DEFAULT false,
  p_reason    text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid  uuid := auth.uid();
  v_role text;
  v_id   uuid;
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
  IF v_role NOT IN ('owner','general_manager','gsm','admin','manager','compliance') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'insufficient_permission');
  END IF;
  IF p_approve THEN
    UPDATE public.description_voice_profiles
       SET status = 'archived', updated_at = now()
     WHERE tenant_id = p_tenant_id AND status = 'approved';
  END IF;
  INSERT INTO public.description_voice_profiles (
    tenant_id, version, status, profile_json, dealer_name, city, state,
    approved_claims, change_reason, created_by, approved_by, approved_at
  ) VALUES (
    p_tenant_id, p_version, CASE WHEN p_approve THEN 'approved' ELSE 'draft' END,
    COALESCE(p_profile, '{}'::jsonb),
    NULLIF(p_profile->>'dealerName',''), NULLIF(p_profile->>'city',''), NULLIF(p_profile->>'state',''),
    COALESCE(ARRAY(SELECT jsonb_array_elements_text(p_profile->'approvedClaims')), '{}'),
    p_reason, v_uid,
    CASE WHEN p_approve THEN v_uid END,
    CASE WHEN p_approve THEN now() END
  ) RETURNING id INTO v_id;
  INSERT INTO public.audit_log (action, entity_type, entity_id, store_id, details)
  VALUES ('voice_profile_changed', 'description_voice_profile', v_id, p_tenant_id,
          jsonb_build_object('version', p_version, 'approved', p_approve, 'reason', p_reason,
                             'actor_role', v_role));
  RETURN jsonb_build_object('ok', true, 'id', v_id, 'version', p_version,
                            'status', CASE WHEN p_approve THEN 'approved' ELSE 'draft' END);
END;
$$;
REVOKE ALL ON FUNCTION public.save_description_voice_profile(uuid, jsonb, text, boolean, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_description_voice_profile(uuid, jsonb, text, boolean, text) TO authenticated;

-- ── RPC: save channel policy ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.save_description_channel_policy(
  p_tenant_id uuid,
  p_channel   text,
  p_policy    jsonb,
  p_active    boolean DEFAULT true,
  p_reason    text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid  uuid := auth.uid();
  v_role text;
  v_id   uuid;
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
  IF v_role NOT IN ('owner','general_manager','gsm','admin','manager','compliance') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'insufficient_permission');
  END IF;
  p_policy := COALESCE(p_policy, '{}'::jsonb) - 'deliveryMode' - 'connectorStatus'
              - 'htmlAllowed' - 'seoFields' - 'limitVerified';
  INSERT INTO public.description_channel_policies (
    tenant_id, channel, active, policy_json, policy_version,
    last_reviewed, reviewed_by, change_reason
  ) VALUES (
    p_tenant_id, p_channel, COALESCE(p_active, true), p_policy,
    NULLIF(p_policy->>'policyVersion',''), now(), v_uid, p_reason
  )
  ON CONFLICT (tenant_id, channel) DO UPDATE SET
    active         = EXCLUDED.active,
    policy_json    = EXCLUDED.policy_json,
    policy_version = EXCLUDED.policy_version,
    last_reviewed  = now(),
    reviewed_by    = EXCLUDED.reviewed_by,
    change_reason  = EXCLUDED.change_reason,
    updated_at     = now()
  RETURNING id INTO v_id;
  INSERT INTO public.audit_log (action, entity_type, entity_id, store_id, details)
  VALUES ('channel_policy_changed', 'description_channel_policy', v_id, p_tenant_id,
          jsonb_build_object('channel', p_channel, 'active', p_active, 'reason', p_reason,
                             'actor_role', v_role));
  RETURN jsonb_build_object('ok', true, 'id', v_id, 'channel', p_channel);
END;
$$;
REVOKE ALL ON FUNCTION public.save_description_channel_policy(uuid, text, jsonb, boolean, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_description_channel_policy(uuid, text, jsonb, boolean, text) TO authenticated;

-- ── RPC: record output use ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.record_description_output_use(
  p_version_id  uuid,
  p_channel     text,
  p_action      text,
  p_destination text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid   uuid := auth.uid();
  v_ver   public.description_versions%ROWTYPE;
  v_ok    boolean;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;
  IF p_action NOT IN ('saved_to_vehicle','exported','copied') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unsupported_action');
  END IF;
  SELECT * INTO v_ver FROM public.description_versions WHERE id = p_version_id;
  IF v_ver.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'version_not_found');
  END IF;
  SELECT EXISTS (
    SELECT 1 FROM public.tenant_members
    WHERE tenant_id = v_ver.tenant_id AND user_id = v_uid AND accepted_at IS NOT NULL
  ) INTO v_ok;
  IF NOT v_ok THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
  END IF;
  INSERT INTO public.description_deliveries (
    tenant_id, vehicle_id, description_case_id, version_id, destination,
    delivery_mode, connector_status, status, idempotency_key, response_metadata
  ) VALUES (
    v_ver.tenant_id, v_ver.vehicle_id, v_ver.description_case_id, p_version_id,
    COALESCE(p_destination, p_channel, 'manual_export'),
    'export_only', 'export_only', 'recorded',
    p_version_id::text || ':' || p_action || ':' || COALESCE(p_channel,'master') || ':' || v_uid::text,
    jsonb_build_object('action', p_action, 'channel', p_channel,
                       'note', 'Operator took a copy of a stored version. No delivery was performed.')
  )
  ON CONFLICT (idempotency_key) DO NOTHING;
  INSERT INTO public.audit_log (action, entity_type, entity_id, store_id, details)
  VALUES ('description_' || p_action, 'description_version', p_version_id, v_ver.tenant_id,
          jsonb_build_object('channel', p_channel, 'version_number', v_ver.version_number,
                             'destination', p_destination));
  RETURN jsonb_build_object('ok', true, 'version_id', p_version_id,
                            'version_number', v_ver.version_number, 'action', p_action);
END;
$$;
REVOKE ALL ON FUNCTION public.record_description_output_use(uuid, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_description_output_use(uuid, text, text, text) TO authenticated;

-- ── 7. Fact snapshot canonical features ──────────────────────────────
ALTER TABLE public.description_fact_snapshots
  ADD COLUMN IF NOT EXISTS features_json jsonb NOT NULL DEFAULT '{}'::jsonb;

-- ── 8. More version fields ───────────────────────────────────────────
ALTER TABLE public.description_versions
  ADD COLUMN IF NOT EXISTS language        text NOT NULL DEFAULT 'en',
  ADD COLUMN IF NOT EXISTS locale          text NOT NULL DEFAULT 'en-US',
  ADD COLUMN IF NOT EXISTS repair_json     jsonb,
  ADD COLUMN IF NOT EXISTS compliance_review_state text NOT NULL DEFAULT 'not_required'
    CHECK (compliance_review_state IN ('not_required','pending','cleared','rejected')),
  ADD COLUMN IF NOT EXISTS pipeline_stage  text;

ALTER TABLE public.description_channel_versions
  ADD COLUMN IF NOT EXISTS repair_json     jsonb,
  ADD COLUMN IF NOT EXISTS language        text NOT NULL DEFAULT 'en',
  ADD COLUMN IF NOT EXISTS locale          text NOT NULL DEFAULT 'en-US';

-- ── Validation overrides ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.description_validation_overrides (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  description_case_id uuid NOT NULL REFERENCES public.description_cases(id) ON DELETE CASCADE,
  version_id          uuid REFERENCES public.description_versions(id) ON DELETE CASCADE,
  validator_codes     text[] NOT NULL,
  reason              text NOT NULL,
  actor_user_id       uuid NOT NULL REFERENCES auth.users(id),
  actor_role          text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT description_validation_overrides_reason_len CHECK (char_length(reason) >= 10)
);
CREATE INDEX IF NOT EXISTS idx_description_validation_overrides_version
  ON public.description_validation_overrides (version_id, created_at DESC);

GRANT SELECT ON public.description_validation_overrides TO authenticated;
GRANT ALL ON public.description_validation_overrides TO service_role;
ALTER TABLE public.description_validation_overrides ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public'
                 AND tablename='description_validation_overrides' AND policyname='tenant_members_read') THEN
    CREATE POLICY "tenant_members_read" ON public.description_validation_overrides
      FOR SELECT TO authenticated
      USING (tenant_id IN (SELECT tenant_id FROM public.tenant_members
                           WHERE user_id = (SELECT auth.uid()) AND accepted_at IS NOT NULL));
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════════════
-- PART 2 — generation governance
-- ═══════════════════════════════════════════════════════════════════════

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

ALTER TABLE public.description_versions
  ADD COLUMN IF NOT EXISTS model_execution_id uuid
    REFERENCES public.description_model_executions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS prompt_checksum    text,
  ADD COLUMN IF NOT EXISTS candidate_json     jsonb,
  ADD COLUMN IF NOT EXISTS correlation_id     text;

DROP TRIGGER IF EXISTS set_updated_at_description_generation_budgets
  ON public.description_generation_budgets;
CREATE TRIGGER set_updated_at_description_generation_budgets
  BEFORE UPDATE ON public.description_generation_budgets
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

GRANT SELECT ON public.description_model_executions TO authenticated;
GRANT SELECT ON public.description_generation_budgets TO authenticated;
GRANT SELECT ON public.description_budget_overrides TO authenticated;
GRANT SELECT ON public.description_preflight_results TO authenticated;
GRANT ALL ON public.description_model_executions TO service_role;
GRANT ALL ON public.description_generation_budgets TO service_role;
GRANT ALL ON public.description_budget_overrides TO service_role;
GRANT ALL ON public.description_preflight_results TO service_role;

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
  END LOOP;
END $$;

-- ── RPC: save budget ─────────────────────────────────────────────────
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

-- ── RPC: current-period spend ────────────────────────────────────────
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
