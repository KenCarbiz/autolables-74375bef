-- ──────────────────────────────────────────────────────────────────────
-- Phase 1 — the shared VIN truth snapshot.
-- (Full migration text — see repo file 20260727120000_vehicle_truth_layer.sql
-- plus appended GRANTs at end.)
-- ──────────────────────────────────────────────────────────────────────

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
    RAISE NOTICE 'vehicle_listings: % duplicate tenant/VIN groups; canonical identity index NOT applied.', dupes;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.vehicle_source_records (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  vehicle_id     uuid REFERENCES public.vehicle_listings(id) ON DELETE CASCADE,
  vin            text NOT NULL,
  source_kind    text NOT NULL CHECK (source_kind IN (
                   'oem_authorized','neovin','marketcheck','dealer_confirmed',
                   'vin_decode','other_structured','ai_inference')),
  source_name    text NOT NULL,
  payload        jsonb NOT NULL,
  payload_checksum text NOT NULL,
  retrieved_at   timestamptz NOT NULL DEFAULT now(),
  billable       boolean NOT NULL DEFAULT false,
  request_reason text,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_vehicle_source_records_vehicle
  ON public.vehicle_source_records (vehicle_id, source_kind, retrieved_at DESC);
CREATE INDEX IF NOT EXISTS idx_vehicle_source_records_tenant_vin
  ON public.vehicle_source_records (tenant_id, vin, retrieved_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_vehicle_source_records_dedupe
  ON public.vehicle_source_records (tenant_id, vin, source_kind, payload_checksum);

CREATE TABLE IF NOT EXISTS public.vehicle_facts (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  vehicle_id     uuid NOT NULL REFERENCES public.vehicle_listings(id) ON DELETE CASCADE,
  fact_key       text NOT NULL,
  fact_value     jsonb NOT NULL,
  source_kind    text NOT NULL CHECK (source_kind IN (
                   'oem_authorized','neovin','marketcheck','dealer_confirmed',
                   'vin_decode','other_structured','ai_inference')),
  source_record_id uuid REFERENCES public.vehicle_source_records(id) ON DELETE SET NULL,
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

CREATE INDEX IF NOT EXISTS idx_vehicle_facts_vehicle
  ON public.vehicle_facts (vehicle_id, fact_key);
CREATE INDEX IF NOT EXISTS idx_vehicle_facts_tenant
  ON public.vehicle_facts (tenant_id);

CREATE TABLE IF NOT EXISTS public.vehicle_snapshots (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  vehicle_id       uuid NOT NULL REFERENCES public.vehicle_listings(id) ON DELETE CASCADE,
  vin              text NOT NULL,
  snapshot_version integer NOT NULL,
  parent_snapshot_id uuid REFERENCES public.vehicle_snapshots(id) ON DELETE SET NULL,
  snapshot_json    jsonb NOT NULL,
  content_checksum text NOT NULL,
  material_changes jsonb NOT NULL DEFAULT '[]'::jsonb,
  affected_families text[] NOT NULL DEFAULT '{}',
  source_kinds     text[] NOT NULL DEFAULT '{}',
  has_unresolved_conflicts boolean NOT NULL DEFAULT false,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT vehicle_snapshots_version_key UNIQUE (vehicle_id, snapshot_version)
);

CREATE INDEX IF NOT EXISTS idx_vehicle_snapshots_current
  ON public.vehicle_snapshots (vehicle_id, snapshot_version DESC);
CREATE INDEX IF NOT EXISTS idx_vehicle_snapshots_checksum
  ON public.vehicle_snapshots (vehicle_id, content_checksum);

CREATE TABLE IF NOT EXISTS public.vehicle_fact_conflicts (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  vehicle_id     uuid NOT NULL REFERENCES public.vehicle_listings(id) ON DELETE CASCADE,
  fact_key       text NOT NULL,
  authority      text NOT NULL CHECK (authority IN ('manufacturer','dealer','shared')),
  candidates     jsonb NOT NULL,
  blocks_generation boolean NOT NULL DEFAULT false,
  status         text NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved','dismissed')),
  resolved_by    uuid REFERENCES auth.users(id),
  resolved_at    timestamptz,
  resolution_note text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT vehicle_fact_conflicts_vehicle_key UNIQUE (vehicle_id, fact_key)
);

CREATE INDEX IF NOT EXISTS idx_vehicle_fact_conflicts_open
  ON public.vehicle_fact_conflicts (tenant_id, status) WHERE status = 'open';

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

CREATE OR REPLACE FUNCTION public.set_vehicle_truth_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS trg_vehicle_facts_updated ON public.vehicle_facts;
CREATE TRIGGER trg_vehicle_facts_updated BEFORE UPDATE ON public.vehicle_facts
  FOR EACH ROW EXECUTE FUNCTION public.set_vehicle_truth_updated_at();

DROP TRIGGER IF EXISTS trg_vehicle_fact_conflicts_updated ON public.vehicle_fact_conflicts;
CREATE TRIGGER trg_vehicle_fact_conflicts_updated BEFORE UPDATE ON public.vehicle_fact_conflicts
  FOR EACH ROW EXECUTE FUNCTION public.set_vehicle_truth_updated_at();

CREATE OR REPLACE FUNCTION public.reject_vehicle_snapshot_mutation()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'vehicle_snapshots is append-only; record a new snapshot version instead of editing %', OLD.id;
END $$;

DROP TRIGGER IF EXISTS trg_vehicle_snapshots_immutable ON public.vehicle_snapshots;
CREATE TRIGGER trg_vehicle_snapshots_immutable
  BEFORE UPDATE ON public.vehicle_snapshots
  FOR EACH ROW EXECUTE FUNCTION public.reject_vehicle_snapshot_mutation();

GRANT SELECT ON public.vehicle_source_records TO authenticated;
GRANT ALL    ON public.vehicle_source_records TO service_role;
GRANT SELECT ON public.vehicle_facts          TO authenticated;
GRANT ALL    ON public.vehicle_facts          TO service_role;
GRANT SELECT ON public.vehicle_snapshots      TO authenticated;
GRANT ALL    ON public.vehicle_snapshots      TO service_role;
GRANT SELECT ON public.vehicle_fact_conflicts TO authenticated;
GRANT ALL    ON public.vehicle_fact_conflicts TO service_role;
GRANT SELECT ON public.vehicle_identity_duplicates TO authenticated;
GRANT ALL    ON public.vehicle_identity_duplicates TO service_role;
GRANT EXECUTE ON FUNCTION public.get_current_vehicle_snapshot(uuid) TO authenticated, service_role;