-- ──────────────────────────────────────────────────────────────────────
-- Phase 1 — the shared VIN truth snapshot.
--
-- Today every generator re-derives the vehicle for itself: the sticker
-- engine reads mc_attributes, descriptions read description_fact_snapshots,
-- the Passport reads vehicle_listings columns. The same VIN can therefore
-- print one trim on the sticker, a different one in the description and a
-- third on the Passport, and nothing in the system notices.
--
-- This migration adds the layer they will all read from:
--
--   vehicle_source_records  raw provider payloads, immutable, one row per
--                           retrieval. Never overwritten, so a fact can
--                           always be traced back to what a provider
--                           actually said and when.
--   vehicle_facts           normalized candidate facts, one row per
--                           (vehicle, fact_key, source). The resolution
--                           rules live in src/lib/vehicleTruth/precedence.
--   vehicle_snapshots       immutable resolved snapshots. A new row exists
--                           only when a MATERIAL field changed, which is
--                           what stops a nightly scrape minting a version
--                           and regenerating every document.
--   vehicle_fact_conflicts  disagreements between two sources that are
--                           both allowed to verify. A person resolves
--                           these; ranking does not.
--
-- Canonical vehicle: public.vehicle_listings. Twelve tables already carry
-- a vehicle_id FK to it and the Passport slug lives on it. vehicle_files
-- remains the tenant-scoped satellite, linked by
-- vehicle_listings.vehicle_file_id.
-- ──────────────────────────────────────────────────────────────────────

-- ── 1. Canonical identity ─────────────────────────────────────────────
-- One vehicle record per tenant per VIN. The MarketCheck ingest currently
-- does a read-then-insert with no constraint behind it, so a concurrent
-- run can create a second row for the same VIN and split that VIN's
-- history across two ids.
--
-- Applied only when the data already satisfies it. Deduplicating live
-- dealer rows is destructive and is a decision for a person, not a
-- migration, so where duplicates exist the index is skipped and the pairs
-- are left visible in vehicle_identity_duplicates.

CREATE OR REPLACE VIEW public.vehicle_identity_duplicates AS
  SELECT tenant_id,
         upper(trim(vin)) AS vin,
         count(*)         AS listing_count,
         array_agg(id ORDER BY created_at) AS listing_ids
    FROM public.vehicle_listings
   WHERE tenant_id IS NOT NULL
     AND coalesce(trim(vin), '') <> ''
   GROUP BY tenant_id, upper(trim(vin))
  HAVING count(*) > 1;

COMMENT ON VIEW public.vehicle_identity_duplicates IS
  'Tenant/VIN pairs with more than one vehicle_listings row. Must be empty before the canonical identity index can be enforced.';

DO $$
DECLARE dupes integer;
BEGIN
  SELECT count(*) INTO dupes FROM public.vehicle_identity_duplicates;
  IF dupes = 0 THEN
    CREATE UNIQUE INDEX IF NOT EXISTS uq_vehicle_listings_tenant_vin
      ON public.vehicle_listings (tenant_id, upper(trim(vin)))
      WHERE tenant_id IS NOT NULL AND coalesce(trim(vin), '') <> '';
  ELSE
    RAISE NOTICE 'vehicle_listings: % duplicate tenant/VIN groups; canonical identity index NOT applied. See public.vehicle_identity_duplicates.', dupes;
  END IF;
END $$;

