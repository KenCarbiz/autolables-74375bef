-- -- Inventory duplicate reconciliation ----------------------------------------
--
-- Detect -> immutable preview -> approve -> apply -> archive. Permanent purge is
-- not implemented: purge_enabled is pinned false by a CHECK constraint and
-- inv_dedupe_purge_check only reports why a record is not eligible.
--
-- Depends on 0012 (inventory_apply_store_snapshot reads max_snapshot_shrink_pct).
--
-- Entities kept separate:
--   vehicle identity/specs  vehicle_source_records, vehicle_facts (tenant + exact VIN)
--   store ownership         dealer_stores, inventory_source_mappings, vehicle_listings.owning_store_id
--   inventory episode       store_inventory row (one live row per group + VIN)
--   public identity         vehicle_listings.id / slug, qr_codes, passport_engagement
--   source observations     inventory_store_snapshots, inventory_snapshot_vehicles
--   documents and activity  documents, signatures, leads, engagement (never moved or edited)
--
-- Production already enforces uq_vehicle_listings_tenant_vin, so one tenant
-- holds at most one listing per normalized VIN. The listing-archive path below
-- applies only where that index is absent; the link, episode and ownership
-- paths apply everywhere.
--
-- Reconciliation never deletes a row, never re-points history (documents,
-- signatures, facts and source records stay on the record they were created
-- for), never calls a provider, and never touches storage objects.

-- -- Listing columns --------------------------------------------------------

