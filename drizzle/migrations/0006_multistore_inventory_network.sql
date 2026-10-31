-- ── Multi-store inventory network (Files.com connector phase 2) ─────────────
--
-- Additive only. Nothing existing is renamed, dropped or reassigned.
--
--   dealer_groups                one per existing tenant (backfilled). The
--                                tenant stays the customer/billing/permission
--                                boundary; the group is its inventory parent.
--   dealer_stores                individual rooftops beneath a group, each with
--                                its own identity, subscription status, feed
--                                participation and sharing switch. No store is
--                                created automatically.
--   inventory_source_mappings    explicit, approved source-dealer-id -> store
--                                mapping (vAuto DealerId). Audited.
--   store_inventory              the ONE canonical owning-store vehicle record
--                                fed by Files.com. Unique per store and VIN; a
--                                VIN live at another store of the same group is
--                                held as a conflict, never merged.
--   inventory_store_snapshots +  per-store staging. A snapshot is applied in a
--   inventory_snapshot_vehicles  single transaction or not at all.
--   inventory_feed_jobs          durable queue with bounded retries/backoff.
--   inventory_feed_versions      one processing claim per remote file version.
--   inventory_feed_controls      global pause and emergency stop. Seeded PAUSED.
--   inventory_sharing_rules      directional store -> store visibility. No row
--                                means no sharing.
--   store_enrichment_policies    per-store MarketCheck policy. Default and
--                                missing row both mean feed only (no calls).
--   store_provider_usage         metering by store, group, product, reason.
--   inventory_network_audit      append-only audit of every change above.
--
-- vehicle_listings gains nullable owning_store_id / inventory_record_id. Legacy
-- rows keep NULL: they are not assigned to any store by this migration.
--
-- Rollback: every object here is new except the vehicle_listings columns, the
-- inventory_feed_runs kind check (widened from dry_run to dry_run|import), the
-- inventory_feed_runs/job columns and filescom_record_event (which only gains
-- the enqueue step). See docs/filescom-multistore-rollout.md.

-- ── Groups and stores ──────────────────────────────────────────────────────

CREATE TABLE public.dealer_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL UNIQUE REFERENCES public.tenants(id) ON DELETE RESTRICT,
  name text NOT NULL,
  legal_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.dealer_groups (tenant_id, name)
SELECT t.id, COALESCE(NULLIF(trim(t.name), ''), 'Dealer group') FROM public.tenants t
ON CONFLICT (tenant_id) DO NOTHING;

CREATE TABLE public.dealer_stores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES public.dealer_groups(id) ON DELETE RESTRICT,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  display_name text NOT NULL CHECK (length(trim(display_name)) BETWEEN 2 AND 120),
  legal_name text,
  street text,
  city text,
  state text CHECK (state IS NULL OR state ~ '^[A-Z]{2}$'),
  zip text CHECK (zip IS NULL OR zip ~ '^[0-9]{5}(-[0-9]{4})?$'),
  phone text,
  website text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  subscription_status text NOT NULL DEFAULT 'unsubscribed' CHECK (subscription_status IN ('subscribed','unsubscribed','suspended')),
  is_primary_inventory_store boolean NOT NULL DEFAULT false,
  inventory_feed_enabled boolean NOT NULL DEFAULT false,
  feed_import_paused boolean NOT NULL DEFAULT false,
  inventory_sharing_enabled boolean NOT NULL DEFAULT false,
  customer_browser_enabled boolean NOT NULL DEFAULT false,
  listing_sync_enabled boolean NOT NULL DEFAULT false,
  feed_price_updates_listing boolean NOT NULL DEFAULT false,
  adopt_legacy_matches boolean NOT NULL DEFAULT false,
  retirement_automation_enabled boolean NOT NULL DEFAULT false,
  missing_snapshot_threshold integer NOT NULL DEFAULT 3 CHECK (missing_snapshot_threshold BETWEEN 2 AND 30),
  max_invalid_rows integer NOT NULL DEFAULT 0 CHECK (max_invalid_rows BETWEEN 0 AND 100),
  provider_ids jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(provider_ids) = 'object'),
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- Paid AutoLabels surfaces and listing sync belong to subscribed stores only.
  CHECK (subscription_status = 'subscribed' OR (listing_sync_enabled = false AND customer_browser_enabled = false))
);
CREATE UNIQUE INDEX dealer_stores_one_primary ON public.dealer_stores (group_id) WHERE is_primary_inventory_store;
CREATE UNIQUE INDEX dealer_stores_group_name ON public.dealer_stores (group_id, lower(display_name));
CREATE INDEX dealer_stores_tenant_idx ON public.dealer_stores (tenant_id);

CREATE OR REPLACE FUNCTION public.dealer_stores_bind_tenant() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  SELECT g.tenant_id INTO NEW.tenant_id FROM dealer_groups g WHERE g.id = NEW.group_id;
  IF NEW.tenant_id IS NULL THEN RAISE EXCEPTION 'store_group_not_found'; END IF;
  IF TG_OP = 'UPDATE' AND NEW.group_id IS DISTINCT FROM OLD.group_id THEN
    RAISE EXCEPTION 'store_group_change_forbidden';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
CREATE TRIGGER dealer_stores_bind_tenant BEFORE INSERT OR UPDATE ON public.dealer_stores
  FOR EACH ROW EXECUTE FUNCTION public.dealer_stores_bind_tenant();

CREATE TABLE public.inventory_store_state (
  store_id uuid PRIMARY KEY REFERENCES public.dealer_stores(id) ON DELETE CASCADE,
  last_applied_snapshot_id uuid,
  last_applied_source_mtime timestamptz,
  last_applied_sha256 text,
  last_applied_at timestamptz,
  last_run_id uuid,
  last_failure_at timestamptz,
  last_failure_reason text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ── Source identity mappings ───────────────────────────────────────────────

CREATE TABLE public.inventory_source_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL DEFAULT 'vauto' CHECK (provider = 'vauto'),
  source_dealer_id text NOT NULL CHECK (source_dealer_id ~ '^[A-Za-z0-9._-]{1,64}$'),
  group_id uuid NOT NULL REFERENCES public.dealer_groups(id) ON DELETE RESTRICT,
  store_id uuid NOT NULL REFERENCES public.dealer_stores(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','revoked','rejected')),
  observed_identity jsonb NOT NULL,
  evidence jsonb,
  identity_acknowledged boolean NOT NULL DEFAULT false,
  note text,
  proposed_by uuid, proposed_at timestamptz NOT NULL DEFAULT now(),
  approved_by uuid, approved_at timestamptz,
  revoked_by uuid, revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX inventory_source_mappings_live ON public.inventory_source_mappings (provider, source_dealer_id) WHERE status IN ('pending','approved');
CREATE INDEX inventory_source_mappings_store_idx ON public.inventory_source_mappings (store_id);

CREATE OR REPLACE FUNCTION public.inventory_source_mappings_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_group uuid;
BEGIN
  SELECT group_id INTO v_group FROM dealer_stores WHERE id = NEW.store_id;
  IF v_group IS NULL OR v_group <> NEW.group_id THEN RAISE EXCEPTION 'mapping_store_outside_group'; END IF;
  IF TG_OP = 'UPDATE' AND (NEW.store_id <> OLD.store_id OR NEW.source_dealer_id <> OLD.source_dealer_id OR NEW.group_id <> OLD.group_id) THEN
    -- A mapping never silently re-points. Revoke it and propose a new one.
    RAISE EXCEPTION 'mapping_identity_immutable';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status IN ('revoked','rejected') AND NEW.status <> OLD.status THEN
    RAISE EXCEPTION 'mapping_closed';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
CREATE TRIGGER inventory_source_mappings_guard BEFORE INSERT OR UPDATE ON public.inventory_source_mappings
  FOR EACH ROW EXECUTE FUNCTION public.inventory_source_mappings_guard();

-- ── Canonical store inventory ──────────────────────────────────────────────

CREATE TABLE public.store_inventory (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES public.dealer_stores(id) ON DELETE RESTRICT,
  group_id uuid NOT NULL REFERENCES public.dealer_groups(id) ON DELETE RESTRICT,
  vin text NOT NULL CHECK (vin ~ '^[A-HJ-NPR-Z0-9]{17}$'),
  source_provider text NOT NULL DEFAULT 'vauto',
  source_dealer_id text NOT NULL,
  stock_number text,
  condition text NOT NULL CHECK (condition IN ('new','used','cpo')),
  certified boolean NOT NULL DEFAULT false,
  year integer CHECK (year IS NULL OR year BETWEEN 1900 AND 2100),
  make text, model text, trim text, series_detail text, body text,
  drivetrain text, engine text, transmission text, fuel text,
  equipment jsonb NOT NULL DEFAULT '[]'::jsonb,
  description text,
  mileage integer CHECK (mileage IS NULL OR mileage >= 0),
  msrp numeric(12,2) CHECK (msrp IS NULL OR msrp > 0),
  feed_price numeric(12,2) CHECK (feed_price IS NULL OR feed_price > 0),
  -- 'unknown' is a blank feed price; 'zero' is a literal 0 in the feed. Neither
  -- is ever shown as a price.
  feed_price_status text NOT NULL CHECK (feed_price_status IN ('known','unknown','zero')),
  feed_price_observed_at timestamptz,
  exterior_color text, interior_color text,
  photos jsonb NOT NULL DEFAULT '[]'::jsonb,
  photo_count integer NOT NULL DEFAULT 0,
  photos_modified_at timestamptz,
  inventory_date date,
  presence text NOT NULL DEFAULT 'present' CHECK (presence IN ('present','missing','retirement_review','retired','transferred')),
  missing_snapshots integer NOT NULL DEFAULT 0,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  last_snapshot_id uuid,
  retired_at timestamptz, retired_by uuid, retire_reason text,
  listing_id uuid REFERENCES public.vehicle_listings(id) ON DELETE SET NULL,
  enrichment jsonb NOT NULL DEFAULT '{}'::jsonb,
  enrichment_status text NOT NULL DEFAULT 'not_requested' CHECK (enrichment_status IN ('not_requested','queued','fresh','stale','blocked','failed')),
  enriched_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX store_inventory_store_vin ON public.store_inventory (store_id, vin);
-- One live owner per VIN inside a group. Retired/transferred rows keep history.
CREATE UNIQUE INDEX store_inventory_group_live_vin ON public.store_inventory (group_id, vin) WHERE presence NOT IN ('retired','transferred');
CREATE INDEX store_inventory_store_presence ON public.store_inventory (store_id, presence);
CREATE INDEX store_inventory_group_idx ON public.store_inventory (group_id);

CREATE TABLE public.inventory_vin_conflicts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES public.dealer_groups(id),
  vin text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('other_store','legacy_listing','other_store_listing')),
  claiming_store_id uuid NOT NULL REFERENCES public.dealer_stores(id),
  existing_store_id uuid REFERENCES public.dealer_stores(id),
  existing_inventory_id uuid REFERENCES public.store_inventory(id),
  existing_listing_id uuid REFERENCES public.vehicle_listings(id) ON DELETE SET NULL,
  snapshot_id uuid,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','transferred','adopted','dismissed')),
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  resolved_by uuid, resolved_at timestamptz, note text
);
CREATE UNIQUE INDEX inventory_vin_conflicts_open ON public.inventory_vin_conflicts (group_id, vin, claiming_store_id, kind) WHERE status = 'open';

-- vehicle_listings: link only. Legacy rows stay NULL.
ALTER TABLE public.vehicle_listings
  ADD COLUMN IF NOT EXISTS owning_store_id uuid REFERENCES public.dealer_stores(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS inventory_record_id uuid REFERENCES public.store_inventory(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_vehicle_listings_owning_store ON public.vehicle_listings (owning_store_id) WHERE owning_store_id IS NOT NULL;

-- A listing linked to a store's feed keeps the feed's identity and the
-- dealer's price. Other writers (the MarketCheck sync patches by tenant+VIN)
-- may still add enrichment, but cannot re-point the store, take over the feed
-- source or overwrite price/inventory fields. The feed apply sets
-- app.inventory_writer for its own transaction.
CREATE OR REPLACE FUNCTION public.vehicle_listings_store_feed_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF OLD.owning_store_id IS NULL OR current_setting('app.inventory_writer', true) = 'filescom_apply' THEN
    RETURN NEW;
  END IF;
  NEW.owning_store_id := OLD.owning_store_id;
  NEW.inventory_record_id := OLD.inventory_record_id;
  IF OLD.feed_source = 'filescom' AND NEW.feed_source IS DISTINCT FROM 'filescom' THEN
    NEW.feed_source := OLD.feed_source;
    NEW.condition := OLD.condition;
    NEW.ymm := OLD.ymm;
    NEW.trim := OLD.trim;
    NEW.mileage := OLD.mileage;
    NEW.price := OLD.price;
    NEW.doc_fee := OLD.doc_fee;
    NEW.advertised_price_before_doc := OLD.advertised_price_before_doc;
    NEW.website_sale_price := OLD.website_sale_price;
    NEW.price_source_url := OLD.price_source_url;
    NEW.price_parse_status := OLD.price_parse_status;
    NEW.price_parse_notes := OLD.price_parse_notes;
    NEW.price_last_verified_at := OLD.price_last_verified_at;
    NEW.hero_image_url := OLD.hero_image_url;
    NEW.source_url := OLD.source_url;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER vehicle_listings_store_feed_guard BEFORE UPDATE ON public.vehicle_listings
  FOR EACH ROW EXECUTE FUNCTION public.vehicle_listings_store_feed_guard();

-- ── Feed queue, versions, snapshots ────────────────────────────────────────

CREATE TABLE public.inventory_feed_controls (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  ingestion_paused boolean NOT NULL DEFAULT true,
  emergency_stop boolean NOT NULL DEFAULT false,
  reconcile_enabled boolean NOT NULL DEFAULT false,
  reason text,
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.inventory_feed_controls (id, ingestion_paused, reason) VALUES (1, true, 'Initial state: paused until a platform admin enables imports.')
ON CONFLICT (id) DO NOTHING;

CREATE TABLE public.inventory_feed_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL DEFAULT 'filescom',
  path text NOT NULL,
  kind text NOT NULL DEFAULT 'import' CHECK (kind IN ('import')),
  trigger text NOT NULL CHECK (trigger IN ('webhook','reconcile','manual','retry')),
  requested_by uuid,
  event_id uuid,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','succeeded','partial','skipped','failed','dead','cancelled')),
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 5 CHECK (max_attempts BETWEEN 1 AND 10),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  lock_token uuid,
  locked_until timestamptz,
  version_key text,
  run_id uuid,
  last_error text,
  result jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  finished_at timestamptz
);
-- At most one open job per file: webhook retries, reconciliation and manual
-- discovery coalesce onto it.
CREATE UNIQUE INDEX inventory_feed_jobs_open ON public.inventory_feed_jobs (provider, path) WHERE status IN ('queued','running');
CREATE INDEX inventory_feed_jobs_due ON public.inventory_feed_jobs (next_attempt_at) WHERE status = 'queued';

CREATE TABLE public.inventory_feed_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL DEFAULT 'filescom',
  path text NOT NULL,
  version_key text NOT NULL,
  remote_size bigint, remote_mtime timestamptz, remote_checksum text,
  content_sha256 text,
  status text NOT NULL DEFAULT 'processing' CHECK (status IN ('processing','applied','partial','rejected','failed')),
  job_id uuid, run_id uuid,
  claimed_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  UNIQUE (provider, path, version_key)
);

ALTER TABLE public.inventory_feed_runs DROP CONSTRAINT IF EXISTS inventory_feed_runs_kind_check;
ALTER TABLE public.inventory_feed_runs ADD CONSTRAINT inventory_feed_runs_kind_check CHECK (kind IN ('dry_run','import'));
ALTER TABLE public.inventory_feed_runs DROP CONSTRAINT IF EXISTS inventory_feed_runs_status_check;
ALTER TABLE public.inventory_feed_runs ADD CONSTRAINT inventory_feed_runs_status_check CHECK (status IN ('running','passed','rejected','failed','partial','applied','skipped'));
ALTER TABLE public.inventory_feed_runs
  ADD COLUMN IF NOT EXISTS job_id uuid REFERENCES public.inventory_feed_jobs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS affected_store_ids uuid[] NOT NULL DEFAULT '{}';

CREATE TABLE public.inventory_store_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid REFERENCES public.inventory_feed_runs(id) ON DELETE SET NULL,
  job_id uuid REFERENCES public.inventory_feed_jobs(id) ON DELETE SET NULL,
  path text NOT NULL,
  source_dealer_id text NOT NULL,
  store_id uuid REFERENCES public.dealer_stores(id),
  group_id uuid REFERENCES public.dealer_groups(id),
  mapping_id uuid REFERENCES public.inventory_source_mappings(id),
  source_mtime timestamptz NOT NULL,
  content_sha256 text NOT NULL,
  -- clean: no row was dropped, so absence from this snapshot is evidence.
  clean boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'staged' CHECK (status IN ('staged','applied','quarantined','rejected','superseded','failed')),
  reason text,
  row_count integer NOT NULL DEFAULT 0,
  valid_count integer NOT NULL DEFAULT 0,
  invalid_count integer NOT NULL DEFAULT 0,
  duplicate_count integer NOT NULL DEFAULT 0,
  price_missing_count integer NOT NULL DEFAULT 0,
  photo_missing_count integer NOT NULL DEFAULT 0,
  report jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  applied_at timestamptz
);
CREATE INDEX inventory_store_snapshots_store_idx ON public.inventory_store_snapshots (store_id, created_at DESC);
CREATE INDEX inventory_store_snapshots_run_idx ON public.inventory_store_snapshots (run_id);

CREATE TABLE public.inventory_snapshot_vehicles (
  snapshot_id uuid NOT NULL REFERENCES public.inventory_store_snapshots(id) ON DELETE CASCADE,
  vin text NOT NULL CHECK (vin ~ '^[A-HJ-NPR-Z0-9]{17}$'),
  row_number integer NOT NULL,
  stock_number text,
  condition text NOT NULL CHECK (condition IN ('new','used','cpo')),
  certified boolean NOT NULL DEFAULT false,
  year integer, make text, model text, trim text, series_detail text, body text,
  drivetrain text, engine text, transmission text, fuel text,
  equipment jsonb NOT NULL DEFAULT '[]'::jsonb,
  description text,
  mileage integer,
  msrp numeric(12,2),
  feed_price numeric(12,2),
  feed_price_status text NOT NULL CHECK (feed_price_status IN ('known','unknown','zero')),
  exterior_color text, interior_color text,
  photos jsonb NOT NULL DEFAULT '[]'::jsonb,
  photos_modified_at timestamptz,
  inventory_date date,
  PRIMARY KEY (snapshot_id, vin)
);

-- ── Sharing ────────────────────────────────────────────────────────────────

CREATE TABLE public.inventory_sharing_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES public.dealer_groups(id),
  source_store_id uuid NOT NULL REFERENCES public.dealer_stores(id),
  destination_store_id uuid NOT NULL REFERENCES public.dealer_stores(id),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked')),
  connect_card boolean NOT NULL DEFAULT false,
  customer_room boolean NOT NULL DEFAULT false,
  include_new boolean NOT NULL DEFAULT true,
  include_used boolean NOT NULL DEFAULT true,
  include_certified boolean NOT NULL DEFAULT true,
  priority integer NOT NULL DEFAULT 100 CHECK (priority BETWEEN 1 AND 1000),
  show_prices boolean NOT NULL DEFAULT false,
  show_details boolean NOT NULL DEFAULT true,
  effective_from timestamptz NOT NULL DEFAULT now(),
  effective_until timestamptz,
  note text,
  created_by uuid, updated_by uuid,
  revoked_by uuid, revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (source_store_id <> destination_store_id),
  CHECK (effective_until IS NULL OR effective_until > effective_from)
);
CREATE UNIQUE INDEX inventory_sharing_rules_active ON public.inventory_sharing_rules (source_store_id, destination_store_id) WHERE status = 'active';

