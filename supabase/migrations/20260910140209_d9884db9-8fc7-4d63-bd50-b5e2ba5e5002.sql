-- ──────────────────────────────────────────────────────────────────────
-- Market Intelligence V2 — append-only valuation evidence
--
-- Additive only. Nothing is dropped, nothing is backfilled, no existing
-- column changes meaning. vehicle_listings.market_value / market_position /
-- market_meta stay as they are and become compatibility mirrors written by
-- ONE writer once V2 is switched on.
--
-- Why an append-only table rather than more columns on vehicle_listings:
-- today a dealer looking at "$4,718 Above Market" cannot be told which price
-- was compared, which request produced the market number, whether the car was
-- priced as certified, which comparables were used, or which of them belonged
-- to the dealer's own rooftop. Those facts have nowhere to live. A valuation
-- row is one immutable answer plus everything needed to reconstruct it.
--
-- Two things this file does that a comment cannot:
--
--   1. Every rule that protects a customer-facing claim is a CHECK whose
--      expression can never evaluate to NULL. PostgreSQL accepts a CHECK that
--      evaluates to true OR NULL, so a nullable column inside a conjunction is
--      a hole, not a guard. Every such clause is wrapped in `IS TRUE`.
--   2. Append-only is enforced by privilege and trigger, not by the absence of
--      an RLS policy. service_role carries BYPASSRLS; "no policy" stops dealer
--      staff and stops nothing else.
--
-- Contains no secrets and no customer PII.
-- ──────────────────────────────────────────────────────────────────────