ALTER TABLE public.vehicle_listings
  ADD COLUMN IF NOT EXISTS archive_reason text,
  ADD COLUMN IF NOT EXISTS reconciled_into_listing_id uuid REFERENCES public.vehicle_listings(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS reconciliation_operation_id uuid;
CREATE INDEX IF NOT EXISTS idx_vehicle_listings_reconciled_into ON public.vehicle_listings (reconciled_into_listing_id) WHERE reconciled_into_listing_id IS NOT NULL;

ALTER TABLE public.inventory_vin_conflicts DROP CONSTRAINT IF EXISTS inventory_vin_conflicts_kind_check;
ALTER TABLE public.inventory_vin_conflicts ADD CONSTRAINT inventory_vin_conflicts_kind_check
  CHECK (kind IN ('other_store','legacy_listing','other_store_listing','archived_listing','reconciled_listing_unresolved'));

CREATE OR REPLACE FUNCTION public.inv_dedupe_norm_vin(p text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$ SELECT NULLIF(upper(trim(p)), '') $$;

-- Shared by the feed apply and reconciliation so they never interleave on one
-- tenant + VIN. Lock order rule, to avoid deadlocks with the feed apply (which
-- takes these locks in snapshot row_number order and holds them to commit):
-- take this advisory lock BEFORE any row lock on vehicle_listings or
-- store_inventory, and hold at most one VIN per transaction. A caller that
-- ever needs several VINs in one transaction must lock them in sorted VIN order.
CREATE OR REPLACE FUNCTION public.inv_dedupe_lock(p_tenant_id uuid, p_vin text) RETURNS void
LANGUAGE sql VOLATILE AS $$ SELECT pg_advisory_xact_lock(hashtextextended('inv_listing:' || p_tenant_id::text || ':' || upper(trim(p_vin)), 0)) $$;

-- The feed guard also lets reconciliation set the reciprocal links.
CREATE OR REPLACE FUNCTION public.vehicle_listings_store_feed_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF OLD.owning_store_id IS NULL OR current_setting('app.inventory_writer', true) IN ('filescom_apply', 'inventory_reconcile') THEN
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

-- A reconciled duplicate stays archived. Only a reviewed undo may reopen it.
CREATE OR REPLACE FUNCTION public.vehicle_listings_reconciled_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF OLD.reconciled_into_listing_id IS NOT NULL
     AND current_setting('app.inventory_writer', true) IS DISTINCT FROM 'inventory_reconcile'
     AND (NEW.status IS DISTINCT FROM 'archived' OR NEW.reconciled_into_listing_id IS DISTINCT FROM OLD.reconciled_into_listing_id
          OR NEW.inventory_record_id IS DISTINCT FROM OLD.inventory_record_id) THEN
    RAISE EXCEPTION 'listing_reconciled_archived' USING ERRCODE = '42501',
      DETAIL = 'This listing was archived as a duplicate of ' || OLD.reconciled_into_listing_id::text || '. Use the reviewed recovery flow.';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS vehicle_listings_reconciled_guard ON public.vehicle_listings;
CREATE TRIGGER vehicle_listings_reconciled_guard BEFORE UPDATE ON public.vehicle_listings
  FOR EACH ROW EXECUTE FUNCTION public.vehicle_listings_reconciled_guard();

-- -- Controls -----------------------------------------------------------------

CREATE TABLE public.inventory_dedupe_controls (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  detection_enabled boolean NOT NULL DEFAULT true,
  auto_reconcile_enabled boolean NOT NULL DEFAULT false,
  -- Permanent purge needs an approved retention policy that does not exist yet.
  -- Enabling it is a schema change, not a toggle.
  purge_enabled boolean NOT NULL DEFAULT false CHECK (purge_enabled = false),
  emergency_stop boolean NOT NULL DEFAULT false,
  -- Proposed values, inert until an owner approves them (limits_approved_at).
  max_sets_per_run integer NOT NULL DEFAULT 5 CHECK (max_sets_per_run BETWEEN 1 AND 100),
  max_store_share_pct numeric(5,2) NOT NULL DEFAULT 2 CHECK (max_store_share_pct > 0 AND max_store_share_pct <= 25),
  max_unresolved_conflicts integer NOT NULL DEFAULT 10 CHECK (max_unresolved_conflicts >= 0),
  max_failures integer NOT NULL DEFAULT 1 CHECK (max_failures >= 0),
  preview_ttl_minutes integer NOT NULL DEFAULT 60 CHECK (preview_ttl_minutes BETWEEN 5 AND 1440),
  approval_ttl_minutes integer NOT NULL DEFAULT 30 CHECK (approval_ttl_minutes BETWEEN 5 AND 1440),
  limits_approved_at timestamptz,
  limits_approved_by uuid,
  reason text,
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT inventory_dedupe_auto_needs_limits CHECK (NOT auto_reconcile_enabled OR limits_approved_at IS NOT NULL)
);
INSERT INTO public.inventory_dedupe_controls (id, emergency_stop, reason) VALUES (1, true, 'Initial rollout: detection only. Emergency stop on, automatic reconciliation off, purge off.')
ON CONFLICT (id) DO NOTHING;

CREATE TABLE public.inventory_dedupe_store_controls (
  store_id uuid PRIMARY KEY REFERENCES public.dealer_stores(id) ON DELETE RESTRICT,
  paused boolean NOT NULL DEFAULT false,
  reason text,
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Every place a listing is referenced. class decides what a reference on the
-- redundant record means:
--   protected        signed or customer history: keep it where it is, and block
--                    automatic archive of the record that holds it
--   public_identity  someone outside may hold this record's URL or QR: block
--   evidence         provider or source evidence: stays attached; block when
--                    only the redundant record has it (held for review)
--   side_effect      rows that archiving would change through triggers: block
--   link             reciprocal inventory links that reconciliation maintains
-- A registered table that does not exist, or cannot be read, is "unchecked",
-- and unchecked blocks automatic reconciliation.
CREATE TABLE public.inventory_dedupe_dependency_registry (
  table_name text NOT NULL,
  column_name text NOT NULL,
  key_kind text NOT NULL CHECK (key_kind IN ('listing_uuid','listing_text','slug')),
  class text NOT NULL CHECK (class IN ('protected','public_identity','evidence','side_effect','link')),
  filter_sql text,
  label text NOT NULL,
  PRIMARY KEY (table_name, column_name)
);
INSERT INTO public.inventory_dedupe_dependency_registry (table_name, column_name, key_kind, class, filter_sql, label) VALUES
  ('addendum_signings','vehicle_listing_id','listing_uuid','protected',NULL,'Addendum signings'),
  ('signature_evidence','vehicle_id','listing_uuid','protected',NULL,'Signature evidence'),
  ('vehicle_documents','vehicle_listing_id','listing_uuid','protected',NULL,'Vehicle documents'),
  ('document_assets','vehicle_id','listing_uuid','protected',NULL,'Document assets'),
  ('generated_documents','vehicle_id','listing_uuid','protected',NULL,'Generated documents'),
  ('dept_signoff_tokens','vehicle_listing_id','listing_uuid','protected',NULL,'Department sign-off tokens'),
  ('detail_signoffs','vehicle_listing_id','listing_uuid','protected',NULL,'Detail sign-offs'),
  ('pdi_signoffs','vehicle_listing_id','listing_uuid','protected',NULL,'PDI sign-offs'),
  ('safety_inspections','vehicle_listing_id','listing_uuid','protected',NULL,'Safety inspections'),
  ('recall_service_tasks','vehicle_listing_id','listing_uuid','protected',NULL,'Recall service tasks'),
  ('service_requests','vehicle_listing_id','listing_uuid','protected',NULL,'Service requests'),
  ('recon_estimates','vehicle_listing_id','listing_uuid','protected',NULL,'Recon estimates'),
  ('vehicle_change_history','vehicle_listing_id','listing_uuid','protected',NULL,'Vehicle change history'),
  ('vehicle_exceptions','vehicle_listing_id','listing_uuid','protected',NULL,'Vehicle exceptions'),
  ('vehicle_work_events','listing_id','listing_uuid','protected',NULL,'Work events'),
  ('document_lifecycle_events','vehicle_id','listing_uuid','protected',NULL,'Document lifecycle events'),
  ('oem_distribution_events','vehicle_listing_id','listing_uuid','protected',NULL,'OEM distribution events'),
  ('used_vehicle_inspections','vehicle_id','listing_uuid','protected',NULL,'Used vehicle inspections'),
  ('used_vehicle_investment_items','vehicle_id','listing_uuid','protected',NULL,'Used vehicle investment items'),
  ('dealer_work_items','vehicle_id','listing_uuid','protected',NULL,'Dealer work items'),
  ('vehicle_addendums','vehicle_id','listing_uuid','protected',NULL,'Vehicle addendums'),
  ('ct_mvp_certification_runs','vehicle_id','listing_uuid','protected',NULL,'CT certification runs'),
  ('customer_engagement_events','vehicle_id','listing_text','public_identity',NULL,'Customer engagement events'),
  ('passport_document_delivery_requests','vehicle_id','listing_text','protected',NULL,'Passport document deliveries'),
  ('qr_codes','vehicle_id','listing_uuid','public_identity',NULL,'QR codes'),
  ('qr_scan_events','vehicle_id','listing_uuid','public_identity',NULL,'QR scans'),
  ('passport_engagement','slug','slug','public_identity',NULL,'Passport engagement'),
  ('price_watchers','slug','slug','public_identity',NULL,'Price watchers'),
  ('addendums','listing_slug','slug','protected',NULL,'Addendums by slug'),
  ('vehicle_source_records','vehicle_id','listing_uuid','evidence',NULL,'Provider source records'),
  ('vehicle_facts','vehicle_id','listing_uuid','evidence',NULL,'Vehicle facts'),
  ('vehicle_snapshots','vehicle_id','listing_uuid','evidence',NULL,'Vehicle snapshots'),
  ('vehicle_fact_conflicts','vehicle_id','listing_uuid','evidence',NULL,'Fact conflicts'),
  ('neovin_snapshots','vehicle_id','listing_uuid','evidence',NULL,'NeoVIN snapshots'),
  ('vehicle_market_valuations','listing_id','listing_uuid','evidence',NULL,'Market valuations'),
  ('market_pricing_legacy_payloads','listing_id','listing_uuid','evidence',NULL,'Legacy market pricing payloads'),
  ('vehicle_ingest_ledger','vehicle_id','listing_uuid','evidence',NULL,'Ingest ledger'),
  ('vehicle_lifecycle','vehicle_id','listing_uuid','evidence',NULL,'Vehicle lifecycle'),
  ('used_vehicle_inspection_photos','vehicle_id','listing_uuid','evidence',NULL,'Inspection photos'),
  ('factory_sticker_records','vehicle_id','listing_uuid','side_effect',$f$generation_status NOT IN ('ARCHIVED','SUPERSEDED')$f$,'Active factory sticker records'),
  ('description_cases','vehicle_id','listing_uuid','side_effect','archived_at IS NULL','Active description cases'),
  ('description_jobs','vehicle_id','listing_uuid','evidence',NULL,'Description jobs'),
  ('stale_document_flags','vehicle_id','listing_uuid','evidence',NULL,'Stale document flags'),
  ('store_inventory','listing_id','listing_uuid','link',NULL,'Store inventory link'),
  ('inventory_vin_conflicts','existing_listing_id','listing_uuid','link',NULL,'Inventory conflicts');

-- -- Candidates, previews, operations ----------------------------------------

CREATE TABLE public.inventory_dedupe_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES public.dealer_groups(id),
  tenant_id uuid NOT NULL,
  store_id uuid REFERENCES public.dealer_stores(id),
  vin text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('duplicate_listings','unlinked_inventory','archived_episode','broken_link','cross_tenant','store_identity')),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved')),
  disposition text NOT NULL CHECK (disposition IN ('eligible','needs_review','blocked')),
  reasons text[] NOT NULL DEFAULT '{}',
  summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_checked_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);
CREATE UNIQUE INDEX inventory_dedupe_candidates_open ON public.inventory_dedupe_candidates (group_id, vin, kind) WHERE status = 'open';

CREATE TABLE public.inventory_dedupe_previews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id uuid REFERENCES public.inventory_dedupe_candidates(id),
  group_id uuid NOT NULL,
  tenant_id uuid NOT NULL,
  store_id uuid,
  vin text NOT NULL,
  kind text NOT NULL,
  action text NOT NULL CHECK (action IN ('archive_redundant','link_inventory','none')),
  disposition text NOT NULL CHECK (disposition IN ('eligible','needs_review','blocked')),
  policy_version text NOT NULL,
  plan jsonb NOT NULL,
  fingerprint text NOT NULL,
  plan_sha256 text NOT NULL,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','applied','rejected','invalidated')),
  approved_by uuid,
  approved_at timestamptz,
  approval_expires_at timestamptz,
  applied_operation_id uuid,
  status_reason text
);
CREATE INDEX inventory_dedupe_previews_group ON public.inventory_dedupe_previews (group_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.inventory_dedupe_previews_immutable() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'preview_immutable'; END IF;
  IF NEW.plan IS DISTINCT FROM OLD.plan OR NEW.fingerprint IS DISTINCT FROM OLD.fingerprint OR NEW.plan_sha256 IS DISTINCT FROM OLD.plan_sha256
     OR NEW.vin IS DISTINCT FROM OLD.vin OR NEW.store_id IS DISTINCT FROM OLD.store_id OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.action IS DISTINCT FROM OLD.action OR NEW.disposition IS DISTINCT FROM OLD.disposition OR NEW.policy_version IS DISTINCT FROM OLD.policy_version
     OR NEW.created_at IS DISTINCT FROM OLD.created_at OR NEW.expires_at IS DISTINCT FROM OLD.expires_at OR NEW.created_by IS DISTINCT FROM OLD.created_by THEN
    RAISE EXCEPTION 'preview_immutable';
  END IF;
  IF OLD.status IN ('applied','rejected','invalidated') AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'preview_final';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER inventory_dedupe_previews_immutable BEFORE UPDATE OR DELETE ON public.inventory_dedupe_previews
  FOR EACH ROW EXECUTE FUNCTION public.inventory_dedupe_previews_immutable();

CREATE TABLE public.inventory_dedupe_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'running' CHECK (status IN ('running','stopped','completed','completed_with_failures')),
  stop_reason text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.inventory_dedupe_batch_items (
  batch_id uuid NOT NULL REFERENCES public.inventory_dedupe_batches(id),
  preview_id uuid NOT NULL REFERENCES public.inventory_dedupe_previews(id),
  position integer NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','applied','failed','skipped')),
  operation_id uuid,
  error text,
  finished_at timestamptz,
  PRIMARY KEY (batch_id, preview_id)
);

CREATE TABLE public.inventory_dedupe_operations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key text NOT NULL UNIQUE CHECK (length(idempotency_key) BETWEEN 8 AND 200),
  kind text NOT NULL CHECK (kind IN ('apply','undo')),
  preview_id uuid REFERENCES public.inventory_dedupe_previews(id),
  undo_of uuid REFERENCES public.inventory_dedupe_operations(id),
  batch_id uuid REFERENCES public.inventory_dedupe_batches(id),
  status text NOT NULL CHECK (status IN ('applied','rejected','failed')),
  reason text,
  actor uuid,
  group_id uuid, tenant_id uuid, store_id uuid, vin text,
  action text,
  policy_version text,
  before_state jsonb,
  after_state jsonb,
  result jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX inventory_dedupe_operations_group ON public.inventory_dedupe_operations (group_id, created_at DESC);
CREATE UNIQUE INDEX inventory_dedupe_one_undo ON public.inventory_dedupe_operations (undo_of) WHERE kind = 'undo' AND status = 'applied';

-- Durable record of reconciled ids. Reimports and delayed jobs resolve an
-- alias to its canonical listing; the alias row is never deleted.
CREATE TABLE public.vehicle_listing_aliases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  vin text NOT NULL,
  alias_listing_id uuid NOT NULL REFERENCES public.vehicle_listings(id) ON DELETE RESTRICT,
  alias_slug text,
  canonical_listing_id uuid NOT NULL REFERENCES public.vehicle_listings(id) ON DELETE RESTRICT,
  operation_id uuid NOT NULL REFERENCES public.inventory_dedupe_operations(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  retired_at timestamptz,
  retired_operation_id uuid REFERENCES public.inventory_dedupe_operations(id),
  CHECK (alias_listing_id <> canonical_listing_id)
);
CREATE UNIQUE INDEX vehicle_listing_aliases_live ON public.vehicle_listing_aliases (alias_listing_id) WHERE retired_at IS NULL;
CREATE INDEX vehicle_listing_aliases_slug ON public.vehicle_listing_aliases (alias_slug) WHERE retired_at IS NULL;

ALTER TABLE public.inventory_dedupe_controls ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_dedupe_store_controls ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_dedupe_dependency_registry ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_dedupe_candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_dedupe_previews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_dedupe_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_dedupe_batch_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_dedupe_operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vehicle_listing_aliases ENABLE ROW LEVEL SECURITY;
-- Reads go through the SECURITY DEFINER functions below; no direct grants.
REVOKE ALL ON public.inventory_dedupe_controls, public.inventory_dedupe_store_controls, public.inventory_dedupe_dependency_registry,
  public.inventory_dedupe_candidates, public.inventory_dedupe_previews, public.inventory_dedupe_batches, public.inventory_dedupe_batch_items,
  public.inventory_dedupe_operations, public.vehicle_listing_aliases FROM PUBLIC, anon, authenticated;

-- -- Plan builder -------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.inv_dedupe_policy_version() RETURNS text
LANGUAGE sql IMMUTABLE AS $$ SELECT 'dedupe-2026-10-31.1'::text $$;

-- Counts every registered reference to one listing. null count = unchecked.
CREATE OR REPLACE FUNCTION public.inv_dedupe_dependencies(p_listing_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r record; v_slug text; v_n bigint; v_out jsonb := '[]'::jsonb; v_key text; v_sql text;
BEGIN
  SELECT slug INTO v_slug FROM vehicle_listings WHERE id = p_listing_id;
  FOR r IN SELECT * FROM inventory_dedupe_dependency_registry ORDER BY class, table_name, column_name LOOP
    v_n := NULL;
    IF to_regclass('public.' || quote_ident(r.table_name)) IS NOT NULL
       AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = r.table_name AND column_name = r.column_name) THEN
      v_key := CASE r.key_kind WHEN 'listing_uuid' THEN p_listing_id::text WHEN 'listing_text' THEN p_listing_id::text ELSE v_slug END;
      IF v_key IS NULL THEN
        v_n := 0;
      ELSE
        v_sql := format('SELECT count(*) FROM public.%I WHERE %I = $1%s%s', r.table_name, r.column_name,
          CASE WHEN r.key_kind = 'listing_uuid' THEN '::uuid' ELSE '' END,
          CASE WHEN r.filter_sql IS NOT NULL THEN ' AND (' || r.filter_sql || ')' ELSE '' END);
        BEGIN
          EXECUTE v_sql INTO v_n USING v_key;
        EXCEPTION WHEN OTHERS THEN v_n := NULL;
        END;
      END IF;
    END IF;
    v_out := v_out || jsonb_build_array(jsonb_build_object('table', r.table_name, 'column', r.column_name, 'class', r.class, 'label', r.label, 'count', v_n));
  END LOOP;
  RETURN v_out;
END $$;

CREATE OR REPLACE FUNCTION public.inv_dedupe_listing_view(p_listing_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'id', l.id, 'slug', l.slug, 'status', l.status, 'tenant_id', l.tenant_id, 'owning_store_id', l.owning_store_id, 'inventory_record_id', l.inventory_record_id,
    'feed_source', l.feed_source, 'ymm', l.ymm, 'trim', l.trim, 'condition', l.condition, 'mileage', l.mileage, 'price', l.price,
    'archived_at', l.archived_at, 'archive_reason', l.archive_reason, 'reconciled_into_listing_id', l.reconciled_into_listing_id,
    'created_at', to_jsonb(l)->'created_at', 'published_at', to_jsonb(l)->'published_at', 'deal_processed_at', to_jsonb(l)->'deal_processed_at',
    'market_value', to_jsonb(l)->'market_value', 'market_checked_at', to_jsonb(l)->'market_checked_at',
    'recall_checked_at', to_jsonb(l)->'recall_checked_at', 'in_service_date', to_jsonb(l)->'in_service_date',
    'enriched_at', to_jsonb(l)->'enriched_at', 'has_key_specs', COALESCE(to_jsonb(l)->'key_specs', 'null'::jsonb) NOT IN ('null'::jsonb, '{}'::jsonb, '[]'::jsonb),
    'has_mc_attributes', COALESCE(to_jsonb(l)->'mc_attributes', 'null'::jsonb) NOT IN ('null'::jsonb, '{}'::jsonb, '[]'::jsonb),
    'has_history', COALESCE(to_jsonb(l)->'history_payload', 'null'::jsonb) NOT IN ('null'::jsonb, '{}'::jsonb, '[]'::jsonb),
    'has_title_verification', COALESCE(to_jsonb(l)->'title_verification', 'null'::jsonb) NOT IN ('null'::jsonb, '{}'::jsonb, '[]'::jsonb),
    'photo_count', l.photo_count,
    'row_sha', md5(to_jsonb(l)::text))
  FROM vehicle_listings l WHERE l.id = p_listing_id
$$;

-- Builds the full decision for one (store, VIN, kind). Pure read: no writes.
-- disposition: eligible (may be applied after approval), needs_review (a person
-- must decide outside this flow), blocked (a rule forbids automatic handling).
CREATE OR REPLACE FUNCTION public.inv_dedupe_build_plan(p_group_id uuid, p_vin text, p_kind text, p_store_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  g public.dealer_groups%ROWTYPE;
  st public.dealer_stores%ROWTYPE;
  si public.store_inventory%ROWTYPE;
  v_vin text := inv_dedupe_norm_vin(p_vin);
  v_reasons text[] := '{}';
  v_disposition text := 'eligible';
  v_action text := 'none';
  v_listings jsonb := '[]'::jsonb;
  v_deps jsonb := '{}'::jsonb;
  v_decisions jsonb := '[]'::jsonb;
  v_conflicts jsonb := '[]'::jsonb;
  v_domains jsonb := '[]'::jsonb;
  v_blocked jsonb := '[]'::jsonb;
  v_expected jsonb := '{}'::jsonb;
  v_canonical uuid; v_redundant uuid[] := '{}';
  v_store_count integer;
  v_mapping_id uuid; v_mapping_updated timestamptz;
  r record; d record; c jsonb; rd jsonb;
  v_fp jsonb; v_active integer; v_live_count integer;
  v_scores jsonb := '{}'::jsonb;
BEGIN
  SELECT * INTO g FROM dealer_groups WHERE id = p_group_id;
  IF g.id IS NULL OR v_vin IS NULL THEN RETURN jsonb_build_object('error', 'not_found'); END IF;
  IF p_store_id IS NOT NULL THEN SELECT * INTO st FROM dealer_stores WHERE id = p_store_id; END IF;
  SELECT count(*) INTO v_store_count FROM dealer_stores WHERE group_id = g.id;
  SELECT * INTO si FROM store_inventory WHERE group_id = g.id AND vin = v_vin AND presence NOT IN ('retired','transferred');
  IF st.id IS NULL AND si.id IS NOT NULL THEN SELECT * INTO st FROM dealer_stores WHERE id = si.store_id; END IF;
  IF st.id IS NOT NULL THEN
    SELECT m.id, m.updated_at INTO v_mapping_id, v_mapping_updated FROM inventory_source_mappings m
     WHERE m.store_id = st.id AND m.status = 'approved' ORDER BY m.approved_at DESC NULLS LAST LIMIT 1;
  END IF;

  FOR r IN SELECT l.id FROM vehicle_listings l WHERE l.tenant_id = g.tenant_id AND inv_dedupe_norm_vin(l.vin) = v_vin ORDER BY l.id LOOP
    v_listings := v_listings || jsonb_build_array(inv_dedupe_listing_view(r.id));
    v_deps := v_deps || jsonb_build_object(r.id::text, inv_dedupe_dependencies(r.id));
  END LOOP;
  SELECT count(*) INTO v_active FROM jsonb_array_elements(v_listings) x WHERE x->>'status' <> 'archived';

  -- Ownership gates common to every kind.
  IF st.id IS NULL THEN
    v_reasons := array_append(v_reasons, 'store_unknown');
  ELSE
    IF st.status <> 'active' THEN v_reasons := array_append(v_reasons, 'store_inactive'); END IF;
    IF v_mapping_id IS NULL THEN v_reasons := array_append(v_reasons, 'store_mapping_not_approved'); END IF;
    IF EXISTS (SELECT 1 FROM inventory_dedupe_store_controls sc WHERE sc.store_id = st.id AND sc.paused) THEN v_reasons := array_append(v_reasons, 'store_paused'); END IF;
  END IF;
  -- The same VIN live or listed in another tenant is an ownership question.
  IF EXISTS (SELECT 1 FROM vehicle_listings l WHERE l.tenant_id <> g.tenant_id AND inv_dedupe_norm_vin(l.vin) = v_vin AND l.status <> 'archived')
     OR EXISTS (SELECT 1 FROM store_inventory x WHERE x.group_id <> g.id AND x.vin = v_vin AND x.presence NOT IN ('retired','transferred')) THEN
    v_reasons := array_append(v_reasons, 'vin_active_in_another_tenant');
  END IF;
  IF EXISTS (SELECT 1 FROM inventory_vin_conflicts x WHERE x.group_id = g.id AND x.vin = v_vin AND x.status = 'open' AND x.kind IN ('other_store','other_store_listing')) THEN
    v_reasons := array_append(v_reasons, 'open_store_transfer_conflict');
  END IF;

  IF p_kind = 'duplicate_listings' THEN
    IF v_active < 2 THEN v_reasons := array_append(v_reasons, 'no_longer_duplicated'); END IF;
    IF si.id IS NULL THEN v_reasons := array_append(v_reasons, 'no_live_inventory_episode'); END IF;
    -- Every active listing must belong to the same verified store.
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_listings) x WHERE x->>'status' <> 'archived' AND (x->>'owning_store_id') IS NULL) THEN
      v_reasons := array_append(v_reasons, 'legacy_listing_ownership_unverified');
    END IF;
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_listings) x WHERE x->>'status' <> 'archived' AND (x->>'owning_store_id') IS NOT NULL AND (x->>'owning_store_id')::uuid IS DISTINCT FROM st.id) THEN
      v_reasons := array_append(v_reasons, 'listing_owned_by_other_store');
    END IF;
    -- A listing that went through a deal belongs to an earlier episode.
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_listings) x WHERE x->>'status' <> 'archived' AND (x->>'deal_processed_at') IS NOT NULL) THEN
      v_reasons := array_append(v_reasons, 'prior_episode_deal_recorded');
    END IF;

    -- Score protected history; the record holding public identity and history is kept.
    FOR r IN SELECT x FROM jsonb_array_elements(v_listings) x WHERE x->>'status' <> 'archived' LOOP
      SELECT
        COALESCE(sum((e->>'count')::int) FILTER (WHERE e->>'class' = 'protected'), 0) AS protected,
        COALESCE(sum((e->>'count')::int) FILTER (WHERE e->>'class' = 'public_identity'), 0) AS public_identity,
        COALESCE(sum((e->>'count')::int) FILTER (WHERE e->>'class' = 'evidence'), 0) AS evidence,
        COALESCE(sum((e->>'count')::int) FILTER (WHERE e->>'class' = 'side_effect'), 0) AS side_effect,
        count(*) FILTER (WHERE e->>'count' IS NULL) AS unchecked
      INTO d FROM jsonb_array_elements(v_deps->(r.x->>'id')) e;
      v_scores := v_scores || jsonb_build_object(r.x->>'id', jsonb_build_object(
        'protected', d.protected, 'public_identity', d.public_identity, 'evidence', d.evidence, 'side_effect', d.side_effect, 'unchecked', d.unchecked,
        'published', (r.x->>'published_at') IS NOT NULL OR r.x->>'status' = 'published',
        'linked', (r.x->>'id')::uuid = si.listing_id OR (r.x->>'inventory_record_id')::uuid = si.id,
        'established', (r.x->>'feed_source') IS DISTINCT FROM 'filescom' OR (r.x->>'created_at')::timestamptz < si.first_seen_at));
      IF d.unchecked > 0 THEN v_reasons := array_append(v_reasons, 'dependency_unchecked'); END IF;
    END LOOP;

    -- Canonical: public identity, then protected history, then evidence, then
    -- an established (pre-feed) record, then the record already linked. Age,
    -- import time and filled-field counts are not used.
    SELECT (k.key)::uuid INTO v_canonical FROM jsonb_each(v_scores) k
     ORDER BY ((k.value->>'public_identity')::int > 0 OR (k.value->>'published')::boolean) DESC,
              (k.value->>'protected')::int > 0 DESC, (k.value->>'evidence')::int > 0 DESC,
              (k.value->>'established')::boolean DESC, (k.value->>'linked')::boolean DESC, k.key
     LIMIT 1;
    SELECT array_agg((k.key)::uuid ORDER BY k.key) INTO v_redundant FROM jsonb_each(v_scores) k WHERE (k.key)::uuid <> v_canonical;
    v_redundant := COALESCE(v_redundant, '{}');

    -- Independent activity on the redundant record means a person decides.
    FOR r IN SELECT k.key AS id, k.value AS s FROM jsonb_each(v_scores) k WHERE (k.key)::uuid = ANY (v_redundant) LOOP
      IF (r.s->>'protected')::int > 0 THEN v_reasons := array_append(v_reasons, 'redundant_has_protected_history'); END IF;
      IF (r.s->>'public_identity')::int > 0 OR (r.s->>'published')::boolean THEN v_reasons := array_append(v_reasons, 'redundant_has_public_identity'); END IF;
      IF (r.s->>'side_effect')::int > 0 THEN v_reasons := array_append(v_reasons, 'redundant_has_active_documents'); END IF;
      IF (r.s->>'evidence')::int > 0 AND (v_scores->v_canonical::text->>'evidence')::int = 0 THEN v_reasons := array_append(v_reasons, 'enrichment_only_on_redundant'); END IF;
    END LOOP;

    -- Field conflicts: incompatible identity values hold the set for review.
    FOR r IN SELECT x FROM jsonb_array_elements(v_listings) x WHERE (x->>'id')::uuid = ANY (v_redundant) LOOP
      SELECT x INTO c FROM jsonb_array_elements(v_listings) x WHERE (x->>'id')::uuid = v_canonical;
      IF lower(c->>'trim') IS DISTINCT FROM lower(r.x->>'trim') AND c->>'trim' IS NOT NULL AND r.x->>'trim' IS NOT NULL THEN
        v_conflicts := v_conflicts || jsonb_build_array(jsonb_build_object('field', 'trim', 'canonical', c->'trim', 'redundant', r.x->'trim', 'rule', 'incompatible trims are never combined'));
      END IF;
      IF lower(c->>'ymm') IS DISTINCT FROM lower(r.x->>'ymm') AND c->>'ymm' IS NOT NULL AND r.x->>'ymm' IS NOT NULL THEN
        v_conflicts := v_conflicts || jsonb_build_array(jsonb_build_object('field', 'year_make_model', 'canonical', c->'ymm', 'redundant', r.x->'ymm', 'rule', 'identity disagreement'));
      END IF;
      IF c->>'condition' IS DISTINCT FROM r.x->>'condition' AND c->>'condition' IS NOT NULL AND r.x->>'condition' IS NOT NULL THEN
        v_conflicts := v_conflicts || jsonb_build_array(jsonb_build_object('field', 'condition', 'canonical', c->'condition', 'redundant', r.x->'condition', 'rule', 'feed is authoritative; differing listings need review'));
      END IF;
    END LOOP;
    IF jsonb_array_length(v_conflicts) > 0 THEN v_reasons := array_append(v_reasons, 'field_conflict'); END IF;

    v_action := 'archive_redundant';
    v_expected := jsonb_build_object('active_listings_before', v_active, 'active_listings_after', v_active - COALESCE(array_length(v_redundant, 1), 0),
      'listings_archived', COALESCE(array_length(v_redundant, 1), 0), 'rows_deleted', 0, 'aliases_created', COALESCE(array_length(v_redundant, 1), 0));

  ELSIF p_kind = 'unlinked_inventory' THEN
    IF si.id IS NULL THEN v_reasons := array_append(v_reasons, 'no_live_inventory_episode'); END IF;
    IF si.listing_id IS NOT NULL THEN v_reasons := array_append(v_reasons, 'already_linked'); END IF;
    IF v_active <> 1 THEN v_reasons := array_append(v_reasons, CASE WHEN v_active = 0 THEN 'no_active_listing' ELSE 'multiple_active_listings' END::text); END IF;
    SELECT (x->>'id')::uuid INTO v_canonical FROM jsonb_array_elements(v_listings) x WHERE x->>'status' <> 'archived' ORDER BY x->>'id' LIMIT 1;
    SELECT x INTO c FROM jsonb_array_elements(v_listings) x WHERE (x->>'id')::uuid = v_canonical;
    IF c IS NOT NULL THEN
      IF (c->>'owning_store_id') IS NULL THEN v_reasons := array_append(v_reasons, 'legacy_listing_ownership_unverified');
      ELSIF (c->>'owning_store_id')::uuid IS DISTINCT FROM st.id THEN v_reasons := array_append(v_reasons, 'listing_owned_by_other_store'); END IF;
      IF (c->>'inventory_record_id') IS NOT NULL AND (c->>'inventory_record_id')::uuid IS DISTINCT FROM si.id THEN v_reasons := array_append(v_reasons, 'listing_linked_to_other_episode'); END IF;
      IF (c->>'deal_processed_at') IS NOT NULL THEN v_reasons := array_append(v_reasons, 'prior_episode_deal_recorded'); END IF;
      IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_deps->(c->>'id')) e WHERE e->>'count' IS NULL) THEN v_reasons := array_append(v_reasons, 'dependency_unchecked'); END IF;
    END IF;
    v_action := 'link_inventory';
    v_expected := jsonb_build_object('links_set', 2, 'listings_archived', 0, 'rows_deleted', 0);

  ELSIF p_kind = 'archived_episode' THEN
    -- A car in today's feed whose only listing is archived. Restoring publishes
    -- a Passport, and the archive may mark a real sale, so a person decides.
    v_reasons := array_append(v_reasons, 'archived_listing_for_live_inventory');
    SELECT (x->>'id')::uuid INTO v_canonical FROM jsonb_array_elements(v_listings) x ORDER BY (x->>'id')::uuid = si.listing_id DESC LIMIT 1;

  ELSIF p_kind = 'broken_link' THEN
    v_reasons := array_append(v_reasons, 'non_reciprocal_inventory_link');
    v_canonical := si.listing_id;

  ELSIF p_kind = 'cross_tenant' THEN
    v_reasons := array_append(v_reasons, 'cross_tenant_never_merged');

  ELSIF p_kind = 'store_identity' THEN
    v_reasons := array_append(v_reasons, 'duplicate_store_ownership_unresolved');
  END IF;

  SELECT array_agg(DISTINCT x ORDER BY x) INTO v_reasons FROM unnest(v_reasons) x;
  v_reasons := COALESCE(v_reasons, '{}');
  IF v_reasons && ARRAY['cross_tenant_never_merged','duplicate_store_ownership_unresolved','vin_active_in_another_tenant','store_unknown','store_inactive',
                        'store_mapping_not_approved','listing_owned_by_other_store','open_store_transfer_conflict','dependency_unchecked','no_live_inventory_episode',
                        'no_longer_duplicated','already_linked','no_active_listing','store_paused']::text[] THEN
    v_disposition := 'blocked';
  ELSIF cardinality(v_reasons) > 0 THEN
    v_disposition := 'needs_review';
  END IF;
  IF p_kind IN ('archived_episode','broken_link','cross_tenant','store_identity') THEN v_action := 'none'; END IF;

  -- KEEP / LINK / PRESERVE / ARCHIVE / BLOCKED, with the reason for each.
  FOR r IN SELECT x FROM jsonb_array_elements(v_listings) x LOOP
    IF (r.x->>'id')::uuid = v_canonical THEN
      v_decisions := v_decisions || jsonb_build_array(jsonb_build_object('record', 'vehicle_listings', 'id', r.x->'id', 'verb', 'KEEP',
        'why', CASE WHEN p_kind = 'duplicate_listings' THEN 'Holds the established public identity and protected history (scored before age or completeness).'
                    WHEN p_kind = 'unlinked_inventory' THEN 'The only active listing for this VIN in the tenant.'
                    ELSE 'Existing listing for this VIN; unchanged.' END));
    ELSIF (r.x->>'id')::uuid = ANY (v_redundant) THEN
      v_decisions := v_decisions || jsonb_build_array(jsonb_build_object('record', 'vehicle_listings', 'id', r.x->'id',
        'verb', CASE WHEN v_disposition = 'eligible' THEN 'ARCHIVE' ELSE 'BLOCKED' END,
        'why', CASE WHEN v_disposition = 'eligible' THEN 'Redundant listing with no protected history, public identity or unique evidence; archived, aliased to the kept listing, never deleted.'
                    ELSE 'Would be archived, but: ' || array_to_string(v_reasons, ', ') END));
    ELSE
      v_decisions := v_decisions || jsonb_build_array(jsonb_build_object('record', 'vehicle_listings', 'id', r.x->'id', 'verb', 'PRESERVE',
        'why', CASE WHEN r.x->>'status' = 'archived' THEN 'Earlier or archived record; kept as history, not merged into current stock.' ELSE 'Not part of this action.' END));
    END IF;
  END LOOP;
  IF si.id IS NOT NULL THEN
    v_decisions := v_decisions || jsonb_build_array(jsonb_build_object('record', 'store_inventory', 'id', si.id,
      'verb', CASE WHEN v_action IN ('archive_redundant','link_inventory') AND v_disposition = 'eligible' THEN 'LINK' WHEN v_disposition = 'eligible' THEN 'KEEP' ELSE 'BLOCKED' END,
      'why', 'Current feed episode for ' || COALESCE(st.display_name, 'the store') || '; links to the kept listing in both directions.'));
  END IF;
  v_decisions := v_decisions || jsonb_build_array(jsonb_build_object('record', 'documents_and_history', 'verb', 'PRESERVE',
    'why', 'Documents, signatures, leads, engagement, facts and provider source records stay on the record that created them. Nothing is deleted, moved or edited.'));

  -- Domain resolution (see the field authority matrix). Values are not copied
  -- between records; the effective source is named with its observation date.
  SELECT x INTO c FROM jsonb_array_elements(v_listings) x WHERE (x->>'id')::uuid = v_canonical;
  v_domains := jsonb_build_array(
    jsonb_build_object('domain', 'feed_fields', 'authority', 'store_inventory (current feed)', 'effective_source', CASE WHEN si.id IS NULL THEN 'none' ELSE 'store_inventory ' || si.id END,
      'observed_at', si.last_seen_at, 'stock_number', si.stock_number, 'mileage', si.mileage,
      'feed_price', CASE si.feed_price_status WHEN 'known' THEN to_jsonb(si.feed_price) WHEN 'zero' THEN '"zero in feed"'::jsonb ELSE '"missing in feed"'::jsonb END),
    jsonb_build_object('domain', 'factory_specs', 'authority', 'verified factory build data for this exact VIN', 'effective_source', 'kept listing facts',
      'present', COALESCE((c->>'has_key_specs')::boolean, false) OR COALESCE((c->>'has_mc_attributes')::boolean, false)),
    jsonb_build_object('domain', 'market_value', 'authority', 'MarketCheck observation with its date', 'effective_source', 'kept listing',
      'value', c->'market_value', 'observed_at', c->'market_checked_at', 'freshness', CASE WHEN c->>'market_checked_at' IS NULL THEN 'missing'
        WHEN (c->>'market_checked_at')::timestamptz < now() - interval '30 days' THEN 'stale' ELSE 'within 30 days' END),
    jsonb_build_object('domain', 'recalls', 'authority', 'exact-VIN recall lookup, date-specific', 'effective_source', 'kept listing', 'observed_at', c->'recall_checked_at'),
    jsonb_build_object('domain', 'warranty_start', 'authority', 'existing evidence rules (never listing history)', 'effective_source', 'kept listing', 'value', c->'in_service_date'),
    jsonb_build_object('domain', 'title_odometer_history', 'authority', 'tied to the inventory episode', 'effective_source', 'kept listing',
      'present', COALESCE((c->>'has_history')::boolean, false) OR COALESCE((c->>'has_title_verification')::boolean, false)),
    jsonb_build_object('domain', 'pricing_policy', 'authority', 'unchanged; existing store feed price setting', 'effective_source', 'no change'));

  SELECT COALESCE(jsonb_agg(jsonb_build_object('listing_id', k.key, 'table', e->>'table', 'label', e->>'label', 'class', e->>'class', 'count', e->'count')), '[]'::jsonb)
    INTO v_blocked
    FROM jsonb_each(v_deps) k, jsonb_array_elements(k.value) e
   WHERE (k.key)::uuid = ANY (v_redundant) AND ((e->>'count') IS NULL OR ((e->>'count')::int > 0 AND e->>'class' <> 'link'));

  -- Fingerprint: everything a decision depends on. Any change re-validates to a
  -- different value and the preview is rejected.
  v_fp := jsonb_build_object(
    'policy', inv_dedupe_policy_version(),
    'listings', (SELECT COALESCE(jsonb_object_agg(x->>'id', x->>'row_sha'), '{}'::jsonb) FROM jsonb_array_elements(v_listings) x),
    'dependencies', v_deps,
    'inventory', CASE WHEN si.id IS NULL THEN NULL ELSE md5(to_jsonb(si)::text) END,
    'store', CASE WHEN st.id IS NULL THEN NULL ELSE md5(jsonb_build_object('status', st.status, 'group', st.group_id, 'tenant', st.tenant_id, 'feed_price_updates_listing', st.feed_price_updates_listing)::text) END,
    'mapping', CASE WHEN v_mapping_id IS NULL THEN NULL ELSE v_mapping_id::text || ':' || v_mapping_updated::text END,
    'other_tenant', (SELECT COALESCE(jsonb_agg(l.id ORDER BY l.id), '[]'::jsonb) FROM vehicle_listings l WHERE l.tenant_id <> g.tenant_id AND inv_dedupe_norm_vin(l.vin) = v_vin),
    'conflicts', (SELECT COALESCE(jsonb_agg(x.id ORDER BY x.id), '[]'::jsonb) FROM inventory_vin_conflicts x WHERE x.group_id = g.id AND x.vin = v_vin AND x.status = 'open'));

  RETURN jsonb_build_object(
    'policy_version', inv_dedupe_policy_version(),
    'group_id', g.id, 'tenant_id', g.tenant_id, 'store_id', st.id, 'store_name', st.display_name, 'vin', v_vin, 'kind', p_kind,
    'action', v_action, 'disposition', v_disposition, 'reasons', to_jsonb(v_reasons),
    'canonical_listing_id', v_canonical, 'redundant_listing_ids', to_jsonb(v_redundant), 'inventory_id', si.id,
    'listings', v_listings, 'inventory', CASE WHEN si.id IS NULL THEN NULL ELSE jsonb_build_object('id', si.id, 'store_id', si.store_id, 'presence', si.presence,
      'listing_id', si.listing_id, 'stock_number', si.stock_number, 'first_seen_at', si.first_seen_at, 'last_seen_at', si.last_seen_at, 'enrichment_status', si.enrichment_status) END,
    'scores', v_scores, 'decisions', v_decisions, 'domains', v_domains, 'conflicts', v_conflicts, 'blocked_dependencies', v_blocked,
    'dependencies', v_deps, 'expected_counts', v_expected, 'provider_calls', 0, 'storage_operations', 0,
    'fingerprint_parts', v_fp, 'fingerprint', md5(v_fp::text));