CREATE OR REPLACE FUNCTION public.inventory_sharing_rules_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_src uuid; v_dst uuid;
BEGIN
  SELECT group_id INTO v_src FROM dealer_stores WHERE id = NEW.source_store_id;
  SELECT group_id INTO v_dst FROM dealer_stores WHERE id = NEW.destination_store_id;
  IF v_src IS NULL OR v_dst IS NULL OR v_src <> v_dst OR v_src <> NEW.group_id THEN
    RAISE EXCEPTION 'sharing_across_groups_forbidden';
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW.source_store_id <> OLD.source_store_id OR NEW.destination_store_id <> OLD.destination_store_id) THEN
    RAISE EXCEPTION 'sharing_rule_direction_immutable';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'revoked' AND NEW.status <> 'revoked' THEN
    RAISE EXCEPTION 'sharing_rule_revoked';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
CREATE TRIGGER inventory_sharing_rules_guard BEFORE INSERT OR UPDATE ON public.inventory_sharing_rules
  FOR EACH ROW EXECUTE FUNCTION public.inventory_sharing_rules_guard();

-- ── MarketCheck policy and metering ────────────────────────────────────────

-- Products a store may be approved for. Names match mcCost.ts billing products.
CREATE OR REPLACE FUNCTION public.store_enrichment_products() RETURNS text[]
LANGUAGE sql IMMUTABLE AS $$
  SELECT ARRAY['basic_vin_decode','neovin','vin_history','price_prediction','inventory_search','market_days_supply','recent_inventory','sales_stats','auto_recalls','cached_images']::text[]
$$;

CREATE TABLE public.store_enrichment_policies (
  store_id uuid PRIMARY KEY REFERENCES public.dealer_stores(id) ON DELETE CASCADE,
  mode text NOT NULL DEFAULT 'feed_only' CHECK (mode IN ('feed_only','enrichment','paused')),
  budget_blocked boolean NOT NULL DEFAULT false,
  -- Name of a server-side secret, never the secret itself.
  credential_ref text CHECK (credential_ref IS NULL OR credential_ref IN ('MARKETCHECK_API_KEY')),
  mc_rooftop_id text CHECK (mc_rooftop_id IS NULL OR mc_rooftop_id ~ '^[A-Za-z0-9._:-]{1,80}$'),
  mc_rooftop_verified_at timestamptz,
  mc_rooftop_verified_by uuid,
  allowed_products text[] NOT NULL DEFAULT '{}',
  refresh_cadence_hours integer CHECK (refresh_cadence_hours IS NULL OR refresh_cadence_hours BETWEEN 1 AND 8760),
  freshness_hours integer CHECK (freshness_hours IS NULL OR freshness_hours BETWEEN 1 AND 8760),
  backfill_limit integer NOT NULL DEFAULT 0 CHECK (backfill_limit BETWEEN 0 AND 5000),
  per_run_limit integer NOT NULL DEFAULT 0 CHECK (per_run_limit BETWEEN 0 AND 5000),
  daily_request_limit integer NOT NULL DEFAULT 0 CHECK (daily_request_limit BETWEEN 0 AND 100000),
  monthly_request_cap integer NOT NULL DEFAULT 0 CHECK (monthly_request_cap BETWEEN 0 AND 1000000),
  monthly_usd_cap numeric(10,2) CHECK (monthly_usd_cap IS NULL OR monthly_usd_cap >= 0),
  warn_pct integer NOT NULL DEFAULT 80 CHECK (warn_pct BETWEEN 1 AND 100),
  hard_stop_pct integer NOT NULL DEFAULT 100 CHECK (hard_stop_pct BETWEEN 1 AND 100),
  manual_refresh_allowed boolean NOT NULL DEFAULT false,
  enrich_shared_inventory boolean NOT NULL DEFAULT false,
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (allowed_products <@ public.store_enrichment_products()),
  CHECK (warn_pct <= hard_stop_pct),
  -- Enrichment requires a credential, a verified rooftop, products and caps.
  CHECK (mode <> 'enrichment' OR (credential_ref IS NOT NULL AND mc_rooftop_verified_at IS NOT NULL
         AND cardinality(allowed_products) > 0 AND daily_request_limit > 0 AND monthly_request_cap > 0))
);

CREATE TABLE public.store_provider_usage (
  id bigserial PRIMARY KEY,
  at timestamptz NOT NULL DEFAULT now(),
  store_id uuid REFERENCES public.dealer_stores(id),
  group_id uuid REFERENCES public.dealer_groups(id),
  provider text NOT NULL DEFAULT 'marketcheck',
  product text NOT NULL,
  reason text NOT NULL,
  caller text NOT NULL,
  vin text,
  outcome text NOT NULL CHECK (outcome IN ('admitted','denied')),
  deny_reason text,
  estimated_cost_usd numeric(10,4),
  actual_cost_usd numeric(10,4),
  cost_basis text NOT NULL DEFAULT 'estimate' CHECK (cost_basis IN ('estimate','actual','unpriced'))
);
CREATE INDEX store_provider_usage_store_at ON public.store_provider_usage (store_id, at DESC);

CREATE TABLE public.store_enrichment_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES public.dealer_stores(id),
  inventory_id uuid NOT NULL REFERENCES public.store_inventory(id) ON DELETE CASCADE,
  vin text NOT NULL,
  product text NOT NULL,
  reason text NOT NULL CHECK (reason IN ('manual_refresh','backfill','scheduled_refresh')),
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','done','denied','failed','cancelled')),
  requested_by uuid,
  deny_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  CHECK (product = ANY (public.store_enrichment_products()))
);
CREATE UNIQUE INDEX store_enrichment_requests_open ON public.store_enrichment_requests (store_id, vin, product) WHERE status = 'queued';

-- ── Audit ──────────────────────────────────────────────────────────────────

CREATE TABLE public.inventory_network_audit (
  id bigserial PRIMARY KEY,
  at timestamptz NOT NULL DEFAULT now(),
  actor uuid,
  group_id uuid,
  store_id uuid,
  entity text NOT NULL,
  entity_id text,
  action text NOT NULL,
  before jsonb,
  after jsonb
);
CREATE INDEX inventory_network_audit_group_at ON public.inventory_network_audit (group_id, at DESC);

CREATE OR REPLACE FUNCTION public.inventory_network_audit_row() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_new jsonb := CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE to_jsonb(NEW) END;
  v_old jsonb := CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE to_jsonb(OLD) END;
  v_row jsonb := COALESCE(v_new, v_old);
  v_store uuid;
  v_group uuid;
BEGIN
  IF TG_OP = 'UPDATE' AND (v_new - 'updated_at') = (v_old - 'updated_at') THEN RETURN NEW; END IF;
  v_store := CASE TG_TABLE_NAME
    WHEN 'dealer_stores' THEN (v_row->>'id')::uuid
    WHEN 'inventory_sharing_rules' THEN (v_row->>'destination_store_id')::uuid
    ELSE NULLIF(v_row->>'store_id','')::uuid END;
  v_group := COALESCE(NULLIF(v_row->>'group_id','')::uuid, (SELECT group_id FROM dealer_stores WHERE id = v_store));
  INSERT INTO inventory_network_audit (actor, group_id, store_id, entity, entity_id, action, before, after)
  VALUES ((SELECT auth.uid()), v_group, v_store, TG_TABLE_NAME, COALESCE(v_row->>'id', v_row->>'store_id'), lower(TG_OP), v_old, v_new);
  RETURN COALESCE(NEW, OLD);
END $$;