-- ══ 1. Valuations ═════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.vehicle_market_valuations (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- RESTRICT, not CASCADE. Deleting a dealership must not silently erase the
  -- evidence for every price claim ever made about its cars; off-boarding runs
  -- the owner-only purge below, deliberately.
  tenant_id                   uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  listing_id                  uuid,
  vehicle_file_id             uuid,
  vin                         text NOT NULL,

  algorithm_version           text NOT NULL,
  status                      text NOT NULL,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  checked_at                  timestamptz,
  stale_at                    timestamptz,
  expires_at                  timestamptz,

  -- Subject, as the engine saw it.
  subject_inputs              jsonb NOT NULL DEFAULT '{}'::jsonb,
  displayed_total_price       numeric(12,2),
  vehicle_comparison_price    numeric(12,2),
  conditional_discounts       numeric(12,2),
  -- NULL is UNKNOWN, never zero. A row that cannot say where the add-on sits
  -- cannot state a customer total, which is why the two columns below are
  -- nullable and why `total_with_mandatory_add_ons` is null alongside them.
  mandatory_dealer_add_ons    numeric(12,2),
  mandatory_add_ons_included_in_displayed_price boolean,
  mandatory_add_on_source     text,
  total_with_mandatory_add_ons numeric(12,2),
  doc_fee                     numeric(12,2),
  fee_decomposition           jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- NOT NULL: a nullable basis is exactly how a red row slipped past the
  -- evidence constraint in review.
  price_basis_status          text NOT NULL,
  price_basis_reasons         text[] NOT NULL DEFAULT '{}',

  -- Provider, reconstructable.
  provider                    text,
  provider_endpoint           text,
  provider_selected_field     text,
  provider_request_params     jsonb NOT NULL DEFAULT '{}'::jsonb,   -- api key never present
  provider_request_fingerprint text,
  provider_response_hash      text,
  provider_prediction         numeric(12,2),
  provider_range_low          numeric(12,2),
  provider_range_high         numeric(12,2),
  provider_validation         jsonb NOT NULL DEFAULT '{}'::jsonb,
  provider_answered_at        timestamptz,
  provider_attempt_status     text,

  -- Did the provider price the same certification class as the subject?
  -- Three states: true, false, unknown. NULL is unknown and is never a match.
  certification_match         boolean,

  -- The whole valuation decision, not just the provider inputs. See
  -- src/lib/market/fingerprints.ts.
  valuation_input_fingerprint text,

  -- Comparable evidence.
  raw_candidate_count         integer NOT NULL DEFAULT 0,
  eligible_primary_count      integer NOT NULL DEFAULT 0,
  effective_sample_size       numeric(10,4) NOT NULL DEFAULT 0,
  independent_rooftop_count   integer NOT NULL DEFAULT 0,
  independent_group_count     integer NOT NULL DEFAULT 0,
  top_rooftop_share           numeric(6,4),
  top_group_share             numeric(6,4),
  effective_rooftop_cap       numeric(6,4),
  effective_group_cap         numeric(6,4),
  strict_concentration_satisfied boolean,
  insufficient_market_diversity  boolean NOT NULL DEFAULT true,
  winning_tier                text,
  relaxation_steps            text[] NOT NULL DEFAULT '{}',
  comparable_p10              numeric(12,2),
  comparable_p25              numeric(12,2),
  comparable_p50              numeric(12,2),
  comparable_p75              numeric(12,2),
  comparable_p90              numeric(12,2),
  market_floor                numeric(12,2),

  -- Conclusion.
  confidence_tier             text NOT NULL,
  confidence_reasons          text[] NOT NULL DEFAULT '{}',
  verdict                     text NOT NULL,
  verdict_tone                text NOT NULL,
  difference                  numeric(12,2),
  difference_percent          numeric(8,4),
  price_to_market_percent     numeric(8,3),

  -- Shadow work, never rendered.
  shadow_composite            jsonb,
  pricing_position_shadow     jsonb,
  model_versions              jsonb NOT NULL DEFAULT '{}'::jsonb,
  data_provenance             jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- ── Vocabulary ─────────────────────────────────────────────────────
  CONSTRAINT vmv_status_check
    CHECK (status IN ('available', 'limited', 'unavailable')),
  CONSTRAINT vmv_confidence_check
    CHECK (confidence_tier IN ('high', 'medium', 'low', 'unavailable')),
  CONSTRAINT vmv_tone_check
    CHECK (verdict_tone IN ('neutral', 'green', 'amber', 'red')),
  CONSTRAINT vmv_price_basis_check
    CHECK (price_basis_status IN ('verified', 'ambiguous', 'invalid')),
  CONSTRAINT vmv_verdict_vocabulary_check CHECK (verdict IN (
    'Market Estimate Unavailable',
    'Limited Market Evidence',
    'Competitive Market Position',
    'Below Adjusted Market',
    'Within Adjusted Market',
    'High End of Adjusted Market',
    'High End of Adjusted Market — Review Recommended',
    'Above Adjusted Market'
  )),

  -- ── The red gate ───────────────────────────────────────────────────
  -- Every clause is COALESCE-guarded or NOT NULL, and the whole conjunction
  -- is forced through IS TRUE, so a nullable column added here in future
  -- cannot reopen the hole this constraint was written to close.
  CONSTRAINT vmv_red_requires_evidence CHECK (
    verdict_tone IS DISTINCT FROM 'red'
    OR (
      confidence_tier IS NOT DISTINCT FROM 'high'
      AND COALESCE(effective_sample_size, 0) >= 5
      AND COALESCE(independent_rooftop_count, 0) >= 3
      AND COALESCE(top_rooftop_share, 1) <= 0.2000
      AND COALESCE(top_group_share, 1) <= 0.2000
      AND price_basis_status IS NOT DISTINCT FROM 'verified'
      AND certification_match IS TRUE
      AND COALESCE(insufficient_market_diversity, true) = false
      AND COALESCE(strict_concentration_satisfied, false) = true
    ) IS TRUE
  ),

  -- The same rules again, named individually, so a rejection message says
  -- WHICH evidentiary requirement failed instead of naming one omnibus check.
  CONSTRAINT vmv_red_requires_high_confidence
    CHECK ((verdict_tone IS DISTINCT FROM 'red' OR confidence_tier IS NOT DISTINCT FROM 'high') IS TRUE),
  CONSTRAINT vmv_red_requires_five_effective_comps
    CHECK ((verdict_tone IS DISTINCT FROM 'red' OR COALESCE(effective_sample_size, 0) >= 5) IS TRUE),
  CONSTRAINT vmv_red_requires_three_rooftops
    CHECK ((verdict_tone IS DISTINCT FROM 'red' OR COALESCE(independent_rooftop_count, 0) >= 3) IS TRUE),
  CONSTRAINT vmv_red_requires_rooftop_concentration
    CHECK ((verdict_tone IS DISTINCT FROM 'red' OR COALESCE(top_rooftop_share, 1) <= 0.2000) IS TRUE),
  CONSTRAINT vmv_red_requires_group_concentration
    CHECK ((verdict_tone IS DISTINCT FROM 'red' OR COALESCE(top_group_share, 1) <= 0.2000) IS TRUE),
  CONSTRAINT vmv_red_requires_verified_price_basis
    CHECK ((verdict_tone IS DISTINCT FROM 'red' OR price_basis_status IS NOT DISTINCT FROM 'verified') IS TRUE),
  CONSTRAINT vmv_red_requires_certification_match
    CHECK ((verdict_tone IS DISTINCT FROM 'red' OR certification_match IS TRUE) IS TRUE),
  CONSTRAINT vmv_red_requires_market_diversity
    CHECK ((verdict_tone IS DISTINCT FROM 'red' OR COALESCE(insufficient_market_diversity, true) = false) IS TRUE),

  -- ── Unavailable makes no claim ──────────────────────────────────────
  CONSTRAINT vmv_unavailable_is_never_red
    CHECK ((status IS DISTINCT FROM 'unavailable' OR verdict_tone IS NOT DISTINCT FROM 'neutral') IS TRUE),
  CONSTRAINT vmv_unavailable_confidence_is_never_red
    CHECK ((confidence_tier IS DISTINCT FROM 'unavailable' OR verdict_tone IS NOT DISTINCT FROM 'neutral') IS TRUE),
  CONSTRAINT vmv_unavailable_makes_no_claim CHECK (
    ((status IS DISTINCT FROM 'unavailable' AND confidence_tier IS DISTINCT FROM 'unavailable')
     OR (difference IS NULL AND difference_percent IS NULL
         AND price_to_market_percent IS NULL AND comparable_p50 IS NULL)) IS TRUE
  ),

  -- ── Certification ───────────────────────────────────────────────────
  -- A proven mismatch cannot be dressed as an available or high-confidence
  -- answer; that is the QX50 defect expressed as a storage rule.
  CONSTRAINT vmv_mismatch_is_never_available CHECK (
    (certification_match IS NOT FALSE
     OR (status IS DISTINCT FROM 'available' AND confidence_tier IS DISTINCT FROM 'high')) IS TRUE
  ),
  -- High confidence requires certification to be positively established.
  CONSTRAINT vmv_high_confidence_requires_certification_match CHECK (
    (confidence_tier IS DISTINCT FROM 'high' OR certification_match IS TRUE) IS TRUE
  ),

  -- ── Basis and provenance ────────────────────────────────────────────
  CONSTRAINT vmv_invalid_basis_has_no_price CHECK (
    (price_basis_status IS DISTINCT FROM 'invalid' OR vehicle_comparison_price IS NULL) IS TRUE
  ),
  CONSTRAINT vmv_provider_field_recorded CHECK (
    (provider_prediction IS NULL
     OR (provider IS NOT NULL AND provider_selected_field IS NOT NULL
         AND provider_request_fingerprint IS NOT NULL)) IS TRUE
  ),
  -- The two fingerprints are different questions and must not be conflated.
  CONSTRAINT vmv_fingerprints_are_distinct CHECK (
    (valuation_input_fingerprint IS NULL
     OR provider_request_fingerprint IS NULL
     OR valuation_input_fingerprint <> provider_request_fingerprint) IS TRUE
  ),

  -- Needed by the composite foreign key from the comparable ledger.
  CONSTRAINT vmv_id_tenant_unique UNIQUE (id, tenant_id)
);

