-- ──────────────────────────────────────────────────────────────────────
-- Market Intelligence V2 — append-only valuation audit
--
-- Additive only. Nothing is dropped, nothing is backfilled, and no existing
-- column changes meaning. vehicle_listings.market_value / market_position /
-- market_meta stay exactly as they are and become compatibility mirrors
-- written by ONE writer once V2 is switched on.
--
-- Why an append-only table instead of more columns on vehicle_listings:
-- today a dealer looking at "$4,718 Above Market" cannot be told which price
-- was compared, which request produced the market number, whether the car was
-- priced as certified, which comparables were used, or which of them belonged
-- to the dealer's own rooftop. Those facts have nowhere to live. A valuation
-- row is one immutable answer plus everything needed to reconstruct it, and
-- the history of answers is the evidence that the number moved for a reason.
--
-- Contains no secrets (the adapter strips every credential-shaped key before a
-- response is stored) and no customer PII.
-- ──────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.vehicle_market_valuations (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                   uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  listing_id                  uuid,
  vehicle_file_id             uuid,
  vin                         text NOT NULL,

  algorithm_version           text NOT NULL,
  status                      text NOT NULL,          -- available | limited | unavailable
  created_at                  timestamptz NOT NULL DEFAULT now(),
  checked_at                  timestamptz,
  stale_at                    timestamptz,
  expires_at                  timestamptz,

  -- Subject, as the engine saw it.
  subject_inputs              jsonb NOT NULL DEFAULT '{}'::jsonb,
  displayed_total_price       numeric(12,2),
  vehicle_comparison_price    numeric(12,2),
  fee_decomposition           jsonb NOT NULL DEFAULT '{}'::jsonb,
  price_basis_status          text,
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

  -- Comparable evidence.
  raw_candidate_count         integer NOT NULL DEFAULT 0,
  eligible_primary_count      integer NOT NULL DEFAULT 0,
  effective_sample_size       numeric(10,4) NOT NULL DEFAULT 0,
  independent_rooftop_count   integer NOT NULL DEFAULT 0,
  independent_group_count     integer NOT NULL DEFAULT 0,
  top_rooftop_share           numeric(6,4),
  top_group_share             numeric(6,4),
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

  CONSTRAINT vehicle_market_valuations_status_check
    CHECK (status IN ('available', 'limited', 'unavailable')),
  CONSTRAINT vehicle_market_valuations_confidence_check
    CHECK (confidence_tier IN ('high', 'medium', 'low', 'unavailable')),
  CONSTRAINT vehicle_market_valuations_tone_check
    CHECK (verdict_tone IN ('neutral', 'green', 'amber', 'red')),

  -- The red gate, enforced by the database as well as by the code. A row that
  -- claims red without high confidence, five effective comparables, three
  -- independent rooftops and both concentration caps satisfied cannot be
  -- written at all — so no future writer, migration or manual fix can
  -- reintroduce the QX50 warning by going around the engine.
  CONSTRAINT vehicle_market_valuations_red_requires_evidence CHECK (
    verdict_tone <> 'red'
    OR (
      confidence_tier = 'high'
      AND effective_sample_size >= 5
      AND independent_rooftop_count >= 3
      AND COALESCE(top_rooftop_share, 1) <= 0.2000
      AND COALESCE(top_group_share, 1) <= 0.2000
      AND price_basis_status = 'verified'
    )
  ),

  -- An unavailable valuation may not carry a dollar or percentage claim.
  CONSTRAINT vehicle_market_valuations_unavailable_makes_no_claim CHECK (
    confidence_tier <> 'unavailable'
    OR (difference IS NULL AND difference_percent IS NULL
        AND price_to_market_percent IS NULL AND comparable_p50 IS NULL)
  ),

  -- A price basis that did not verify cannot produce a comparison price.
  CONSTRAINT vehicle_market_valuations_invalid_basis_has_no_price CHECK (
    price_basis_status IS DISTINCT FROM 'invalid' OR vehicle_comparison_price IS NULL
  ),

  -- Every stored provider prediction names the field it came from.
  CONSTRAINT vehicle_market_valuations_provider_field_recorded CHECK (
    provider_prediction IS NULL
    OR (provider IS NOT NULL AND provider_selected_field IS NOT NULL
        AND provider_request_fingerprint IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_vmv_tenant_vin_time
  ON public.vehicle_market_valuations (tenant_id, vin, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_vmv_tenant_time
  ON public.vehicle_market_valuations (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_vmv_listing
  ON public.vehicle_market_valuations (listing_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_vmv_fingerprint
  ON public.vehicle_market_valuations (provider_request_fingerprint);

COMMENT ON TABLE public.vehicle_market_valuations IS
  'Append-only market valuations. One row per computed answer; never updated in place.';

-- ── The comparable ledger ─────────────────────────────────────────────
-- Every candidate that was considered, including the ones that were thrown
-- away and why. A dealer asking "why is my car above market" is owed the
-- excluded list as much as the included one.

CREATE TABLE IF NOT EXISTS public.vehicle_market_comparables (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  valuation_id            uuid NOT NULL REFERENCES public.vehicle_market_valuations(id) ON DELETE CASCADE,
  tenant_id               uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  subject_vin             text NOT NULL,
  comparable_vin          text,

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

  -- NULL is UNKNOWN certification and never means "not certified".
  certified               boolean,
  certification_program   text,

  dealer_name             text,
  dealer_id               text,
  rooftop_id              text,
  dealer_group_id         text,
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

  CONSTRAINT vmc_inclusion_check
    CHECK (inclusion_status IN ('primary', 'secondary', 'context_only', 'excluded')),
  CONSTRAINT vmc_history_check
    CHECK (history_status IN ('clean', 'adverse', 'unknown')),
  CONSTRAINT vmc_condition_check
    CHECK (condition_status IN ('verified', 'unknown')),
  -- Anything not primary contributes nothing. This is where "own rooftop has
  -- zero external weight" stops being a convention and becomes a fact.
  CONSTRAINT vmc_only_primary_carries_weight
    CHECK (inclusion_status = 'primary' OR (raw_weight = 0 AND capped_weight = 0)),
  CONSTRAINT vmc_subject_never_votes
    CHECK (comparable_vin IS DISTINCT FROM subject_vin OR (raw_weight = 0 AND capped_weight = 0))
);

CREATE INDEX IF NOT EXISTS idx_vmc_valuation ON public.vehicle_market_comparables (valuation_id);
CREATE INDEX IF NOT EXISTS idx_vmc_tenant_subject
  ON public.vehicle_market_comparables (tenant_id, subject_vin, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_vmc_comparable_vin
  ON public.vehicle_market_comparables (comparable_vin);

-- One VIN may appear at most once per valuation, so a duplicate cannot vote
-- twice even if a future writer forgets to deduplicate.
CREATE UNIQUE INDEX IF NOT EXISTS uq_vmc_valuation_comparable_vin
  ON public.vehicle_market_comparables (valuation_id, comparable_vin)
  WHERE comparable_vin IS NOT NULL;

-- ── Model metrics ─────────────────────────────────────────────────────
-- Forward-looking, out-of-time validation. Until this table has rows the
-- composite in composite.ts has no rolling error to learn from and stays
-- shadow-only by construction.

CREATE TABLE IF NOT EXISTS public.market_value_model_metrics (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid REFERENCES public.tenants(id) ON DELETE CASCADE,
  model_key             text NOT NULL,          -- e.g. marketcheck_prediction | comparable_p50 | composite
  model_version         text NOT NULL,
  cohort                jsonb NOT NULL DEFAULT '{}'::jsonb,  -- make/model/price band/mileage band/geography
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

  CONSTRAINT mvmm_window_ordered CHECK (evaluated_to > evaluated_from)
);

CREATE INDEX IF NOT EXISTS idx_mvmm_model_time
  ON public.market_value_model_metrics (model_key, evaluated_to DESC);

-- ── RLS ───────────────────────────────────────────────────────────────
-- Read-only for dealer staff, scoped to their own tenants. The edge function
-- runs as service role and is the single writer, so no INSERT, UPDATE or
-- DELETE policy is granted to `authenticated` at all — which is also what
-- makes the valuation history append-only in practice, not just by intent.
--
-- auth.uid() is wrapped as (SELECT auth.uid()) so the planner caches it as an
-- initPlan instead of evaluating it per row.

ALTER TABLE public.vehicle_market_valuations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vehicle_market_comparables ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.market_value_model_metrics ENABLE ROW LEVEL SECURITY;

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

DROP POLICY IF EXISTS "market_value_model_metrics tenant read" ON public.market_value_model_metrics;
CREATE POLICY "market_value_model_metrics tenant read"
  ON public.market_value_model_metrics FOR SELECT
  TO authenticated
  USING (
    tenant_id IS NULL
    OR tenant_id IN (
      SELECT tenant_id FROM public.tenant_members
      WHERE user_id = (SELECT auth.uid())
    )
  );