CREATE TRIGGER audit_dealer_stores AFTER INSERT OR UPDATE OR DELETE ON public.dealer_stores FOR EACH ROW EXECUTE FUNCTION public.inventory_network_audit_row();
CREATE TRIGGER audit_inventory_source_mappings AFTER INSERT OR UPDATE OR DELETE ON public.inventory_source_mappings FOR EACH ROW EXECUTE FUNCTION public.inventory_network_audit_row();
CREATE TRIGGER audit_inventory_sharing_rules AFTER INSERT OR UPDATE OR DELETE ON public.inventory_sharing_rules FOR EACH ROW EXECUTE FUNCTION public.inventory_network_audit_row();
CREATE TRIGGER audit_store_enrichment_policies AFTER INSERT OR UPDATE OR DELETE ON public.store_enrichment_policies FOR EACH ROW EXECUTE FUNCTION public.inventory_network_audit_row();
CREATE TRIGGER audit_inventory_feed_controls AFTER INSERT OR UPDATE ON public.inventory_feed_controls FOR EACH ROW EXECUTE FUNCTION public.inventory_network_audit_row();

-- ── Grants and RLS ─────────────────────────────────────────────────────────
-- Reads: platform admins everything; accepted members of the group's tenant
-- read their own group's configuration and inventory. Writes go through the
-- SECURITY DEFINER functions below (or the service role) only.

GRANT SELECT ON public.dealer_groups, public.dealer_stores, public.inventory_store_state, public.inventory_source_mappings,
  public.store_inventory, public.inventory_vin_conflicts, public.inventory_feed_controls, public.inventory_feed_jobs,
  public.inventory_feed_versions, public.inventory_store_snapshots, public.inventory_sharing_rules,
  public.store_enrichment_policies, public.store_provider_usage, public.store_enrichment_requests, public.inventory_network_audit TO authenticated;
GRANT ALL ON public.dealer_groups, public.dealer_stores, public.inventory_store_state, public.inventory_source_mappings,
  public.store_inventory, public.inventory_vin_conflicts, public.inventory_feed_controls, public.inventory_feed_jobs,
  public.inventory_feed_versions, public.inventory_store_snapshots, public.inventory_snapshot_vehicles, public.inventory_sharing_rules,
  public.store_enrichment_policies, public.store_provider_usage, public.store_enrichment_requests, public.inventory_network_audit TO service_role;
GRANT USAGE ON SEQUENCE public.store_provider_usage_id_seq, public.inventory_network_audit_id_seq TO service_role;

ALTER TABLE public.dealer_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dealer_stores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_store_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_source_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.store_inventory ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_vin_conflicts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_feed_controls ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_feed_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_feed_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_store_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_snapshot_vehicles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_sharing_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.store_enrichment_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.store_provider_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.store_enrichment_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_network_audit ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Platform admins read groups" ON public.dealer_groups FOR SELECT TO authenticated USING (public.has_role((SELECT auth.uid()), 'admin'::public.app_role));
CREATE POLICY "Members read own group" ON public.dealer_groups FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT tenant_id FROM public.tenant_members WHERE user_id = (SELECT auth.uid()) AND accepted_at IS NOT NULL));

CREATE POLICY "Platform admins read stores" ON public.dealer_stores FOR SELECT TO authenticated USING (public.has_role((SELECT auth.uid()), 'admin'::public.app_role));
CREATE POLICY "Members read own group stores" ON public.dealer_stores FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT tenant_id FROM public.tenant_members WHERE user_id = (SELECT auth.uid()) AND accepted_at IS NOT NULL));

CREATE POLICY "Platform admins read store inventory" ON public.store_inventory FOR SELECT TO authenticated USING (public.has_role((SELECT auth.uid()), 'admin'::public.app_role));
CREATE POLICY "Members read own group inventory" ON public.store_inventory FOR SELECT TO authenticated
  USING (group_id IN (SELECT g.id FROM public.dealer_groups g JOIN public.tenant_members tm ON tm.tenant_id = g.tenant_id
                      WHERE tm.user_id = (SELECT auth.uid()) AND tm.accepted_at IS NOT NULL));

CREATE POLICY "Platform admins read sharing" ON public.inventory_sharing_rules FOR SELECT TO authenticated USING (public.has_role((SELECT auth.uid()), 'admin'::public.app_role));
CREATE POLICY "Members read own group sharing" ON public.inventory_sharing_rules FOR SELECT TO authenticated
  USING (group_id IN (SELECT g.id FROM public.dealer_groups g JOIN public.tenant_members tm ON tm.tenant_id = g.tenant_id
                      WHERE tm.user_id = (SELECT auth.uid()) AND tm.accepted_at IS NOT NULL));

CREATE POLICY "Platform admins read enrichment policy" ON public.store_enrichment_policies FOR SELECT TO authenticated USING (public.has_role((SELECT auth.uid()), 'admin'::public.app_role));
CREATE POLICY "Members read own store policy" ON public.store_enrichment_policies FOR SELECT TO authenticated
  USING (store_id IN (SELECT s.id FROM public.dealer_stores s JOIN public.tenant_members tm ON tm.tenant_id = s.tenant_id
                      WHERE tm.user_id = (SELECT auth.uid()) AND tm.accepted_at IS NOT NULL));

CREATE POLICY "Platform admins read usage" ON public.store_provider_usage FOR SELECT TO authenticated USING (public.has_role((SELECT auth.uid()), 'admin'::public.app_role));
CREATE POLICY "Members read own group usage" ON public.store_provider_usage FOR SELECT TO authenticated
  USING (group_id IN (SELECT g.id FROM public.dealer_groups g JOIN public.tenant_members tm ON tm.tenant_id = g.tenant_id
                      WHERE tm.user_id = (SELECT auth.uid()) AND tm.accepted_at IS NOT NULL));

CREATE POLICY "Platform admins read enrichment requests" ON public.store_enrichment_requests FOR SELECT TO authenticated USING (public.has_role((SELECT auth.uid()), 'admin'::public.app_role));
CREATE POLICY "Members read own store requests" ON public.store_enrichment_requests FOR SELECT TO authenticated
  USING (store_id IN (SELECT s.id FROM public.dealer_stores s JOIN public.tenant_members tm ON tm.tenant_id = s.tenant_id
                      WHERE tm.user_id = (SELECT auth.uid()) AND tm.accepted_at IS NOT NULL));

-- Operational tables: platform admins only.
CREATE POLICY "Platform admins read store state" ON public.inventory_store_state FOR SELECT TO authenticated USING (public.has_role((SELECT auth.uid()), 'admin'::public.app_role));
CREATE POLICY "Platform admins read mappings" ON public.inventory_source_mappings FOR SELECT TO authenticated USING (public.has_role((SELECT auth.uid()), 'admin'::public.app_role));
CREATE POLICY "Platform admins read conflicts" ON public.inventory_vin_conflicts FOR SELECT TO authenticated USING (public.has_role((SELECT auth.uid()), 'admin'::public.app_role));
CREATE POLICY "Platform admins read controls" ON public.inventory_feed_controls FOR SELECT TO authenticated USING (public.has_role((SELECT auth.uid()), 'admin'::public.app_role));
CREATE POLICY "Platform admins read jobs" ON public.inventory_feed_jobs FOR SELECT TO authenticated USING (public.has_role((SELECT auth.uid()), 'admin'::public.app_role));
CREATE POLICY "Platform admins read versions" ON public.inventory_feed_versions FOR SELECT TO authenticated USING (public.has_role((SELECT auth.uid()), 'admin'::public.app_role));
CREATE POLICY "Platform admins read snapshots" ON public.inventory_store_snapshots FOR SELECT TO authenticated USING (public.has_role((SELECT auth.uid()), 'admin'::public.app_role));
CREATE POLICY "Platform admins read audit" ON public.inventory_network_audit FOR SELECT TO authenticated USING (public.has_role((SELECT auth.uid()), 'admin'::public.app_role));