END $$;

-- -- Detection ----------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.inv_dedupe_scan(p_group_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := inv_require_platform_admin();
  ctl public.inventory_dedupe_controls%ROWTYPE;
  g public.dealer_groups%ROWTYPE;
  r record; v_plan jsonb; v_seen uuid[] := '{}'; v_id uuid; v_count integer := 0;
BEGIN
  SELECT * INTO ctl FROM inventory_dedupe_controls WHERE id = 1;
  IF NOT ctl.detection_enabled THEN RAISE EXCEPTION 'dedupe_detection_disabled'; END IF;
  SELECT * INTO g FROM dealer_groups WHERE id = p_group_id;
  IF g.id IS NULL THEN RAISE EXCEPTION 'group_not_found'; END IF;

  FOR r IN
    -- More than one active listing for a VIN inside the tenant.
    SELECT inv_dedupe_norm_vin(l.vin) AS vin, 'duplicate_listings'::text AS kind, NULL::uuid AS store_id
      FROM vehicle_listings l WHERE l.tenant_id = g.tenant_id AND l.status <> 'archived' AND inv_dedupe_norm_vin(l.vin) IS NOT NULL
     GROUP BY 1 HAVING count(*) > 1
    UNION ALL
    -- Live feed inventory not linked to the tenant's listing for that VIN.
    SELECT si.vin, 'unlinked_inventory', si.store_id FROM store_inventory si
     WHERE si.group_id = g.id AND si.presence NOT IN ('retired','transferred') AND si.listing_id IS NULL
       AND EXISTS (SELECT 1 FROM vehicle_listings l WHERE l.tenant_id = g.tenant_id AND inv_dedupe_norm_vin(l.vin) = si.vin)
    UNION ALL
    -- Live feed inventory whose listing is archived (or is the only listing).
    SELECT si.vin, 'archived_episode', si.store_id FROM store_inventory si
     WHERE si.group_id = g.id AND si.presence NOT IN ('retired','transferred')
       AND EXISTS (SELECT 1 FROM vehicle_listings l WHERE l.tenant_id = g.tenant_id AND inv_dedupe_norm_vin(l.vin) = si.vin AND l.status = 'archived' AND l.reconciled_into_listing_id IS NULL)
       AND NOT EXISTS (SELECT 1 FROM vehicle_listings l WHERE l.tenant_id = g.tenant_id AND inv_dedupe_norm_vin(l.vin) = si.vin AND l.status <> 'archived')
    UNION ALL
    -- One-way links between inventory and listing.
    SELECT si.vin, 'broken_link', si.store_id FROM store_inventory si JOIN vehicle_listings l ON l.id = si.listing_id
     WHERE si.group_id = g.id AND si.presence NOT IN ('retired','transferred') AND l.inventory_record_id IS DISTINCT FROM si.id AND l.reconciled_into_listing_id IS NULL
    UNION ALL
    -- The same VIN active in another tenant.
    SELECT si.vin, 'cross_tenant', si.store_id FROM store_inventory si
     WHERE si.group_id = g.id AND si.presence NOT IN ('retired','transferred')
       AND (EXISTS (SELECT 1 FROM vehicle_listings l WHERE l.tenant_id <> g.tenant_id AND inv_dedupe_norm_vin(l.vin) = si.vin AND l.status <> 'archived')
         OR EXISTS (SELECT 1 FROM store_inventory x WHERE x.group_id <> g.id AND x.vin = si.vin AND x.presence NOT IN ('retired','transferred')))
    UNION ALL
    -- Live inventory in a store whose feed identity is mapped to another store.
    SELECT si.vin, 'store_identity', si.store_id FROM store_inventory si
     WHERE si.group_id = g.id AND si.presence NOT IN ('retired','transferred')
       AND EXISTS (SELECT 1 FROM inventory_source_mappings m WHERE m.source_dealer_id = si.source_dealer_id AND m.status = 'approved' AND m.store_id <> si.store_id)
  LOOP
    v_plan := inv_dedupe_build_plan(g.id, r.vin, r.kind, r.store_id);
    INSERT INTO inventory_dedupe_candidates (group_id, tenant_id, store_id, vin, kind, disposition, reasons, summary)
    VALUES (g.id, g.tenant_id, (v_plan->>'store_id')::uuid, r.vin, r.kind, v_plan->>'disposition',
      ARRAY(SELECT jsonb_array_elements_text(v_plan->'reasons')),
      jsonb_build_object('action', v_plan->'action', 'canonical_listing_id', v_plan->'canonical_listing_id', 'redundant_listing_ids', v_plan->'redundant_listing_ids',
        'inventory_id', v_plan->'inventory_id', 'listing_count', jsonb_array_length(v_plan->'listings'), 'fingerprint', v_plan->'fingerprint'))
    ON CONFLICT (group_id, vin, kind) WHERE status = 'open' DO UPDATE SET
      store_id = EXCLUDED.store_id, disposition = EXCLUDED.disposition, reasons = EXCLUDED.reasons, summary = EXCLUDED.summary, last_checked_at = now()
    RETURNING id INTO v_id;
    v_seen := v_seen || v_id;
    v_count := v_count + 1;
  END LOOP;

  UPDATE inventory_dedupe_candidates SET status = 'resolved', resolved_at = now(), last_checked_at = now()
   WHERE group_id = g.id AND status = 'open' AND NOT (id = ANY (v_seen));

  INSERT INTO inventory_network_audit (actor, group_id, entity, entity_id, action, after)
  VALUES (v_uid, g.id, 'inventory_dedupe_candidates', g.id::text, 'dedupe_scan', jsonb_build_object('candidates', v_count, 'policy', inv_dedupe_policy_version()));

  RETURN jsonb_build_object('candidates', v_count, 'checked_at', now(), 'policy_version', inv_dedupe_policy_version());
END $$;

-- -- Preview and approval -----------------------------------------------------

CREATE OR REPLACE FUNCTION public.inv_dedupe_create_preview(p_candidate_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := inv_require_platform_admin();
  ctl public.inventory_dedupe_controls%ROWTYPE;
  cand public.inventory_dedupe_candidates%ROWTYPE;
  v_plan jsonb; v_id uuid; v_sha text; v_expires timestamptz;
BEGIN
  SELECT * INTO ctl FROM inventory_dedupe_controls WHERE id = 1;
  SELECT * INTO cand FROM inventory_dedupe_candidates WHERE id = p_candidate_id;
  IF cand.id IS NULL THEN RAISE EXCEPTION 'candidate_not_found'; END IF;
  IF cand.status <> 'open' THEN RAISE EXCEPTION 'candidate_resolved'; END IF;
  v_plan := inv_dedupe_build_plan(cand.group_id, cand.vin, cand.kind, cand.store_id);
  v_expires := now() + make_interval(mins => ctl.preview_ttl_minutes);
  v_id := gen_random_uuid();
  v_plan := v_plan || jsonb_build_object('preview_id', v_id, 'expires_at', v_expires, 'generated_at', now());
  v_sha := encode(sha256(convert_to(v_plan::text, 'UTF8')), 'hex');
  INSERT INTO inventory_dedupe_previews (id, candidate_id, group_id, tenant_id, store_id, vin, kind, action, disposition, policy_version, plan, fingerprint, plan_sha256, created_by, expires_at)
  VALUES (v_id, cand.id, cand.group_id, cand.tenant_id, (v_plan->>'store_id')::uuid, cand.vin, cand.kind, v_plan->>'action', v_plan->>'disposition',
    v_plan->>'policy_version', v_plan, v_plan->>'fingerprint', v_sha, v_uid, v_expires);
  INSERT INTO inventory_network_audit (actor, group_id, store_id, entity, entity_id, action, after)
  VALUES (v_uid, cand.group_id, (v_plan->>'store_id')::uuid, 'inventory_dedupe_previews', v_id::text, 'dedupe_preview',
    jsonb_build_object('vin_suffix', right(cand.vin, 6), 'kind', cand.kind, 'action', v_plan->'action', 'disposition', v_plan->'disposition', 'plan_sha256', v_sha));
  RETURN jsonb_build_object('preview_id', v_id, 'plan_sha256', v_sha, 'expires_at', v_expires, 'plan', v_plan);
END $$;

CREATE OR REPLACE FUNCTION public.inv_dedupe_approve(p_preview_id uuid, p_plan_sha256 text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := inv_require_platform_admin();
  ctl public.inventory_dedupe_controls%ROWTYPE;
  p public.inventory_dedupe_previews%ROWTYPE;
  v_now_plan jsonb;
BEGIN
  SELECT * INTO ctl FROM inventory_dedupe_controls WHERE id = 1;
  SELECT * INTO p FROM inventory_dedupe_previews WHERE id = p_preview_id FOR UPDATE;
  IF p.id IS NULL THEN RAISE EXCEPTION 'preview_not_found'; END IF;
  IF p.plan_sha256 IS DISTINCT FROM p_plan_sha256 THEN RAISE EXCEPTION 'preview_hash_mismatch'; END IF;
  IF p.status <> 'pending' THEN RAISE EXCEPTION 'preview_not_pending'; END IF;
  IF p.expires_at <= now() THEN
    UPDATE inventory_dedupe_previews SET status = 'invalidated', status_reason = 'expired' WHERE id = p.id;
    RETURN jsonb_build_object('approved', false, 'reason', 'preview_expired');
  END IF;
  IF p.disposition <> 'eligible' OR p.action = 'none' THEN RAISE EXCEPTION 'preview_not_eligible'; END IF;
  v_now_plan := inv_dedupe_build_plan(p.group_id, p.vin, p.kind, p.store_id);
  IF v_now_plan->>'fingerprint' IS DISTINCT FROM p.fingerprint OR v_now_plan->>'policy_version' IS DISTINCT FROM p.policy_version THEN
    UPDATE inventory_dedupe_previews SET status = 'invalidated', status_reason = 'records_changed_since_preview' WHERE id = p.id;
    RETURN jsonb_build_object('approved', false, 'reason', 'preview_stale');
  END IF;
  UPDATE inventory_dedupe_previews SET status = 'approved', approved_by = v_uid, approved_at = now(),
    approval_expires_at = LEAST(p.expires_at, now() + make_interval(mins => ctl.approval_ttl_minutes)) WHERE id = p.id;
  INSERT INTO inventory_network_audit (actor, group_id, store_id, entity, entity_id, action, after)
  VALUES (v_uid, p.group_id, p.store_id, 'inventory_dedupe_previews', p.id::text, 'dedupe_approve', jsonb_build_object('plan_sha256', p.plan_sha256));
  RETURN jsonb_build_object('approved', true, 'preview_id', p.id);
END $$;

-- -- Apply ----------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.inv_dedupe_state(p_listing_ids uuid[], p_inventory_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'listings', (SELECT COALESCE(jsonb_object_agg(l.id, to_jsonb(l)), '{}'::jsonb) FROM vehicle_listings l WHERE l.id = ANY (p_listing_ids)),
    'inventory', (SELECT to_jsonb(si) FROM store_inventory si WHERE si.id = p_inventory_id))
$$;

CREATE OR REPLACE FUNCTION public.inv_dedupe_apply_internal(p_preview_id uuid, p_idempotency_key text, p_actor uuid, p_batch_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  ctl public.inventory_dedupe_controls%ROWTYPE;
  p public.inventory_dedupe_previews%ROWTYPE;
  op public.inventory_dedupe_operations%ROWTYPE;
  v_plan jsonb; v_canonical uuid; v_redundant uuid[]; v_inv uuid; v_ids uuid[]; v_before jsonb; v_after jsonb;
  v_op uuid := gen_random_uuid(); v_reason text; x uuid; v_slug text;
BEGIN
  SELECT * INTO op FROM inventory_dedupe_operations WHERE idempotency_key = p_idempotency_key;
  IF op.id IS NOT NULL THEN
    IF op.preview_id IS DISTINCT FROM p_preview_id OR op.kind <> 'apply' THEN RAISE EXCEPTION 'idempotency_key_reused'; END IF;
    RETURN op.result || jsonb_build_object('replayed', true, 'operation_id', op.id);
  END IF;

  SELECT * INTO ctl FROM inventory_dedupe_controls WHERE id = 1;
  SELECT * INTO p FROM inventory_dedupe_previews WHERE id = p_preview_id FOR UPDATE;
  IF p.id IS NULL THEN RAISE EXCEPTION 'preview_not_found'; END IF;

  -- Lock order: previews row (above), then tenant+VIN advisory lock, then listings by id, then inventory.
  PERFORM inv_dedupe_lock(p.tenant_id, p.vin);

  IF ctl.emergency_stop THEN v_reason := 'emergency_stop';
  ELSIF p.store_id IS NOT NULL AND EXISTS (SELECT 1 FROM inventory_dedupe_store_controls sc WHERE sc.store_id = p.store_id AND sc.paused) THEN v_reason := 'store_paused';
  ELSIF p.status = 'applied' THEN v_reason := 'preview_already_applied';
  ELSIF p.status <> 'approved' THEN v_reason := 'preview_not_approved';
  ELSIF p.approval_expires_at <= now() OR p.expires_at <= now() THEN v_reason := 'approval_expired';
  ELSIF p.disposition <> 'eligible' OR p.action = 'none' THEN v_reason := 'preview_not_eligible';
  END IF;

  IF v_reason IS NULL THEN
    PERFORM 1 FROM vehicle_listings WHERE tenant_id = p.tenant_id AND inv_dedupe_norm_vin(vin) = p.vin ORDER BY id FOR UPDATE;
    PERFORM 1 FROM store_inventory WHERE id = (p.plan->>'inventory_id')::uuid FOR UPDATE;
    v_plan := inv_dedupe_build_plan(p.group_id, p.vin, p.kind, p.store_id);
    IF v_plan->>'fingerprint' IS DISTINCT FROM p.fingerprint OR v_plan->>'policy_version' IS DISTINCT FROM p.policy_version THEN v_reason := 'preview_stale';
    ELSIF v_plan->>'disposition' <> 'eligible' THEN v_reason := 'no_longer_eligible';
    END IF;
  END IF;

  IF v_reason IS NOT NULL THEN
    IF v_reason IN ('preview_stale','no_longer_eligible','approval_expired') AND p.status IN ('pending','approved') THEN
      UPDATE inventory_dedupe_previews SET status = 'invalidated', status_reason = v_reason WHERE id = p.id;
    END IF;
    INSERT INTO inventory_dedupe_operations (id, idempotency_key, kind, preview_id, batch_id, status, reason, actor, group_id, tenant_id, store_id, vin, action, policy_version, result)
    VALUES (v_op, p_idempotency_key, 'apply', p.id, p_batch_id, 'rejected', v_reason, p_actor, p.group_id, p.tenant_id, p.store_id, p.vin, p.action, p.policy_version,
      jsonb_build_object('applied', false, 'reason', v_reason, 'preview_id', p.id));
    RETURN jsonb_build_object('applied', false, 'reason', v_reason, 'preview_id', p.id, 'operation_id', v_op);
  END IF;

  v_canonical := (v_plan->>'canonical_listing_id')::uuid;
  v_redundant := ARRAY(SELECT (jsonb_array_elements_text(v_plan->'redundant_listing_ids'))::uuid);
  v_inv := (v_plan->>'inventory_id')::uuid;
  v_ids := array_append(v_redundant, v_canonical);
  v_before := inv_dedupe_state(v_ids, v_inv);

  -- The operation row exists before aliases reference it.
  INSERT INTO inventory_dedupe_operations (id, idempotency_key, kind, preview_id, batch_id, status, actor, group_id, tenant_id, store_id, vin, action, policy_version, before_state)
  VALUES (v_op, p_idempotency_key, 'apply', p.id, p_batch_id, 'applied', p_actor, p.group_id, p.tenant_id, p.store_id, p.vin, p.action, p.policy_version, v_before);

  PERFORM set_config('app.inventory_writer', 'inventory_reconcile', true);
  IF p.action = 'archive_redundant' THEN
    FOREACH x IN ARRAY v_redundant LOOP
      SELECT slug INTO v_slug FROM vehicle_listings WHERE id = x;
      UPDATE vehicle_listings SET status = 'archived', archived_at = now(), archive_reason = 'duplicate_reconciled',
        reconciled_into_listing_id = v_canonical, reconciliation_operation_id = v_op, inventory_record_id = NULL
       WHERE id = x;
      INSERT INTO vehicle_listing_aliases (tenant_id, vin, alias_listing_id, alias_slug, canonical_listing_id, operation_id)
      VALUES (p.tenant_id, p.vin, x, v_slug, v_canonical, v_op);
    END LOOP;
  END IF;
  IF v_inv IS NOT NULL THEN
    UPDATE vehicle_listings SET inventory_record_id = v_inv WHERE id = v_canonical AND inventory_record_id IS DISTINCT FROM v_inv;
    UPDATE store_inventory SET listing_id = v_canonical WHERE id = v_inv AND listing_id IS DISTINCT FROM v_canonical;
  END IF;
  PERFORM set_config('app.inventory_writer', '', true);

  v_after := inv_dedupe_state(v_ids, v_inv);
  -- Count check: what changed must be what the preview said would change.
  IF (SELECT count(*) FROM vehicle_listings WHERE id = ANY (v_redundant) AND status = 'archived' AND reconciled_into_listing_id = v_canonical)
       <> COALESCE(array_length(v_redundant, 1), 0)
     OR (v_inv IS NOT NULL AND NOT EXISTS (SELECT 1 FROM store_inventory si JOIN vehicle_listings l ON l.id = si.listing_id WHERE si.id = v_inv AND l.id = v_canonical AND l.inventory_record_id = v_inv)) THEN
    RAISE EXCEPTION 'reconciliation_check_failed';
  END IF;

  UPDATE inventory_dedupe_operations SET after_state = v_after,
    result = jsonb_build_object('applied', true, 'operation_id', v_op, 'preview_id', p.id, 'action', p.action, 'canonical_listing_id', v_canonical,
      'archived_listing_ids', CASE WHEN p.action = 'archive_redundant' THEN to_jsonb(v_redundant) ELSE '[]'::jsonb END, 'inventory_id', v_inv,
      'rows_deleted', 0, 'provider_calls', 0, 'storage_operations', 0)
   WHERE id = v_op;
  UPDATE inventory_dedupe_previews SET status = 'applied', applied_operation_id = v_op WHERE id = p.id;
  UPDATE inventory_dedupe_candidates SET status = 'resolved', resolved_at = now() WHERE id = p.candidate_id AND status = 'open';
  INSERT INTO inventory_network_audit (actor, group_id, store_id, entity, entity_id, action, after)
  VALUES (p_actor, p.group_id, p.store_id, 'inventory_dedupe_operations', v_op::text, 'dedupe_apply',
    jsonb_build_object('preview_id', p.id, 'action', p.action, 'canonical_listing_id', v_canonical, 'archived', to_jsonb(v_redundant), 'inventory_id', v_inv));

  RETURN (SELECT result FROM inventory_dedupe_operations WHERE id = v_op);
END $$;

CREATE OR REPLACE FUNCTION public.inv_dedupe_apply(p_preview_id uuid, p_idempotency_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := inv_require_platform_admin();
BEGIN
  RETURN inv_dedupe_apply_internal(p_preview_id, p_idempotency_key, v_uid, NULL);
END $$;

-- -- Batches: one duplicate set per call, each its own transaction --------------

CREATE OR REPLACE FUNCTION public.inv_dedupe_batch_create(p_group_id uuid, p_preview_ids uuid[])
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := inv_require_platform_admin(); ctl public.inventory_dedupe_controls%ROWTYPE; v_id uuid; i integer;
BEGIN
  SELECT * INTO ctl FROM inventory_dedupe_controls WHERE id = 1;
  IF p_preview_ids IS NULL OR cardinality(p_preview_ids) = 0 THEN RAISE EXCEPTION 'batch_empty'; END IF;
  IF cardinality(p_preview_ids) > ctl.max_sets_per_run THEN RAISE EXCEPTION 'batch_exceeds_max_sets_per_run'; END IF;
  IF EXISTS (SELECT 1 FROM unnest(p_preview_ids) pid LEFT JOIN inventory_dedupe_previews p ON p.id = pid
             WHERE p.id IS NULL OR p.group_id <> p_group_id OR p.status <> 'approved') THEN
    RAISE EXCEPTION 'batch_previews_must_be_approved';
  END IF;
  INSERT INTO inventory_dedupe_batches (group_id, created_by) VALUES (p_group_id, v_uid) RETURNING id INTO v_id;
  FOR i IN 1 .. cardinality(p_preview_ids) LOOP
    INSERT INTO inventory_dedupe_batch_items (batch_id, preview_id, position) VALUES (v_id, p_preview_ids[i], i);
  END LOOP;
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.inv_dedupe_batch_progress(p_batch_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object('batch_id', b.id, 'status', b.status, 'stop_reason', b.stop_reason,
    'total', (SELECT count(*) FROM inventory_dedupe_batch_items i WHERE i.batch_id = b.id),
    'applied', (SELECT count(*) FROM inventory_dedupe_batch_items i WHERE i.batch_id = b.id AND i.status = 'applied'),
    'failed', (SELECT count(*) FROM inventory_dedupe_batch_items i WHERE i.batch_id = b.id AND i.status = 'failed'),
    'skipped', (SELECT count(*) FROM inventory_dedupe_batch_items i WHERE i.batch_id = b.id AND i.status = 'skipped'),
    'pending', (SELECT count(*) FROM inventory_dedupe_batch_items i WHERE i.batch_id = b.id AND i.status = 'pending'),
    'items', (SELECT COALESCE(jsonb_agg(jsonb_build_object('preview_id', i.preview_id, 'position', i.position, 'status', i.status, 'operation_id', i.operation_id, 'error', i.error) ORDER BY i.position), '[]'::jsonb)
                FROM inventory_dedupe_batch_items i WHERE i.batch_id = b.id))
  FROM inventory_dedupe_batches b WHERE b.id = p_batch_id
$$;

-- Applies the next pending set. Stop controls are checked before each set.
-- A set that fails rolls back alone (savepoint); committed sets stay committed.
CREATE OR REPLACE FUNCTION public.inv_dedupe_batch_step(p_batch_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := inv_require_platform_admin();
  ctl public.inventory_dedupe_controls%ROWTYPE;
  b public.inventory_dedupe_batches%ROWTYPE;
  it public.inventory_dedupe_batch_items%ROWTYPE;
  v_res jsonb; v_failed integer; v_store uuid;
BEGIN
  SELECT * INTO b FROM inventory_dedupe_batches WHERE id = p_batch_id FOR UPDATE;
  IF b.id IS NULL THEN RAISE EXCEPTION 'batch_not_found'; END IF;
  IF b.status <> 'running' THEN RETURN inv_dedupe_batch_progress(b.id); END IF;
  SELECT * INTO ctl FROM inventory_dedupe_controls WHERE id = 1;
  SELECT count(*) INTO v_failed FROM inventory_dedupe_batch_items WHERE batch_id = b.id AND status = 'failed';
  IF ctl.emergency_stop OR v_failed > ctl.max_failures THEN
    UPDATE inventory_dedupe_batches SET status = 'stopped', stop_reason = CASE WHEN ctl.emergency_stop THEN 'emergency_stop' ELSE 'failure_limit' END, updated_at = now() WHERE id = b.id;
    RETURN inv_dedupe_batch_progress(b.id);
  END IF;
  SELECT * INTO it FROM inventory_dedupe_batch_items WHERE batch_id = b.id AND status = 'pending' ORDER BY position LIMIT 1 FOR UPDATE;
  IF it.batch_id IS NULL THEN
    UPDATE inventory_dedupe_batches SET status = CASE WHEN v_failed > 0 THEN 'completed_with_failures' ELSE 'completed' END, updated_at = now() WHERE id = b.id;
    RETURN inv_dedupe_batch_progress(b.id);
  END IF;
  SELECT store_id INTO v_store FROM inventory_dedupe_previews WHERE id = it.preview_id;
  IF EXISTS (SELECT 1 FROM inventory_dedupe_store_controls sc WHERE sc.store_id = v_store AND sc.paused) THEN
    UPDATE inventory_dedupe_batches SET status = 'stopped', stop_reason = 'store_paused', updated_at = now() WHERE id = b.id;
    RETURN inv_dedupe_batch_progress(b.id);
  END IF;
  BEGIN
    v_res := inv_dedupe_apply_internal(it.preview_id, 'batch:' || b.id::text || ':' || it.preview_id::text, v_uid, b.id);
    UPDATE inventory_dedupe_batch_items SET status = CASE WHEN (v_res->>'applied')::boolean THEN 'applied' ELSE 'skipped' END,
      operation_id = (v_res->>'operation_id')::uuid, error = v_res->>'reason', finished_at = now()
     WHERE batch_id = b.id AND preview_id = it.preview_id;
  EXCEPTION WHEN OTHERS THEN
    UPDATE inventory_dedupe_batch_items SET status = 'failed', error = left(SQLERRM, 300), finished_at = now() WHERE batch_id = b.id AND preview_id = it.preview_id;
  END;
  UPDATE inventory_dedupe_batches SET updated_at = now() WHERE id = b.id;
  RETURN inv_dedupe_batch_progress(b.id);
END $$;

-- Resume after a stop: pending items run again; applied items are skipped by
-- their idempotency keys.
CREATE OR REPLACE FUNCTION public.inv_dedupe_batch_resume(p_batch_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := inv_require_platform_admin();
BEGIN
  UPDATE inventory_dedupe_batches SET status = 'running', stop_reason = NULL, updated_at = now() WHERE id = p_batch_id AND status IN ('stopped','completed_with_failures');
  UPDATE inventory_dedupe_batch_items SET status = 'pending', error = NULL, finished_at = NULL WHERE batch_id = p_batch_id AND status = 'failed';
  RETURN inv_dedupe_batch_progress(p_batch_id);
END $$;

-- -- Recovery -------------------------------------------------------------------

-- Version-aware: compares each record now with the state the operation left.
CREATE OR REPLACE FUNCTION public.inv_dedupe_undo_plan(p_operation_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  op public.inventory_dedupe_operations%ROWTYPE; v_now jsonb; v_diffs jsonb := '[]'::jsonb; k text; v_fields jsonb; v_plan jsonb;
BEGIN
  SELECT * INTO op FROM inventory_dedupe_operations WHERE id = p_operation_id;
  IF op.id IS NULL OR op.kind <> 'apply' OR op.status <> 'applied' THEN RETURN jsonb_build_object('reversible', false, 'reason', 'operation_not_reversible'); END IF;
  IF EXISTS (SELECT 1 FROM inventory_dedupe_operations u WHERE u.undo_of = op.id AND u.status = 'applied') THEN
    RETURN jsonb_build_object('reversible', false, 'reason', 'already_undone');
  END IF;
  v_now := inv_dedupe_state(ARRAY(SELECT (jsonb_object_keys(op.after_state->'listings'))::uuid), (op.after_state->'inventory'->>'id')::uuid);
  FOR k IN SELECT jsonb_object_keys(op.after_state->'listings') LOOP
    SELECT COALESCE(jsonb_agg(f.key), '[]'::jsonb) INTO v_fields FROM jsonb_each(op.after_state->'listings'->k) f
     WHERE f.value IS DISTINCT FROM (v_now->'listings'->k->f.key);
    IF jsonb_array_length(v_fields) > 0 THEN v_diffs := v_diffs || jsonb_build_array(jsonb_build_object('record', 'vehicle_listings', 'id', k, 'changed_fields', v_fields)); END IF;
  END LOOP;
  IF op.after_state->'inventory' IS NOT NULL AND op.after_state->'inventory' <> 'null'::jsonb THEN
    SELECT COALESCE(jsonb_agg(f.key), '[]'::jsonb) INTO v_fields FROM jsonb_each(op.after_state->'inventory') f WHERE f.value IS DISTINCT FROM (v_now->'inventory'->f.key);
    IF jsonb_array_length(v_fields) > 0 THEN v_diffs := v_diffs || jsonb_build_array(jsonb_build_object('record', 'store_inventory', 'id', op.after_state->'inventory'->>'id', 'changed_fields', v_fields)); END IF;
  END IF;
  v_plan := jsonb_build_object('operation_id', op.id, 'reversible', jsonb_array_length(v_diffs) = 0, 'changed_since', v_diffs,
    'restores', jsonb_build_object('listing_status', 'archived listings return to their prior status, slug and links',
      'inventory_link', 'store_inventory.listing_id returns to its prior value', 'aliases', 'retired, not deleted'),
    'not_restored', jsonb_build_array('Audit rows and the operation record stay as written.'),
    'reason', CASE WHEN jsonb_array_length(v_diffs) = 0 THEN NULL ELSE 'records_changed_since_reconciliation' END,
    'state_sha', md5(v_now::text));
  RETURN v_plan || jsonb_build_object('plan_sha256', encode(sha256(convert_to(v_plan::text, 'UTF8')), 'hex'));
END $$;

CREATE OR REPLACE FUNCTION public.inv_dedupe_undo(p_operation_id uuid, p_plan_sha256 text, p_idempotency_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := inv_require_platform_admin();
  op public.inventory_dedupe_operations%ROWTYPE; prior public.inventory_dedupe_operations%ROWTYPE;
  v_plan jsonb; k text; b jsonb; v_undo uuid := gen_random_uuid(); v_inv jsonb;
BEGIN
  SELECT * INTO prior FROM inventory_dedupe_operations WHERE idempotency_key = p_idempotency_key;
  IF prior.id IS NOT NULL THEN
    IF prior.undo_of IS DISTINCT FROM p_operation_id THEN RAISE EXCEPTION 'idempotency_key_reused'; END IF;
    RETURN prior.result || jsonb_build_object('replayed', true);
  END IF;
  SELECT * INTO op FROM inventory_dedupe_operations WHERE id = p_operation_id FOR UPDATE;
  IF op.id IS NULL THEN RAISE EXCEPTION 'operation_not_found'; END IF;
  PERFORM inv_dedupe_lock(op.tenant_id, op.vin);
  PERFORM 1 FROM vehicle_listings WHERE id IN (SELECT (jsonb_object_keys(op.before_state->'listings'))::uuid) ORDER BY id FOR UPDATE;
  v_plan := inv_dedupe_undo_plan(op.id);
  IF v_plan->>'plan_sha256' IS DISTINCT FROM p_plan_sha256 THEN RAISE EXCEPTION 'undo_plan_changed'; END IF;
  IF NOT (v_plan->>'reversible')::boolean THEN
    RETURN jsonb_build_object('undone', false, 'reason', COALESCE(v_plan->>'reason', 'not_reversible'), 'recovery_plan', v_plan);
  END IF;

  INSERT INTO inventory_dedupe_operations (id, idempotency_key, kind, undo_of, status, actor, group_id, tenant_id, store_id, vin, action, policy_version, before_state)
  VALUES (v_undo, p_idempotency_key, 'undo', op.id, 'applied', v_uid, op.group_id, op.tenant_id, op.store_id, op.vin, op.action, op.policy_version, op.after_state);

  PERFORM set_config('app.inventory_writer', 'inventory_reconcile', true);
  FOR k IN SELECT jsonb_object_keys(op.before_state->'listings') LOOP
    b := op.before_state->'listings'->k;
    UPDATE vehicle_listings SET status = b->>'status', archived_at = (b->>'archived_at')::timestamptz, archive_reason = b->>'archive_reason',
      reconciled_into_listing_id = (b->>'reconciled_into_listing_id')::uuid, reconciliation_operation_id = (b->>'reconciliation_operation_id')::uuid,
      inventory_record_id = (b->>'inventory_record_id')::uuid
     WHERE id = k::uuid;
  END LOOP;
  v_inv := op.before_state->'inventory';
  IF v_inv IS NOT NULL AND v_inv <> 'null'::jsonb THEN
    UPDATE store_inventory SET listing_id = (v_inv->>'listing_id')::uuid WHERE id = (v_inv->>'id')::uuid;
  END IF;
  UPDATE vehicle_listing_aliases SET retired_at = now(), retired_operation_id = v_undo WHERE operation_id = op.id AND retired_at IS NULL;
  PERFORM set_config('app.inventory_writer', '', true);

  UPDATE inventory_dedupe_operations SET after_state = inv_dedupe_state(ARRAY(SELECT (jsonb_object_keys(op.before_state->'listings'))::uuid), (v_inv->>'id')::uuid),
    result = jsonb_build_object('undone', true, 'operation_id', v_undo, 'undo_of', op.id) WHERE id = v_undo;
  INSERT INTO inventory_network_audit (actor, group_id, store_id, entity, entity_id, action, after)
  VALUES (v_uid, op.group_id, op.store_id, 'inventory_dedupe_operations', v_undo::text, 'dedupe_undo', jsonb_build_object('undo_of', op.id));
  RETURN jsonb_build_object('undone', true, 'operation_id', v_undo, 'undo_of', op.id);
END $$;

-- -- Purge: eligibility report only ------------------------------------------

CREATE OR REPLACE FUNCTION public.inv_dedupe_purge_check(p_listing_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := inv_require_platform_admin(); l record; v_deps jsonb; v_reasons text[] := ARRAY['purge_disabled','no_approved_retention_policy'];
BEGIN
  SELECT id, status, reconciled_into_listing_id INTO l FROM vehicle_listings WHERE id = p_listing_id;
  IF l.id IS NULL THEN RAISE EXCEPTION 'listing_not_found'; END IF;
  IF l.reconciled_into_listing_id IS NULL THEN v_reasons := array_append(v_reasons, 'not_a_reconciled_duplicate'); END IF;
  v_deps := inv_dedupe_dependencies(p_listing_id);
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_deps) e WHERE e->>'class' = 'protected' AND (e->>'count' IS NULL OR (e->>'count')::int > 0)) THEN v_reasons := array_append(v_reasons, 'protected_history'); END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_deps) e WHERE e->>'class' = 'evidence' AND (e->>'count' IS NULL OR (e->>'count')::int > 0)) THEN v_reasons := array_append(v_reasons, 'source_evidence'); END IF;
  IF EXISTS (SELECT 1 FROM vehicle_listing_aliases a WHERE a.alias_listing_id = p_listing_id) THEN v_reasons := array_append(v_reasons, 'alias_tombstone_required'); END IF;
  RETURN jsonb_build_object('eligible', false, 'reasons', to_jsonb(v_reasons), 'dependencies', v_deps,
    'note', 'Permanent purge is not implemented. Archived duplicates remain archived; deleting a listing would cascade to QR codes, documents and source records.');
END $$;

-- -- Controls and read model --------------------------------------------------

CREATE OR REPLACE FUNCTION public.inv_dedupe_set_controls(p jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := inv_require_platform_admin(); o public.inventory_dedupe_controls%ROWTYPE;
BEGIN
  IF length(trim(COALESCE(p->>'reason', ''))) < 3 THEN RAISE EXCEPTION 'reason_required'; END IF;
  SELECT * INTO o FROM inventory_dedupe_controls WHERE id = 1 FOR UPDATE;
  UPDATE inventory_dedupe_controls SET
    detection_enabled = COALESCE((p->>'detection_enabled')::boolean, detection_enabled),
    auto_reconcile_enabled = COALESCE((p->>'auto_reconcile_enabled')::boolean, auto_reconcile_enabled),
    emergency_stop = COALESCE((p->>'emergency_stop')::boolean, emergency_stop),
    reason = left(p->>'reason', 300), updated_by = v_uid, updated_at = now()
   WHERE id = 1;
  INSERT INTO inventory_network_audit (actor, entity, entity_id, action, before, after)
  VALUES (v_uid, 'inventory_dedupe_controls', '1', 'dedupe_controls', to_jsonb(o), (SELECT to_jsonb(c) FROM inventory_dedupe_controls c WHERE id = 1));
END $$;

CREATE OR REPLACE FUNCTION public.inv_dedupe_set_store_pause(p_store_id uuid, p_paused boolean, p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := inv_require_platform_admin(); st public.dealer_stores%ROWTYPE;
BEGIN
  IF length(trim(COALESCE(p_reason, ''))) < 3 THEN RAISE EXCEPTION 'reason_required'; END IF;
  SELECT * INTO st FROM dealer_stores WHERE id = p_store_id;
  IF st.id IS NULL THEN RAISE EXCEPTION 'store_not_found'; END IF;
  INSERT INTO inventory_dedupe_store_controls (store_id, paused, reason, updated_by) VALUES (st.id, p_paused, left(p_reason, 300), v_uid)
  ON CONFLICT (store_id) DO UPDATE SET paused = EXCLUDED.paused, reason = EXCLUDED.reason, updated_by = v_uid, updated_at = now();
  INSERT INTO inventory_network_audit (actor, group_id, store_id, entity, entity_id, action, after)
  VALUES (v_uid, st.group_id, st.id, 'inventory_dedupe_store_controls', st.id::text, 'dedupe_store_pause', jsonb_build_object('paused', p_paused, 'reason', left(p_reason, 300)));
END $$;

-- Full VINs are returned only by inv_dedupe_reveal_vin (audited); lists carry the last six.
CREATE OR REPLACE FUNCTION public.inv_dedupe_overview(p_group_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := inv_require_platform_admin();
BEGIN
  RETURN jsonb_build_object(
    'controls', (SELECT to_jsonb(c) FROM inventory_dedupe_controls c WHERE id = 1),
    'policy_version', inv_dedupe_policy_version(),
    'store_controls', (SELECT COALESCE(jsonb_agg(to_jsonb(sc)), '[]'::jsonb) FROM inventory_dedupe_store_controls sc JOIN dealer_stores s ON s.id = sc.store_id WHERE s.group_id = p_group_id),
    'last_checked_at', (SELECT max(last_checked_at) FROM inventory_dedupe_candidates WHERE group_id = p_group_id),
    'candidates', (SELECT COALESCE(jsonb_agg(jsonb_build_object('id', c.id, 'store_id', c.store_id, 'store_name', s.display_name, 'vin_suffix', right(c.vin, 6),
        'kind', c.kind, 'status', c.status, 'disposition', c.disposition, 'reasons', to_jsonb(c.reasons), 'summary', c.summary,
        'first_seen_at', c.first_seen_at, 'last_checked_at', c.last_checked_at,
        'vehicle', (SELECT jsonb_build_object('year', si.year, 'make', si.make, 'model', si.model, 'trim', si.trim, 'stock_number', si.stock_number)
                      FROM store_inventory si WHERE si.group_id = c.group_id AND si.vin = c.vin ORDER BY (si.presence NOT IN ('retired','transferred')) DESC LIMIT 1),
        'listing_ymm', (SELECT l.ymm FROM vehicle_listings l WHERE l.tenant_id = c.tenant_id AND inv_dedupe_norm_vin(l.vin) = c.vin ORDER BY l.id LIMIT 1))
        ORDER BY c.disposition, c.last_checked_at DESC), '[]'::jsonb)
      FROM inventory_dedupe_candidates c LEFT JOIN dealer_stores s ON s.id = c.store_id WHERE c.group_id = p_group_id AND c.status = 'open'),
    'previews', (SELECT COALESCE(jsonb_agg(jsonb_build_object('id', p.id, 'candidate_id', p.candidate_id, 'vin_suffix', right(p.vin, 6), 'kind', p.kind, 'action', p.action,
        'disposition', p.disposition, 'status', p.status, 'status_reason', p.status_reason, 'created_at', p.created_at, 'expires_at', p.expires_at,
        'approval_expires_at', p.approval_expires_at, 'plan_sha256', p.plan_sha256, 'applied_operation_id', p.applied_operation_id) ORDER BY p.created_at DESC), '[]'::jsonb)
      FROM (SELECT * FROM inventory_dedupe_previews WHERE group_id = p_group_id ORDER BY created_at DESC LIMIT 100) p),
    'operations', (SELECT COALESCE(jsonb_agg(jsonb_build_object('id', o.id, 'kind', o.kind, 'status', o.status, 'reason', o.reason, 'action', o.action, 'vin_suffix', right(o.vin, 6),
        'preview_id', o.preview_id, 'undo_of', o.undo_of, 'batch_id', o.batch_id, 'created_at', o.created_at, 'result', o.result,
        'undone', EXISTS (SELECT 1 FROM inventory_dedupe_operations u WHERE u.undo_of = o.id AND u.status = 'applied')) ORDER BY o.created_at DESC), '[]'::jsonb)
      FROM (SELECT * FROM inventory_dedupe_operations WHERE group_id = p_group_id ORDER BY created_at DESC LIMIT 100) o),
    'reconciled', (SELECT COALESCE(jsonb_agg(jsonb_build_object('alias_listing_id', a.alias_listing_id, 'canonical_listing_id', a.canonical_listing_id, 'vin_suffix', right(a.vin, 6),
        'alias_slug', a.alias_slug, 'operation_id', a.operation_id, 'created_at', a.created_at, 'retired_at', a.retired_at) ORDER BY a.created_at DESC), '[]'::jsonb)
      FROM vehicle_listing_aliases a JOIN dealer_groups g ON g.tenant_id = a.tenant_id WHERE g.id = p_group_id),
    'batches', (SELECT COALESCE(jsonb_agg(inv_dedupe_batch_progress(b.id) ORDER BY b.created_at DESC), '[]'::jsonb)
      FROM (SELECT * FROM inventory_dedupe_batches WHERE group_id = p_group_id ORDER BY created_at DESC LIMIT 20) b));
END $$;

CREATE OR REPLACE FUNCTION public.inv_dedupe_get_preview(p_preview_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := inv_require_platform_admin(); p public.inventory_dedupe_previews%ROWTYPE; v_plan jsonb;
BEGIN
  SELECT * INTO p FROM inventory_dedupe_previews WHERE id = p_preview_id;
  IF p.id IS NULL THEN RAISE EXCEPTION 'preview_not_found'; END IF;
  -- The stored plan carries full VINs; the screen gets the suffix.
  v_plan := p.plan || jsonb_build_object('vin', NULL, 'vin_suffix', right(p.vin, 6));
  RETURN jsonb_build_object('id', p.id, 'status', p.status, 'status_reason', p.status_reason, 'plan_sha256', p.plan_sha256, 'expires_at', p.expires_at,
    'approval_expires_at', p.approval_expires_at, 'approved_at', p.approved_at, 'applied_operation_id', p.applied_operation_id, 'plan', v_plan);
END $$;

CREATE OR REPLACE FUNCTION public.inv_dedupe_reveal_vin(p_candidate_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := inv_require_platform_admin(); c public.inventory_dedupe_candidates%ROWTYPE;
BEGIN
  SELECT * INTO c FROM inventory_dedupe_candidates WHERE id = p_candidate_id;
  IF c.id IS NULL THEN RAISE EXCEPTION 'candidate_not_found'; END IF;
  INSERT INTO inventory_network_audit (actor, group_id, store_id, entity, entity_id, action) VALUES (v_uid, c.group_id, c.store_id, 'inventory_dedupe_candidates', c.id::text, 'reveal_vin');
  RETURN c.vin;
END $$;

-- Resolves a reconciled listing id to its canonical listing (for reimports,
-- delayed jobs and future read paths). Follows at most five hops.
CREATE OR REPLACE FUNCTION public.inv_dedupe_resolve_listing(p_listing_id uuid) RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v uuid := p_listing_id; nxt uuid; i integer := 0;
BEGIN
  LOOP
    SELECT canonical_listing_id INTO nxt FROM vehicle_listing_aliases WHERE alias_listing_id = v AND retired_at IS NULL;
    EXIT WHEN nxt IS NULL OR i >= 5;
    v := nxt; i := i + 1;
  END LOOP;
  RETURN v;
END $$;

-- -- Import-time duplicate prevention ----------------------------------------
-- 0012's inventory_apply_store_snapshot with three changes in the listing-sync
-- block: the shared tenant+VIN lock, alias resolution, and no automatic
-- adoption or update of an archived listing (recorded as an archived_listing
-- conflict for review instead). Everything else is unchanged.

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
  v_live integer := 0; v_absent integer := 0; v_allowed integer := 0; v_absence_counted boolean := false; v_shrink_held boolean := false;
  v_canonical uuid;
  v_alias_id uuid;
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
    -- Before any row lock for this VIN (see inv_dedupe_lock).
    PERFORM inv_dedupe_lock(st.tenant_id, v.vin);
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
      v_alias_id := NULL;
      v_ymm := NULLIF(trim(concat_ws(' ', v.year::text, v.make, v.model)), '');
      SELECT id, owning_store_id, inventory_record_id, status, reconciled_into_listing_id INTO lst FROM vehicle_listings
       WHERE tenant_id = st.tenant_id AND upper(trim(vin)) = v.vin
       ORDER BY (reconciled_into_listing_id IS NULL) DESC, (status <> 'archived') DESC, id LIMIT 1 FOR UPDATE;
      -- A reconciled duplicate resolves to its canonical listing, so a reimport
      -- or delayed job never revives or recreates it.
      IF lst.id IS NOT NULL AND lst.reconciled_into_listing_id IS NOT NULL THEN
        v_alias_id := lst.id;
        v_canonical := inv_dedupe_resolve_listing(lst.id);
        lst := NULL;
        SELECT id, owning_store_id, inventory_record_id, status, reconciled_into_listing_id INTO lst FROM vehicle_listings WHERE id = v_canonical FOR UPDATE;
      END IF;
      IF v_alias_id IS NOT NULL AND (lst.id IS NULL OR lst.reconciled_into_listing_id IS NOT NULL) THEN
        -- The alias chain is broken, too long or points at a missing listing.
        -- Creating a listing here would recreate the duplicate, so skip the
        -- listing step and leave it for a person.
        INSERT INTO inventory_vin_conflicts (group_id, vin, kind, claiming_store_id, existing_store_id, existing_listing_id, existing_inventory_id, snapshot_id)
        VALUES (st.group_id, v.vin, 'reconciled_listing_unresolved', st.id, NULL, v_alias_id, v_inv_id, s.id)
        ON CONFLICT (group_id, vin, claiming_store_id, kind) WHERE status = 'open' DO UPDATE SET last_seen_at = now(), snapshot_id = EXCLUDED.snapshot_id;
        v_conflicts := v_conflicts + 1;
      ELSIF lst.id IS NULL THEN
        INSERT INTO vehicle_listings (tenant_id, store_id, owning_store_id, inventory_record_id, vin, slug, ymm, trim, mileage, condition, price,
          status, sticker_snapshot, feed_source, photos, photo_count, hero_image_url, features)
        VALUES (st.tenant_id, st.tenant_id::text, st.id, v_inv_id, v.vin, lower(v.vin) || '-' || substr(md5(random()::text || clock_timestamp()::text), 1, 6),
          v_ymm, v.trim, v.mileage, v.condition, v.feed_price, 'draft', '{}'::jsonb, 'filescom', v_photos, jsonb_array_length(v_photos),
          v_photos->>0, v.equipment)
        RETURNING id INTO v_listing_id;
        UPDATE store_inventory SET listing_id = v_listing_id WHERE id = v_inv_id;
        v_listings_created := v_listings_created + 1;
      ELSIF lst.status = 'archived' AND (lst.owning_store_id IS NULL OR lst.owning_store_id = st.id) THEN
        -- An archived listing may belong to an earlier inventory episode or a
        -- recorded sale. Linking it to today's car is a person's decision.
        INSERT INTO inventory_vin_conflicts (group_id, vin, kind, claiming_store_id, existing_store_id, existing_listing_id, existing_inventory_id, snapshot_id)
        VALUES (st.group_id, v.vin, 'archived_listing', st.id, lst.owning_store_id, lst.id, v_inv_id, s.id)
        ON CONFLICT (group_id, vin, claiming_store_id, kind) WHERE status = 'open' DO UPDATE SET last_seen_at = now(), snapshot_id = EXCLUDED.snapshot_id;
        v_conflicts := v_conflicts + 1;
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

  -- Absence: only this store's own rows, only from a clean snapshot, and only
  -- when the snapshot did not shrink beyond the store's guard. A well-formed
  -- but truncated export must not walk a store's stock towards retirement.
  IF s.clean THEN
    SELECT count(*), count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM inventory_snapshot_vehicles x WHERE x.snapshot_id = s.id AND x.vin = si.vin))
      INTO v_live, v_absent FROM store_inventory si WHERE si.store_id = st.id AND si.presence IN ('present','missing','retirement_review');
    v_allowed := GREATEST(5, ceil(v_live * st.max_snapshot_shrink_pct / 100.0)::integer);
    v_shrink_held := v_absent > v_allowed;
    IF v_shrink_held THEN
      INSERT INTO inventory_network_audit (group_id, store_id, entity, entity_id, action, after)
      VALUES (st.group_id, st.id, 'inventory_store_snapshots', s.id::text, 'shrink_guard_held',
        jsonb_build_object('path', s.path, 'source_dealer_id', s.source_dealer_id, 'live', v_live, 'absent', v_absent, 'allowed', v_allowed, 'max_shrink_pct', st.max_snapshot_shrink_pct));
    END IF;
  END IF;
  v_absence_counted := s.clean AND NOT v_shrink_held;
  IF v_absence_counted THEN
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
      'missing', v_missing, 'retirement_review', v_review, 'retired', v_retired, 'absence_counted', v_absence_counted,
      'shrink_guard', jsonb_build_object('held', v_shrink_held, 'live', v_live, 'absent', v_absent, 'allowed', v_allowed),
      'listings_created', v_listings_created, 'listings_updated', v_listings_updated, 'provider_calls', 0))
  WHERE id = s.id;
  UPDATE inventory_store_state SET last_applied_snapshot_id = s.id, last_applied_source_mtime = s.source_mtime, last_applied_sha256 = s.content_sha256,
    last_applied_at = now(), last_run_id = s.run_id, updated_at = now() WHERE store_id = st.id;
  INSERT INTO inventory_network_audit (group_id, store_id, entity, entity_id, action, after)
  VALUES (st.group_id, st.id, 'inventory_store_snapshots', s.id::text, 'apply_snapshot',
    jsonb_build_object('path', s.path, 'source_dealer_id', s.source_dealer_id, 'added', v_added, 'updated', v_updated, 'conflicts', v_conflicts, 'missing', v_missing, 'retired', v_retired));

  RETURN jsonb_build_object('applied', true, 'added', v_added, 'updated', v_updated, 'unchanged', v_unchanged, 'returned', v_returned,
    'conflicts', v_conflicts, 'missing', v_missing, 'retirement_review', v_review, 'retired', v_retired,
    'listings_created', v_listings_created, 'listings_updated', v_listings_updated, 'absence_counted', v_absence_counted, 'shrink_guard_held', v_shrink_held);
END $$;

-- -- Grants -----------------------------------------------------------------------

REVOKE ALL ON FUNCTION public.inventory_apply_store_snapshot(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.inventory_apply_store_snapshot(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.inv_dedupe_lock(uuid, text), public.inv_dedupe_dependencies(uuid), public.inv_dedupe_listing_view(uuid),
  public.inv_dedupe_build_plan(uuid, text, text, uuid), public.inv_dedupe_state(uuid[], uuid),
  public.inv_dedupe_apply_internal(uuid, text, uuid, uuid), public.inv_dedupe_undo_plan(uuid), public.inv_dedupe_batch_progress(uuid),
  public.inv_dedupe_resolve_listing(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.inv_dedupe_resolve_listing(uuid) TO service_role;
DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'inv_dedupe_scan(uuid)', 'inv_dedupe_create_preview(uuid)', 'inv_dedupe_approve(uuid, text)', 'inv_dedupe_apply(uuid, text)',
    'inv_dedupe_batch_create(uuid, uuid[])', 'inv_dedupe_batch_step(uuid)', 'inv_dedupe_batch_resume(uuid)',
    'inv_dedupe_undo(uuid, text, text)', 'inv_dedupe_purge_check(uuid)', 'inv_dedupe_set_controls(jsonb)',
    'inv_dedupe_set_store_pause(uuid, boolean, text)', 'inv_dedupe_overview(uuid)', 'inv_dedupe_get_preview(uuid)', 'inv_dedupe_reveal_vin(uuid)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated', f);
  END LOOP;
END $$;

-- Recovery for the undo plan is read through a platform-admin wrapper.
CREATE OR REPLACE FUNCTION public.inv_dedupe_recovery_plan(p_operation_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := inv_require_platform_admin();
BEGIN RETURN inv_dedupe_undo_plan(p_operation_id); END $$;
REVOKE ALL ON FUNCTION public.inv_dedupe_recovery_plan(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.inv_dedupe_recovery_plan(uuid) TO authenticated;
