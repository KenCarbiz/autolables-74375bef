-- ── Shared market evidence, stored once ────────────────────────────────────
--
-- NOT APPLIED. Authored under Gate 14F-C and held for a supervised window.
--
-- Why a new table rather than reusing what exists:
--
--   `vehicle_market_comparables.valuation_id` is NOT NULL and foreign-keyed to
--   a single valuation. That is correct for what it is — the comparable set a
--   SPECIFIC decision was made from, frozen with that decision — and it is
--   exactly wrong for shared evidence. Reusing it would mean either inventing
--   a placeholder valuation for a snapshot that belongs to no vehicle, or
--   pointing several vehicles at one vehicle's row and calling it shared. Both
--   make the evidence trail lie about what happened.
--
--   So the snapshot gets its own table, and a valuation records which snapshot
--   informed it. One snapshot, many valuations, and each valuation still owns
--   its own frozen comparable rows.
--
-- What is deliberately NOT here: any subject VIN, any asking price of ours,
-- any API key, any provider URL, any image or description. The snapshot is a
-- description of a market, not a copy of a provider's catalogue.
--
-- PROVIDER LICENSING AND RETENTION. These observations derive from
-- MarketCheck active-listing responses. They are retained as normalized
-- evidence supporting a valuation we made for one tenant, scoped to that
-- tenant by RLS, excluded from every public payload, and superseded rather
-- than accumulated indefinitely: `market_snapshot_fresh_days` (7) bounds how
-- long a snapshot may inform a decision, and a later gate may add a retention
-- sweep that deletes superseded rows past a contractual window. Nothing here
-- is redistributed, and no row is exposed to an anonymous reader.

CREATE TABLE IF NOT EXISTS public.market_cohort_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,

  -- Identity of the market this describes. The cohort hash carries no VIN,
  -- no price and no tenant secret; the readable columns beside it exist so an
  -- operator can see what a hash means without decoding it.
  cohort_hash text NOT NULL,
  cohort_rules_version text NOT NULL,
  cohort_year integer,
  cohort_make text,
  cohort_model text,
  cohort_trim text,
  cohort_drivetrain text,
  cohort_vehicle_class text,
  cohort_certified_class text,
  cohort_equipment_signature text NOT NULL,

  -- The evidence.
  snapshot_fingerprint text NOT NULL,
  snapshot_rules_version text NOT NULL,
  algorithm_version text NOT NULL,
  observed_at timestamptz NOT NULL DEFAULT now(),

  -- Where it came from. A CATEGORY, never a URL and never a key.
  source_function text NOT NULL,
  source_endpoint_category text NOT NULL,
  -- Sanitized query dimensions: zip, radius, car_type, miles band. Nothing else.
  query_dimensions jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- Normalized observations. No image, no description, no VDP link.
  observations jsonb NOT NULL DEFAULT '[]'::jsonb,
  eligible_observation_count integer NOT NULL DEFAULT 0,
  independent_rooftop_count integer NOT NULL DEFAULT 0,
  own_rooftop_excluded_count integer NOT NULL DEFAULT 0,
  evidence_sufficiency text NOT NULL,
  observation_p25 numeric(12,2),
  observation_p50 numeric(12,2),
  observation_p75 numeric(12,2),
  certified_share numeric(5,4),

  -- History rather than mutation: a newer snapshot points back at the one it
  -- replaces, so the chain is reconstructable and nothing is overwritten.
  superseded_by uuid REFERENCES public.market_cohort_snapshots(id),

  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT market_cohort_snapshots_sufficiency_check
    CHECK (evidence_sufficiency IN ('sufficient', 'insufficient')),
  CONSTRAINT market_cohort_snapshots_counts_nonnegative
    CHECK (eligible_observation_count >= 0
       AND independent_rooftop_count >= 0
       AND own_rooftop_excluded_count >= 0)
);

-- Idempotency. The same tenant, cohort, evidence and algorithm inserts once;
-- a second attempt conflicts instead of duplicating the row, which is what
-- makes reprocessing an identical snapshot free.
CREATE UNIQUE INDEX IF NOT EXISTS market_cohort_snapshots_identity_idx
  ON public.market_cohort_snapshots (tenant_id, cohort_hash, snapshot_fingerprint, algorithm_version);

CREATE INDEX IF NOT EXISTS market_cohort_snapshots_lookup_idx
  ON public.market_cohort_snapshots (tenant_id, cohort_hash, observed_at DESC);

-- Which snapshot informed a valuation. Additive and nullable: every existing
-- row keeps its meaning, and a valuation made without a shared snapshot simply
-- has none.
ALTER TABLE public.vehicle_market_valuations
  ADD COLUMN IF NOT EXISTS market_snapshot_id uuid
    REFERENCES public.market_cohort_snapshots(id);

CREATE INDEX IF NOT EXISTS vehicle_market_valuations_snapshot_idx
  ON public.vehicle_market_valuations (market_snapshot_id);

-- ── Access ────────────────────────────────────────────────────────────────
--
-- Append-only for everyone. The service role inserts; a tenant member reads
-- its own rows; nobody updates and nobody deletes, so the evidence trail
-- cannot be edited after the fact. Anonymous access is not granted at all —
-- this is dealer evidence and never reaches a public payload.

ALTER TABLE public.market_cohort_snapshots ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.market_cohort_snapshots FROM PUBLIC;
REVOKE ALL ON public.market_cohort_snapshots FROM anon;
GRANT SELECT ON public.market_cohort_snapshots TO authenticated;
GRANT SELECT, INSERT ON public.market_cohort_snapshots TO service_role;

-- `(SELECT auth.uid())` is wrapped so the planner caches it as an initPlan
-- instead of evaluating it per row, and the role is named so the policy is
-- skipped entirely for anonymous connections.
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
  'Shared, append-only market evidence for one tenant and one exact vehicle cohort. '
  'Carries no subject VIN, no asking price, no credential and no provider image or '
  'description. One snapshot may inform many valuations; a valuation never copies '
  'another vehicle''s prediction, verdict or market position.';

COMMENT ON COLUMN public.vehicle_market_valuations.market_snapshot_id IS
  'The shared market snapshot this valuation was judged against. Nullable: a '
  'valuation made before shared snapshots existed, or without one, has none.';