-- ── Queue functions (service role) ─────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.inventory_feed_enqueue(p_path text, p_trigger text, p_requested_by uuid DEFAULT NULL, p_event_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid; v_binding text;
BEGIN
  SELECT status INTO v_binding FROM inventory_feed_bindings WHERE provider = 'filescom' AND path = p_path;
  IF v_binding IS DISTINCT FROM 'approved' THEN
    RETURN jsonb_build_object('enqueued', false, 'reason', 'binding_not_approved');
  END IF;
  INSERT INTO inventory_feed_jobs (path, trigger, requested_by, event_id)
  VALUES (p_path, p_trigger, p_requested_by, p_event_id)
  ON CONFLICT (provider, path) WHERE status IN ('queued','running') DO NOTHING
  RETURNING id INTO v_id;
  IF v_id IS NULL THEN
    SELECT id INTO v_id FROM inventory_feed_jobs WHERE provider = 'filescom' AND path = p_path AND status IN ('queued','running');
    RETURN jsonb_build_object('enqueued', false, 'reason', 'coalesced', 'job_id', v_id);
  END IF;
  RETURN jsonb_build_object('enqueued', true, 'job_id', v_id);
END $$;

-- Claims due jobs. A running job whose lock expired is reclaimed (its worker
-- died); attempts count claims so a crash loop still ends in 'dead'.
CREATE OR REPLACE FUNCTION public.inventory_feed_claim_jobs(p_limit integer DEFAULT 3, p_lock_seconds integer DEFAULT 600)
RETURNS SETOF public.inventory_feed_jobs LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE c public.inventory_feed_controls%ROWTYPE;
BEGIN
  SELECT * INTO c FROM inventory_feed_controls WHERE id = 1;
  IF NOT FOUND OR c.emergency_stop OR c.ingestion_paused THEN RETURN; END IF;
  UPDATE inventory_feed_jobs SET status = 'dead', finished_at = now(), last_error = COALESCE(last_error, 'lock_expired_after_max_attempts')
   WHERE status = 'running' AND locked_until < now() AND attempts >= max_attempts;
  RETURN QUERY
  WITH due AS (
    SELECT id FROM inventory_feed_jobs
     WHERE (status = 'queued' AND next_attempt_at <= now())
        OR (status = 'running' AND locked_until < now() AND attempts < max_attempts)
     ORDER BY next_attempt_at
     LIMIT GREATEST(1, LEAST(p_limit, 10))
     FOR UPDATE SKIP LOCKED
  )
  UPDATE inventory_feed_jobs j SET status = 'running', attempts = j.attempts + 1, lock_token = gen_random_uuid(),
         locked_until = now() + make_interval(secs => GREATEST(60, LEAST(p_lock_seconds, 1800))), started_at = now()
    FROM due WHERE j.id = due.id
  RETURNING j.*;
END $$;

-- Claims one specific queued job (Import now). Same controls as the batch claim.
CREATE OR REPLACE FUNCTION public.inventory_feed_claim_job(p_job_id uuid, p_lock_seconds integer DEFAULT 600)
RETURNS SETOF public.inventory_feed_jobs LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE c public.inventory_feed_controls%ROWTYPE;
BEGIN
  SELECT * INTO c FROM inventory_feed_controls WHERE id = 1;
  IF NOT FOUND OR c.emergency_stop OR c.ingestion_paused THEN RETURN; END IF;
  RETURN QUERY
  UPDATE inventory_feed_jobs j SET status = 'running', attempts = j.attempts + 1, lock_token = gen_random_uuid(),
         locked_until = now() + make_interval(secs => GREATEST(60, LEAST(p_lock_seconds, 1800))), started_at = now()
   WHERE j.id = p_job_id AND j.status = 'queued' AND j.attempts < j.max_attempts
  RETURNING j.*;
END $$;

-- Ends a job. Retryable failures back off exponentially (2^n minutes, max 60)
-- until max_attempts, then the job is dead and stays visible for review.
CREATE OR REPLACE FUNCTION public.inventory_feed_finish_job(p_job_id uuid, p_lock_token uuid, p_status text, p_error text DEFAULT NULL, p_retryable boolean DEFAULT false, p_result jsonb DEFAULT NULL, p_run_id uuid DEFAULT NULL, p_version_key text DEFAULT NULL)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE j public.inventory_feed_jobs%ROWTYPE; v_status text;
BEGIN
  SELECT * INTO j FROM inventory_feed_jobs WHERE id = p_job_id FOR UPDATE;
  IF NOT FOUND OR j.status <> 'running' OR j.lock_token IS DISTINCT FROM p_lock_token THEN RETURN 'lock_lost'; END IF;
  IF p_status NOT IN ('succeeded','partial','skipped','failed') THEN RAISE EXCEPTION 'bad_job_status'; END IF;
  IF p_status = 'failed' AND p_retryable AND j.attempts < j.max_attempts THEN
    v_status := 'queued';
    UPDATE inventory_feed_jobs SET status = 'queued', lock_token = NULL, locked_until = NULL, last_error = left(p_error, 300),
           next_attempt_at = now() + make_interval(mins => LEAST(60, power(2, j.attempts)::int)), run_id = COALESCE(p_run_id, run_id),
           version_key = COALESCE(p_version_key, version_key), result = COALESCE(p_result, result)
     WHERE id = p_job_id;
  ELSE
    v_status := CASE WHEN p_status = 'failed' AND p_retryable THEN 'dead' ELSE p_status END;
    UPDATE inventory_feed_jobs SET status = v_status, lock_token = NULL, locked_until = NULL, finished_at = now(), last_error = left(p_error, 300),
           run_id = COALESCE(p_run_id, run_id), version_key = COALESCE(p_version_key, version_key), result = COALESCE(p_result, result)
     WHERE id = p_job_id;
  END IF;
  RETURN v_status;
END $$;

-- One processing claim per remote file version. A version already applied,
-- partially applied or rejected is never processed again; a stale claim
-- (worker died mid-run) can be re-taken.
CREATE OR REPLACE FUNCTION public.inventory_feed_claim_version(p_path text, p_version_key text, p_size bigint, p_mtime timestamptz, p_checksum text, p_job_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v public.inventory_feed_versions%ROWTYPE;
BEGIN
  INSERT INTO inventory_feed_versions (path, version_key, remote_size, remote_mtime, remote_checksum, job_id, claimed_until)
  VALUES (p_path, p_version_key, p_size, p_mtime, p_checksum, p_job_id, now() + interval '15 minutes')
  ON CONFLICT (provider, path, version_key) DO NOTHING;
  SELECT * INTO v FROM inventory_feed_versions WHERE provider = 'filescom' AND path = p_path AND version_key = p_version_key FOR UPDATE;
  IF v.job_id = p_job_id AND v.status = 'processing' THEN RETURN jsonb_build_object('claimed', true, 'version_id', v.id); END IF;
  IF v.status = 'processing' AND v.claimed_until < now() THEN
    UPDATE inventory_feed_versions SET job_id = p_job_id, claimed_until = now() + interval '15 minutes' WHERE id = v.id;
    RETURN jsonb_build_object('claimed', true, 'version_id', v.id, 'reclaimed', true);
  END IF;
  IF v.status = 'failed' THEN
    UPDATE inventory_feed_versions SET status = 'processing', job_id = p_job_id, claimed_until = now() + interval '15 minutes', finished_at = NULL WHERE id = v.id;
    RETURN jsonb_build_object('claimed', true, 'version_id', v.id, 'retry', true);
  END IF;
  RETURN jsonb_build_object('claimed', false, 'version_id', v.id, 'status', v.status);
END $$;

-- ── Snapshot apply: one store, one transaction ─────────────────────────────

CREATE OR REPLACE FUNCTION public.inventory_apply_store_snapshot(p_snapshot_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  s public.inventory_store_snapshots%ROWTYPE;
  st public.dealer_stores%ROWTYPE;
  ss public.inventory_store_state%ROWTYPE;
  c public.inventory_feed_controls%ROWTYPE;
  m public.inventory_source_mappings%ROWTYPE;
  v record;
  cur public.store_inventory%ROWTYPE;
  other public.store_inventory%ROWTYPE;
  lst record;
  v_staged integer;
  v_added integer := 0; v_updated integer := 0; v_unchanged integer := 0; v_conflicts integer := 0;
  v_missing integer := 0; v_review integer := 0; v_retired integer := 0; v_returned integer := 0;
  v_listings_created integer := 0; v_listings_updated integer := 0;
  v_inv_id uuid;
  v_listing_id uuid;
  v_ymm text;
  v_photos jsonb;
BEGIN
  SELECT * INTO s FROM inventory_store_snapshots WHERE id = p_snapshot_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'snapshot_not_found'; END IF;
  IF s.status <> 'staged' THEN RETURN jsonb_build_object('applied', false, 'reason', 'snapshot_not_staged', 'status', s.status); END IF;

  SELECT * INTO c FROM inventory_feed_controls WHERE id = 1;
  IF NOT FOUND OR c.emergency_stop OR c.ingestion_paused THEN
    UPDATE inventory_store_snapshots SET status = 'rejected', reason = 'ingestion_paused' WHERE id = s.id;
    RETURN jsonb_build_object('applied', false, 'reason', 'ingestion_paused');
  END IF;

  SELECT * INTO st FROM dealer_stores WHERE id = s.store_id FOR UPDATE;
  SELECT * INTO m FROM inventory_source_mappings WHERE id = s.mapping_id;
  IF st.id IS NULL OR m.id IS NULL OR m.status <> 'approved' OR m.store_id <> st.id OR m.source_dealer_id <> s.source_dealer_id THEN
    UPDATE inventory_store_snapshots SET status = 'quarantined', reason = 'mapping_not_approved' WHERE id = s.id;
    RETURN jsonb_build_object('applied', false, 'reason', 'mapping_not_approved');
  END IF;
  IF st.status <> 'active' OR NOT st.inventory_feed_enabled OR st.feed_import_paused THEN
    UPDATE inventory_store_snapshots SET status = 'rejected', reason = 'store_feed_not_enabled' WHERE id = s.id;
    RETURN jsonb_build_object('applied', false, 'reason', 'store_feed_not_enabled');
  END IF;

  INSERT INTO inventory_store_state (store_id) VALUES (st.id) ON CONFLICT (store_id) DO NOTHING;
  SELECT * INTO ss FROM inventory_store_state WHERE store_id = st.id FOR UPDATE;
  IF ss.last_applied_source_mtime IS NOT NULL AND s.source_mtime < ss.last_applied_source_mtime THEN
    UPDATE inventory_store_snapshots SET status = 'superseded', reason = 'older_than_applied_snapshot' WHERE id = s.id;
    RETURN jsonb_build_object('applied', false, 'reason', 'older_than_applied_snapshot');
  END IF;
  IF ss.last_applied_sha256 = s.content_sha256 AND ss.last_applied_source_mtime = s.source_mtime THEN
    UPDATE inventory_store_snapshots SET status = 'superseded', reason = 'same_version_already_applied' WHERE id = s.id;
    RETURN jsonb_build_object('applied', false, 'reason', 'same_version_already_applied');
  END IF;

  SELECT count(*) INTO v_staged FROM inventory_snapshot_vehicles WHERE snapshot_id = s.id;
  IF v_staged = 0 OR v_staged <> s.valid_count THEN
    UPDATE inventory_store_snapshots SET status = 'rejected', reason = CASE WHEN v_staged = 0 THEN 'empty_snapshot' ELSE 'staging_incomplete' END WHERE id = s.id;
    RETURN jsonb_build_object('applied', false, 'reason', CASE WHEN v_staged = 0 THEN 'empty_snapshot' ELSE 'staging_incomplete' END);
  END IF;

  PERFORM set_config('app.inventory_writer', 'filescom_apply', true);

  FOR v IN SELECT * FROM inventory_snapshot_vehicles WHERE snapshot_id = s.id ORDER BY row_number LOOP
    v_photos := COALESCE(v.photos, '[]'::jsonb);
    SELECT * INTO cur FROM store_inventory WHERE store_id = st.id AND vin = v.vin FOR UPDATE;
    IF cur.id IS NULL OR cur.presence IN ('retired','transferred') THEN
      SELECT * INTO other FROM store_inventory WHERE group_id = st.group_id AND vin = v.vin AND store_id <> st.id AND presence NOT IN ('retired','transferred');
      IF other.id IS NOT NULL THEN
        INSERT INTO inventory_vin_conflicts (group_id, vin, kind, claiming_store_id, existing_store_id, existing_inventory_id, snapshot_id)
        VALUES (st.group_id, v.vin, 'other_store', st.id, other.store_id, other.id, s.id)
        ON CONFLICT (group_id, vin, claiming_store_id, kind) WHERE status = 'open' DO UPDATE SET last_seen_at = now(), snapshot_id = EXCLUDED.snapshot_id;
        v_conflicts := v_conflicts + 1;
        other := NULL;
        CONTINUE;
      END IF;
    END IF;

    IF cur.id IS NULL THEN
      INSERT INTO store_inventory (store_id, group_id, vin, source_dealer_id, stock_number, condition, certified, year, make, model, trim, series_detail, body,
        drivetrain, engine, transmission, fuel, equipment, description, mileage, msrp, feed_price, feed_price_status, feed_price_observed_at,
        exterior_color, interior_color, photos, photo_count, photos_modified_at, inventory_date, last_snapshot_id)
      VALUES (st.id, st.group_id, v.vin, s.source_dealer_id, v.stock_number, v.condition, v.certified, v.year, v.make, v.model, v.trim, v.series_detail, v.body,
        v.drivetrain, v.engine, v.transmission, v.fuel, v.equipment, v.description, v.mileage, v.msrp, v.feed_price, v.feed_price_status, now(),
        v.exterior_color, v.interior_color, v_photos, jsonb_array_length(v_photos), v.photos_modified_at, v.inventory_date, s.id)
      RETURNING id INTO v_inv_id;
      v_added := v_added + 1;
    ELSE
      IF cur.presence IN ('retired','transferred','missing','retirement_review') THEN v_returned := v_returned + 1; END IF;
      IF cur.presence IN ('retired','transferred') THEN
        -- A retired car that reappears in its own store's feed is live again.
        UPDATE store_inventory SET presence = 'present', retired_at = NULL, retired_by = NULL, retire_reason = NULL WHERE id = cur.id;
      END IF;
      UPDATE store_inventory SET
        stock_number = v.stock_number, condition = v.condition, certified = v.certified, year = v.year, make = v.make, model = v.model, trim = v.trim,
        series_detail = v.series_detail, body = v.body, drivetrain = v.drivetrain, engine = v.engine, transmission = v.transmission, fuel = v.fuel,
        equipment = v.equipment, description = v.description, mileage = v.mileage, msrp = v.msrp,
        feed_price = v.feed_price, feed_price_status = v.feed_price_status,
        feed_price_observed_at = CASE WHEN v.feed_price IS DISTINCT FROM cur.feed_price OR v.feed_price_status <> cur.feed_price_status THEN now() ELSE cur.feed_price_observed_at END,
        exterior_color = v.exterior_color, interior_color = v.interior_color, photos = v_photos, photo_count = jsonb_array_length(v_photos),
        photos_modified_at = v.photos_modified_at, inventory_date = v.inventory_date,
        presence = 'present', missing_snapshots = 0, last_seen_at = now(), last_snapshot_id = s.id, updated_at = now()
      WHERE id = cur.id;
      IF cur.feed_price IS DISTINCT FROM v.feed_price OR cur.mileage IS DISTINCT FROM v.mileage OR cur.stock_number IS DISTINCT FROM v.stock_number
         OR cur.photos IS DISTINCT FROM v_photos OR cur.condition IS DISTINCT FROM v.condition THEN
        v_updated := v_updated + 1;
      ELSE
        v_unchanged := v_unchanged + 1;
      END IF;
      v_inv_id := cur.id;
    END IF;

    -- Optional: the store's own AutoLabels working listing (subscribed stores).
    IF st.listing_sync_enabled THEN
      v_ymm := NULLIF(trim(concat_ws(' ', v.year::text, v.make, v.model)), '');
      SELECT id, owning_store_id, inventory_record_id, status INTO lst FROM vehicle_listings
       WHERE tenant_id = st.tenant_id AND upper(trim(vin)) = v.vin FOR UPDATE;
      IF lst.id IS NULL THEN
        INSERT INTO vehicle_listings (tenant_id, store_id, owning_store_id, inventory_record_id, vin, slug, ymm, trim, mileage, condition, price,
          status, sticker_snapshot, feed_source, photos, photo_count, hero_image_url, features)
        VALUES (st.tenant_id, st.tenant_id::text, st.id, v_inv_id, v.vin, lower(v.vin) || '-' || substr(md5(random()::text || clock_timestamp()::text), 1, 6),
          v_ymm, v.trim, v.mileage, v.condition, v.feed_price, 'draft', '{}'::jsonb, 'filescom', v_photos, jsonb_array_length(v_photos),
          v_photos->>0, v.equipment)
        RETURNING id INTO v_listing_id;
        UPDATE store_inventory SET listing_id = v_listing_id WHERE id = v_inv_id;
        v_listings_created := v_listings_created + 1;
      ELSIF lst.owning_store_id = st.id THEN
        UPDATE vehicle_listings SET inventory_record_id = v_inv_id, feed_source = 'filescom', ymm = COALESCE(v_ymm, ymm), trim = COALESCE(v.trim, trim),
          mileage = COALESCE(v.mileage, mileage), condition = v.condition,
          photos = CASE WHEN jsonb_array_length(v_photos) > 0 THEN v_photos ELSE photos END,
          photo_count = CASE WHEN jsonb_array_length(v_photos) > 0 THEN jsonb_array_length(v_photos) ELSE photo_count END,
          price = CASE WHEN st.feed_price_updates_listing AND v.feed_price_status = 'known' THEN v.feed_price ELSE price END
        WHERE id = lst.id;
        UPDATE store_inventory SET listing_id = lst.id WHERE id = v_inv_id;
        v_listings_updated := v_listings_updated + 1;
      ELSIF lst.owning_store_id IS NULL AND st.adopt_legacy_matches THEN
        -- Adoption links an unassigned legacy listing; the price stays as the
        -- dealer set it unless the store's feed price is authoritative.
        UPDATE vehicle_listings SET owning_store_id = st.id, inventory_record_id = v_inv_id, feed_source = 'filescom',
          price = CASE WHEN st.feed_price_updates_listing AND v.feed_price_status = 'known' THEN v.feed_price ELSE price END
        WHERE id = lst.id;
        UPDATE store_inventory SET listing_id = lst.id WHERE id = v_inv_id;
        INSERT INTO inventory_network_audit (group_id, store_id, entity, entity_id, action, after)
        VALUES (st.group_id, st.id, 'vehicle_listings', lst.id::text, 'adopt_legacy_listing', jsonb_build_object('vin', v.vin, 'snapshot_id', s.id));
        v_listings_updated := v_listings_updated + 1;
      ELSE
        INSERT INTO inventory_vin_conflicts (group_id, vin, kind, claiming_store_id, existing_store_id, existing_listing_id, existing_inventory_id, snapshot_id)
        VALUES (st.group_id, v.vin, CASE WHEN lst.owning_store_id IS NULL THEN 'legacy_listing' ELSE 'other_store_listing' END, st.id, lst.owning_store_id, lst.id, v_inv_id, s.id)
        ON CONFLICT (group_id, vin, claiming_store_id, kind) WHERE status = 'open' DO UPDATE SET last_seen_at = now(), snapshot_id = EXCLUDED.snapshot_id;
        v_conflicts := v_conflicts + 1;
      END IF;
      lst := NULL;
    END IF;
    cur := NULL;
  END LOOP;

  -- Absence: only this store's own rows, only from a clean snapshot.
  IF s.clean THEN
    WITH gone AS (
      UPDATE store_inventory si SET
        missing_snapshots = si.missing_snapshots + 1,
        presence = CASE
          WHEN si.missing_snapshots + 1 >= st.missing_snapshot_threshold AND st.retirement_automation_enabled THEN 'retired'
          WHEN si.missing_snapshots + 1 >= st.missing_snapshot_threshold THEN 'retirement_review'
          ELSE 'missing' END,
        retired_at = CASE WHEN si.missing_snapshots + 1 >= st.missing_snapshot_threshold AND st.retirement_automation_enabled THEN now() ELSE si.retired_at END,
        retire_reason = CASE WHEN si.missing_snapshots + 1 >= st.missing_snapshot_threshold AND st.retirement_automation_enabled THEN 'absent_from_feed' ELSE si.retire_reason END,
        updated_at = now()
      WHERE si.store_id = st.id AND si.presence IN ('present','missing','retirement_review')
        AND NOT EXISTS (SELECT 1 FROM inventory_snapshot_vehicles x WHERE x.snapshot_id = s.id AND x.vin = si.vin)
      RETURNING si.presence
    )
    SELECT count(*) FILTER (WHERE presence = 'missing'), count(*) FILTER (WHERE presence = 'retirement_review'), count(*) FILTER (WHERE presence = 'retired')
      INTO v_missing, v_review, v_retired FROM gone;
  END IF;

  UPDATE inventory_store_snapshots SET status = 'applied', applied_at = now(),
    report = COALESCE(report, '{}'::jsonb) || jsonb_build_object('apply', jsonb_build_object(
      'added', v_added, 'updated', v_updated, 'unchanged', v_unchanged, 'returned', v_returned, 'conflicts', v_conflicts,
      'missing', v_missing, 'retirement_review', v_review, 'retired', v_retired, 'absence_counted', s.clean,
      'listings_created', v_listings_created, 'listings_updated', v_listings_updated, 'provider_calls', 0))
  WHERE id = s.id;
  UPDATE inventory_store_state SET last_applied_snapshot_id = s.id, last_applied_source_mtime = s.source_mtime, last_applied_sha256 = s.content_sha256,
    last_applied_at = now(), last_run_id = s.run_id, updated_at = now() WHERE store_id = st.id;
  INSERT INTO inventory_network_audit (group_id, store_id, entity, entity_id, action, after)
  VALUES (st.group_id, st.id, 'inventory_store_snapshots', s.id::text, 'apply_snapshot',
    jsonb_build_object('path', s.path, 'source_dealer_id', s.source_dealer_id, 'added', v_added, 'updated', v_updated, 'conflicts', v_conflicts, 'missing', v_missing, 'retired', v_retired));

  RETURN jsonb_build_object('applied', true, 'added', v_added, 'updated', v_updated, 'unchanged', v_unchanged, 'returned', v_returned,
    'conflicts', v_conflicts, 'missing', v_missing, 'retirement_review', v_review, 'retired', v_retired,
    'listings_created', v_listings_created, 'listings_updated', v_listings_updated);
END $$;

-- ── Webhook: enqueue after the existing record step ────────────────────────
-- Same signature, same dedup and quarantine behaviour as 0004. The only
-- addition: a new (non-duplicate) event for an approved binding enqueues an
-- import job, which coalesces onto any open job for the file.
CREATE OR REPLACE FUNCTION public.filescom_record_event(
  p_digest text, p_action text, p_path text, p_destination text, p_event_at timestamptz, p_size bigint
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_event_id uuid;
  v_binding record;
  v_status text;
  v_reason text;
  v_file record;
  v_latest boolean;
  v_job jsonb := NULL;
BEGIN
  INSERT INTO inventory_feed_events (digest, action, path, destination, event_at, size)
  VALUES (p_digest, p_action, p_path, p_destination, p_event_at, p_size)
  ON CONFLICT (digest) DO NOTHING
  RETURNING id INTO v_event_id;
  IF v_event_id IS NULL THEN
    RETURN jsonb_build_object('duplicate', true);
  END IF;

  SELECT status INTO v_binding FROM inventory_feed_bindings WHERE provider = 'filescom' AND path = p_path;
  IF NOT FOUND THEN v_status := 'quarantined'; v_reason := 'unmapped';
  ELSIF v_binding.status = 'approved' THEN v_status := 'pending'; v_reason := NULL;
  ELSE v_status := 'quarantined'; v_reason := 'binding_' || v_binding.status;
  END IF;

  INSERT INTO inventory_feed_files (path, status, quarantine_reason, latest_action, latest_event_at, latest_event_size, latest_notified_at)
  VALUES (p_path, v_status, v_reason, p_action, p_event_at, p_size, now())
  ON CONFLICT (provider, path) DO NOTHING;

  SELECT * INTO v_file FROM inventory_feed_files WHERE provider = 'filescom' AND path = p_path FOR UPDATE;
  v_latest := v_file.latest_event_at IS NULL OR p_event_at IS NULL OR p_event_at >= v_file.latest_event_at;

  UPDATE inventory_feed_files SET
    latest_action = CASE WHEN v_latest THEN p_action ELSE latest_action END,
    latest_event_at = CASE WHEN v_latest THEN COALESCE(p_event_at, latest_event_at) ELSE latest_event_at END,
    latest_event_size = CASE WHEN v_latest THEN p_size ELSE latest_event_size END,
    latest_notified_at = now(),
    status = CASE WHEN status = 'validating' THEN status ELSE v_status END,
    quarantine_reason = CASE WHEN status = 'validating' THEN quarantine_reason ELSE v_reason END,
    updated_at = now()
  WHERE id = v_file.id;

  UPDATE inventory_feed_events SET file_id = v_file.id, applied_as_latest = v_latest WHERE id = v_event_id;

  IF v_status = 'pending' THEN
    v_job := inventory_feed_enqueue(p_path, 'webhook', NULL, v_event_id);
  END IF;
  RETURN jsonb_build_object('duplicate', false, 'status', v_status, 'latest', v_latest, 'job', v_job);
END $$;

-- ── MarketCheck store gate ─────────────────────────────────────────────────
-- Called by admitProviderCall for every per-VIN MarketCheck call before the
-- platform budget. A VIN that belongs to a store's feed inventory is admitted
-- only under that store's approved policy; a VIN with no store record (legacy
-- tenant inventory) keeps today's behaviour. Every decision on a store VIN is
-- metered.
CREATE OR REPLACE FUNCTION public.store_enrichment_admit(p_tenant_id uuid, p_vin text, p_product text, p_caller text, p_reason text DEFAULT 'provider_call', p_estimated_cost_usd numeric DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  inv record;
  p public.store_enrichment_policies%ROWTYPE;
  v_day integer; v_month integer; v_usd numeric; v_reason text;
BEGIN
  IF p_tenant_id IS NULL OR p_vin IS NULL OR p_vin = '' THEN
    RETURN jsonb_build_object('admitted', true, 'scope', 'not_store_vehicle');
  END IF;
  SELECT si.store_id, si.group_id INTO inv FROM store_inventory si JOIN dealer_groups g ON g.id = si.group_id
   WHERE g.tenant_id = p_tenant_id AND si.vin = upper(trim(p_vin)) AND si.presence NOT IN ('retired','transferred') LIMIT 1;
  IF inv.store_id IS NULL THEN
    SELECT vl.owning_store_id AS store_id, s.group_id INTO inv FROM vehicle_listings vl JOIN dealer_stores s ON s.id = vl.owning_store_id
     WHERE vl.tenant_id = p_tenant_id AND upper(trim(vl.vin)) = upper(trim(p_vin)) LIMIT 1;
  END IF;
  IF inv.store_id IS NULL THEN
    RETURN jsonb_build_object('admitted', true, 'scope', 'legacy_tenant_inventory');
  END IF;

  SELECT * INTO p FROM store_enrichment_policies WHERE store_id = inv.store_id FOR UPDATE;
  IF NOT FOUND OR p.mode = 'feed_only' THEN v_reason := 'feed_only';
  ELSIF p.mode = 'paused' THEN v_reason := 'paused';
  ELSIF p.budget_blocked THEN v_reason := 'budget_blocked';
  ELSIF NOT (p_product = ANY (p.allowed_products)) THEN v_reason := 'product_not_approved';
  ELSE
    SELECT count(*) FILTER (WHERE at >= date_trunc('day', now())), count(*), COALESCE(sum(estimated_cost_usd), 0)
      INTO v_day, v_month, v_usd
      FROM store_provider_usage WHERE store_id = inv.store_id AND outcome = 'admitted' AND at >= date_trunc('month', now());
    IF v_day >= p.daily_request_limit THEN v_reason := 'daily_limit';
    ELSIF v_month >= floor(p.monthly_request_cap * p.hard_stop_pct / 100.0) THEN v_reason := 'monthly_cap';
    ELSIF p.monthly_usd_cap IS NOT NULL AND p_estimated_cost_usd IS NULL THEN v_reason := 'unpriced';
    ELSIF p.monthly_usd_cap IS NOT NULL AND v_usd + p_estimated_cost_usd > p.monthly_usd_cap * p.hard_stop_pct / 100.0 THEN v_reason := 'monthly_usd_cap';
    END IF;
  END IF;

  INSERT INTO store_provider_usage (store_id, group_id, product, reason, caller, vin, outcome, deny_reason, estimated_cost_usd, cost_basis)
  VALUES (inv.store_id, inv.group_id, p_product, left(p_reason, 60), left(p_caller, 80), upper(trim(p_vin)),
          CASE WHEN v_reason IS NULL THEN 'admitted' ELSE 'denied' END, v_reason, p_estimated_cost_usd,
          CASE WHEN p_estimated_cost_usd IS NULL THEN 'unpriced' ELSE 'estimate' END);
  IF v_reason IS NULL THEN
    RETURN jsonb_build_object('admitted', true, 'scope', 'store', 'store_id', inv.store_id);
  END IF;
  RETURN jsonb_build_object('admitted', false, 'scope', 'store', 'store_id', inv.store_id, 'reason', v_reason);
END $$;

-- ── Customer inventory service ─────────────────────────────────────────────
-- The core is keyed by a home store resolved server-side. Customer callers
-- reach it only through customer_group_inventory, which derives the home store
-- from a published passport slug; nothing a browser sends picks the store.
-- Nothing is cached, so revoking a rule hides its vehicles on the next read.

CREATE OR REPLACE FUNCTION public.group_inventory_core(p_home_store_id uuid, p_channel text, p_filters jsonb DEFAULT '{}'::jsonb, p_limit integer DEFAULT 24, p_offset integer DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  h public.dealer_stores%ROWTYPE;
  v_scope text := COALESCE(p_filters->>'scope', 'all');
  v_cond text := NULLIF(p_filters->>'condition', '');
  v_make text := NULLIF(lower(p_filters->>'make'), '');
  v_model text := NULLIF(lower(p_filters->>'model'), '');
  v_max numeric := NULLIF(p_filters->>'max_price', '')::numeric;
  v_rows jsonb;
  v_total integer;
  v_sources jsonb;
BEGIN
  IF p_channel NOT IN ('connect_card','customer_room') THEN RAISE EXCEPTION 'bad_channel'; END IF;
  SELECT * INTO h FROM dealer_stores WHERE id = p_home_store_id;
  IF NOT FOUND OR h.status <> 'active' THEN RETURN jsonb_build_object('enabled', false, 'reason', 'home_store_unavailable'); END IF;

  WITH rules AS (
    SELECT r.* FROM inventory_sharing_rules r JOIN dealer_stores src ON src.id = r.source_store_id
     WHERE r.destination_store_id = h.id AND r.status = 'active' AND h.inventory_sharing_enabled
       AND r.effective_from <= now() AND (r.effective_until IS NULL OR r.effective_until > now())
       AND src.status = 'active' AND src.inventory_feed_enabled AND src.group_id = h.group_id
       AND ((p_channel = 'connect_card' AND r.connect_card) OR (p_channel = 'customer_room' AND r.customer_room))
  ), visible AS (
    SELECT si.*, 0 AS tier, 0 AS source_priority, true AS show_prices, true AS show_details FROM store_inventory si
     WHERE si.store_id = h.id AND si.presence = 'present' AND v_scope IN ('all','home')
    UNION ALL
    SELECT si.*, 1, r.priority, r.show_prices, r.show_details FROM store_inventory si JOIN rules r ON r.source_store_id = si.store_id
     WHERE si.presence = 'present' AND v_scope IN ('all','additional')
       AND ((si.condition = 'new' AND r.include_new) OR (si.condition = 'used' AND r.include_used) OR (si.condition = 'cpo' AND r.include_certified))
  ), filtered AS (
    SELECT v.* FROM visible v
     WHERE (v_cond IS NULL OR v.condition = v_cond)
       AND (v_make IS NULL OR lower(v.make) = v_make)
       AND (v_model IS NULL OR lower(v.model) = v_model)
       AND (v_max IS NULL OR (v.show_prices AND v.feed_price_status = 'known' AND v.feed_price <= v_max))
  ), ranked AS (
    SELECT f.*, row_number() OVER (ORDER BY f.tier, f.source_priority, f.store_id,
             (f.photo_count > 0) DESC, (f.feed_price_status = 'known') DESC, f.inventory_date DESC NULLS LAST, f.vin) AS rank
      FROM filtered f
  )
  SELECT (SELECT count(*) FROM ranked),
         COALESCE(jsonb_agg(jsonb_build_object(
           'id', r.id, 'rank', r.rank,
           'inventory_group', CASE WHEN r.tier = 0 THEN 'home' ELSE 'additional' END,
           'owning_store', jsonb_build_object('id', s.id, 'name', s.display_name, 'city', s.city, 'state', s.state),
           'vin', r.vin, 'stock_number', r.stock_number, 'condition', r.condition, 'certified', r.certified,
           'year', r.year, 'make', r.make, 'model', r.model, 'trim', r.trim, 'mileage', r.mileage,
           'exterior_color', CASE WHEN r.show_details THEN r.exterior_color END,
           'interior_color', CASE WHEN r.show_details THEN r.interior_color END,
           'price', CASE WHEN r.show_prices AND r.feed_price_status = 'known' THEN r.feed_price END,
           'price_status', CASE WHEN NOT r.show_prices THEN 'hidden' ELSE r.feed_price_status END,
           'photo', CASE WHEN r.show_details THEN r.photos->>0 END,
           'photo_count', CASE WHEN r.show_details THEN r.photo_count ELSE 0 END,
           'enrichment_status', r.enrichment_status
         ) ORDER BY r.rank), '[]'::jsonb)
    INTO v_total, v_rows
    FROM (SELECT * FROM ranked ORDER BY rank LIMIT GREATEST(1, LEAST(p_limit, 60)) OFFSET GREATEST(0, p_offset)) r
    JOIN dealer_stores s ON s.id = r.store_id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', s.id, 'name', s.display_name, 'city', s.city, 'state', s.state, 'priority', r.priority) ORDER BY r.priority), '[]'::jsonb)
    INTO v_sources
    FROM inventory_sharing_rules r JOIN dealer_stores s ON s.id = r.source_store_id
   WHERE r.destination_store_id = h.id AND r.status = 'active' AND h.inventory_sharing_enabled
     AND r.effective_from <= now() AND (r.effective_until IS NULL OR r.effective_until > now())
     AND ((p_channel = 'connect_card' AND r.connect_card) OR (p_channel = 'customer_room' AND r.customer_room));

  RETURN jsonb_build_object('enabled', true,
    'home_store', jsonb_build_object('id', h.id, 'name', h.display_name, 'city', h.city, 'state', h.state),
    'additional_sources', v_sources, 'total', v_total, 'vehicles', v_rows);
END $$;

CREATE OR REPLACE FUNCTION public.customer_origin_context(p_slug text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE l record; v_store uuid;
BEGIN
  SELECT vl.id, vl.tenant_id, vl.store_id, vl.vin, vl.ymm, vl.owning_store_id, vl.assigned_agent_id INTO l
    FROM vehicle_listings vl WHERE vl.slug = p_slug AND vl.status = 'published' LIMIT 1;
  IF l.id IS NULL THEN RETURN NULL; END IF;
  v_store := l.owning_store_id;
  IF v_store IS NULL THEN
    SELECT s.id INTO v_store FROM dealer_stores s JOIN dealer_groups g ON g.id = s.group_id
     WHERE g.tenant_id = l.tenant_id AND s.is_primary_inventory_store AND s.status = 'active';
  END IF;
  IF v_store IS NULL THEN RETURN NULL; END IF;
  RETURN jsonb_build_object('listing_id', l.id, 'tenant_id', l.tenant_id, 'store_id', l.store_id, 'vin', l.vin, 'ymm', l.ymm,
                            'home_store_id', v_store, 'assigned_agent_id', l.assigned_agent_id);
END $$;

CREATE OR REPLACE FUNCTION public.customer_group_inventory(p_slug text, p_channel text, p_filters jsonb DEFAULT '{}'::jsonb, p_limit integer DEFAULT 24, p_offset integer DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE o jsonb; h public.dealer_stores%ROWTYPE;
BEGIN
  o := customer_origin_context(p_slug);
  IF o IS NULL THEN RETURN jsonb_build_object('enabled', false, 'reason', 'no_origin'); END IF;
  SELECT * INTO h FROM dealer_stores WHERE id = (o->>'home_store_id')::uuid;
  IF h.subscription_status <> 'subscribed' OR NOT h.customer_browser_enabled THEN
    RETURN jsonb_build_object('enabled', false, 'reason', 'browser_not_enabled');
  END IF;
  RETURN group_inventory_core(h.id, p_channel, p_filters, p_limit, p_offset)
    || jsonb_build_object('origin', jsonb_build_object('slug', p_slug, 'assigned_agent_id', o->>'assigned_agent_id'));
END $$;

CREATE OR REPLACE FUNCTION public.group_inventory_visible(p_home_store_id uuid, p_channel text, p_inventory_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM store_inventory si JOIN dealer_stores h ON h.id = p_home_store_id
     WHERE si.id = p_inventory_id AND si.presence = 'present' AND h.status = 'active'
       AND (si.store_id = h.id OR EXISTS (
         SELECT 1 FROM inventory_sharing_rules r JOIN dealer_stores src ON src.id = r.source_store_id
          WHERE r.destination_store_id = h.id AND r.source_store_id = si.store_id AND r.status = 'active' AND h.inventory_sharing_enabled
            AND r.effective_from <= now() AND (r.effective_until IS NULL OR r.effective_until > now())
            AND src.status = 'active' AND src.inventory_feed_enabled AND src.group_id = h.group_id
            AND ((p_channel = 'connect_card' AND r.connect_card) OR (p_channel = 'customer_room' AND r.customer_room))
            AND ((si.condition = 'new' AND r.include_new) OR (si.condition = 'used' AND r.include_used) OR (si.condition = 'cpo' AND r.include_certified))))
  )
$$;

CREATE OR REPLACE FUNCTION public.customer_group_inventory_vehicle(p_slug text, p_channel text, p_inventory_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE o jsonb; h public.dealer_stores%ROWTYPE; si public.store_inventory%ROWTYPE; s public.dealer_stores%ROWTYPE; r public.inventory_sharing_rules%ROWTYPE;
  v_prices boolean := true; v_details boolean := true;
BEGIN
  o := customer_origin_context(p_slug);
  IF o IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO h FROM dealer_stores WHERE id = (o->>'home_store_id')::uuid;
  IF h.subscription_status <> 'subscribed' OR NOT h.customer_browser_enabled THEN RETURN NULL; END IF;
  IF NOT group_inventory_visible(h.id, p_channel, p_inventory_id) THEN RETURN NULL; END IF;
  SELECT * INTO si FROM store_inventory WHERE id = p_inventory_id;
  SELECT * INTO s FROM dealer_stores WHERE id = si.store_id;
  IF si.store_id <> h.id THEN
    SELECT * INTO r FROM inventory_sharing_rules WHERE destination_store_id = h.id AND source_store_id = si.store_id AND status = 'active';
    v_prices := r.show_prices; v_details := r.show_details;
  END IF;
  RETURN jsonb_build_object(
    'id', si.id, 'inventory_group', CASE WHEN si.store_id = h.id THEN 'home' ELSE 'additional' END,
    'owning_store', jsonb_build_object('name', s.display_name, 'city', s.city, 'state', s.state),
    'home_store', jsonb_build_object('name', h.display_name, 'city', h.city, 'state', h.state),
    'origin', jsonb_build_object('slug', p_slug, 'assigned_agent_id', o->>'assigned_agent_id'),
    'vin', si.vin, 'stock_number', si.stock_number, 'condition', si.condition, 'certified', si.certified,
    'year', si.year, 'make', si.make, 'model', si.model, 'trim', si.trim, 'mileage', si.mileage,
    'price', CASE WHEN v_prices AND si.feed_price_status = 'known' THEN si.feed_price END,
    'price_status', CASE WHEN NOT v_prices THEN 'hidden' ELSE si.feed_price_status END,
    'msrp', CASE WHEN v_prices THEN si.msrp END,
    'exterior_color', CASE WHEN v_details THEN si.exterior_color END, 'interior_color', CASE WHEN v_details THEN si.interior_color END,
    'equipment', CASE WHEN v_details THEN si.equipment ELSE '[]'::jsonb END,
    'photos', CASE WHEN v_details THEN si.photos ELSE '[]'::jsonb END,
    'enrichment_status', si.enrichment_status, 'last_seen_at', si.last_seen_at);
END $$;

-- Records interest in a group vehicle as a lead of the ORIGINATING store and
-- listing, so the existing lead-alert routing sends it to the customer's own
-- salesperson. The sibling store learns nothing about the customer here.
CREATE OR REPLACE FUNCTION public.customer_group_inventory_interest(p_slug text, p_channel text, p_inventory_id uuid, p_name text, p_phone text DEFAULT NULL, p_email text DEFAULT NULL, p_message text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE o jsonb; h public.dealer_stores%ROWTYPE; si public.store_inventory%ROWTYPE; s public.dealer_stores%ROWTYPE;
  v_name text := left(trim(COALESCE(p_name, '')), 120); v_email text := lower(left(trim(COALESCE(p_email, '')), 200)); v_phone text := left(regexp_replace(COALESCE(p_phone, ''), '[^0-9+]', '', 'g'), 20);
  v_recent integer; v_lead uuid;
BEGIN
  IF length(v_name) < 2 OR (v_email = '' AND v_phone = '') THEN RETURN jsonb_build_object('ok', false, 'error', 'contact_required'); END IF;
  o := customer_origin_context(p_slug);
  IF o IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'not_found'); END IF;
  SELECT * INTO h FROM dealer_stores WHERE id = (o->>'home_store_id')::uuid;
  IF h.subscription_status <> 'subscribed' OR NOT h.customer_browser_enabled OR NOT group_inventory_visible(h.id, p_channel, p_inventory_id) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;
  SELECT count(*) INTO v_recent FROM leads WHERE tenant_id = (o->>'tenant_id')::uuid AND sub_source = 'group_inventory' AND created_at > now() - interval '1 hour'
     AND ((v_email <> '' AND lower(email) = v_email) OR (v_phone <> '' AND phone = v_phone));
  IF v_recent >= 5 THEN RETURN jsonb_build_object('ok', false, 'error', 'rate_limited'); END IF;
  SELECT * INTO si FROM store_inventory WHERE id = p_inventory_id;
  SELECT * INTO s FROM dealer_stores WHERE id = si.store_id;
  INSERT INTO leads (tenant_id, store_id, name, phone, email, vehicle_interest, vehicle_vin, source, sub_source, status, notes, routing)
  VALUES ((o->>'tenant_id')::uuid, NULLIF(o->>'store_id','')::uuid, v_name, NULLIF(v_phone, ''), NULLIF(v_email, ''),
    left(concat_ws(' ', si.year::text, si.make, si.model, si.trim) || ' at ' || s.display_name || COALESCE(', ' || s.city, '') || CASE WHEN si.store_id <> h.id THEN ' (additional group inventory)' ELSE '' END, 300),
    o->>'vin', 'website', 'group_inventory', 'new', left(p_message, 1000),
    jsonb_build_object('group_inventory', jsonb_build_object('origin_slug', p_slug, 'origin_listing_id', o->>'listing_id',
      'originating_store_id', h.id, 'owning_store_id', si.store_id, 'inventory_id', si.id, 'inventory_vin', si.vin, 'channel', p_channel,
      'origin_assigned_agent_id', o->>'assigned_agent_id')))
  RETURNING id INTO v_lead;
  RETURN jsonb_build_object('ok', true, 'lead_id', v_lead);
END $$;

-- ── Admin functions (platform admin, audited by row triggers) ──────────────

CREATE OR REPLACE FUNCTION public.inv_require_platform_admin() RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := (SELECT auth.uid());
BEGIN
  IF v_uid IS NULL OR NOT has_role(v_uid, 'admin'::app_role) THEN RAISE EXCEPTION 'platform_admin_required' USING ERRCODE = '42501'; END IF;
  RETURN v_uid;
END $$;

CREATE OR REPLACE FUNCTION public.inv_admin_save_store(p jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := inv_require_platform_admin(); v_id uuid := NULLIF(p->>'id','')::uuid; v_cur public.dealer_stores%ROWTYPE;
BEGIN
  IF v_id IS NULL THEN
    INSERT INTO dealer_stores (group_id, tenant_id, display_name, legal_name, street, city, state, zip, phone, website, subscription_status, provider_ids, created_by, updated_by)
    VALUES ((p->>'group_id')::uuid, (SELECT tenant_id FROM dealer_groups WHERE id = (p->>'group_id')::uuid), p->>'display_name', NULLIF(p->>'legal_name',''), NULLIF(p->>'street',''),
      NULLIF(p->>'city',''), NULLIF(upper(p->>'state'),''), NULLIF(p->>'zip',''), NULLIF(p->>'phone',''), NULLIF(p->>'website',''),
      COALESCE(p->>'subscription_status','unsubscribed'), COALESCE(p->'provider_ids','{}'::jsonb), v_uid, v_uid)
    RETURNING id INTO v_id;
    RETURN v_id;
  END IF;
  SELECT * INTO v_cur FROM dealer_stores WHERE id = v_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'store_not_found'; END IF;
  IF p ? 'expected_updated_at' AND (p->>'expected_updated_at')::timestamptz IS DISTINCT FROM v_cur.updated_at THEN
    RAISE EXCEPTION 'store_changed_since_loaded';
  END IF;
  UPDATE dealer_stores SET
    display_name = COALESCE(p->>'display_name', display_name),
    legal_name = CASE WHEN p ? 'legal_name' THEN NULLIF(p->>'legal_name','') ELSE legal_name END,
    street = CASE WHEN p ? 'street' THEN NULLIF(p->>'street','') ELSE street END,
    city = CASE WHEN p ? 'city' THEN NULLIF(p->>'city','') ELSE city END,
    state = CASE WHEN p ? 'state' THEN NULLIF(upper(p->>'state'),'') ELSE state END,
    zip = CASE WHEN p ? 'zip' THEN NULLIF(p->>'zip','') ELSE zip END,
    phone = CASE WHEN p ? 'phone' THEN NULLIF(p->>'phone','') ELSE phone END,
    website = CASE WHEN p ? 'website' THEN NULLIF(p->>'website','') ELSE website END,
    status = COALESCE(p->>'status', status),
    subscription_status = COALESCE(p->>'subscription_status', subscription_status),
    is_primary_inventory_store = COALESCE((p->>'is_primary_inventory_store')::boolean, is_primary_inventory_store),
    inventory_feed_enabled = COALESCE((p->>'inventory_feed_enabled')::boolean, inventory_feed_enabled),
    feed_import_paused = COALESCE((p->>'feed_import_paused')::boolean, feed_import_paused),
    inventory_sharing_enabled = COALESCE((p->>'inventory_sharing_enabled')::boolean, inventory_sharing_enabled),
    customer_browser_enabled = COALESCE((p->>'customer_browser_enabled')::boolean, customer_browser_enabled),
    listing_sync_enabled = COALESCE((p->>'listing_sync_enabled')::boolean, listing_sync_enabled),
    feed_price_updates_listing = COALESCE((p->>'feed_price_updates_listing')::boolean, feed_price_updates_listing),
    adopt_legacy_matches = COALESCE((p->>'adopt_legacy_matches')::boolean, adopt_legacy_matches),
    retirement_automation_enabled = COALESCE((p->>'retirement_automation_enabled')::boolean, retirement_automation_enabled),
    missing_snapshot_threshold = COALESCE((p->>'missing_snapshot_threshold')::integer, missing_snapshot_threshold),
    max_invalid_rows = COALESCE((p->>'max_invalid_rows')::integer, max_invalid_rows),
    provider_ids = COALESCE(p->'provider_ids', provider_ids),
    updated_by = v_uid
  WHERE id = v_id;
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.inv_admin_set_controls(p_ingestion_paused boolean, p_emergency_stop boolean, p_reconcile_enabled boolean, p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := inv_require_platform_admin();
BEGIN
  IF length(trim(COALESCE(p_reason, ''))) < 3 THEN RAISE EXCEPTION 'reason_required'; END IF;
  UPDATE inventory_feed_controls SET ingestion_paused = p_ingestion_paused, emergency_stop = p_emergency_stop, reconcile_enabled = p_reconcile_enabled,
    reason = left(p_reason, 300), updated_by = v_uid, updated_at = now() WHERE id = 1;
  IF p_emergency_stop THEN
    UPDATE inventory_feed_jobs SET status = 'cancelled', finished_at = now(), last_error = 'emergency_stop' WHERE status = 'queued';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.inv_admin_propose_mapping(p_source_dealer_id text, p_store_id uuid, p_observed_identity jsonb, p_evidence jsonb, p_note text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := inv_require_platform_admin(); v_id uuid; v_group uuid;
BEGIN
  SELECT group_id INTO v_group FROM dealer_stores WHERE id = p_store_id;
  IF v_group IS NULL THEN RAISE EXCEPTION 'store_not_found'; END IF;
  INSERT INTO inventory_source_mappings (source_dealer_id, group_id, store_id, observed_identity, evidence, note, proposed_by)
  VALUES (p_source_dealer_id, v_group, p_store_id, p_observed_identity, p_evidence, left(p_note, 300), v_uid)
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.inv_admin_decide_mapping(p_mapping_id uuid, p_decision text, p_acknowledge_identity boolean DEFAULT false, p_note text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := inv_require_platform_admin(); m public.inventory_source_mappings%ROWTYPE;
BEGIN
  SELECT * INTO m FROM inventory_source_mappings WHERE id = p_mapping_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'mapping_not_found'; END IF;
  IF p_decision = 'approve' THEN
    IF m.status <> 'pending' THEN RAISE EXCEPTION 'mapping_not_pending'; END IF;
    IF COALESCE(m.evidence->>'verdict', '') <> 'match' AND NOT p_acknowledge_identity THEN RAISE EXCEPTION 'identity_not_confirmed'; END IF;
    UPDATE inventory_source_mappings SET status = 'approved', approved_by = v_uid, approved_at = now(),
      identity_acknowledged = COALESCE(m.evidence->>'verdict', '') <> 'match', note = COALESCE(left(p_note, 300), note) WHERE id = m.id;
  ELSIF p_decision = 'reject' THEN
    IF m.status <> 'pending' THEN RAISE EXCEPTION 'mapping_not_pending'; END IF;
    UPDATE inventory_source_mappings SET status = 'rejected', revoked_by = v_uid, revoked_at = now(), note = COALESCE(left(p_note, 300), note) WHERE id = m.id;
  ELSIF p_decision = 'revoke' THEN
    IF m.status <> 'approved' THEN RAISE EXCEPTION 'mapping_not_approved'; END IF;
    -- Revoking stops future imports for this identity. Existing vehicles stay
    -- with their store; nothing is moved.
    UPDATE inventory_source_mappings SET status = 'revoked', revoked_by = v_uid, revoked_at = now(), note = COALESCE(left(p_note, 300), note) WHERE id = m.id;
  ELSE
    RAISE EXCEPTION 'bad_decision';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.inv_admin_save_sharing_rule(p jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := inv_require_platform_admin(); v_id uuid := NULLIF(p->>'id','')::uuid; v_group uuid;
BEGIN
  IF v_id IS NULL THEN
    SELECT group_id INTO v_group FROM dealer_stores WHERE id = (p->>'source_store_id')::uuid;
    INSERT INTO inventory_sharing_rules (group_id, source_store_id, destination_store_id, connect_card, customer_room, include_new, include_used, include_certified,
      priority, show_prices, show_details, effective_from, effective_until, note, created_by, updated_by)
    VALUES (v_group, (p->>'source_store_id')::uuid, (p->>'destination_store_id')::uuid,
      COALESCE((p->>'connect_card')::boolean, false), COALESCE((p->>'customer_room')::boolean, false),
      COALESCE((p->>'include_new')::boolean, true), COALESCE((p->>'include_used')::boolean, true), COALESCE((p->>'include_certified')::boolean, true),
      COALESCE((p->>'priority')::integer, 100), COALESCE((p->>'show_prices')::boolean, false), COALESCE((p->>'show_details')::boolean, true),
      COALESCE((p->>'effective_from')::timestamptz, now()), NULLIF(p->>'effective_until','')::timestamptz, left(p->>'note', 300), v_uid, v_uid)
    RETURNING id INTO v_id;
    RETURN v_id;
  END IF;
  UPDATE inventory_sharing_rules SET
    connect_card = COALESCE((p->>'connect_card')::boolean, connect_card), customer_room = COALESCE((p->>'customer_room')::boolean, customer_room),
    include_new = COALESCE((p->>'include_new')::boolean, include_new), include_used = COALESCE((p->>'include_used')::boolean, include_used),
    include_certified = COALESCE((p->>'include_certified')::boolean, include_certified), priority = COALESCE((p->>'priority')::integer, priority),
    show_prices = COALESCE((p->>'show_prices')::boolean, show_prices), show_details = COALESCE((p->>'show_details')::boolean, show_details),
    effective_until = CASE WHEN p ? 'effective_until' THEN NULLIF(p->>'effective_until','')::timestamptz ELSE effective_until END,
    note = CASE WHEN p ? 'note' THEN left(p->>'note', 300) ELSE note END, updated_by = v_uid
  WHERE id = v_id AND status = 'active';
  IF NOT FOUND THEN RAISE EXCEPTION 'sharing_rule_not_active'; END IF;
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.inv_admin_revoke_sharing_rule(p_rule_id uuid, p_note text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := inv_require_platform_admin();
BEGIN
  UPDATE inventory_sharing_rules SET status = 'revoked', revoked_by = v_uid, revoked_at = now(), updated_by = v_uid, note = COALESCE(left(p_note, 300), note)
   WHERE id = p_rule_id AND status = 'active';
  IF NOT FOUND THEN RAISE EXCEPTION 'sharing_rule_not_active'; END IF;
END $$;

CREATE OR REPLACE FUNCTION public.inv_admin_save_enrichment_policy(p jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := inv_require_platform_admin(); v_store uuid := (p->>'store_id')::uuid; v_products text[];
BEGIN
  IF NOT EXISTS (SELECT 1 FROM dealer_stores WHERE id = v_store) THEN RAISE EXCEPTION 'store_not_found'; END IF;
  IF p ? 'allowed_products' AND jsonb_typeof(p->'allowed_products') <> 'array' THEN RAISE EXCEPTION 'allowed_products_must_be_array'; END IF;
  v_products := COALESCE(ARRAY(SELECT jsonb_array_elements_text(COALESCE(p->'allowed_products', '[]'::jsonb))), '{}');
  INSERT INTO store_enrichment_policies (store_id, mode, budget_blocked, credential_ref, mc_rooftop_id, mc_rooftop_verified_at, mc_rooftop_verified_by,
    allowed_products, refresh_cadence_hours, freshness_hours, backfill_limit, per_run_limit, daily_request_limit, monthly_request_cap, monthly_usd_cap,
    warn_pct, hard_stop_pct, manual_refresh_allowed, enrich_shared_inventory, updated_by, updated_at)
  VALUES (v_store, COALESCE(p->>'mode','feed_only'), COALESCE((p->>'budget_blocked')::boolean, false), NULLIF(p->>'credential_ref',''), NULLIF(p->>'mc_rooftop_id',''),
    CASE WHEN (p->>'mc_rooftop_verified')::boolean THEN now() END, CASE WHEN (p->>'mc_rooftop_verified')::boolean THEN v_uid END,
    v_products, NULLIF(p->>'refresh_cadence_hours','')::integer, NULLIF(p->>'freshness_hours','')::integer,
    COALESCE((p->>'backfill_limit')::integer, 0), COALESCE((p->>'per_run_limit')::integer, 0), COALESCE((p->>'daily_request_limit')::integer, 0),
    COALESCE((p->>'monthly_request_cap')::integer, 0), NULLIF(p->>'monthly_usd_cap','')::numeric, COALESCE((p->>'warn_pct')::integer, 80),
    COALESCE((p->>'hard_stop_pct')::integer, 100), COALESCE((p->>'manual_refresh_allowed')::boolean, false), COALESCE((p->>'enrich_shared_inventory')::boolean, false), v_uid, now())
  ON CONFLICT (store_id) DO UPDATE SET
    mode = EXCLUDED.mode, budget_blocked = EXCLUDED.budget_blocked, credential_ref = EXCLUDED.credential_ref,
    mc_rooftop_verified_at = CASE WHEN EXCLUDED.mc_rooftop_id IS DISTINCT FROM store_enrichment_policies.mc_rooftop_id THEN EXCLUDED.mc_rooftop_verified_at
                                  ELSE COALESCE(EXCLUDED.mc_rooftop_verified_at, store_enrichment_policies.mc_rooftop_verified_at) END,
    mc_rooftop_verified_by = CASE WHEN EXCLUDED.mc_rooftop_id IS DISTINCT FROM store_enrichment_policies.mc_rooftop_id THEN EXCLUDED.mc_rooftop_verified_by
                                  ELSE COALESCE(EXCLUDED.mc_rooftop_verified_by, store_enrichment_policies.mc_rooftop_verified_by) END,
    mc_rooftop_id = EXCLUDED.mc_rooftop_id,
    allowed_products = EXCLUDED.allowed_products, refresh_cadence_hours = EXCLUDED.refresh_cadence_hours, freshness_hours = EXCLUDED.freshness_hours,
    backfill_limit = EXCLUDED.backfill_limit, per_run_limit = EXCLUDED.per_run_limit, daily_request_limit = EXCLUDED.daily_request_limit,
    monthly_request_cap = EXCLUDED.monthly_request_cap, monthly_usd_cap = EXCLUDED.monthly_usd_cap, warn_pct = EXCLUDED.warn_pct,
    hard_stop_pct = EXCLUDED.hard_stop_pct, manual_refresh_allowed = EXCLUDED.manual_refresh_allowed,
    enrich_shared_inventory = EXCLUDED.enrich_shared_inventory, updated_by = v_uid, updated_at = now();
END $$;

CREATE OR REPLACE FUNCTION public.inv_admin_resolve_conflict(p_conflict_id uuid, p_action text, p_note text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := inv_require_platform_admin(); c public.inventory_vin_conflicts%ROWTYPE; st public.dealer_stores%ROWTYPE;
BEGIN
  SELECT * INTO c FROM inventory_vin_conflicts WHERE id = p_conflict_id FOR UPDATE;
  IF NOT FOUND OR c.status <> 'open' THEN RAISE EXCEPTION 'conflict_not_open'; END IF;
  SELECT * INTO st FROM dealer_stores WHERE id = c.claiming_store_id;
  PERFORM set_config('app.inventory_writer', 'filescom_apply', true);
  IF p_action = 'transfer' AND c.kind = 'other_store' THEN
    -- Explicit transfer: the old store's record is closed as transferred; the
    -- claiming store's next applied snapshot creates its own record.
    UPDATE store_inventory SET presence = 'transferred', retired_at = now(), retired_by = v_uid, retire_reason = 'transferred_to_' || c.claiming_store_id::text
     WHERE id = c.existing_inventory_id;
    UPDATE vehicle_listings SET owning_store_id = NULL, inventory_record_id = NULL WHERE inventory_record_id = c.existing_inventory_id;
    UPDATE inventory_vin_conflicts SET status = 'transferred', resolved_by = v_uid, resolved_at = now(), note = left(p_note, 300) WHERE id = c.id;
  ELSIF p_action = 'adopt' AND c.kind = 'legacy_listing' THEN
    UPDATE vehicle_listings SET owning_store_id = c.claiming_store_id, inventory_record_id = c.existing_inventory_id, feed_source = 'filescom'
     WHERE id = c.existing_listing_id AND owning_store_id IS NULL;
    UPDATE store_inventory SET listing_id = c.existing_listing_id WHERE id = c.existing_inventory_id;
    UPDATE inventory_vin_conflicts SET status = 'adopted', resolved_by = v_uid, resolved_at = now(), note = left(p_note, 300) WHERE id = c.id;
  ELSIF p_action = 'dismiss' THEN
    UPDATE inventory_vin_conflicts SET status = 'dismissed', resolved_by = v_uid, resolved_at = now(), note = left(p_note, 300) WHERE id = c.id;
  ELSE
    RAISE EXCEPTION 'bad_conflict_action';
  END IF;
  INSERT INTO inventory_network_audit (actor, group_id, store_id, entity, entity_id, action, after)
  VALUES (v_uid, c.group_id, c.claiming_store_id, 'inventory_vin_conflicts', c.id::text, 'resolve_' || p_action, jsonb_build_object('vin', c.vin, 'kind', c.kind, 'note', p_note));
END $$;

CREATE OR REPLACE FUNCTION public.inv_admin_review_retirement(p_inventory_id uuid, p_action text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := inv_require_platform_admin(); si public.store_inventory%ROWTYPE;
BEGIN
  SELECT * INTO si FROM store_inventory WHERE id = p_inventory_id FOR UPDATE;
  IF NOT FOUND OR si.presence <> 'retirement_review' THEN RAISE EXCEPTION 'not_in_retirement_review'; END IF;
  IF p_action = 'retire' THEN
    UPDATE store_inventory SET presence = 'retired', retired_at = now(), retired_by = v_uid, retire_reason = 'reviewed_absent_from_feed' WHERE id = si.id;
  ELSIF p_action = 'keep' THEN
    UPDATE store_inventory SET presence = 'missing', missing_snapshots = 0 WHERE id = si.id;
  ELSE RAISE EXCEPTION 'bad_retirement_action'; END IF;
  INSERT INTO inventory_network_audit (actor, group_id, store_id, entity, entity_id, action, after)
  VALUES (v_uid, si.group_id, si.store_id, 'store_inventory', si.id::text, 'retirement_' || p_action, jsonb_build_object('vin', si.vin));
END $$;

CREATE OR REPLACE FUNCTION public.inv_admin_retry_job(p_job_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := inv_require_platform_admin(); j public.inventory_feed_jobs%ROWTYPE;
BEGIN
  SELECT * INTO j FROM inventory_feed_jobs WHERE id = p_job_id;
  IF NOT FOUND OR j.status NOT IN ('failed','dead','cancelled') THEN RAISE EXCEPTION 'job_not_retryable'; END IF;
  RETURN inventory_feed_enqueue(j.path, 'retry', v_uid, NULL);
END $$;

CREATE OR REPLACE FUNCTION public.inv_admin_enqueue_import(p_path text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := inv_require_platform_admin();
BEGIN
  RETURN inventory_feed_enqueue(p_path, 'manual', v_uid, NULL);
END $$;

CREATE OR REPLACE FUNCTION public.inv_admin_preview_customer_inventory(p_home_store_id uuid, p_channel text, p_filters jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM inv_require_platform_admin();
  RETURN group_inventory_core(p_home_store_id, p_channel, p_filters, 60, 0);
END $$;

-- Read models for the admin console: live counts only, nothing invented.
CREATE OR REPLACE FUNCTION public.inv_admin_overview(p_group_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM inv_require_platform_admin();
  RETURN (SELECT jsonb_build_object(
    'group', (SELECT to_jsonb(g) FROM dealer_groups g WHERE g.id = p_group_id),
    'controls', (SELECT to_jsonb(c) FROM inventory_feed_controls c WHERE c.id = 1),
    'stores', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'store', to_jsonb(s),
        'state', (SELECT to_jsonb(ss) FROM inventory_store_state ss WHERE ss.store_id = s.id),
        'policy', (SELECT to_jsonb(p) FROM store_enrichment_policies p WHERE p.store_id = s.id),
        'counts', (SELECT jsonb_build_object(
            'present', count(*) FILTER (WHERE presence = 'present'),
            'missing', count(*) FILTER (WHERE presence = 'missing'),
            'retirement_review', count(*) FILTER (WHERE presence = 'retirement_review'),
            'retired', count(*) FILTER (WHERE presence = 'retired'),
            'price_unknown', count(*) FILTER (WHERE presence = 'present' AND feed_price_status <> 'known'),
            'no_photos', count(*) FILTER (WHERE presence = 'present' AND photo_count = 0))
          FROM store_inventory si WHERE si.store_id = s.id),
        'mappings', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', m.id, 'source_dealer_id', m.source_dealer_id, 'status', m.status, 'approved_at', m.approved_at) ORDER BY m.created_at)
          FROM inventory_source_mappings m WHERE m.store_id = s.id AND m.status IN ('pending','approved')), '[]'::jsonb),
        'open_conflicts', (SELECT count(*) FROM inventory_vin_conflicts c WHERE c.claiming_store_id = s.id AND c.status = 'open'),
        'last_snapshot', (SELECT jsonb_build_object('id', x.id, 'status', x.status, 'reason', x.reason, 'created_at', x.created_at, 'run_id', x.run_id)
          FROM inventory_store_snapshots x WHERE x.store_id = s.id ORDER BY x.created_at DESC LIMIT 1),
        'sharing_out', (SELECT count(*) FROM inventory_sharing_rules r WHERE r.source_store_id = s.id AND r.status = 'active'),
        'sharing_in', (SELECT count(*) FROM inventory_sharing_rules r WHERE r.destination_store_id = s.id AND r.status = 'active')
      ) ORDER BY s.is_primary_inventory_store DESC, s.display_name) FROM dealer_stores s WHERE s.group_id = p_group_id), '[]'::jsonb),
    'exceptions', jsonb_build_object(
      'open_conflicts', (SELECT count(*) FROM inventory_vin_conflicts WHERE group_id = p_group_id AND status = 'open'),
      'retirement_review', (SELECT count(*) FROM store_inventory WHERE group_id = p_group_id AND presence = 'retirement_review'),
      'quarantined_partitions_7d', (SELECT count(*) FROM inventory_store_snapshots WHERE (group_id = p_group_id OR group_id IS NULL) AND status = 'quarantined' AND created_at > now() - interval '7 days'),
      'failed_jobs', (SELECT count(*) FROM inventory_feed_jobs WHERE status IN ('failed','dead')),
      'pending_mappings', (SELECT count(*) FROM inventory_source_mappings WHERE group_id = p_group_id AND status = 'pending'))
  ));
END $$;

CREATE OR REPLACE FUNCTION public.inv_admin_usage(p_store_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM inv_require_platform_admin();
  RETURN jsonb_build_object(
    'today', (SELECT jsonb_build_object('admitted', count(*) FILTER (WHERE outcome = 'admitted'), 'denied', count(*) FILTER (WHERE outcome = 'denied'))
      FROM store_provider_usage WHERE store_id = p_store_id AND at >= date_trunc('day', now())),
    'month', (SELECT jsonb_build_object('admitted', count(*) FILTER (WHERE outcome = 'admitted'), 'denied', count(*) FILTER (WHERE outcome = 'denied'),
        'estimated_usd', COALESCE(sum(estimated_cost_usd) FILTER (WHERE outcome = 'admitted'), 0),
        'actual_usd', sum(actual_cost_usd) FILTER (WHERE outcome = 'admitted'),
        'unpriced_calls', count(*) FILTER (WHERE outcome = 'admitted' AND cost_basis = 'unpriced'))
      FROM store_provider_usage WHERE store_id = p_store_id AND at >= date_trunc('month', now())),
    'by_product', COALESCE((SELECT jsonb_agg(x) FROM (SELECT product, reason, outcome, deny_reason, count(*) AS calls, COALESCE(sum(estimated_cost_usd), 0) AS estimated_usd
      FROM store_provider_usage WHERE store_id = p_store_id AND at >= date_trunc('month', now()) GROUP BY 1,2,3,4 ORDER BY 5 DESC LIMIT 50) x), '[]'::jsonb),
    'queued_requests', (SELECT count(*) FROM store_enrichment_requests WHERE store_id = p_store_id AND status = 'queued'));
END $$;

CREATE OR REPLACE FUNCTION public.inv_admin_preview_context(p_store_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_tenant uuid;
BEGIN
  PERFORM inv_require_platform_admin();
  SELECT tenant_id INTO v_tenant FROM dealer_stores WHERE id = p_store_id;
  RETURN jsonb_build_object('agents', COALESCE((
    SELECT jsonb_agg(jsonb_build_object('id', a->>'id', 'name', a->>'name', 'title', a->>'title', 'status', a->>'status'))
      FROM dealer_profiles dp, jsonb_array_elements(CASE WHEN jsonb_typeof(dp.settings->'passport_agents') = 'array' THEN dp.settings->'passport_agents' ELSE '[]'::jsonb END) a
     WHERE dp.tenant_id = v_tenant), '[]'::jsonb));
END $$;

-- Store admins of a group may queue an approved refresh for their own store;
-- the request is checked again by store_enrichment_admit when it runs.
CREATE OR REPLACE FUNCTION public.inv_store_request_enrichment(p_inventory_id uuid, p_product text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := (SELECT auth.uid()); si public.store_inventory%ROWTYPE; st public.dealer_stores%ROWTYPE; p public.store_enrichment_policies%ROWTYPE; v_id uuid;
BEGIN
  SELECT * INTO si FROM store_inventory WHERE id = p_inventory_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
  SELECT * INTO st FROM dealer_stores WHERE id = si.store_id;
  IF NOT (has_role(v_uid, 'admin'::app_role) OR tenant_role_in(st.tenant_id, ARRAY['owner','admin','general_manager','inventory_manager'])) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO p FROM store_enrichment_policies WHERE store_id = st.id;
  IF NOT FOUND OR p.mode <> 'enrichment' THEN RETURN jsonb_build_object('queued', false, 'reason', 'feed_only'); END IF;
  IF NOT p.manual_refresh_allowed THEN RETURN jsonb_build_object('queued', false, 'reason', 'manual_refresh_not_allowed'); END IF;
  IF NOT (p_product = ANY (p.allowed_products)) THEN RETURN jsonb_build_object('queued', false, 'reason', 'product_not_approved'); END IF;
  INSERT INTO store_enrichment_requests (store_id, inventory_id, vin, product, reason, requested_by)
  VALUES (st.id, si.id, si.vin, p_product, 'manual_refresh', v_uid)
  ON CONFLICT (store_id, vin, product) WHERE status = 'queued' DO NOTHING RETURNING id INTO v_id;
  RETURN jsonb_build_object('queued', v_id IS NOT NULL, 'reason', CASE WHEN v_id IS NULL THEN 'already_queued' END);
END $$;

-- ── Scheduling (run explicitly by a platform admin; not executed here) ─────

CREATE OR REPLACE FUNCTION public.schedule_files_inventory_worker(_cron_expr text DEFAULT '*/10 * * * *')
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, vault, cron AS $$
DECLARE url text; key text; job_id bigint;
BEGIN
  SELECT decrypted_secret INTO url FROM vault.decrypted_secrets WHERE name = 'supabase_url' LIMIT 1;
  SELECT decrypted_secret INTO key FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1;
  IF url IS NULL OR key IS NULL THEN RAISE EXCEPTION 'supabase_url and service_role_key Vault entries required'; END IF;
  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'files-inventory-worker';
  SELECT cron.schedule('files-inventory-worker', _cron_expr, format(
    $job$ SELECT net.http_post(url := %L, headers := jsonb_build_object('Content-Type','application/json','Authorization',%L), body := '{"reconcile":true}'::jsonb, timeout_milliseconds := 120000); $job$,
    url || '/functions/v1/files-inventory-worker', 'Bearer ' || key)) INTO job_id;
  RETURN job_id;
END $$;

CREATE OR REPLACE FUNCTION public.unschedule_files_inventory_worker()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, cron AS $$
BEGIN PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'files-inventory-worker'; END $$;

-- ── Function privileges ────────────────────────────────────────────────────

REVOKE ALL ON FUNCTION public.inventory_feed_enqueue(text, text, uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.inventory_feed_claim_jobs(integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.inventory_feed_claim_job(uuid, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.inventory_feed_finish_job(uuid, uuid, text, text, boolean, jsonb, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.inventory_feed_claim_version(text, text, bigint, timestamptz, text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.inventory_apply_store_snapshot(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.store_enrichment_admit(uuid, text, text, text, text, numeric) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.group_inventory_core(uuid, text, jsonb, integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.group_inventory_visible(uuid, text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.customer_origin_context(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.schedule_files_inventory_worker(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.unschedule_files_inventory_worker() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.inventory_feed_enqueue(text, text, uuid, uuid), public.inventory_feed_claim_jobs(integer, integer), public.inventory_feed_claim_job(uuid, integer),
  public.inventory_feed_finish_job(uuid, uuid, text, text, boolean, jsonb, uuid, text), public.inventory_feed_claim_version(text, text, bigint, timestamptz, text, uuid),
  public.inventory_apply_store_snapshot(uuid), public.store_enrichment_admit(uuid, text, text, text, text, numeric),
  public.group_inventory_core(uuid, text, jsonb, integer, integer), public.group_inventory_visible(uuid, text, uuid), public.customer_origin_context(text),
  public.schedule_files_inventory_worker(text), public.unschedule_files_inventory_worker() TO service_role;

REVOKE ALL ON FUNCTION public.customer_group_inventory(text, text, jsonb, integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.customer_group_inventory_vehicle(text, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.customer_group_inventory_interest(text, text, uuid, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.customer_group_inventory(text, text, jsonb, integer, integer), public.customer_group_inventory_vehicle(text, text, uuid),
  public.customer_group_inventory_interest(text, text, uuid, text, text, text, text) TO anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.inv_require_platform_admin() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.inv_admin_save_store(jsonb), public.inv_admin_set_controls(boolean, boolean, boolean, text),
  public.inv_admin_propose_mapping(text, uuid, jsonb, jsonb, text), public.inv_admin_decide_mapping(uuid, text, boolean, text),
  public.inv_admin_save_sharing_rule(jsonb), public.inv_admin_revoke_sharing_rule(uuid, text), public.inv_admin_save_enrichment_policy(jsonb),
  public.inv_admin_resolve_conflict(uuid, text, text), public.inv_admin_review_retirement(uuid, text), public.inv_admin_retry_job(uuid),
  public.inv_admin_enqueue_import(text), public.inv_admin_preview_customer_inventory(uuid, text, jsonb), public.inv_store_request_enrichment(uuid, text),
  public.inv_admin_overview(uuid), public.inv_admin_usage(uuid), public.inv_admin_preview_context(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.inv_require_platform_admin(), public.inv_admin_save_store(jsonb), public.inv_admin_set_controls(boolean, boolean, boolean, text),
  public.inv_admin_propose_mapping(text, uuid, jsonb, jsonb, text), public.inv_admin_decide_mapping(uuid, text, boolean, text),
  public.inv_admin_save_sharing_rule(jsonb), public.inv_admin_revoke_sharing_rule(uuid, text), public.inv_admin_save_enrichment_policy(jsonb),
  public.inv_admin_resolve_conflict(uuid, text, text), public.inv_admin_review_retirement(uuid, text), public.inv_admin_retry_job(uuid),
  public.inv_admin_enqueue_import(text), public.inv_admin_preview_customer_inventory(uuid, text, jsonb), public.inv_store_request_enrichment(uuid, text),
  public.inv_admin_overview(uuid), public.inv_admin_usage(uuid), public.inv_admin_preview_context(uuid) TO authenticated;