CREATE INDEX IF NOT EXISTS idx_vmv_tenant_vin_time
  ON public.vehicle_market_valuations (tenant_id, vin, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_vmv_tenant_time
  ON public.vehicle_market_valuations (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_vmv_listing
  ON public.vehicle_market_valuations (listing_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_vmv_provider_fingerprint
  ON public.vehicle_market_valuations (provider_request_fingerprint, created_at DESC);

-- Idempotency: one decision per (tenant, VIN, complete valuation input). A
-- repeat computation with identical inputs is the same row, not a new one.
CREATE UNIQUE INDEX IF NOT EXISTS uq_vmv_valuation_fingerprint
  ON public.vehicle_market_valuations (tenant_id, vin, valuation_input_fingerprint)
  WHERE valuation_input_fingerprint IS NOT NULL;

COMMENT ON TABLE public.vehicle_market_valuations IS
  'Append-only market valuations. One row per computed decision; UPDATE and DELETE are rejected by trigger.';

-- ══ 2. Comparable ledger ══════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.vehicle_market_comparables (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  valuation_id            uuid NOT NULL,
  tenant_id               uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  subject_vin             text NOT NULL,
  comparable_vin          text,
  -- Every row is addressable even when it has no VIN, so a context-only or
  -- malformed candidate can still be shown in the explanation and can still be
  -- deduplicated — without being allowed to vote.
  evidence_ref            text NOT NULL,

  raw_attributes          jsonb NOT NULL DEFAULT '{}'::jsonb,
  year                    integer,
  make                    text,
  model                   text,
  trim                    text,
  drivetrain              text,
  mileage                 integer,
  advertised_price        numeric(12,2),
  normalized_vehicle_price numeric(12,2),
  price_basis_status      text,

  certified               boolean,     -- NULL is UNKNOWN, never "not certified"
  certification_program   text,

  dealer_name             text,
  dealer_id               text,
  rooftop_id              text,
  dealer_group_id         text,
  dealer_group_name       text,
  dealer_domain           text,
  distance_miles          numeric(8,2),
  days_on_market          integer,
  listing_observed_at     timestamptz,

  history_status          text NOT NULL DEFAULT 'unknown',
  condition_status        text NOT NULL DEFAULT 'unknown',
  is_duplicate            boolean NOT NULL DEFAULT false,
  inclusion_status        text NOT NULL,
  tier                    text,
  exclusion_reasons       text[] NOT NULL DEFAULT '{}',
  similarity_components   jsonb NOT NULL DEFAULT '{}'::jsonb,
  raw_weight              numeric(12,8) NOT NULL DEFAULT 0,
  capped_weight           numeric(12,8) NOT NULL DEFAULT 0,
  adjusted_price          numeric(12,2),
  source_observed_at      timestamptz,
  created_at              timestamptz NOT NULL DEFAULT now(),

  -- A comparable cannot claim one tenant while citing another tenant's
  -- valuation. Enforced by the key itself rather than by writer discipline.
  CONSTRAINT vmc_valuation_tenant_fk
    FOREIGN KEY (valuation_id, tenant_id)
    REFERENCES public.vehicle_market_valuations (id, tenant_id) ON DELETE RESTRICT,

  CONSTRAINT vmc_inclusion_check
    CHECK (inclusion_status IN ('primary', 'secondary', 'context_only', 'excluded')),
  CONSTRAINT vmc_history_check
    CHECK (history_status IN ('clean', 'adverse', 'unknown')),
  CONSTRAINT vmc_condition_check
    CHECK (condition_status IN ('verified', 'unknown')),
  CONSTRAINT vmc_weights_non_negative
    CHECK ((raw_weight >= 0 AND capped_weight >= 0) IS TRUE),
  CONSTRAINT vmc_only_primary_carries_weight
    CHECK ((inclusion_status = 'primary' OR (raw_weight = 0 AND capped_weight = 0)) IS TRUE),
  CONSTRAINT vmc_subject_never_votes
    CHECK ((comparable_vin IS DISTINCT FROM subject_vin OR (raw_weight = 0 AND capped_weight = 0)) IS TRUE),
  -- A row without a VIN is evidence, not a vote.
  CONSTRAINT vmc_voting_rows_have_a_vin
    CHECK ((comparable_vin IS NOT NULL OR (raw_weight = 0 AND capped_weight = 0)) IS TRUE)
);

CREATE INDEX IF NOT EXISTS idx_vmc_valuation ON public.vehicle_market_comparables (valuation_id);
CREATE INDEX IF NOT EXISTS idx_vmc_tenant_subject
  ON public.vehicle_market_comparables (tenant_id, subject_vin, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_vmc_comparable_vin
  ON public.vehicle_market_comparables (comparable_vin);

-- One VIN votes once per valuation, and every evidence row is unique, even the
-- ones that carry no VIN.
CREATE UNIQUE INDEX IF NOT EXISTS uq_vmc_valuation_comparable_vin
  ON public.vehicle_market_comparables (valuation_id, comparable_vin)
  WHERE comparable_vin IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_vmc_valuation_evidence_ref
  ON public.vehicle_market_comparables (valuation_id, evidence_ref);

-- ══ 3. Model metrics ══════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.market_value_model_metrics (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- NULL tenant_id means a GLOBAL, cross-dealer metric. Those are proprietary
  -- performance figures and are not readable by dealership users.
  tenant_id             uuid REFERENCES public.tenants(id) ON DELETE RESTRICT,
  model_key             text NOT NULL,
  model_version         text NOT NULL,
  cohort                jsonb NOT NULL DEFAULT '{}'::jsonb,
  evaluated_from        timestamptz NOT NULL,
  evaluated_to          timestamptz NOT NULL,
  sample_size           integer NOT NULL DEFAULT 0,
  mae                   numeric(12,2),
  median_absolute_error numeric(12,2),
  mape                  numeric(8,4),
  bias                  numeric(12,2),
  interval_coverage     numeric(6,4),
  false_positive_rate   numeric(6,4),
  stability             numeric(8,4),
  notes                 text,
  created_at            timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT mvmm_window_ordered CHECK ((evaluated_to > evaluated_from) IS TRUE)
);

CREATE INDEX IF NOT EXISTS idx_mvmm_model_time
  ON public.market_value_model_metrics (model_key, evaluated_to DESC);

-- ══ 4. Provider budget and reservation ════════════════════════════════
-- A paid call must be reserved BEFORE it is made. An advisory lock taken at
-- commit time is too late: two edge functions can both decide to call, both
-- call, and both pay, and the lock only serialises the write afterwards.

CREATE TABLE IF NOT EXISTS public.market_provider_budgets (
  tenant_id             uuid PRIMARY KEY REFERENCES public.tenants(id) ON DELETE RESTRICT,
  provider              text NOT NULL DEFAULT 'marketcheck',
  monthly_budget_usd    numeric(10,2) NOT NULL DEFAULT 0,
  per_call_cost_usd     numeric(8,4) NOT NULL DEFAULT 0.07,
  enabled               boolean NOT NULL DEFAULT false,
  updated_by            uuid,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mpb_budget_non_negative CHECK ((monthly_budget_usd >= 0 AND per_call_cost_usd >= 0) IS TRUE)
);

CREATE TABLE IF NOT EXISTS public.provider_request_reservations (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  provider             text NOT NULL,
  request_fingerprint  text NOT NULL,
  attempt_id           uuid NOT NULL DEFAULT gen_random_uuid(),
  status               text NOT NULL DEFAULT 'reserved',
  reserved_at          timestamptz NOT NULL DEFAULT now(),
  expires_at           timestamptz NOT NULL,
  completed_at         timestamptz,
  estimated_cost_usd   numeric(8,4) NOT NULL DEFAULT 0,
  actual_cost_usd      numeric(8,4),
  failure_reason       text,
  CONSTRAINT prr_status_check
    CHECK (status IN ('reserved', 'succeeded', 'failed', 'expired')),
  CONSTRAINT prr_completed_has_time
    CHECK ((status = 'reserved' OR completed_at IS NOT NULL) IS TRUE)
);

-- At most ONE live reservation per provider fingerprint, across every caller.
CREATE UNIQUE INDEX IF NOT EXISTS uq_prr_active_fingerprint
  ON public.provider_request_reservations (provider, request_fingerprint)
  WHERE status = 'reserved';

CREATE INDEX IF NOT EXISTS idx_prr_tenant_month
  ON public.provider_request_reservations (tenant_id, reserved_at DESC);

COMMENT ON TABLE public.provider_request_reservations IS
  'Pre-call reservation and spend ledger for paid provider requests. Never stores credentials.';

-- ══ 5. Append-only, enforced by the database ══════════════════════════
--
-- RLS does not make a table append-only. service_role carries BYPASSRLS and
-- the default public-schema grants, so "we granted no UPDATE policy" stops
-- dealer staff and stops nothing else — and the only thing that will ever
-- write here runs as service_role.
--
-- Two independent locks, so undoing one is not enough:
--
--   1. UPDATE, DELETE and TRUNCATE are revoked from every runtime role.
--   2. A trigger rejects UPDATE and DELETE unless the acting role IS the table
--      owner. There is no session flag, no GUC and no argument that lets a
--      runtime role talk its way past this: service_role cannot become the
--      owner, so it cannot reach the allowed branch at all.
--
-- Administrative recovery therefore requires the database owner — a migration,
-- or the owner-only procedure below whose EXECUTE is revoked from PUBLIC,
-- anon, authenticated and service_role.

CREATE OR REPLACE FUNCTION public.reject_valuation_mutation()
RETURNS trigger
LANGUAGE plpgsql
-- Pinned so a caller's search_path cannot influence resolution inside a trigger
-- that fires implicitly on every write. Every reference below is already
-- schema-qualified; this is defence in depth, not a fix for a live exposure.
-- (The repository's 231 existing SECURITY DEFINER functions pin `public`; the
-- explicit `pg_catalog, public` used here is the stricter superset.)
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_owner name;
BEGIN
  SELECT pg_catalog.pg_get_userbyid(c.relowner) INTO v_owner
    FROM pg_catalog.pg_class c
   WHERE c.oid = TG_RELID;

  -- SECURITY INVOKER on purpose: current_user must be the role actually
  -- performing the statement, not the function's definer.
  IF current_user = v_owner THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  RAISE EXCEPTION
    'market valuation evidence is append-only: % on public.% is not permitted for role %',
    TG_OP, TG_TABLE_NAME, current_user
    USING ERRCODE = '42501',
          HINT = 'Evidence is immutable. Corrections are made by writing a new valuation row.';
END
$$;

COMMENT ON FUNCTION public.reject_valuation_mutation() IS
  'Append-only guard. Permits UPDATE/DELETE only for the table owner (migration or owner-only procedure).';

DROP TRIGGER IF EXISTS trg_vmv_append_only ON public.vehicle_market_valuations;
CREATE TRIGGER trg_vmv_append_only
  BEFORE UPDATE OR DELETE ON public.vehicle_market_valuations
  FOR EACH ROW EXECUTE FUNCTION public.reject_valuation_mutation();

DROP TRIGGER IF EXISTS trg_vmc_append_only ON public.vehicle_market_comparables;
CREATE TRIGGER trg_vmc_append_only
  BEFORE UPDATE OR DELETE ON public.vehicle_market_comparables
  FOR EACH ROW EXECUTE FUNCTION public.reject_valuation_mutation();

REVOKE UPDATE, DELETE, TRUNCATE ON public.vehicle_market_valuations  FROM PUBLIC, anon, authenticated, service_role;
REVOKE UPDATE, DELETE, TRUNCATE ON public.vehicle_market_comparables FROM PUBLIC, anon, authenticated, service_role;

-- The writer keeps exactly what it needs and nothing more.
GRANT SELECT, INSERT ON public.vehicle_market_valuations  TO service_role;
GRANT SELECT, INSERT ON public.vehicle_market_comparables TO service_role;

-- market_value_model_metrics is a CALCULATED table, not evidence. It is
-- deliberately left mutable so a metrics recomputation can replace its own
-- rows without an owner-level intervention.

-- ══ 6. Owner-only administrative recovery ═════════════════════════════
-- The documented path for tenant off-boarding. Because the tenant foreign keys
-- are ON DELETE RESTRICT, deleting a dealership fails until its evidence is
-- deliberately purged through this procedure — which no runtime role can call.
-- It is never invoked by application code and is not run by this migration.

CREATE OR REPLACE FUNCTION public.admin_purge_tenant_market_evidence(
  p_tenant_id uuid,
  p_reason    text
)
RETURNS TABLE (comparables_deleted bigint, valuations_deleted bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_comparables bigint;
  v_valuations  bigint;
BEGIN
  IF p_reason IS NULL OR length(btrim(p_reason)) < 10 THEN
    RAISE EXCEPTION 'a written reason is required to purge market evidence';
  END IF;

  DELETE FROM public.vehicle_market_comparables WHERE tenant_id = p_tenant_id;
  GET DIAGNOSTICS v_comparables = ROW_COUNT;

  DELETE FROM public.vehicle_market_valuations WHERE tenant_id = p_tenant_id;
  GET DIAGNOSTICS v_valuations = ROW_COUNT;

  INSERT INTO public.audit_log (action, entity_type, entity_id, metadata)
  VALUES ('market_evidence_purged', 'tenant', p_tenant_id,
          jsonb_build_object('reason', p_reason,
                             'comparables_deleted', v_comparables,
                             'valuations_deleted', v_valuations));

  comparables_deleted := v_comparables;
  valuations_deleted  := v_valuations;
  RETURN NEXT;
END
$$;

REVOKE ALL ON FUNCTION public.admin_purge_tenant_market_evidence(uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION public.admin_purge_tenant_market_evidence(uuid, text) IS
  'Owner-only tenant off-boarding purge. EXECUTE is revoked from every runtime role by design.';

-- ══ 7. Atomic provider reservation and budget ═════════════════════════

CREATE OR REPLACE FUNCTION public.market_reserve_provider_call(
  p_tenant_id   uuid,
  p_provider    text,
  p_fingerprint text,
  p_ttl_seconds integer DEFAULT 120
)
RETURNS TABLE (
  outcome            text,      -- reserved | existing | budget_exceeded | disabled
  attempt_id         uuid,
  estimated_cost_usd numeric,
  month_spent_usd    numeric,
  month_budget_usd   numeric
)
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_budget  public.market_provider_budgets%ROWTYPE;
  v_spent   numeric := 0;
  v_month   timestamptz := date_trunc('month', now());
  v_existing public.provider_request_reservations%ROWTYPE;
  v_id      uuid;
BEGIN
  -- Expire anything abandoned before measuring, so a crashed caller cannot
  -- hold a fingerprint or a slice of the budget forever.
  UPDATE public.provider_request_reservations
     SET status = 'expired', completed_at = now(), failure_reason = 'reservation_expired'
   WHERE status = 'reserved' AND expires_at < now();

  -- Serialise every decision for this tenant, so two callers cannot both read
  -- the same remaining budget and both spend it.
  SELECT * INTO v_budget FROM public.market_provider_budgets
   WHERE tenant_id = p_tenant_id FOR UPDATE;

  IF NOT FOUND OR v_budget.enabled IS NOT TRUE THEN
    RETURN QUERY SELECT 'disabled'::text, NULL::uuid, 0::numeric, 0::numeric, 0::numeric;
    RETURN;
  END IF;

  SELECT * INTO v_existing FROM public.provider_request_reservations
   WHERE provider = p_provider AND request_fingerprint = p_fingerprint AND status = 'reserved'
   LIMIT 1;
  IF FOUND THEN
    RETURN QUERY SELECT 'existing'::text, v_existing.attempt_id, v_existing.estimated_cost_usd,
                        0::numeric, v_budget.monthly_budget_usd;
    RETURN;
  END IF;

  SELECT COALESCE(SUM(COALESCE(actual_cost_usd, estimated_cost_usd)), 0) INTO v_spent
    FROM public.provider_request_reservations
   WHERE tenant_id = p_tenant_id AND reserved_at >= v_month
     AND status IN ('reserved', 'succeeded');

  IF v_spent + v_budget.per_call_cost_usd > v_budget.monthly_budget_usd THEN
    RETURN QUERY SELECT 'budget_exceeded'::text, NULL::uuid, v_budget.per_call_cost_usd,
                        v_spent, v_budget.monthly_budget_usd;
    RETURN;
  END IF;

  INSERT INTO public.provider_request_reservations
    (tenant_id, provider, request_fingerprint, status, expires_at, estimated_cost_usd)
  VALUES
    (p_tenant_id, p_provider, p_fingerprint, 'reserved',
     now() + make_interval(secs => GREATEST(p_ttl_seconds, 10)), v_budget.per_call_cost_usd)
  RETURNING provider_request_reservations.attempt_id INTO v_id;

  RETURN QUERY SELECT 'reserved'::text, v_id, v_budget.per_call_cost_usd,
                      v_spent, v_budget.monthly_budget_usd;
EXCEPTION
  WHEN unique_violation THEN
    -- Another caller won the race for this fingerprint between our check and
    -- our insert. Hand back theirs; nobody pays twice.
    SELECT * INTO v_existing FROM public.provider_request_reservations
     WHERE provider = p_provider AND request_fingerprint = p_fingerprint AND status = 'reserved'
     LIMIT 1;
    RETURN QUERY SELECT 'existing'::text, v_existing.attempt_id, v_existing.estimated_cost_usd,
                        0::numeric, 0::numeric;
END
$$;

CREATE OR REPLACE FUNCTION public.market_complete_provider_call(
  p_attempt_id     uuid,
  p_status         text,
  p_actual_cost    numeric DEFAULT NULL,
  p_failure_reason text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF p_status NOT IN ('succeeded', 'failed') THEN
    RAISE EXCEPTION 'provider call may only complete as succeeded or failed, got %', p_status;
  END IF;
  UPDATE public.provider_request_reservations
     SET status = p_status,
         completed_at = now(),
         actual_cost_usd = COALESCE(p_actual_cost, CASE WHEN p_status = 'succeeded' THEN estimated_cost_usd ELSE 0 END),
         failure_reason = p_failure_reason
   WHERE attempt_id = p_attempt_id AND status = 'reserved';
END
$$;

-- ══ 8. Atomic valuation commit ════════════════════════════════════════
-- The decision and the evidence for it land together or not at all. A
-- valuation without its comparable ledger is an unexplainable claim.

CREATE OR REPLACE FUNCTION public.market_valuation_commit(
  p_valuation   jsonb,
  p_comparables jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_id      uuid := gen_random_uuid();
  v_now     timestamptz := now();
  v_tenant  uuid := (p_valuation->>'tenant_id')::uuid;
BEGIN
  -- jsonb_populate_record returns NULL for any key the payload omits, and an
  -- explicit NULL BYPASSES a column default — so a caller that (correctly)
  -- sends no id would insert a null primary key and a null created_at. The
  -- identity and the timestamp are therefore supplied here rather than left to
  -- the table defaults, which this insert can never reach.
  INSERT INTO public.vehicle_market_valuations
  SELECT (jsonb_populate_record(
            NULL::public.vehicle_market_valuations,
            p_valuation
              || jsonb_build_object('id', v_id::text, 'created_at', v_now)
         )).*;

  IF p_comparables IS NOT NULL AND jsonb_typeof(p_comparables) = 'array' THEN
    INSERT INTO public.vehicle_market_comparables
    SELECT (jsonb_populate_record(
              NULL::public.vehicle_market_comparables,
              row_json || jsonb_build_object(
                'id', gen_random_uuid()::text,
                'created_at', v_now,
                'valuation_id', v_id::text,
                'tenant_id', v_tenant::text))).*
      FROM jsonb_array_elements(p_comparables) AS row_json;
  END IF;

  RETURN v_id;
END
$$;

REVOKE ALL ON FUNCTION public.market_reserve_provider_call(uuid, text, text, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.market_complete_provider_call(uuid, text, numeric, text)  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.market_valuation_commit(jsonb, jsonb)                     FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.market_reserve_provider_call(uuid, text, text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.market_complete_provider_call(uuid, text, numeric, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.market_valuation_commit(jsonb, jsonb)                    TO service_role;

-- ══ 9. Row level security ═════════════════════════════════════════════
--
-- Dealer staff read their own tenant's evidence and nothing else. No INSERT,
-- UPDATE or DELETE policy is granted to `authenticated` at all — the writer is
-- service_role and the tables are append-only above.
--
-- auth.uid() is wrapped as (SELECT auth.uid()) so the planner caches it as an
-- initPlan rather than evaluating it once per row.

ALTER TABLE public.vehicle_market_valuations     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vehicle_market_comparables    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.market_value_model_metrics    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.market_provider_budgets       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.provider_request_reservations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "vehicle_market_valuations tenant read" ON public.vehicle_market_valuations;
CREATE POLICY "vehicle_market_valuations tenant read"
  ON public.vehicle_market_valuations FOR SELECT
  TO authenticated
  USING (
    tenant_id IN (
      SELECT tenant_id FROM public.tenant_members
      WHERE user_id = (SELECT auth.uid())
    )
  );

DROP POLICY IF EXISTS "vehicle_market_comparables tenant read" ON public.vehicle_market_comparables;
CREATE POLICY "vehicle_market_comparables tenant read"
  ON public.vehicle_market_comparables FOR SELECT
  TO authenticated
  USING (
    tenant_id IN (
      SELECT tenant_id FROM public.tenant_members
      WHERE user_id = (SELECT auth.uid())
    )
  );

-- Model metrics, split in two.
--
-- A tenant may read metrics ABOUT ITSELF. Rows with a NULL tenant_id are
-- global, cross-dealer accuracy figures — how well our valuation model
-- performs against every dealership's outcomes — and a dealership user has no
-- business reading them. Those are readable only by an internal platform
-- administrator or by service_role, which bypasses RLS.
--
-- Note the shape: `tenant_id IS NOT NULL AND tenant_id IN (...)`. The earlier
-- draft said `tenant_id IS NULL OR ...`, which handed every authenticated user
-- of every dealership the global set.
DROP POLICY IF EXISTS "market_value_model_metrics tenant read" ON public.market_value_model_metrics;
CREATE POLICY "market_value_model_metrics tenant read"
  ON public.market_value_model_metrics FOR SELECT
  TO authenticated
  USING (
    tenant_id IS NOT NULL
    AND tenant_id IN (
      SELECT tenant_id FROM public.tenant_members
      WHERE user_id = (SELECT auth.uid())
    )
  );

-- The platform-admin check goes through the repository's existing helper rather
-- than reading user_roles directly. `has_role` is SECURITY DEFINER with a pinned
-- search_path, so it does NOT re-enter user_roles' own RLS the way a raw EXISTS
-- does — one policy evaluation instead of a policy inside a policy, and no
-- enum-to-text cast on a column that is indexed as an enum.
DROP POLICY IF EXISTS "market_value_model_metrics platform admin read" ON public.market_value_model_metrics;
CREATE POLICY "market_value_model_metrics platform admin read"
  ON public.market_value_model_metrics FOR SELECT
  TO authenticated
  USING ( public.has_role((SELECT auth.uid()), 'admin'::public.app_role) );

-- What a dealership is being CHARGED is financial and operational data, not
-- vehicle data. A salesperson needs the valuation; they have no business
-- reading the monthly provider budget, what each paid lookup cost, or how much
-- of the month's spend is gone. The valuation tables above stay readable by any
-- tenant member; these two do not.
--
-- Management is decided by the repository's existing helper, which is SECURITY
-- DEFINER with a pinned search_path and already means "an ACCEPTED owner or
-- admin of this tenant" — so it cannot recurse into tenant_members' own RLS and
-- it cannot be satisfied by an unaccepted invitation.
--
-- Argument order matters and is easy to get backwards:
--   is_tenant_manager(_tenant_id uuid, _user_id uuid)   -- tenant FIRST
-- Reversed, it silently returns false for everyone and the table reads as empty
-- rather than as an error.
DROP POLICY IF EXISTS "market_provider_budgets tenant read" ON public.market_provider_budgets;
DROP POLICY IF EXISTS "market_provider_budgets manager read" ON public.market_provider_budgets;
CREATE POLICY "market_provider_budgets manager read"
  ON public.market_provider_budgets FOR SELECT
  TO authenticated
  USING (
    public.is_tenant_manager(tenant_id, (SELECT auth.uid()))
    OR public.has_role((SELECT auth.uid()), 'admin'::public.app_role)
  );

DROP POLICY IF EXISTS "provider_request_reservations tenant read" ON public.provider_request_reservations;
DROP POLICY IF EXISTS "provider_request_reservations manager read" ON public.provider_request_reservations;
CREATE POLICY "provider_request_reservations manager read"
  ON public.provider_request_reservations FOR SELECT
  TO authenticated
  USING (
    public.is_tenant_manager(tenant_id, (SELECT auth.uid()))
    OR public.has_role((SELECT auth.uid()), 'admin'::public.app_role)
  );

REVOKE INSERT, UPDATE, DELETE ON public.market_value_model_metrics    FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.market_provider_budgets       FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.provider_request_reservations FROM anon, authenticated;
REVOKE ALL ON public.vehicle_market_valuations     FROM anon;
REVOKE ALL ON public.vehicle_market_comparables    FROM anon;
REVOKE ALL ON public.market_value_model_metrics    FROM anon;
REVOKE ALL ON public.market_provider_budgets       FROM anon;
REVOKE ALL ON public.provider_request_reservations FROM anon;