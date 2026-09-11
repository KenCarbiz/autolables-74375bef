-- ── Shared market evidence, stored once ────────────────────────────────────
--
-- Authored under Gate 14F-C.
--
-- Why a new table rather than reusing what exists:
--
--   `vehicle_market_comparables.valuation_id` is NOT NULL and foreign-keyed to
--   a single valuation. That is correct for what it is — the comparable set a
--   SPECIFIC decision was made from, frozen with that decision — and it is
--   exactly wrong for shared evidence.
--
-- PROVIDER LICENSING AND RETENTION. These observations derive from
-- MarketCheck active-listing responses, retained as normalized evidence
-- supporting a valuation for one tenant, scoped by RLS, excluded from every
-- public payload.

CREATE TABLE IF NOT EXISTS public.market_cohort_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,

  cohort_hash text NOT NULL,
  cohort_rules_version text NOT NULL,
  cohort_year integer,
  cohort_make text,
  cohort_model text,
  cohort_trim text,
  cohort_drivetrain text,
  cohort_powertrain text,
  cohort_body_type text,
  cohort_vehicle_class text,
  cohort_certified_class text,
  cohort_zip text,
  cohort_radius_miles integer,

  snapshot_fingerprint text NOT NULL,
  snapshot_rules_version text NOT NULL,
  algorithm_version text NOT NULL,
  observed_at timestamptz NOT NULL DEFAULT now(),

  source_function text NOT NULL,
  source_endpoint_category text NOT NULL,
  query_dimensions jsonb NOT NULL DEFAULT '{}'::jsonb,

  observations jsonb NOT NULL DEFAULT '[]'::jsonb,
  eligible_observation_count integer NOT NULL DEFAULT 0,
  independent_rooftop_count integer NOT NULL DEFAULT 0,
  own_rooftop_excluded_count integer NOT NULL DEFAULT 0,
  evidence_sufficiency text NOT NULL,
  observation_p25 numeric(12,2),
  observation_p50 numeric(12,2),
  observation_p75 numeric(12,2),
  certified_share numeric(5,4),

  superseded_by uuid REFERENCES public.market_cohort_snapshots(id),

  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT market_cohort_snapshots_sufficiency_check
    CHECK (evidence_sufficiency IN ('sufficient', 'insufficient')),
  CONSTRAINT market_cohort_snapshots_counts_nonnegative
    CHECK (eligible_observation_count >= 0
       AND independent_rooftop_count >= 0
       AND own_rooftop_excluded_count >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS market_cohort_snapshots_identity_idx
  ON public.market_cohort_snapshots (tenant_id, cohort_hash, snapshot_fingerprint, algorithm_version);

CREATE INDEX IF NOT EXISTS market_cohort_snapshots_lookup_idx
  ON public.market_cohort_snapshots (tenant_id, cohort_hash, observed_at DESC);

ALTER TABLE public.vehicle_market_valuations
  ADD COLUMN IF NOT EXISTS market_snapshot_id uuid
    REFERENCES public.market_cohort_snapshots(id);

CREATE INDEX IF NOT EXISTS vehicle_market_valuations_snapshot_idx
  ON public.vehicle_market_valuations (market_snapshot_id);

ALTER TABLE public.market_cohort_snapshots ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.market_cohort_snapshots FROM PUBLIC;
REVOKE ALL ON public.market_cohort_snapshots FROM anon;
GRANT SELECT ON public.market_cohort_snapshots TO authenticated;
GRANT SELECT, INSERT ON public.market_cohort_snapshots TO service_role;

CREATE POLICY "market_cohort_snapshots_tenant_read"
  ON public.market_cohort_snapshots FOR SELECT
  TO authenticated
  USING (
    tenant_id IN (
      SELECT tenant_id FROM public.tenant_members
      WHERE user_id = (SELECT auth.uid())
    )
  );

COMMENT ON TABLE public.market_cohort_snapshots IS
  'Shared, append-only market evidence for one tenant and one MARKET cohort. '
  'Carries no subject VIN, no asking price, no credential and no provider '
  'image or description. One snapshot may inform many valuations.';

COMMENT ON COLUMN public.vehicle_market_valuations.market_snapshot_id IS
  'The shared market snapshot this valuation was judged against. Nullable.';