-- ── 2. Raw source records ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.vehicle_source_records (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  vehicle_id     uuid REFERENCES public.vehicle_listings(id) ON DELETE CASCADE,
  vin            text NOT NULL,
  source_kind    text NOT NULL CHECK (source_kind IN (
                   'oem_authorized','neovin','marketcheck','dealer_confirmed',
                   'vin_decode','other_structured','ai_inference')),
  source_name    text NOT NULL,
  -- Exactly what the provider returned. Never edited, never normalized.
  payload        jsonb NOT NULL,
  payload_checksum text NOT NULL,
  retrieved_at   timestamptz NOT NULL DEFAULT now(),
  -- Set when this retrieval was billed, so a reuse decision can be audited
  -- against what it saved.
  billable       boolean NOT NULL DEFAULT false,
  request_reason text,
  created_at     timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.vehicle_source_records IS
  'Immutable raw provider payloads. One row per retrieval; never overwritten, so every fact remains traceable to what a provider actually returned.';

CREATE INDEX IF NOT EXISTS idx_vehicle_source_records_vehicle
  ON public.vehicle_source_records (vehicle_id, source_kind, retrieved_at DESC);
CREATE INDEX IF NOT EXISTS idx_vehicle_source_records_tenant_vin
  ON public.vehicle_source_records (tenant_id, vin, retrieved_at DESC);
-- Re-storing an identical payload is a no-op rather than a new row, which
-- keeps an unchanged nightly refresh from growing the table without bound.
CREATE UNIQUE INDEX IF NOT EXISTS uq_vehicle_source_records_dedupe
  ON public.vehicle_source_records (tenant_id, vin, source_kind, payload_checksum);

-- ── 3. Normalized candidate facts ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.vehicle_facts (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  vehicle_id     uuid NOT NULL REFERENCES public.vehicle_listings(id) ON DELETE CASCADE,
  fact_key       text NOT NULL,
  -- Wrapped so a fact can hold a scalar, an array of options or an object
  -- without a column per shape: { "v": <value> }.
  fact_value     jsonb NOT NULL,
  source_kind    text NOT NULL CHECK (source_kind IN (
                   'oem_authorized','neovin','marketcheck','dealer_confirmed',
                   'vin_decode','other_structured','ai_inference')),
  source_record_id uuid REFERENCES public.vehicle_source_records(id) ON DELETE SET NULL,
  -- Already capped by capConfidence() before it is written: ai_inference
  -- can never arrive here as VERIFIED.
  confidence     text NOT NULL CHECK (confidence IN ('VERIFIED','HIGH','MEDIUM','LOW','UNVERIFIED')),
  authority      text NOT NULL CHECK (authority IN ('manufacturer','dealer','shared')),
  usable_in_copy boolean NOT NULL DEFAULT true,
  evidence       jsonb NOT NULL DEFAULT '{}'::jsonb,
  observed_at    timestamptz NOT NULL DEFAULT now(),
  overridden_by  uuid REFERENCES auth.users(id),
  override_reason text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT vehicle_facts_vehicle_key_source_key UNIQUE (vehicle_id, fact_key, source_kind)
);

COMMENT ON TABLE public.vehicle_facts IS
  'Normalized candidate facts, one row per vehicle/fact/source. Competing candidates are resolved by src/lib/vehicleTruth/precedence, not by insertion order.';
COMMENT ON COLUMN public.vehicle_facts.fact_value IS
  'Wrapped as { "v": <value> } so scalars, arrays and objects share one column.';

CREATE INDEX IF NOT EXISTS idx_vehicle_facts_vehicle
  ON public.vehicle_facts (vehicle_id, fact_key);
CREATE INDEX IF NOT EXISTS idx_vehicle_facts_tenant
  ON public.vehicle_facts (tenant_id);

-- ── 4. Immutable resolved snapshots ───────────────────────────────────
CREATE TABLE IF NOT EXISTS public.vehicle_snapshots (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  vehicle_id       uuid NOT NULL REFERENCES public.vehicle_listings(id) ON DELETE CASCADE,
  vin              text NOT NULL,
  snapshot_version integer NOT NULL,
  parent_snapshot_id uuid REFERENCES public.vehicle_snapshots(id) ON DELETE SET NULL,
  -- The resolved vehicle every generator reads. Shape is the
  -- VehicleTruthSnapshot in src/lib/vehicleTruth/snapshot.ts.
  snapshot_json    jsonb NOT NULL,
  content_checksum text NOT NULL,
  -- Which fields moved since the parent, and which document families each
  -- one touches. Empty on the first snapshot.
  material_changes jsonb NOT NULL DEFAULT '[]'::jsonb,
  affected_families text[] NOT NULL DEFAULT '{}',
  source_kinds     text[] NOT NULL DEFAULT '{}',
  has_unresolved_conflicts boolean NOT NULL DEFAULT false,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT vehicle_snapshots_version_key UNIQUE (vehicle_id, snapshot_version)
);

COMMENT ON TABLE public.vehicle_snapshots IS
  'Immutable resolved vehicle snapshots. A new row exists only when a material field changed; an unchanged refresh reuses the current snapshot.';

CREATE INDEX IF NOT EXISTS idx_vehicle_snapshots_current
  ON public.vehicle_snapshots (vehicle_id, snapshot_version DESC);
CREATE INDEX IF NOT EXISTS idx_vehicle_snapshots_checksum
  ON public.vehicle_snapshots (vehicle_id, content_checksum);

-- ── 5. Conflicts a person must settle ─────────────────────────────────
CREATE TABLE IF NOT EXISTS public.vehicle_fact_conflicts (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  vehicle_id     uuid NOT NULL REFERENCES public.vehicle_listings(id) ON DELETE CASCADE,
  fact_key       text NOT NULL,
  authority      text NOT NULL CHECK (authority IN ('manufacturer','dealer','shared')),
  -- [{ value, source_kind, confidence, observed_at, source_record_id }]
  candidates     jsonb NOT NULL,
  selected_value jsonb,
  selected_source text,
  status         text NOT NULL DEFAULT 'open'
                   CHECK (status IN ('open','resolved','dismissed')),
  -- A conflict on a manufacturer-controlled fact blocks the OEM
  -- reproduction; a dealer-controlled one does not.
  blocks_generation boolean NOT NULL DEFAULT false,
  resolved_by    uuid REFERENCES auth.users(id),
  resolved_at    timestamptz,
  resolution_note text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT vehicle_fact_conflicts_open_key UNIQUE (vehicle_id, fact_key)
);

COMMENT ON TABLE public.vehicle_fact_conflicts IS
  'Disagreements between two sources that may both verify a fact. Resolved by a person; source ranking alone never settles one.';

CREATE INDEX IF NOT EXISTS idx_vehicle_fact_conflicts_open
  ON public.vehicle_fact_conflicts (tenant_id, status, created_at DESC);

-- ── 6. RLS ────────────────────────────────────────────────────────────
-- Read for members of the owning tenant; the orchestrator (service role)
-- is the only writer, so no client write policies exist.
ALTER TABLE public.vehicle_source_records  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vehicle_facts           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vehicle_snapshots       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vehicle_fact_conflicts  ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['vehicle_source_records','vehicle_facts',
                           'vehicle_snapshots','vehicle_fact_conflicts'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_read', t);
    EXECUTE format($f$
      CREATE POLICY %I ON public.%I FOR SELECT TO authenticated
        USING (
          tenant_id IN (
            SELECT tenant_id FROM public.tenant_members
            WHERE user_id = (SELECT auth.uid()) AND accepted_at IS NOT NULL
          )
        )
    $f$, t || '_read', t);
  END LOOP;
END $$;

-- ── 7. Shared read contract ───────────────────────────────────────────
-- The one accessor every generator uses. Returning the snapshot through a
-- function rather than letting each caller assemble its own query is what
-- makes "the sticker, the description and the Passport read the same
-- vehicle" enforceable rather than a convention.
CREATE OR REPLACE FUNCTION public.get_current_vehicle_snapshot(_vehicle_id uuid)
RETURNS TABLE (
  snapshot_id uuid,
  snapshot_version integer,
  snapshot_json jsonb,
  content_checksum text,
  has_unresolved_conflicts boolean,
  created_at timestamptz
)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT s.id, s.snapshot_version, s.snapshot_json, s.content_checksum,
         s.has_unresolved_conflicts, s.created_at
    FROM public.vehicle_snapshots s
   WHERE s.vehicle_id = _vehicle_id
   ORDER BY s.snapshot_version DESC
   LIMIT 1;
$$;

COMMENT ON FUNCTION public.get_current_vehicle_snapshot(uuid) IS
  'The shared read contract. Every document generator reads the vehicle through this, so one VIN cannot print different truth on different documents.';

CREATE OR REPLACE FUNCTION public.set_vehicle_truth_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS trg_vehicle_facts_updated ON public.vehicle_facts;
CREATE TRIGGER trg_vehicle_facts_updated BEFORE UPDATE ON public.vehicle_facts
  FOR EACH ROW EXECUTE FUNCTION public.set_vehicle_truth_updated_at();

DROP TRIGGER IF EXISTS trg_vehicle_fact_conflicts_updated ON public.vehicle_fact_conflicts;
CREATE TRIGGER trg_vehicle_fact_conflicts_updated BEFORE UPDATE ON public.vehicle_fact_conflicts
  FOR EACH ROW EXECUTE FUNCTION public.set_vehicle_truth_updated_at();

-- Snapshots are immutable: correcting one means adding the next version.
CREATE OR REPLACE FUNCTION public.reject_vehicle_snapshot_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'vehicle_snapshots is append-only; record a new snapshot version instead of editing %', OLD.id;
END $$;

DROP TRIGGER IF EXISTS trg_vehicle_snapshots_immutable ON public.vehicle_snapshots;
CREATE TRIGGER trg_vehicle_snapshots_immutable
  BEFORE UPDATE ON public.vehicle_snapshots
  FOR EACH ROW EXECUTE FUNCTION public.reject_vehicle_snapshot_mutation();
