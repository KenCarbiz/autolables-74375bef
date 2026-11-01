-- Permanent vehicle history foundation. PROPOSED, NOT APPLIED.
-- Requires supabase/proposed/20261030000000_rooftopos_spine.sql first.
--
-- Additive: new tables, new columns on the (also unapplied) spine tables, and
-- replacements of spine functions. No existing production table, constraint,
-- policy or function is altered. Nothing runs on its own: no triggers on
-- existing tables, no cron, no backfill. Every new write path is an RPC that
-- re-checks the caller and the effective settings at the point of effect.
--
-- Core rule: sold, archived and missing-from-feed are custody states, never
-- deletion instructions. Service and inspection evidence attaches to the
-- VIN-identified vehicle and a service visit, independent of active inventory.

-- ── 1. Vehicle identity ────────────────────────────────────────────────────
ALTER TABLE public.vehicles ADD COLUMN IF NOT EXISTS id uuid NOT NULL DEFAULT gen_random_uuid();
CREATE UNIQUE INDEX IF NOT EXISTS vehicles_id_key ON public.vehicles (id);

-- Invalid or conflicting identity is parked here instead of being rewritten.
CREATE TABLE IF NOT EXISTS public.vehicle_identity_quarantine (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  store_id      uuid,
  raw_vin       text NOT NULL,
  reason        text NOT NULL CHECK (reason IN (
    'vin_format','vin_check_digit','vin_conflict','store_mismatch','ro_conflict',
    'service_visit_vin_conflict','unknown_vehicle','service_only_disabled','service_only_unverified','other')),
  source_app    text NOT NULL,
  source_ref    text,
  inbox_id      uuid REFERENCES public.integration_inbox(id) ON DELETE SET NULL,
  status        text NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved','rejected')),
  resolution    text,
  resolved_by   uuid,
  resolved_at   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.vehicle_identity_quarantine DROP CONSTRAINT IF EXISTS vehicle_identity_quarantine_reason_check;
ALTER TABLE public.vehicle_identity_quarantine ADD CONSTRAINT vehicle_identity_quarantine_reason_check CHECK (reason IN (
  'vin_format','vin_check_digit','vin_conflict','store_mismatch','ro_conflict',
  'service_visit_vin_conflict','unknown_vehicle','service_only_disabled','service_only_unverified','other'));
CREATE INDEX IF NOT EXISTS vehicle_identity_quarantine_open_idx
  ON public.vehicle_identity_quarantine (tenant_id, status, created_at DESC);

-- Audited VIN corrections. Only the listed record references move; documents never do.
CREATE TABLE IF NOT EXISTS public.vehicle_identity_corrections (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  from_vin      text NOT NULL,
  to_vin        text NOT NULL REFERENCES public.vehicles(vin),
  record_refs   jsonb NOT NULL,
  reason        text NOT NULL CHECK (length(trim(reason)) >= 5),
  status        text NOT NULL DEFAULT 'requested' CHECK (status IN ('requested','applied','rejected')),
  requested_by  uuid NOT NULL,
  decided_by    uuid,
  decided_at    timestamptz,
  before_after  jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CHECK (from_vin <> to_vin),
  CHECK (decided_by IS NULL OR decided_by <> requested_by)
);

-- ── 2. Custody episodes ────────────────────────────────────────────────────
ALTER TABLE public.vehicle_instances
  ADD COLUMN IF NOT EXISTS listing_id uuid REFERENCES public.vehicle_listings(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS opened_reason text NOT NULL DEFAULT 'initial',
  ADD COLUMN IF NOT EXISTS previous_instance_id uuid REFERENCES public.vehicle_instances(id),
  ADD COLUMN IF NOT EXISTS custody_state text NOT NULL DEFAULT 'in_stock';
DO $$ BEGIN
  ALTER TABLE public.vehicle_instances ADD CONSTRAINT vehicle_instances_opened_reason_check
    CHECK (opened_reason IN ('initial','reacquisition','restore','transfer_in','backfill'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public.vehicle_instances ADD CONSTRAINT vehicle_instances_custody_state_check
    CHECK (custody_state IN ('in_stock','sold','awaiting_delivery','delivered','transferred_out','archived'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Append-only milestones. Corrections and voids are new rows that point at the original.
CREATE TABLE IF NOT EXISTS public.vehicle_custody_milestones (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  instance_id        uuid NOT NULL,
  vin                text NOT NULL REFERENCES public.vehicles(vin),
  milestone          text NOT NULL CHECK (milestone IN (
    'sold','awaiting_delivery','delivered','sale_voided','delivery_corrected',
    'transferred_out','archived','restored')),
  from_state         text NOT NULL,
  to_state           text NOT NULL,
  occurred_at        timestamptz NOT NULL,
  occurred_tz        text,
  source             text NOT NULL CHECK (source IN ('staff','dms','autocurb','feed_review','integration','backfill')),
  source_ref         text,
  confirmed_by       uuid,
  corrects_id        uuid REFERENCES public.vehicle_custody_milestones(id),
  reason             text,
  causation_event_id uuid,
  created_at         timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (instance_id, tenant_id) REFERENCES public.vehicle_instances (id, tenant_id) ON DELETE RESTRICT,
  CHECK (milestone <> 'delivery_corrected' OR corrects_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS vehicle_custody_milestones_instance_idx
  ON public.vehicle_custody_milestones (instance_id, occurred_at);

CREATE OR REPLACE FUNCTION public.vehicle_history_append_only()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'append_only: % rows cannot be changed or deleted', TG_TABLE_NAME;
END; $$;
DROP TRIGGER IF EXISTS vehicle_custody_milestones_append_only ON public.vehicle_custody_milestones;
CREATE TRIGGER vehicle_custody_milestones_append_only BEFORE UPDATE OR DELETE ON public.vehicle_custody_milestones
  FOR EACH ROW EXECUTE FUNCTION public.vehicle_history_append_only();

-- ── 3. Service visits and evidence that does not need inventory ────────────
CREATE TABLE IF NOT EXISTS public.service_visits (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  store_id            uuid,
  vin                 text NOT NULL REFERENCES public.vehicles(vin),
  instance_id         uuid,
  source_app          text NOT NULL CHECK (source_app IN ('autofilm','autolabels','dms')),
  source_record_id    text NOT NULL,
  ro_number           text,
  opened_at           timestamptz,
  closed_at           timestamptz,
  odometer_value      numeric CHECK (odometer_value IS NULL OR odometer_value >= 0),
  odometer_unit       text CHECK (odometer_unit IS NULL OR odometer_unit IN ('mi','km')),
  intake_verification text NOT NULL CHECK (intake_verification IN
    ('verified_ro','connection_attested','staff_confirmed','unverified')),
  status              text NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed','voided')),
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, source_app, source_record_id),
  UNIQUE (id, tenant_id),
  FOREIGN KEY (instance_id, tenant_id) REFERENCES public.vehicle_instances (id, tenant_id) ON DELETE RESTRICT,
  CHECK ((odometer_value IS NULL) = (odometer_unit IS NULL))
);
CREATE INDEX IF NOT EXISTS service_visits_vin_idx ON public.service_visits (tenant_id, vin, opened_at DESC);

-- Evidence keeps its vehicle even with no custody episode, and can no longer be
-- removed by deleting an episode (spine used ON DELETE CASCADE).
ALTER TABLE public.inspection_evidence
  ADD COLUMN IF NOT EXISTS vin text REFERENCES public.vehicles(vin),
  ADD COLUMN IF NOT EXISTS service_visit_id uuid,
  ADD COLUMN IF NOT EXISTS odometer_unit text;
ALTER TABLE public.inspection_evidence ALTER COLUMN instance_id DROP NOT NULL;
ALTER TABLE public.repair_items
  ADD COLUMN IF NOT EXISTS vin text REFERENCES public.vehicles(vin),
  ADD COLUMN IF NOT EXISTS service_visit_id uuid;
ALTER TABLE public.repair_items ALTER COLUMN instance_id DROP NOT NULL;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['inspection_evidence','repair_items'] LOOP
    EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT IF EXISTS %I', t, t || '_instance_id_tenant_id_fkey');
    EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT IF EXISTS %I', t, t || '_instance_restrict_fkey');
    EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (instance_id, tenant_id) REFERENCES public.vehicle_instances (id, tenant_id) ON DELETE RESTRICT', t, t || '_instance_restrict_fkey');
    EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT IF EXISTS %I', t, t || '_visit_fkey');
    EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (service_visit_id, tenant_id) REFERENCES public.service_visits (id, tenant_id) ON DELETE RESTRICT', t, t || '_visit_fkey');
    EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT IF EXISTS %I', t, t || '_anchor_check');
    EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I CHECK (instance_id IS NOT NULL OR service_visit_id IS NOT NULL)', t, t || '_anchor_check');
  END LOOP;
END $$;
DO $$ BEGIN
  ALTER TABLE public.inspection_evidence ADD CONSTRAINT inspection_evidence_odometer_unit_check
    CHECK (odometer_unit IS NULL OR odometer_unit IN ('mi','km'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS inspection_evidence_visit_idx ON public.inspection_evidence (service_visit_id);
CREATE INDEX IF NOT EXISTS repair_items_visit_idx ON public.repair_items (service_visit_id);

-- Every repair status change is kept, so a later clean inspection never erases a
-- declined or open recommendation from history.
CREATE TABLE IF NOT EXISTS public.repair_item_status_history (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  repair_item_id uuid NOT NULL REFERENCES public.repair_items(id) ON DELETE RESTRICT,
  tenant_id      uuid NOT NULL,
  from_status    text,
  to_status      text NOT NULL,
  source_version bigint NOT NULL,
  evidence_ref   text,
  changed_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS repair_item_status_history_item_idx ON public.repair_item_status_history (repair_item_id, changed_at);

CREATE OR REPLACE FUNCTION public.repair_items_record_status()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO public.repair_item_status_history (repair_item_id, tenant_id, from_status, to_status, source_version, evidence_ref)
    VALUES (NEW.id, NEW.tenant_id, CASE WHEN TG_OP = 'UPDATE' THEN OLD.status END, NEW.status, NEW.source_version, NEW.verified_evidence_ref);
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS repair_items_status_history ON public.repair_items;
CREATE TRIGGER repair_items_status_history AFTER INSERT OR UPDATE ON public.repair_items
  FOR EACH ROW EXECUTE FUNCTION public.repair_items_record_status();
DROP TRIGGER IF EXISTS repair_item_status_history_append_only ON public.repair_item_status_history;
CREATE TRIGGER repair_item_status_history_append_only BEFORE UPDATE OR DELETE ON public.repair_item_status_history
  FOR EACH ROW EXECUTE FUNCTION public.vehicle_history_append_only();

-- ── 4. Reappearance review (archived VIN shows up again) ───────────────────
CREATE TABLE IF NOT EXISTS public.vehicle_reappearance_reviews (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  store_id              uuid,
  vin                   text NOT NULL REFERENCES public.vehicles(vin),
  listing_id            uuid REFERENCES public.vehicle_listings(id) ON DELETE SET NULL,
  prior_instance_id     uuid,
  prior_custody_state   text,
  detected_source       text NOT NULL,
  detected_ref          text,
  detected_at           timestamptz NOT NULL DEFAULT now(),
  status                text NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved')),
  decision              text CHECK (decision IN
    ('restore_episode','new_episode','wrong_store_mapping','reject_source','keep_quarantined')),
  decided_by            uuid,
  decided_at            timestamptz,
  reason                text,
  resulting_instance_id uuid,
  CHECK ((status = 'open') = (decision IS NULL OR decision = 'keep_quarantined'))
);
CREATE UNIQUE INDEX IF NOT EXISTS vehicle_reappearance_one_open
  ON public.vehicle_reappearance_reviews (tenant_id, vin) WHERE status = 'open';

-- ── 5. Customer relationships and access ───────────────────────────────────
CREATE TABLE IF NOT EXISTS public.vehicle_access_grants (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  vin                 text NOT NULL REFERENCES public.vehicles(vin),
  instance_id         uuid,
  relationship        text NOT NULL CHECK (relationship IN
    ('customer_contact','purchaser','lessee','co_owner','verified_access_holder')),
  subject_user_id     uuid NOT NULL,
  subject_ref         text NOT NULL,
  purpose             text NOT NULL,
  scopes              text[] NOT NULL CHECK (scopes <@ ARRAY['transaction_records','service_history','inspection_evidence']::text[] AND cardinality(scopes) > 0),
  verification_source text NOT NULL CHECK (verification_source IN
    ('signed_deal','dms_contract','staff_verified_identity','service_ro_verified')),
  starts_at           timestamptz NOT NULL,
  ends_at             timestamptz,
  revoked_at          timestamptz,
  revoked_by          uuid,
  revoke_reason       text,
  transaction_access_until timestamptz,
  created_by          uuid,
  created_at          timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (instance_id, tenant_id) REFERENCES public.vehicle_instances (id, tenant_id) ON DELETE RESTRICT,
  CHECK (ends_at IS NULL OR ends_at > starts_at),
  CHECK (subject_ref !~* '@' AND subject_ref ~ '^[a-z_]+:[A-Za-z0-9._-]{1,128}$')
);
CREATE INDEX IF NOT EXISTS vehicle_access_grants_subject_idx ON public.vehicle_access_grants (subject_user_id, vin);
CREATE INDEX IF NOT EXISTS vehicle_access_grants_vin_idx ON public.vehicle_access_grants (tenant_id, vin);

-- ── 6. Settings with platform -> tenant -> store inheritance ───────────────
CREATE TABLE IF NOT EXISTS public.vehicle_history_setting_keys (
  key             text PRIMARY KEY,
  value_type      text NOT NULL CHECK (value_type IN ('boolean','integer')),
  combine         text NOT NULL CHECK (combine IN ('any_true','all_true','minimum')),
  safe_default    jsonb NOT NULL,
  allowed_scopes  text[] NOT NULL,
  min_value       integer,
  max_value       integer,
  consumer        text NOT NULL,
  policy_status   text NOT NULL CHECK (policy_status IN ('approved_default','awaiting_approval'))
);
INSERT INTO public.vehicle_history_setting_keys
  (key, value_type, combine, safe_default, allowed_scopes, min_value, max_value, consumer, policy_status) VALUES
  ('lifecycle.emergency_hold', 'boolean', 'any_true', 'false', ARRAY['platform','tenant','store'], NULL, NULL,
   'vehicle_history_record_milestone, vehicle_history_resolve_reappearance', 'approved_default'),
  ('service.attach_enabled', 'boolean', 'all_true', 'false', ARRAY['platform','tenant','store'], NULL, NULL,
   'integration_apply_event (service visit path)', 'awaiting_approval'),
  ('service.allow_service_only_vehicle', 'boolean', 'all_true', 'false', ARRAY['platform','tenant'], NULL, NULL,
   'integration_apply_event (vehicle with no custody history at this dealer)', 'awaiting_approval'),
  ('integration.apply_paused', 'boolean', 'any_true', 'false', ARRAY['platform','tenant'], NULL, NULL,
   'integration_claim_inbox', 'approved_default'),
  ('integration.delivery_paused', 'boolean', 'any_true', 'false', ARRAY['platform','tenant'], NULL, NULL,
   'integration-dispatch via integration_delivery_allowed', 'approved_default'),
  ('integration.outbound_capture_enabled', 'boolean', 'all_true', 'false', ARRAY['platform','tenant'], NULL, NULL,
   'vehicle_history_record_milestone (outbox write)', 'awaiting_approval'),
  ('integration.replay_max_batch', 'integer', 'minimum', '25', ARRAY['platform','tenant'], 1, 500,
   'integration_replay_inbox', 'awaiting_approval'),
  ('access.prior_owner_keeps_transaction_records', 'boolean', 'all_true', 'false', ARRAY['platform','tenant'], NULL, NULL,
   'vehicle_history_owner_view', 'awaiting_approval')
ON CONFLICT (key) DO UPDATE SET
  value_type = EXCLUDED.value_type, combine = EXCLUDED.combine, safe_default = EXCLUDED.safe_default,
  allowed_scopes = EXCLUDED.allowed_scopes, min_value = EXCLUDED.min_value, max_value = EXCLUDED.max_value,
  consumer = EXCLUDED.consumer, policy_status = EXCLUDED.policy_status;

-- Versioned, append-only. The current value is the highest version per (scope, key);
-- a revert is a new version, so the value used for any past decision stays readable.
CREATE TABLE IF NOT EXISTS public.vehicle_history_settings (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope_type   text NOT NULL CHECK (scope_type IN ('platform','tenant','store')),
  scope_id     uuid,
  tenant_id    uuid REFERENCES public.tenants(id) ON DELETE CASCADE,
  key          text NOT NULL REFERENCES public.vehicle_history_setting_keys(key),
  value        jsonb NOT NULL,
  version      integer NOT NULL CHECK (version >= 1),
  set_by       uuid,
  reason       text NOT NULL CHECK (length(trim(reason)) >= 5),
  created_at   timestamptz NOT NULL DEFAULT now(),
  CHECK ((scope_type = 'platform') = (scope_id IS NULL)),
  CHECK (scope_type = 'platform' OR tenant_id IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS vehicle_history_settings_version_key
  ON public.vehicle_history_settings (scope_type, COALESCE(scope_id, '00000000-0000-0000-0000-000000000000'::uuid), key, version);
DROP TRIGGER IF EXISTS vehicle_history_settings_append_only ON public.vehicle_history_settings;
CREATE TRIGGER vehicle_history_settings_append_only BEFORE UPDATE OR DELETE ON public.vehicle_history_settings
  FOR EACH ROW EXECUTE FUNCTION public.vehicle_history_append_only();

-- ── 7. Audit ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.vehicle_history_audit (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid REFERENCES public.tenants(id) ON DELETE CASCADE,
  actor       uuid,
  action      text NOT NULL,
  entity_type text NOT NULL,
  entity_id   text NOT NULL,
  reason      text,
  before      jsonb,
  after       jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS vehicle_history_audit_tenant_idx ON public.vehicle_history_audit (tenant_id, created_at DESC);
DROP TRIGGER IF EXISTS vehicle_history_audit_append_only ON public.vehicle_history_audit;
CREATE TRIGGER vehicle_history_audit_append_only BEFORE UPDATE OR DELETE ON public.vehicle_history_audit
  FOR EACH ROW EXECUTE FUNCTION public.vehicle_history_append_only();

-- ── 8. Grants and RLS ──────────────────────────────────────────────────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'vehicle_identity_quarantine','vehicle_identity_corrections','vehicle_custody_milestones',
    'service_visits','repair_item_status_history','vehicle_reappearance_reviews',
    'vehicle_access_grants','vehicle_history_setting_keys','vehicle_history_settings','vehicle_history_audit'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
  END LOOP;

  -- Any accepted member of the tenant can read the vehicle history itself.
  FOREACH t IN ARRAY ARRAY[
    'vehicle_identity_quarantine','vehicle_custody_milestones','service_visits',
    'repair_item_status_history','vehicle_reappearance_reviews'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_tenant_select', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (tenant_id IN (SELECT tenant_id FROM public.tenant_members WHERE user_id = (SELECT auth.uid()) AND accepted_at IS NOT NULL))',
      t || '_tenant_select', t);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated', t);
  END LOOP;

  -- Customer grants, corrections and audit are owner/admin only.
  FOREACH t IN ARRAY ARRAY['vehicle_access_grants','vehicle_identity_corrections','vehicle_history_audit'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_manager_select', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (tenant_id IN (SELECT tenant_id FROM public.tenant_members WHERE user_id = (SELECT auth.uid()) AND accepted_at IS NOT NULL AND role IN (''owner'',''admin'')))',
      t || '_manager_select', t);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated', t);
  END LOOP;
END $$;

DROP POLICY IF EXISTS vehicle_history_setting_keys_read ON public.vehicle_history_setting_keys;
CREATE POLICY vehicle_history_setting_keys_read ON public.vehicle_history_setting_keys
  FOR SELECT TO authenticated USING (true);
GRANT SELECT ON public.vehicle_history_setting_keys TO authenticated;

DROP POLICY IF EXISTS vehicle_history_settings_read ON public.vehicle_history_settings;
CREATE POLICY vehicle_history_settings_read ON public.vehicle_history_settings
  FOR SELECT TO authenticated USING (
    scope_type = 'platform'
    OR tenant_id IN (SELECT tenant_id FROM public.tenant_members WHERE user_id = (SELECT auth.uid()) AND accepted_at IS NOT NULL)
  );
GRANT SELECT ON public.vehicle_history_settings TO authenticated;

-- ── 9. Helpers ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.vehicle_history_is_service()
RETURNS boolean LANGUAGE sql STABLE SET search_path = '' AS $$
  -- current_user is the definer inside SECURITY DEFINER callers, so read the session
  -- role (SET ROLE by PostgREST) and the JWT claim instead.
  SELECT COALESCE(current_setting('role', true), '') = 'service_role'
      OR COALESCE(current_setting('request.jwt.claims', true)::jsonb->>'role', '') = 'service_role';
$$;

CREATE OR REPLACE FUNCTION public.vehicle_history_is_platform_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = (SELECT auth.uid()) AND r.role::text = 'admin');
$$;

CREATE OR REPLACE FUNCTION public.vehicle_history_is_manager(p_tenant uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.tenant_members m
    WHERE m.tenant_id = p_tenant AND m.user_id = (SELECT auth.uid())
      AND m.accepted_at IS NOT NULL AND m.role IN ('owner','admin'));
$$;

CREATE OR REPLACE FUNCTION public.vehicle_history_audit_write(
  p_tenant uuid, p_action text, p_entity_type text, p_entity_id text, p_reason text, p_before jsonb, p_after jsonb
) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  INSERT INTO public.vehicle_history_audit (tenant_id, actor, action, entity_type, entity_id, reason, before, after)
  VALUES (p_tenant, (SELECT auth.uid()), p_action, p_entity_type, p_entity_id, p_reason, p_before, p_after);
$$;

-- Effective value: platform -> tenant -> store. any_true: any level's true wins (holds).
-- all_true: every level that has a row must be true, and the platform level counts
-- as its safe default when it has no row. minimum: the smallest configured value wins (hard caps).
CREATE OR REPLACE FUNCTION public.vehicle_history_effective_setting(p_tenant uuid, p_store uuid, p_key text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  k public.vehicle_history_setting_keys%ROWTYPE;
  v_vals jsonb[] := '{}';
  v_src text[] := '{}';
  v_row record;
  v_out jsonb;
  v_source text;
BEGIN
  SELECT * INTO k FROM public.vehicle_history_setting_keys WHERE key = p_key;
  IF NOT FOUND THEN RAISE EXCEPTION 'unknown_setting %', p_key; END IF;

  FOR v_row IN
    SELECT DISTINCT ON (s.scope_type) s.scope_type, s.value
    FROM public.vehicle_history_settings s
    WHERE s.key = p_key AND (
      s.scope_type = 'platform'
      OR (s.scope_type = 'tenant' AND s.scope_id = p_tenant)
      OR (s.scope_type = 'store' AND p_store IS NOT NULL AND s.scope_id = p_store AND s.tenant_id = p_tenant))
    ORDER BY s.scope_type, s.version DESC
  LOOP
    v_vals := v_vals || v_row.value;
    v_src := v_src || v_row.scope_type;
  END LOOP;

  IF cardinality(v_vals) = 0 THEN
    RETURN jsonb_build_object('value', k.safe_default, 'source', 'safe_default', 'policy_status', k.policy_status);
  END IF;
  -- An enable (all_true) needs the platform to say yes. With no platform row the
  -- safe default stands in for it, so a dealer cannot switch on a policy alone.
  IF k.combine = 'all_true' AND NOT ('platform' = ANY (v_src)) THEN
    v_vals := v_vals || k.safe_default;
    v_src := v_src || 'safe_default'::text;
  END IF;

  IF k.combine = 'any_true' THEN
    v_out := to_jsonb(EXISTS (SELECT 1 FROM unnest(v_vals) x WHERE x = 'true'::jsonb));
  ELSIF k.combine = 'all_true' THEN
    v_out := to_jsonb(NOT EXISTS (SELECT 1 FROM unnest(v_vals) x WHERE x <> 'true'::jsonb));
  ELSE
    v_out := to_jsonb((SELECT min((x #>> '{}')::integer) FROM unnest(v_vals) x));
  END IF;
  v_source := array_to_string(v_src, '+');
  RETURN jsonb_build_object('value', v_out, 'source', v_source, 'policy_status', k.policy_status);
END; $$;

CREATE OR REPLACE FUNCTION public.vehicle_history_flag(p_tenant uuid, p_store uuid, p_key text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT (public.vehicle_history_effective_setting(p_tenant, p_store, p_key)->'value') = 'true'::jsonb;
$$;

CREATE OR REPLACE FUNCTION public.vehicle_history_set_setting(
  p_scope_type text, p_scope_id uuid, p_key text, p_value jsonb, p_expected_version integer, p_reason text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  k public.vehicle_history_setting_keys%ROWTYPE;
  v_tenant uuid;
  v_current integer;
  v_before jsonb;
  v_parent jsonb;
  v_id uuid;
BEGIN
  SELECT * INTO k FROM public.vehicle_history_setting_keys WHERE key = p_key;
  IF NOT FOUND THEN RAISE EXCEPTION 'unknown_setting'; END IF;
  IF NOT (p_scope_type = ANY (k.allowed_scopes)) THEN RAISE EXCEPTION 'scope_not_allowed'; END IF;
  IF p_reason IS NULL OR length(trim(p_reason)) < 5 THEN RAISE EXCEPTION 'reason_required'; END IF;

  IF p_scope_type = 'platform' THEN
    IF p_scope_id IS NOT NULL THEN RAISE EXCEPTION 'platform_scope_has_no_id'; END IF;
    IF NOT (public.vehicle_history_is_platform_admin() OR public.vehicle_history_is_service()) THEN
      RAISE EXCEPTION 'not_authorized';
    END IF;
  ELSIF p_scope_type = 'tenant' THEN
    v_tenant := p_scope_id;
  ELSE
    SELECT ds.tenant_id INTO v_tenant FROM public.dealer_stores ds WHERE ds.id = p_scope_id;
    IF v_tenant IS NULL THEN RAISE EXCEPTION 'unknown_store'; END IF;
  END IF;
  IF p_scope_type <> 'platform'
     AND NOT (public.vehicle_history_is_manager(v_tenant) OR public.vehicle_history_is_platform_admin() OR public.vehicle_history_is_service()) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  IF k.value_type = 'boolean' AND jsonb_typeof(p_value) <> 'boolean' THEN RAISE EXCEPTION 'invalid_value_type'; END IF;
  IF k.value_type = 'integer' THEN
    IF jsonb_typeof(p_value) <> 'number' OR (p_value #>> '{}') !~ '^[0-9]+$' THEN RAISE EXCEPTION 'invalid_value_type'; END IF;
    IF (p_value #>> '{}')::integer < k.min_value OR (p_value #>> '{}')::integer > k.max_value THEN
      RAISE EXCEPTION 'value_out_of_bounds';
    END IF;
    IF p_scope_type <> 'platform' THEN
      v_parent := public.vehicle_history_effective_setting(
        v_tenant, NULL, p_key)->'value';
      IF p_scope_type = 'tenant' THEN
        SELECT s.value INTO v_parent FROM public.vehicle_history_settings s
         WHERE s.scope_type = 'platform' AND s.key = p_key ORDER BY s.version DESC LIMIT 1;
        v_parent := COALESCE(v_parent, k.safe_default);
      END IF;
      IF (p_value #>> '{}')::integer > (v_parent #>> '{}')::integer THEN RAISE EXCEPTION 'exceeds_parent_cap'; END IF;
    END IF;
  END IF;

  -- Serialize writers on this (scope, key) so the version check cannot race.
  PERFORM pg_advisory_xact_lock(hashtext(p_scope_type || ':' || COALESCE(p_scope_id::text, '-') || ':' || p_key));
  SELECT s.version, s.value INTO v_current, v_before FROM public.vehicle_history_settings s
   WHERE s.scope_type = p_scope_type AND s.scope_id IS NOT DISTINCT FROM p_scope_id AND s.key = p_key
   ORDER BY s.version DESC LIMIT 1;
  v_current := COALESCE(v_current, 0);
  IF p_expected_version IS DISTINCT FROM v_current THEN
    RAISE EXCEPTION 'version_conflict: expected %, current %', p_expected_version, v_current;
  END IF;

  INSERT INTO public.vehicle_history_settings (scope_type, scope_id, tenant_id, key, value, version, set_by, reason)
  VALUES (p_scope_type, p_scope_id, v_tenant, p_key, p_value, v_current + 1, (SELECT auth.uid()), p_reason)
  RETURNING id INTO v_id;
  PERFORM public.vehicle_history_audit_write(v_tenant, 'setting.set', 'vehicle_history_setting', p_key, p_reason,
    jsonb_build_object('scope_type', p_scope_type, 'scope_id', p_scope_id, 'value', v_before, 'version', v_current),
    jsonb_build_object('scope_type', p_scope_type, 'scope_id', p_scope_id, 'value', p_value, 'version', v_current + 1));
  RETURN jsonb_build_object('id', v_id, 'version', v_current + 1);
END; $$;

-- ── 10. Lifecycle milestones ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.vehicle_history_next_state(p_from text, p_milestone text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE
    WHEN p_from = 'in_stock'          AND p_milestone = 'sold'              THEN 'sold'
    WHEN p_from = 'in_stock'          AND p_milestone = 'transferred_out'   THEN 'transferred_out'
    WHEN p_from = 'in_stock'          AND p_milestone = 'archived'          THEN 'archived'
    WHEN p_from = 'sold'              AND p_milestone = 'awaiting_delivery' THEN 'awaiting_delivery'
    WHEN p_from IN ('sold','awaiting_delivery') AND p_milestone = 'delivered' THEN 'delivered'
    WHEN p_from IN ('sold','awaiting_delivery','delivered') AND p_milestone = 'sale_voided' THEN 'in_stock'
    WHEN p_from = 'delivered'         AND p_milestone = 'delivery_corrected' THEN 'delivered'
    WHEN p_from = 'archived'          AND p_milestone = 'restored'          THEN 'in_stock'
    ELSE NULL
  END;
$$;

CREATE OR REPLACE FUNCTION public.vehicle_history_record_milestone(
  p_instance_id uuid, p_milestone text, p_occurred_at timestamptz, p_occurred_tz text,
  p_source text, p_source_ref text, p_reason text, p_corrects_id uuid DEFAULT NULL,
  p_causation_event_id uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  i public.vehicle_instances%ROWTYPE;
  v_next text;
  v_id uuid;
  v_event text;
  c record;
BEGIN
  SELECT * INTO i FROM public.vehicle_instances WHERE id = p_instance_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'unknown_instance'; END IF;
  IF NOT (public.vehicle_history_is_manager(i.tenant_id) OR public.vehicle_history_is_service()) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
  IF public.vehicle_history_flag(i.tenant_id, i.store_id, 'lifecycle.emergency_hold') THEN
    RAISE EXCEPTION 'emergency_hold';
  END IF;
  IF p_occurred_at IS NULL OR p_occurred_at > now() + interval '5 minutes' THEN RAISE EXCEPTION 'invalid_occurred_at'; END IF;
  IF p_milestone IN ('sale_voided','delivery_corrected','restored') AND (p_reason IS NULL OR length(trim(p_reason)) < 5) THEN
    RAISE EXCEPTION 'reason_required';
  END IF;
  IF p_corrects_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.vehicle_custody_milestones m WHERE m.id = p_corrects_id AND m.instance_id = i.id) THEN
    RAISE EXCEPTION 'corrects_unknown_milestone';
  END IF;

  v_next := public.vehicle_history_next_state(i.custody_state, p_milestone);
  IF v_next IS NULL THEN RAISE EXCEPTION 'invalid_transition: % -> %', i.custody_state, p_milestone; END IF;

  INSERT INTO public.vehicle_custody_milestones (tenant_id, instance_id, vin, milestone, from_state, to_state,
      occurred_at, occurred_tz, source, source_ref, confirmed_by, corrects_id, reason, causation_event_id)
  VALUES (i.tenant_id, i.id, i.vin, p_milestone, i.custody_state, v_next, p_occurred_at, p_occurred_tz,
      p_source, p_source_ref, (SELECT auth.uid()), p_corrects_id, p_reason, p_causation_event_id)
  RETURNING id INTO v_id;

  UPDATE public.vehicle_instances SET
    custody_state = v_next,
    status = CASE WHEN v_next IN ('delivered','transferred_out') THEN 'disposed' ELSE 'active' END,
    disposed_at = CASE WHEN v_next IN ('delivered','transferred_out') THEN COALESCE(
      CASE WHEN p_milestone = 'delivery_corrected' THEN p_occurred_at END, disposed_at, p_occurred_at)
      WHEN v_next = 'in_stock' THEN NULL ELSE disposed_at END,
    disposition = CASE WHEN v_next = 'delivered' THEN 'retail_sale' WHEN v_next = 'transferred_out' THEN 'transfer'
      WHEN v_next = 'in_stock' THEN NULL ELSE disposition END
  WHERE id = i.id;

  PERFORM public.vehicle_history_audit_write(i.tenant_id, 'custody.' || p_milestone, 'vehicle_instance', i.id::text, p_reason,
    jsonb_build_object('custody_state', i.custody_state), jsonb_build_object('custody_state', v_next, 'milestone_id', v_id));

  -- Transactional outbox: the event exists if and only if the milestone does.
  v_event := CASE p_milestone WHEN 'sold' THEN 'autolabels.vehicle.sold' WHEN 'delivered' THEN 'autolabels.vehicle.delivered'
    WHEN 'sale_voided' THEN 'autolabels.vehicle.sale_voided' WHEN 'archived' THEN 'autolabels.vehicle.archived' END;
  IF v_event IS NOT NULL AND public.vehicle_history_flag(i.tenant_id, i.store_id, 'integration.outbound_capture_enabled') THEN
    FOR c IN
      SELECT ic.id, ic.app FROM public.integration_connections ic
      WHERE ic.tenant_id = i.tenant_id AND ic.status IN ('active','paused')
        -- Echo guard: never re-emit to the app whose inbound event caused this change.
        AND NOT EXISTS (SELECT 1 FROM public.integration_inbox ib
                        WHERE p_causation_event_id IS NOT NULL AND ib.event_id = p_causation_event_id AND ib.connection_id = ic.id)
    LOOP
      INSERT INTO public.integration_outbox (tenant_id, connection_id, event_id, event_type, envelope)
      SELECT i.tenant_id, c.id, e.id, v_event, jsonb_build_object(
        'event_id', e.id, 'event_type', v_event, 'schema_version', '1.1.0', 'producer', 'autolabels',
        'source_record_id', 'instance:' || i.id, 'source_version', (SELECT count(*) FROM public.vehicle_custody_milestones m WHERE m.instance_id = i.id),
        'idempotency_key', 'milestone:' || v_id || ':' || c.id, 'correlation_id', COALESCE(p_causation_event_id, v_id)::text,
        'causation_id', p_causation_event_id, 'occurred_at', to_char(p_occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
        'sent_at', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), 'vin', i.vin, 'tenant_ref', i.tenant_id::text,
        'instance_ref', jsonb_build_object('app', 'autolabels', 'id', i.id::text), 'service_visit_ref', NULL,
        'visibility', 'tenant_private', 'payload', jsonb_build_object('custody_state', v_next, 'milestone', p_milestone))
      FROM (SELECT gen_random_uuid() AS id) e;
    END LOOP;
  END IF;

  RETURN jsonb_build_object('milestone_id', v_id, 'custody_state', v_next);
END; $$;

-- ── 11. Reappearance: detection is read-only, decisions are explicit ───────
CREATE OR REPLACE FUNCTION public.vehicle_history_flag_reappearance(
  p_tenant uuid, p_store uuid, p_vin text, p_listing_id uuid, p_source text, p_ref text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_prior public.vehicle_instances%ROWTYPE;
  v_id uuid;
BEGIN
  IF NOT (public.vehicle_history_is_manager(p_tenant) OR public.vehicle_history_is_service()) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
  SELECT * INTO v_prior FROM public.vehicle_instances
   WHERE tenant_id = p_tenant AND vin = upper(trim(p_vin)) ORDER BY created_at DESC LIMIT 1;
  IF v_prior.id IS NOT NULL AND v_prior.custody_state NOT IN ('archived','delivered','transferred_out') THEN
    RETURN NULL;
  END IF;
  INSERT INTO public.vehicle_reappearance_reviews (tenant_id, store_id, vin, listing_id, prior_instance_id,
      prior_custody_state, detected_source, detected_ref)
  VALUES (p_tenant, p_store, upper(trim(p_vin)), p_listing_id, v_prior.id, v_prior.custody_state, p_source, p_ref)
  ON CONFLICT (tenant_id, vin) WHERE status = 'open' DO NOTHING
  RETURNING id INTO v_id;
  RETURN v_id;
END; $$;

CREATE OR REPLACE FUNCTION public.vehicle_history_resolve_reappearance(
  p_review_id uuid, p_decision text, p_reason text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  r public.vehicle_reappearance_reviews%ROWTYPE;
  p public.vehicle_instances%ROWTYPE;
  v_new uuid;
BEGIN
  SELECT * INTO r FROM public.vehicle_reappearance_reviews WHERE id = p_review_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'unknown_review'; END IF;
  IF NOT (public.vehicle_history_is_manager(r.tenant_id) OR public.vehicle_history_is_service()) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
  IF r.status <> 'open' THEN RAISE EXCEPTION 'review_not_open'; END IF;
  IF p_reason IS NULL OR length(trim(p_reason)) < 5 THEN RAISE EXCEPTION 'reason_required'; END IF;
  IF public.vehicle_history_flag(r.tenant_id, r.store_id, 'lifecycle.emergency_hold') THEN RAISE EXCEPTION 'emergency_hold'; END IF;
  IF r.prior_instance_id IS NOT NULL THEN
    SELECT * INTO p FROM public.vehicle_instances WHERE id = r.prior_instance_id FOR UPDATE;
  END IF;

  IF p_decision = 'restore_episode' THEN
    -- Only an archived episode can be restored. A delivered car coming back is a new episode.
    IF p.id IS NULL OR p.custody_state <> 'archived' THEN RAISE EXCEPTION 'restore_requires_archived_episode'; END IF;
    PERFORM public.vehicle_history_record_milestone(p.id, 'restored', now(), NULL, 'feed_review', r.id::text, p_reason);
    v_new := p.id;
  ELSIF p_decision = 'new_episode' THEN
    IF EXISTS (SELECT 1 FROM public.vehicle_instances WHERE tenant_id = r.tenant_id AND vin = r.vin AND status = 'active'
               AND custody_state NOT IN ('archived')) THEN
      RAISE EXCEPTION 'active_episode_exists';
    END IF;
    IF p.id IS NOT NULL AND p.status = 'active' THEN
      -- Close the archived episode as-is; its history stays attached to it.
      UPDATE public.vehicle_instances SET status = 'disposed', disposition = COALESCE(disposition, 'cancelled')
       WHERE id = p.id;
    END IF;
    INSERT INTO public.vehicle_instances (tenant_id, vin, store_id, acquired_at, opened_reason, previous_instance_id, custody_state, status)
    VALUES (r.tenant_id, r.vin, r.store_id, NULL, 'reacquisition', p.id, 'in_stock', 'active')
    RETURNING id INTO v_new;
  ELSIF p_decision IN ('wrong_store_mapping','reject_source','keep_quarantined') THEN
    v_new := NULL;
  ELSE
    RAISE EXCEPTION 'invalid_decision';
  END IF;

  UPDATE public.vehicle_reappearance_reviews SET
    status = CASE WHEN p_decision = 'keep_quarantined' THEN 'open' ELSE 'resolved' END,
    decision = p_decision, decided_by = (SELECT auth.uid()), decided_at = now(), reason = p_reason,
    resulting_instance_id = v_new
  WHERE id = r.id;
  PERFORM public.vehicle_history_audit_write(r.tenant_id, 'reappearance.' || p_decision, 'vehicle_reappearance_review', r.id::text,
    p_reason, jsonb_build_object('prior_instance_id', r.prior_instance_id, 'prior_state', p.custody_state),
    jsonb_build_object('resulting_instance_id', v_new));
  RETURN jsonb_build_object('decision', p_decision, 'instance_id', v_new);
END; $$;

-- Staff-confirmed backfill of custody episodes from existing listings. Dry run by default.
CREATE OR REPLACE FUNCTION public.vehicle_history_backfill_tenant(p_tenant uuid, p_dry_run boolean DEFAULT true)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_valid integer; v_invalid integer; v_existing integer; v_created integer := 0;
BEGIN
  IF NOT (public.vehicle_history_is_platform_admin() OR public.vehicle_history_is_service()) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
  SELECT count(*) FILTER (WHERE upper(trim(l.vin)) ~ '^[A-HJ-NPR-Z0-9]{17}$'),
         count(*) FILTER (WHERE upper(trim(coalesce(l.vin,''))) !~ '^[A-HJ-NPR-Z0-9]{17}$')
    INTO v_valid, v_invalid FROM public.vehicle_listings l WHERE l.tenant_id = p_tenant;
  SELECT count(*) INTO v_existing FROM public.vehicle_instances WHERE tenant_id = p_tenant;
  IF NOT p_dry_run THEN
    INSERT INTO public.vehicles (vin)
    SELECT DISTINCT upper(trim(l.vin)) FROM public.vehicle_listings l
     WHERE l.tenant_id = p_tenant AND upper(trim(l.vin)) ~ '^[A-HJ-NPR-Z0-9]{17}$'
    ON CONFLICT (vin) DO NOTHING;
    WITH ins AS (
      INSERT INTO public.vehicle_instances (tenant_id, vin, listing_id, opened_reason, custody_state, status)
      SELECT l.tenant_id, upper(trim(l.vin)), l.id, 'backfill',
             CASE WHEN l.status = 'archived' THEN 'archived' ELSE 'in_stock' END, 'active'
        FROM public.vehicle_listings l
       WHERE l.tenant_id = p_tenant AND upper(trim(l.vin)) ~ '^[A-HJ-NPR-Z0-9]{17}$'
         AND NOT EXISTS (SELECT 1 FROM public.vehicle_instances vi WHERE vi.tenant_id = l.tenant_id AND vi.vin = upper(trim(l.vin)))
      ON CONFLICT DO NOTHING
      RETURNING 1)
    SELECT count(*) INTO v_created FROM ins;
    PERFORM public.vehicle_history_audit_write(p_tenant, 'backfill.instances', 'tenant', p_tenant::text, 'custody backfill',
      NULL, jsonb_build_object('created', v_created));
  END IF;
  RETURN jsonb_build_object('dry_run', p_dry_run, 'listings_valid_vin', v_valid, 'listings_invalid_vin', v_invalid,
    'existing_instances', v_existing, 'created', v_created);
END; $$;

-- ── 12. Access: checked at read time, never cached ─────────────────────────
CREATE OR REPLACE FUNCTION public.vehicle_history_grant_access(
  p_tenant uuid, p_vin text, p_instance_id uuid, p_relationship text, p_subject_user uuid, p_subject_ref text,
  p_purpose text, p_scopes text[], p_verification text, p_starts_at timestamptz, p_ends_at timestamptz
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_id uuid;
BEGIN
  IF NOT (public.vehicle_history_is_manager(p_tenant) OR public.vehicle_history_is_service()) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
  IF 'transaction_records' = ANY (p_scopes) AND p_instance_id IS NULL THEN
    RAISE EXCEPTION 'transaction_scope_requires_episode';
  END IF;
  INSERT INTO public.vehicle_access_grants (tenant_id, vin, instance_id, relationship, subject_user_id, subject_ref,
      purpose, scopes, verification_source, starts_at, ends_at, created_by)
  VALUES (p_tenant, p_vin, p_instance_id, p_relationship, p_subject_user, p_subject_ref, p_purpose, p_scopes,
      p_verification, p_starts_at, p_ends_at, (SELECT auth.uid()))
  RETURNING id INTO v_id;
  PERFORM public.vehicle_history_audit_write(p_tenant, 'access.grant', 'vehicle_access_grant', v_id::text, p_purpose, NULL,
    jsonb_build_object('relationship', p_relationship, 'scopes', p_scopes, 'starts_at', p_starts_at, 'ends_at', p_ends_at));
  RETURN v_id;
END; $$;

-- Retention for a former customer's own transaction records. No date, no access after
-- the relationship ends, whatever the policy says.
CREATE OR REPLACE FUNCTION public.vehicle_history_set_transaction_retention(p_grant_id uuid, p_until timestamptz, p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE g public.vehicle_access_grants%ROWTYPE;
BEGIN
  SELECT * INTO g FROM public.vehicle_access_grants WHERE id = p_grant_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'unknown_grant'; END IF;
  IF NOT (public.vehicle_history_is_manager(g.tenant_id) OR public.vehicle_history_is_service()) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
  IF p_reason IS NULL OR length(trim(p_reason)) < 5 THEN RAISE EXCEPTION 'reason_required'; END IF;
  IF NOT ('transaction_records' = ANY (g.scopes)) THEN RAISE EXCEPTION 'grant_has_no_transaction_scope'; END IF;
  UPDATE public.vehicle_access_grants SET transaction_access_until = p_until WHERE id = g.id;
  PERFORM public.vehicle_history_audit_write(g.tenant_id, 'access.transaction_retention', 'vehicle_access_grant', g.id::text, p_reason,
    jsonb_build_object('transaction_access_until', g.transaction_access_until), jsonb_build_object('transaction_access_until', p_until));
END; $$;

-- Ending a relationship stops future records at p_effective_at. Revoking removes access
-- entirely. Both take effect on the next read because every read re-evaluates grants.
CREATE OR REPLACE FUNCTION public.vehicle_history_end_access(p_grant_id uuid, p_mode text, p_effective_at timestamptz, p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE g public.vehicle_access_grants%ROWTYPE;
BEGIN
  SELECT * INTO g FROM public.vehicle_access_grants WHERE id = p_grant_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'unknown_grant'; END IF;
  IF NOT (public.vehicle_history_is_manager(g.tenant_id) OR public.vehicle_history_is_service()) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
  IF p_reason IS NULL OR length(trim(p_reason)) < 5 THEN RAISE EXCEPTION 'reason_required'; END IF;
  IF p_mode = 'end_relationship' THEN
    UPDATE public.vehicle_access_grants SET ends_at = GREATEST(starts_at + interval '1 second', LEAST(COALESCE(ends_at, p_effective_at), p_effective_at))
     WHERE id = g.id;
  ELSIF p_mode = 'revoke' THEN
    UPDATE public.vehicle_access_grants SET revoked_at = now(), revoked_by = (SELECT auth.uid()), revoke_reason = p_reason
     WHERE id = g.id;
  ELSE
    RAISE EXCEPTION 'invalid_mode';
  END IF;
  PERFORM public.vehicle_history_audit_write(g.tenant_id, 'access.' || p_mode, 'vehicle_access_grant', g.id::text, p_reason,
    jsonb_build_object('ends_at', g.ends_at, 'revoked_at', g.revoked_at), jsonb_build_object('effective_at', p_effective_at));
END; $$;

ALTER TABLE public.vehicle_access_grants ADD COLUMN IF NOT EXISTS transaction_access_until timestamptz;

CREATE OR REPLACE FUNCTION public.vehicle_history_can_read(
  p_grant public.vehicle_access_grants, p_scope text, p_record_instance uuid, p_record_at timestamptz
) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT p_grant.revoked_at IS NULL
    AND p_scope = ANY (p_grant.scopes)
    AND CASE
      WHEN p_scope = 'transaction_records' THEN
        -- Own episode only. After the relationship ends, a former customer keeps these
        -- records only while the policy is on AND a retention date is set and not passed.
        p_record_instance IS NOT DISTINCT FROM p_grant.instance_id
        AND (p_grant.ends_at IS NULL OR p_grant.ends_at > now()
             OR (public.vehicle_history_flag(p_grant.tenant_id, NULL, 'access.prior_owner_keeps_transaction_records')
                 AND p_grant.transaction_access_until IS NOT NULL AND p_grant.transaction_access_until > now()))
      ELSE
        p_record_at IS NOT NULL AND p_record_at >= p_grant.starts_at
        AND (p_grant.ends_at IS NULL OR p_record_at < p_grant.ends_at)
        AND p_grant.starts_at <= now()
    END;
$$;

-- The owner/customer read path. Returns only what the caller's own grants permit;
-- never acquisition cost, appraisal, other customers, messages or private documents.
CREATE OR REPLACE FUNCTION public.vehicle_history_owner_view(p_vin text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_out jsonb := '[]'::jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  SELECT COALESCE(jsonb_agg(x ORDER BY x->>'at'), '[]'::jsonb) INTO v_out FROM (
    SELECT DISTINCT ON (kind, id) jsonb_build_object('kind', kind, 'id', id, 'at', at, 'detail', detail) AS x, kind, id
    FROM (
      SELECT 'service_visit' AS kind, sv.id, sv.opened_at AS at,
             jsonb_build_object('ro_number', sv.ro_number, 'odometer', sv.odometer_value, 'odometer_unit', sv.odometer_unit,
                                'status', sv.status) AS detail
        FROM public.vehicle_access_grants g
        JOIN public.service_visits sv ON sv.tenant_id = g.tenant_id AND sv.vin = g.vin
       WHERE g.subject_user_id = v_uid AND g.vin = upper(trim(p_vin))
         AND public.vehicle_history_can_read(g, 'service_history', sv.instance_id, sv.opened_at)
      UNION ALL
      SELECT 'inspection', e.id, e.inspected_at,
             jsonb_build_object('odometer', e.odometer_miles, 'odometer_unit', COALESCE(e.odometer_unit, 'mi'),
                                'technician_verified', e.technician_verified, 'revoked', e.revoked_at IS NOT NULL)
        FROM public.vehicle_access_grants g
        JOIN public.inspection_evidence e ON e.tenant_id = g.tenant_id AND e.vin = g.vin
       WHERE g.subject_user_id = v_uid AND g.vin = upper(trim(p_vin))
         AND public.vehicle_history_can_read(g, 'inspection_evidence', e.instance_id, e.inspected_at)
      UNION ALL
      SELECT 'repair', ri.id, sv.opened_at,
             jsonb_build_object('item', ri.item, 'status', ri.status, 'verified', ri.status = 'completed_verified')
        FROM public.vehicle_access_grants g
        JOIN public.repair_items ri ON ri.tenant_id = g.tenant_id AND ri.vin = g.vin
        JOIN public.service_visits sv ON sv.id = ri.service_visit_id
       WHERE g.subject_user_id = v_uid AND g.vin = upper(trim(p_vin))
         AND public.vehicle_history_can_read(g, 'service_history', ri.instance_id, sv.opened_at)
      UNION ALL
      SELECT 'custody_milestone', m.id, m.occurred_at,
             jsonb_build_object('milestone', m.milestone, 'state', m.to_state)
        FROM public.vehicle_access_grants g
        JOIN public.vehicle_custody_milestones m ON m.tenant_id = g.tenant_id AND m.instance_id = g.instance_id
       WHERE g.subject_user_id = v_uid AND g.vin = upper(trim(p_vin))
         AND public.vehicle_history_can_read(g, 'transaction_records', m.instance_id, m.occurred_at)
    ) s
  ) d;
  RETURN v_out;
END; $$;

-- ── 13. Integration spine changes ──────────────────────────────────────────
-- Pause application without stopping capture: rows stay received/held, nothing is dropped.
CREATE OR REPLACE FUNCTION public.integration_claim_inbox(p_limit integer, p_lease_seconds integer DEFAULT 300)
RETURNS SETOF public.integration_inbox
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  UPDATE public.integration_inbox i
     SET status = 'held', outcome_code = 'direction_disabled'
   WHERE i.status = 'received'
     AND NOT EXISTS (
       SELECT 1 FROM public.integration_direction_flags f
       WHERE f.tenant_id = i.tenant_id AND f.enabled
         AND f.direction = CASE i.producer WHEN 'autofilm' THEN 'film_to_labels' WHEN 'autocurb' THEN 'curb_to_labels' END
     );

  RETURN QUERY
  WITH picked AS (
    SELECT i.id
    FROM public.integration_inbox i
    WHERE i.status IN ('received','held')
      AND i.next_attempt_at <= now()
      AND (i.claimed_until IS NULL OR i.claimed_until <= now())
      AND EXISTS (
        SELECT 1 FROM public.integration_direction_flags f
        WHERE f.tenant_id = i.tenant_id AND f.enabled
          AND f.direction = CASE i.producer WHEN 'autofilm' THEN 'film_to_labels' WHEN 'autocurb' THEN 'curb_to_labels' END
      )
      AND NOT public.vehicle_history_flag(i.tenant_id, NULL, 'integration.apply_paused')
    ORDER BY i.received_at, i.id
    LIMIT GREATEST(1, LEAST(p_limit, 100))
    FOR UPDATE OF i SKIP LOCKED
  )
  UPDATE public.integration_inbox i
     SET claimed_until = now() + make_interval(secs => GREATEST(p_lease_seconds, 1)),
         status = 'received'
    FROM picked
   WHERE i.id = picked.id
  RETURNING i.*;
END;
$$;
REVOKE ALL ON FUNCTION public.integration_claim_inbox(integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.integration_claim_inbox(integer, integer) TO service_role;

CREATE OR REPLACE FUNCTION public.integration_delivery_allowed(p_tenant uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT NOT public.vehicle_history_flag(p_tenant, NULL, 'integration.delivery_paused');
$$;

-- Records an unmatched/quarantined event in the review queue (idempotent per inbox row).
CREATE OR REPLACE FUNCTION public.integration_quarantine(r public.integration_inbox, p_reason text)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  INSERT INTO public.vehicle_identity_quarantine (tenant_id, raw_vin, reason, source_app, source_ref, inbox_id)
  SELECT r.tenant_id, COALESCE(r.vin, ''), p_reason, r.producer, r.source_record_id, r.id
  WHERE NOT EXISTS (SELECT 1 FROM public.vehicle_identity_quarantine q WHERE q.inbox_id = r.id AND q.status = 'open');
$$;

-- Applies one leased inbox row in a single transaction. Resolution order:
--  1. service_visit_ref (schema 1.1): the evidence belongs to that visit and the VIN,
--     with or without an active custody episode. A visit VIN that disagrees with the
--     envelope VIN is quarantined, never guessed.
--  2. otherwise the tenant's active custody episode (spine 1.0 behaviour).
CREATE OR REPLACE FUNCTION public.integration_apply_event(p_inbox_id uuid, p_plan jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  r public.integration_inbox%ROWTYPE;
  v_verdict text := p_plan->>'verdict';
  v_outcome text := COALESCE(p_plan->>'outcome', 'applied');
  v_effect jsonb := p_plan->'effect';
  v_latest bigint;
  v_instance uuid;
  v_visit public.service_visits%ROWTYPE;
  v_visit_ref text;
  v_known boolean;
  v_unit text;
BEGIN
  SELECT * INTO r FROM public.integration_inbox WHERE id = p_inbox_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'missing');
  END IF;
  IF r.status NOT IN ('received','held') THEN
    RETURN jsonb_build_object('status', 'noop', 'current', r.status);
  END IF;

  IF v_verdict IN ('reject','unmatched') THEN
    UPDATE public.integration_inbox
       SET status = CASE v_verdict WHEN 'reject' THEN 'rejected' ELSE 'unmatched' END,
           outcome_code = v_outcome, attempts = attempts + 1, claimed_until = NULL
     WHERE id = r.id;
    RETURN jsonb_build_object('status', CASE v_verdict WHEN 'reject' THEN 'rejected' ELSE 'unmatched' END, 'outcome', v_outcome);
  END IF;

  INSERT INTO public.integration_source_versions (connection_id, source_record_id, latest_version)
  VALUES (r.connection_id, r.source_record_id, 0)
  ON CONFLICT (connection_id, source_record_id) DO NOTHING;
  SELECT latest_version INTO v_latest FROM public.integration_source_versions
   WHERE connection_id = r.connection_id AND source_record_id = r.source_record_id FOR UPDATE;

  SELECT id INTO v_instance FROM public.vehicle_instances
   WHERE tenant_id = r.tenant_id AND vin = r.vin AND status = 'active';

  v_visit_ref := NULLIF(r.envelope #>> '{service_visit_ref,id}', '');
  IF v_visit_ref IS NOT NULL AND NOT public.vehicle_history_flag(r.tenant_id, NULL, 'service.attach_enabled') THEN
    IF v_instance IS NULL THEN
      -- Paused, not discarded: retry later once the switch is on.
      UPDATE public.integration_inbox
         SET status = 'held', outcome_code = 'service_attach_disabled', claimed_until = NULL,
             next_attempt_at = now() + interval '1 hour'
       WHERE id = r.id;
      RETURN jsonb_build_object('status', 'held', 'outcome', 'service_attach_disabled');
    END IF;
    -- Switch off and the car is in stock: keep the spine 1.0 behaviour exactly.
    v_visit_ref := NULL;
  END IF;
  IF v_visit_ref IS NOT NULL THEN

    SELECT * INTO v_visit FROM public.service_visits
     WHERE tenant_id = r.tenant_id AND source_app = r.producer AND source_record_id = v_visit_ref;
    IF v_visit.id IS NOT NULL AND v_visit.vin <> r.vin THEN
      PERFORM public.integration_quarantine(r, 'service_visit_vin_conflict');
      UPDATE public.integration_inbox
         SET status = 'unmatched', outcome_code = 'service_visit_vin_conflict', attempts = attempts + 1, claimed_until = NULL
       WHERE id = r.id;
      RETURN jsonb_build_object('status', 'unmatched', 'outcome', 'service_visit_vin_conflict');
    END IF;

    IF v_visit.id IS NULL THEN
      v_known := EXISTS (SELECT 1 FROM public.vehicle_instances WHERE tenant_id = r.tenant_id AND vin = r.vin)
              OR EXISTS (SELECT 1 FROM public.vehicle_files WHERE tenant_id = r.tenant_id AND upper(vin) = r.vin);
      IF NOT v_known AND NOT public.vehicle_history_flag(r.tenant_id, NULL, 'service.allow_service_only_vehicle') THEN
        PERFORM public.integration_quarantine(r, 'service_only_disabled');
        UPDATE public.integration_inbox
           SET status = 'unmatched', outcome_code = 'service_only_disabled', attempts = attempts + 1, claimed_until = NULL
         WHERE id = r.id;
        RETURN jsonb_build_object('status', 'unmatched', 'outcome', 'service_only_disabled');
      END IF;
      -- A vehicle this dealer never stocked gets a service record only from verified,
      -- authorized intake: a connection that is still active, a full VIN, and a repair
      -- order number from the producer. It never opens inventory or a listing.
      IF NOT v_known AND NOT (
           EXISTS (SELECT 1 FROM public.integration_connections c WHERE c.id = r.connection_id AND c.status = 'active')
           AND r.vin ~ '^[A-HJ-NPR-Z0-9]{17}$'
           AND COALESCE(NULLIF(trim(r.envelope #>> '{payload,ro_number}'), ''), NULL) IS NOT NULL) THEN
        PERFORM public.integration_quarantine(r, 'service_only_unverified');
        UPDATE public.integration_inbox
           SET status = 'unmatched', outcome_code = 'service_only_unverified', attempts = attempts + 1, claimed_until = NULL
         WHERE id = r.id;
        RETURN jsonb_build_object('status', 'unmatched', 'outcome', 'service_only_unverified');
      END IF;
      INSERT INTO public.vehicles (vin) VALUES (r.vin) ON CONFLICT (vin) DO NOTHING;
      v_unit := CASE WHEN r.envelope #>> '{payload,odometer_unit}' IN ('mi','km') THEN r.envelope #>> '{payload,odometer_unit}' END;
      INSERT INTO public.service_visits (tenant_id, vin, instance_id, source_app, source_record_id, ro_number, opened_at,
          odometer_value, odometer_unit, intake_verification)
      VALUES (r.tenant_id, r.vin,
          -- Link the episode only when the car is in this dealer's stock (recon); never for a sold car.
          (SELECT vi.id FROM public.vehicle_instances vi WHERE vi.id = v_instance AND vi.custody_state = 'in_stock'),
          r.producer, v_visit_ref, NULLIF(r.envelope #>> '{payload,ro_number}', ''),
          COALESCE((r.envelope->>'observed_at')::timestamptz, (r.envelope->>'occurred_at')::timestamptz),
          CASE WHEN v_unit IS NOT NULL THEN NULLIF(r.envelope #>> '{payload,odometer_miles}', '')::numeric END, v_unit,
          'connection_attested')
      ON CONFLICT (tenant_id, source_app, source_record_id) DO NOTHING;
      SELECT * INTO v_visit FROM public.service_visits
       WHERE tenant_id = r.tenant_id AND source_app = r.producer AND source_record_id = v_visit_ref;
    END IF;
    v_instance := v_visit.instance_id;
  ELSIF v_instance IS NULL THEN
    PERFORM public.integration_quarantine(r, 'unknown_vehicle');
    UPDATE public.integration_inbox
       SET status = 'unmatched', outcome_code = 'no_active_instance', attempts = attempts + 1, claimed_until = NULL
     WHERE id = r.id;
    RETURN jsonb_build_object('status', 'unmatched', 'outcome', 'no_active_instance');
  END IF;

  IF r.source_version <= v_latest THEN
    UPDATE public.integration_inbox
       SET status = 'superseded', outcome_code = 'stale_version', attempts = attempts + 1, claimed_until = NULL
     WHERE id = r.id;
    RETURN jsonb_build_object('status', 'superseded', 'outcome', 'stale_version');
  END IF;

  IF v_verdict = 'apply' AND v_effect IS NOT NULL THEN
    IF v_effect->>'kind' = 'inspection_evidence_upsert' THEN
      INSERT INTO public.inspection_evidence AS e (
        tenant_id, instance_id, vin, service_visit_id, source_app, source_record_id, source_version, visibility,
        inspected_at, odometer_miles, odometer_unit, measurements, evidence_refs, technician_verified, revoked_at)
      VALUES (
        r.tenant_id, v_instance, r.vin, v_visit.id, r.producer, r.source_record_id, r.source_version, r.visibility,
        (v_effect->>'inspected_at')::timestamptz,
        (v_effect->>'odometer_miles')::integer,
        CASE WHEN v_effect->>'odometer_miles' IS NOT NULL THEN COALESCE(v_effect->>'odometer_unit', 'mi') END,
        COALESCE(v_effect->'measurements', '{}'::jsonb),
        COALESCE(ARRAY(SELECT jsonb_array_elements_text(v_effect->'evidence_refs')), '{}'::text[]),
        COALESCE((v_effect->>'technician_verified')::boolean, false),
        (v_effect->>'revoked_at')::timestamptz)
      ON CONFLICT (tenant_id, source_app, source_record_id) DO UPDATE SET
        source_version = EXCLUDED.source_version,
        visibility = EXCLUDED.visibility,
        inspected_at = CASE WHEN v_effect ? 'revoked_at' THEN e.inspected_at ELSE EXCLUDED.inspected_at END,
        odometer_miles = CASE WHEN v_effect ? 'revoked_at' THEN e.odometer_miles ELSE EXCLUDED.odometer_miles END,
        odometer_unit = CASE WHEN v_effect ? 'revoked_at' THEN e.odometer_unit ELSE EXCLUDED.odometer_unit END,
        measurements = CASE WHEN v_effect ? 'revoked_at' THEN e.measurements ELSE EXCLUDED.measurements END,
        evidence_refs = CASE WHEN v_effect ? 'revoked_at' THEN e.evidence_refs ELSE EXCLUDED.evidence_refs END,
        technician_verified = CASE WHEN v_effect ? 'revoked_at' THEN e.technician_verified ELSE EXCLUDED.technician_verified END,
        revoked_at = COALESCE(EXCLUDED.revoked_at, e.revoked_at)
      WHERE e.source_version < EXCLUDED.source_version;
    ELSIF v_effect->>'kind' = 'repair_item_upsert' THEN
      INSERT INTO public.repair_items AS ri (
        tenant_id, instance_id, vin, service_visit_id, source_app, source_record_id, source_version, visibility,
        status, finding_ref, item, severity, verified_by, verified_evidence_ref)
      VALUES (
        r.tenant_id, v_instance, r.vin, v_visit.id, r.producer, r.source_record_id, r.source_version, r.visibility,
        v_effect->>'status', v_effect->>'finding_ref', v_effect->>'item', v_effect->>'severity',
        v_effect->>'verified_by', v_effect->>'verified_evidence_ref')
      ON CONFLICT (tenant_id, source_app, source_record_id) DO UPDATE SET
        source_version = EXCLUDED.source_version,
        visibility = EXCLUDED.visibility,
        status = EXCLUDED.status,
        finding_ref = COALESCE(EXCLUDED.finding_ref, ri.finding_ref),
        item = COALESCE(EXCLUDED.item, ri.item),
        severity = COALESCE(EXCLUDED.severity, ri.severity),
        verified_by = EXCLUDED.verified_by,
        verified_evidence_ref = EXCLUDED.verified_evidence_ref
      WHERE ri.source_version < EXCLUDED.source_version;
    ELSE
      RAISE EXCEPTION 'unknown_effect_kind';
    END IF;
  END IF;

  UPDATE public.integration_source_versions
     SET latest_version = r.source_version, updated_at = now()
   WHERE connection_id = r.connection_id AND source_record_id = r.source_record_id;

  UPDATE public.integration_inbox
     SET status = 'applied', outcome_code = v_outcome, attempts = attempts + 1,
         applied_at = now(), claimed_until = NULL
   WHERE id = r.id;
  RETURN jsonb_build_object('status', 'applied', 'outcome', v_outcome, 'service_visit_id', v_visit.id, 'instance_id', v_instance);
END;
$$;
REVOKE ALL ON FUNCTION public.integration_apply_event(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.integration_apply_event(uuid, jsonb) TO service_role;

-- Bounded, audited replay of dead or unmatched rows. Applying stays idempotent because the
-- version watermark and the inbox status guard still run.
CREATE OR REPLACE FUNCTION public.integration_replay_inbox(p_tenant uuid, p_ids uuid[], p_reason text)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_cap integer;
  v_n integer;
BEGIN
  IF NOT (public.vehicle_history_is_manager(p_tenant) OR public.vehicle_history_is_platform_admin() OR public.vehicle_history_is_service()) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
  IF p_reason IS NULL OR length(trim(p_reason)) < 5 THEN RAISE EXCEPTION 'reason_required'; END IF;
  v_cap := (public.vehicle_history_effective_setting(p_tenant, NULL, 'integration.replay_max_batch')->>'value')::integer;
  IF cardinality(p_ids) > v_cap THEN RAISE EXCEPTION 'replay_batch_exceeds_cap: % > %', cardinality(p_ids), v_cap; END IF;
  IF EXISTS (SELECT 1 FROM unnest(p_ids) x WHERE NOT EXISTS (
       SELECT 1 FROM public.integration_inbox i WHERE i.id = x AND i.tenant_id = p_tenant AND i.status IN ('dead','unmatched'))) THEN
    RAISE EXCEPTION 'replay_scope_mismatch';
  END IF;
  UPDATE public.integration_inbox SET status = 'received', attempts = 0, next_attempt_at = now(), claimed_until = NULL,
         outcome_code = 'replayed'
   WHERE id = ANY (p_ids) AND tenant_id = p_tenant AND status IN ('dead','unmatched');
  GET DIAGNOSTICS v_n = ROW_COUNT;
  UPDATE public.vehicle_identity_quarantine SET status = 'resolved', resolution = 'replayed', resolved_by = (SELECT auth.uid()), resolved_at = now()
   WHERE inbox_id = ANY (p_ids) AND status = 'open';
  PERFORM public.vehicle_history_audit_write(p_tenant, 'integration.replay', 'integration_inbox', array_to_string(p_ids, ','), p_reason,
    NULL, jsonb_build_object('count', v_n));
  RETURN v_n;
END; $$;

-- ── 14. Identity correction: two people, explicit records, no document moves ─
CREATE OR REPLACE FUNCTION public.vehicle_history_apply_identity_correction(p_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  c public.vehicle_identity_corrections%ROWTYPE;
  ref jsonb;
  v_before jsonb := '[]'::jsonb;
BEGIN
  SELECT * INTO c FROM public.vehicle_identity_corrections WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'unknown_correction'; END IF;
  IF c.status <> 'requested' THEN RAISE EXCEPTION 'correction_not_pending'; END IF;
  IF NOT public.vehicle_history_is_manager(c.tenant_id) THEN RAISE EXCEPTION 'not_authorized'; END IF;
  IF (SELECT auth.uid()) = c.requested_by THEN RAISE EXCEPTION 'second_person_required'; END IF;

  FOR ref IN SELECT * FROM jsonb_array_elements(c.record_refs) LOOP
    IF ref->>'table' = 'service_visits' THEN
      UPDATE public.service_visits SET vin = c.to_vin WHERE id = (ref->>'id')::uuid AND tenant_id = c.tenant_id AND vin = c.from_vin;
    ELSIF ref->>'table' = 'inspection_evidence' THEN
      UPDATE public.inspection_evidence SET vin = c.to_vin WHERE id = (ref->>'id')::uuid AND tenant_id = c.tenant_id AND vin = c.from_vin;
    ELSIF ref->>'table' = 'repair_items' THEN
      UPDATE public.repair_items SET vin = c.to_vin WHERE id = (ref->>'id')::uuid AND tenant_id = c.tenant_id AND vin = c.from_vin;
    ELSE
      RAISE EXCEPTION 'table_not_correctable: %', ref->>'table';
    END IF;
    IF NOT FOUND THEN RAISE EXCEPTION 'record_not_on_from_vin: %', ref; END IF;
    v_before := v_before || jsonb_build_object('table', ref->>'table', 'id', ref->>'id', 'from', c.from_vin, 'to', c.to_vin);
  END LOOP;

  UPDATE public.vehicle_identity_corrections SET status = 'applied', decided_by = (SELECT auth.uid()), decided_at = now(), before_after = v_before
   WHERE id = c.id;
  PERFORM public.vehicle_history_audit_write(c.tenant_id, 'identity.correct', 'vehicle_identity_correction', c.id::text, c.reason,
    jsonb_build_object('vin', c.from_vin), jsonb_build_object('vin', c.to_vin, 'moved', v_before));
  RETURN jsonb_build_object('moved', jsonb_array_length(v_before));
END; $$;

-- ── 15. Function privileges ────────────────────────────────────────────────
DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.vehicle_history_is_service()',
    'public.vehicle_history_audit_write(uuid, text, text, text, text, jsonb, jsonb)',
    'public.vehicle_history_flag(uuid, uuid, text)',
    'public.integration_delivery_allowed(uuid)',
    'public.integration_quarantine(public.integration_inbox, text)',
    'public.vehicle_history_can_read(public.vehicle_access_grants, text, uuid, timestamptz)',
    'public.vehicle_history_backfill_tenant(uuid, boolean)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f);
  END LOOP;

  -- Callable by signed-in staff; each re-checks the role and tenant itself.
  FOREACH f IN ARRAY ARRAY[
    'public.vehicle_history_is_platform_admin()',
    'public.vehicle_history_is_manager(uuid)',
    'public.vehicle_history_effective_setting(uuid, uuid, text)',
    'public.vehicle_history_set_setting(text, uuid, text, jsonb, integer, text)',
    'public.vehicle_history_record_milestone(uuid, text, timestamptz, text, text, text, text, uuid, uuid)',
    'public.vehicle_history_flag_reappearance(uuid, uuid, text, uuid, text, text)',
    'public.vehicle_history_resolve_reappearance(uuid, text, text)',
    'public.vehicle_history_grant_access(uuid, text, uuid, text, uuid, text, text, text[], text, timestamptz, timestamptz)',
    'public.vehicle_history_end_access(uuid, text, timestamptz, text)',
    'public.vehicle_history_set_transaction_retention(uuid, timestamptz, text)',
    'public.vehicle_history_owner_view(text)',
    'public.integration_replay_inbox(uuid, uuid[], text)',
    'public.vehicle_history_apply_identity_correction(uuid)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', f);
  END LOOP;
  EXECUTE 'REVOKE ALL ON FUNCTION public.vehicle_history_next_state(text, text) FROM PUBLIC, anon';
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.vehicle_history_next_state(text, text) TO authenticated, service_role';
END $$;
