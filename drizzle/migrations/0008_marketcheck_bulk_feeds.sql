-- ── Integration timing and future MarketCheck bulk feeds (2026-10-31) ─────
--
-- Three independent integrations stay separate:
--   1. dealer inventory via Files.com      (0004 / 0006, unchanged here)
--   2. MarketCheck / NeoVIN API            (0007 account coordinator)
--   3. MarketCheck bulk feeds              (this file) - capability only.
--      Bulk feeds are a separate contract; nothing here subscribes to one,
--      enables one, or assumes storage, replay or sharing rights.
--
-- Delivery evidence, not schedules, triggers processing; the schedule only
-- detects lateness and runs reconciliation as a backup. A multipart delivery
-- commits only when every expected part is present and intact, and removals
-- (possible sales) are inferred only from a complete, full, production
-- delivery.

-- Supplier delivery, import timing and paid enrichment timing are configured
-- independently for each integration.
CREATE TABLE public.integration_timing (
  integration_key text PRIMARY KEY CHECK (integration_key ~ '^[a-z0-9_:.-]{3,80}$'),
  integration text NOT NULL CHECK (integration IN ('filescom_inventory','marketcheck_api','marketcheck_bulk')),
  expected_delivery_cron text,
  -- The zone the supplier states for its schedule; never guessed.
  expected_delivery_tz text,
  delivery_grace_minutes integer NOT NULL DEFAULT 120 CHECK (delivery_grace_minutes BETWEEN 0 AND 10080),
  import_mode text NOT NULL DEFAULT 'manual' CHECK (import_mode IN ('on_completion','scheduled','manual')),
  import_cron text,
  reconciliation_cron text,
  enrichment_mode text NOT NULL DEFAULT 'off' CHECK (enrichment_mode IN ('off','after_import','scheduled')),
  enrichment_cron text,
  note text,
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (import_mode <> 'scheduled' OR import_cron IS NOT NULL),
  CHECK (enrichment_mode <> 'scheduled' OR enrichment_cron IS NOT NULL),
  CHECK (expected_delivery_cron IS NULL OR expected_delivery_tz IS NOT NULL)
);
INSERT INTO public.integration_timing (integration_key, integration, import_mode, reconciliation_cron, enrichment_mode, note) VALUES
  ('filescom_inventory', 'filescom_inventory', 'on_completion', '*/10 * * * *', 'off', 'Files.com webhook triggers import; reconciliation is the backup. Imports never trigger MarketCheck.'),
  ('marketcheck_api', 'marketcheck_api', 'manual', NULL, 'off', 'Paid enrichment timing; locked until the product catalog is verified.')
ON CONFLICT (integration_key) DO NOTHING;

-- Paid enrichment cannot be scheduled while any catalog product lacks a
-- verified rate, repeat policy and retention right.
CREATE OR REPLACE FUNCTION public.integration_timing_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.enrichment_mode <> 'off' AND EXISTS (
       SELECT 1 FROM provider_product_catalog c WHERE c.enabled
          AND (c.rate_status <> 'verified' OR c.repeat_charge_policy = 'unknown' OR c.retention_policy = 'unknown')) THEN
    RAISE EXCEPTION 'paid_enrichment_requires_verified_catalog';
  END IF;
  IF NEW.integration = 'filescom_inventory' AND NEW.enrichment_mode <> 'off' THEN
    RAISE EXCEPTION 'filescom_imports_never_trigger_enrichment';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER integration_timing_guard BEFORE INSERT OR UPDATE ON public.integration_timing FOR EACH ROW EXECUTE FUNCTION public.integration_timing_guard();

CREATE TABLE public.bulk_feed_contracts (
  feed_key text PRIMARY KEY CHECK (feed_key ~ '^[a-z0-9_]{3,60}$'),
  provider text NOT NULL DEFAULT 'marketcheck',
  label text NOT NULL,
  format text NOT NULL CHECK (format IN ('csv','jsonl','parquet')),
  compression text NOT NULL DEFAULT 'none' CHECK (compression IN ('none','gzip','zstd')),
  delivery_method text NOT NULL CHECK (delivery_method IN ('sftp','s3','https','webhook')),
  delivery_scope text NOT NULL DEFAULT 'full' CHECK (delivery_scope IN ('full','delta')),
  -- Data refresh cadence is not the schema release cadence.
  data_refresh_cadence text,
  contracted boolean NOT NULL DEFAULT false,
  contract_evidence text,
  contract_verified_at timestamptz,
  contract_verified_by uuid,
  storage_rights text NOT NULL DEFAULT 'unknown' CHECK (storage_rights IN ('permitted','limited','prohibited','unknown')),
  retention_days integer,
  replay_rights text NOT NULL DEFAULT 'unknown' CHECK (replay_rights IN ('permitted','prohibited','unknown')),
  sharing_rights text NOT NULL DEFAULT 'unknown' CHECK (sharing_rights IN ('permitted','prohibited','unknown')),
  customer_display text NOT NULL DEFAULT 'unknown' CHECK (customer_display IN ('permitted','prohibited','unknown')),
  -- Name of a server-side secret for the delivery webhook; never Files.com's.
  webhook_secret_ref text CHECK (webhook_secret_ref IS NULL OR (webhook_secret_ref ~ '^MARKETCHECK_BULK_[A-Z0-9_]{1,40}$')),
  max_bytes bigint NOT NULL DEFAULT 2147483648 CHECK (max_bytes BETWEEN 1 AND 53687091200),
  max_rows bigint NOT NULL DEFAULT 20000000 CHECK (max_rows > 0),
  max_row_drop_pct integer NOT NULL DEFAULT 30 CHECK (max_row_drop_pct BETWEEN 1 AND 100),
  enabled boolean NOT NULL DEFAULT false,
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (NOT contracted OR (contract_evidence IS NOT NULL AND contract_verified_at IS NOT NULL)),
  CHECK (NOT enabled OR (contracted AND storage_rights <> 'unknown'))
);

CREATE TABLE public.bulk_feed_schema_versions (
  feed_key text NOT NULL REFERENCES public.bulk_feed_contracts(feed_key) ON DELETE CASCADE,
  version text NOT NULL,
  release_kind text NOT NULL DEFAULT 'quarterly_schema' CHECK (release_kind IN ('quarterly_schema','patch','initial')),
  status text NOT NULL DEFAULT 'upcoming' CHECK (status IN ('upcoming','current','deprecated','retired')),
  announced_at date,
  effective_at date,
  validation_deadline date,
  validated_at timestamptz,
  validated_by uuid,
  fields jsonb NOT NULL DEFAULT '[]'::jsonb,
  deprecated_fields text[] NOT NULL DEFAULT '{}',
  notes text,
  PRIMARY KEY (feed_key, version)
);
CREATE UNIQUE INDEX bulk_feed_one_current_schema ON public.bulk_feed_schema_versions (feed_key) WHERE status = 'current';

CREATE TABLE public.bulk_feed_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  feed_key text NOT NULL REFERENCES public.bulk_feed_contracts(feed_key),
  environment text NOT NULL CHECK (environment IN ('production','release_test')),
  delivery_key text NOT NULL,
  data_as_of date,
  scope text NOT NULL CHECK (scope IN ('full','delta')),
  schema_version text,
  expected_parts integer CHECK (expected_parts IS NULL OR expected_parts BETWEEN 1 AND 10000),
  completion_evidence text NOT NULL DEFAULT 'none' CHECK (completion_evidence IN ('notification','success_metadata','manifest','none')),
  completion_evidence_ref text,
  expected_row_count bigint,
  row_count bigint,
  valid_rows bigint,
  invalid_rows bigint,
  status text NOT NULL DEFAULT 'receiving' CHECK (status IN ('expected','receiving','complete','validated','importing','imported','failed','quarantined')),
  error text,
  expected_at timestamptz,
  received_at timestamptz,
  completed_at timestamptz,
  validated_at timestamptz,
  imported_at timestamptz,
  enriched_at timestamptz,
  replay_of uuid REFERENCES public.bulk_feed_deliveries(id),
  replay_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- A provider release-test file can never become production inventory.
  CHECK (environment = 'production' OR status NOT IN ('importing','imported'))
);
CREATE UNIQUE INDEX bulk_feed_delivery_identity ON public.bulk_feed_deliveries (feed_key, environment, delivery_key) WHERE replay_of IS NULL;

CREATE TABLE public.bulk_feed_delivery_parts (
  delivery_id uuid NOT NULL REFERENCES public.bulk_feed_deliveries(id) ON DELETE CASCADE,
  part_no integer NOT NULL CHECK (part_no >= 1),
  path text NOT NULL,
  size_bytes bigint,
  expected_checksum text,
  actual_checksum text,
  row_count bigint,
  integrity text NOT NULL DEFAULT 'pending' CHECK (integrity IN ('pending','ok','mismatch')),
  received_at timestamptz NOT NULL DEFAULT now(),
  downloaded_at timestamptz,
  storage_ref text,
  PRIMARY KEY (delivery_id, part_no)
);

CREATE TABLE public.bulk_feed_exceptions (
  id bigserial PRIMARY KEY,
  feed_key text,
  delivery_id uuid REFERENCES public.bulk_feed_deliveries(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('late_delivery','missing_parts','checksum_mismatch','no_completion_evidence','schema_unknown','schema_deprecated_field',
    'validation_deadline','row_count_drop','release_test_file','webhook_rejected','import_failed','replay_not_permitted')),
  severity text NOT NULL DEFAULT 'warning' CHECK (severity IN ('info','warning','blocking')),
  detail text,
  opened_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  resolved_by uuid,
  resolution text
);
CREATE UNIQUE INDEX bulk_feed_exception_open ON public.bulk_feed_exceptions (COALESCE(delivery_id::text, feed_key), kind) WHERE resolved_at IS NULL;

GRANT SELECT ON public.integration_timing, public.bulk_feed_contracts, public.bulk_feed_schema_versions, public.bulk_feed_deliveries, public.bulk_feed_delivery_parts, public.bulk_feed_exceptions TO authenticated;
GRANT ALL ON public.integration_timing, public.bulk_feed_contracts, public.bulk_feed_schema_versions, public.bulk_feed_deliveries, public.bulk_feed_delivery_parts, public.bulk_feed_exceptions TO service_role;
GRANT USAGE ON SEQUENCE public.bulk_feed_exceptions_id_seq TO service_role;
ALTER TABLE public.integration_timing ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bulk_feed_contracts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bulk_feed_schema_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bulk_feed_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bulk_feed_delivery_parts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bulk_feed_exceptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Platform admins read integration timing" ON public.integration_timing FOR SELECT TO authenticated USING (public.has_role((SELECT auth.uid()), 'admin'::public.app_role));
CREATE POLICY "Platform admins read bulk contracts" ON public.bulk_feed_contracts FOR SELECT TO authenticated USING (public.has_role((SELECT auth.uid()), 'admin'::public.app_role));
CREATE POLICY "Platform admins read bulk schemas" ON public.bulk_feed_schema_versions FOR SELECT TO authenticated USING (public.has_role((SELECT auth.uid()), 'admin'::public.app_role));
CREATE POLICY "Platform admins read bulk deliveries" ON public.bulk_feed_deliveries FOR SELECT TO authenticated USING (public.has_role((SELECT auth.uid()), 'admin'::public.app_role));
CREATE POLICY "Platform admins read bulk parts" ON public.bulk_feed_delivery_parts FOR SELECT TO authenticated USING (public.has_role((SELECT auth.uid()), 'admin'::public.app_role));
CREATE POLICY "Platform admins read bulk exceptions" ON public.bulk_feed_exceptions FOR SELECT TO authenticated USING (public.has_role((SELECT auth.uid()), 'admin'::public.app_role));
CREATE TRIGGER audit_integration_timing AFTER INSERT OR UPDATE ON public.integration_timing FOR EACH ROW EXECUTE FUNCTION public.inventory_network_audit_row();
CREATE TRIGGER audit_bulk_feed_contracts AFTER INSERT OR UPDATE OR DELETE ON public.bulk_feed_contracts FOR EACH ROW EXECUTE FUNCTION public.inventory_network_audit_row();

CREATE OR REPLACE FUNCTION public.bulk_feed_open_exception(p_feed text, p_delivery uuid, p_kind text, p_severity text, p_detail text)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO bulk_feed_exceptions (feed_key, delivery_id, kind, severity, detail) VALUES (p_feed, p_delivery, p_kind, p_severity, left(p_detail, 500))
  ON CONFLICT (COALESCE(delivery_id::text, feed_key), kind) WHERE resolved_at IS NULL DO UPDATE SET detail = EXCLUDED.detail;
$$;

-- Registers a delivery and its parts as they arrive. Idempotent per part.
CREATE OR REPLACE FUNCTION public.bulk_feed_record_part(p_feed text, p_environment text, p_delivery_key text, p_scope text, p_expected_parts integer,
  p_part_no integer, p_path text, p_size bigint, p_expected_checksum text, p_schema_version text DEFAULT NULL, p_data_as_of date DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid; c public.bulk_feed_contracts%ROWTYPE;
BEGIN
  SELECT * INTO c FROM bulk_feed_contracts WHERE feed_key = p_feed;
  IF NOT FOUND OR NOT c.contracted THEN RAISE EXCEPTION 'feed_not_contracted'; END IF;
  INSERT INTO bulk_feed_deliveries (feed_key, environment, delivery_key, scope, expected_parts, schema_version, data_as_of, received_at)
  VALUES (p_feed, p_environment, p_delivery_key, p_scope, p_expected_parts, p_schema_version, p_data_as_of, now())
  ON CONFLICT (feed_key, environment, delivery_key) WHERE replay_of IS NULL DO UPDATE SET
    expected_parts = COALESCE(bulk_feed_deliveries.expected_parts, EXCLUDED.expected_parts),
    schema_version = COALESCE(bulk_feed_deliveries.schema_version, EXCLUDED.schema_version)
  RETURNING id INTO v_id;
  IF p_environment = 'release_test' THEN
    PERFORM bulk_feed_open_exception(p_feed, v_id, 'release_test_file', 'info', 'Provider release-test delivery; kept apart from production inventory.');
  END IF;
  INSERT INTO bulk_feed_delivery_parts (delivery_id, part_no, path, size_bytes, expected_checksum) VALUES (v_id, p_part_no, p_path, p_size, p_expected_checksum)
  ON CONFLICT (delivery_id, part_no) DO NOTHING;
  RETURN v_id;
END $$;

-- Records completion evidence (a verified notification, success metadata or
-- a manifest) and decides whether the delivery is complete.
CREATE OR REPLACE FUNCTION public.bulk_feed_mark_complete(p_delivery uuid, p_evidence text, p_evidence_ref text, p_expected_parts integer DEFAULT NULL, p_expected_rows bigint DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE d public.bulk_feed_deliveries%ROWTYPE; v_missing int[]; v_bad int;
BEGIN
  IF p_evidence NOT IN ('notification','success_metadata','manifest') THEN RAISE EXCEPTION 'completion_evidence_required'; END IF;
  UPDATE bulk_feed_deliveries SET completion_evidence = p_evidence, completion_evidence_ref = left(p_evidence_ref, 300),
    expected_parts = COALESCE(p_expected_parts, expected_parts), expected_row_count = COALESCE(p_expected_rows, expected_row_count)
   WHERE id = p_delivery RETURNING * INTO d;
  IF NOT FOUND THEN RAISE EXCEPTION 'delivery_not_found'; END IF;
  IF d.expected_parts IS NULL THEN
    PERFORM bulk_feed_open_exception(d.feed_key, d.id, 'missing_parts', 'blocking', 'Expected part count unknown.');
    RETURN jsonb_build_object('complete', false, 'reason', 'expected_parts_unknown');
  END IF;
  SELECT array_agg(g) INTO v_missing FROM generate_series(1, d.expected_parts) g WHERE NOT EXISTS (SELECT 1 FROM bulk_feed_delivery_parts p WHERE p.delivery_id = d.id AND p.part_no = g);
  SELECT count(*) INTO v_bad FROM bulk_feed_delivery_parts p WHERE p.delivery_id = d.id AND (p.integrity = 'mismatch' OR p.part_no > d.expected_parts);
  IF v_missing IS NOT NULL THEN
    PERFORM bulk_feed_open_exception(d.feed_key, d.id, 'missing_parts', 'blocking', 'Missing parts: ' || array_to_string(v_missing, ','));
    RETURN jsonb_build_object('complete', false, 'reason', 'missing_parts', 'missing', to_jsonb(v_missing));
  END IF;
  IF v_bad > 0 THEN
    PERFORM bulk_feed_open_exception(d.feed_key, d.id, 'checksum_mismatch', 'blocking', v_bad || ' part(s) failed integrity or exceed the expected count.');
    RETURN jsonb_build_object('complete', false, 'reason', 'integrity');
  END IF;
  UPDATE bulk_feed_deliveries SET status = 'complete', completed_at = now() WHERE id = d.id AND status IN ('expected','receiving');
  RETURN jsonb_build_object('complete', true);
END $$;

-- Whether a delivery may become a committed snapshot, and whether absences
-- in it may be read as removals.
CREATE OR REPLACE FUNCTION public.bulk_feed_commit_decision(p_delivery uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE d public.bulk_feed_deliveries%ROWTYPE; c public.bulk_feed_contracts%ROWTYPE; v_prev bigint; v_reasons text[] := '{}'; v_schema text;
BEGIN
  SELECT * INTO d FROM bulk_feed_deliveries WHERE id = p_delivery;
  SELECT * INTO c FROM bulk_feed_contracts WHERE feed_key = d.feed_key;
  SELECT status INTO v_schema FROM bulk_feed_schema_versions WHERE feed_key = d.feed_key AND version = d.schema_version;
  IF NOT c.enabled THEN v_reasons := array_append(v_reasons, 'feed_not_enabled'::text); END IF;
  IF d.environment <> 'production' THEN v_reasons := array_append(v_reasons, 'release_test_file'::text); END IF;
  IF d.status NOT IN ('complete','validated') THEN v_reasons := array_append(v_reasons, ('delivery_' || d.status)::text); END IF;
  IF d.completion_evidence = 'none' THEN v_reasons := array_append(v_reasons, 'no_completion_evidence'::text); END IF;
  IF v_schema IS NULL OR v_schema NOT IN ('current','deprecated') THEN v_reasons := array_append(v_reasons, 'schema_not_active'::text); END IF;
  IF d.expected_row_count IS NOT NULL AND d.row_count IS DISTINCT FROM d.expected_row_count THEN v_reasons := array_append(v_reasons, 'row_count_mismatch'::text); END IF;
  SELECT row_count INTO v_prev FROM bulk_feed_deliveries WHERE feed_key = d.feed_key AND environment = 'production' AND status = 'imported' AND id <> d.id ORDER BY imported_at DESC LIMIT 1;
  RETURN jsonb_build_object('can_commit', cardinality(v_reasons) = 0, 'reasons', to_jsonb(v_reasons),
    'can_infer_removals', cardinality(v_reasons) = 0 AND d.scope = 'full'
       AND (v_prev IS NULL OR d.row_count IS NULL OR d.row_count >= v_prev * (100 - c.max_row_drop_pct) / 100.0),
    'previous_row_count', v_prev);
END $$;

-- Replays reuse a downloaded delivery only when retention and use rights allow.
CREATE OR REPLACE FUNCTION public.bulk_feed_request_replay(p_delivery uuid, p_reason text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := inv_require_platform_admin(); d public.bulk_feed_deliveries%ROWTYPE; c public.bulk_feed_contracts%ROWTYPE; v_id uuid;
BEGIN
  SELECT * INTO d FROM bulk_feed_deliveries WHERE id = p_delivery;
  IF NOT FOUND THEN RAISE EXCEPTION 'delivery_not_found'; END IF;
  SELECT * INTO c FROM bulk_feed_contracts WHERE feed_key = d.feed_key;
  IF c.replay_rights <> 'permitted' OR c.storage_rights NOT IN ('permitted','limited')
     OR (c.retention_days IS NOT NULL AND d.received_at < now() - make_interval(days => c.retention_days)) THEN
    PERFORM bulk_feed_open_exception(d.feed_key, d.id, 'replay_not_permitted', 'warning', 'Replay refused: retention or replay rights do not allow it.');
    RAISE EXCEPTION 'replay_not_permitted';
  END IF;
  IF length(trim(COALESCE(p_reason, ''))) < 3 THEN RAISE EXCEPTION 'reason_required'; END IF;
  INSERT INTO bulk_feed_deliveries (feed_key, environment, delivery_key, data_as_of, scope, schema_version, expected_parts, completion_evidence, completion_evidence_ref,
    expected_row_count, status, received_at, replay_of, replay_reason)
  VALUES (d.feed_key, d.environment, d.delivery_key, d.data_as_of, d.scope, d.schema_version, d.expected_parts, d.completion_evidence, d.completion_evidence_ref,
    d.expected_row_count, 'complete', now(), d.id, left(p_reason, 300) || ' (by ' || v_uid || ')')
  RETURNING id INTO v_id;
  INSERT INTO bulk_feed_delivery_parts (delivery_id, part_no, path, size_bytes, expected_checksum, actual_checksum, row_count, integrity, downloaded_at, storage_ref)
  SELECT v_id, part_no, path, size_bytes, expected_checksum, actual_checksum, row_count, integrity, downloaded_at, storage_ref FROM bulk_feed_delivery_parts WHERE delivery_id = d.id;
  RETURN v_id;
END $$;

-- Lateness and schema deadlines. Safe to run on a schedule: it only opens
-- exceptions, it never downloads, imports or spends.
CREATE OR REPLACE FUNCTION public.bulk_feed_check_schedule()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n integer := 0; r record;
BEGIN
  FOR r IN SELECT d.* , t.delivery_grace_minutes FROM bulk_feed_deliveries d LEFT JOIN integration_timing t ON t.integration_key = 'marketcheck_bulk:' || d.feed_key
            WHERE d.status = 'expected' AND d.expected_at IS NOT NULL AND d.expected_at + make_interval(mins => COALESCE(t.delivery_grace_minutes, 120)) < now() LOOP
    PERFORM bulk_feed_open_exception(r.feed_key, r.id, 'late_delivery', 'warning', 'Expected at ' || r.expected_at); n := n + 1;
  END LOOP;
  FOR r IN SELECT * FROM bulk_feed_deliveries WHERE status = 'receiving' AND completion_evidence = 'none' AND received_at < now() - interval '6 hours' LOOP
    PERFORM bulk_feed_open_exception(r.feed_key, r.id, 'no_completion_evidence', 'warning', 'Parts received but no completion notice or metadata yet.'); n := n + 1;
  END LOOP;
  FOR r IN SELECT * FROM bulk_feed_schema_versions WHERE status = 'upcoming' AND validated_at IS NULL AND validation_deadline IS NOT NULL AND validation_deadline <= current_date + 14 LOOP
    PERFORM bulk_feed_open_exception(r.feed_key, NULL, 'validation_deadline', CASE WHEN r.validation_deadline <= current_date THEN 'blocking' ELSE 'warning' END,
      'Schema ' || r.version || ' must be validated by ' || r.validation_deadline); n := n + 1;
  END LOOP;
  RETURN n;
END $$;

-- ── Admin ──────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.inv_admin_save_timing(p jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := inv_require_platform_admin();
BEGIN
  INSERT INTO integration_timing (integration_key, integration, expected_delivery_cron, expected_delivery_tz, delivery_grace_minutes, import_mode, import_cron,
    reconciliation_cron, enrichment_mode, enrichment_cron, note, updated_by)
  VALUES (p->>'integration_key', p->>'integration', NULLIF(p->>'expected_delivery_cron',''), NULLIF(p->>'expected_delivery_tz',''), COALESCE((p->>'delivery_grace_minutes')::int, 120),
    COALESCE(p->>'import_mode','manual'), NULLIF(p->>'import_cron',''), NULLIF(p->>'reconciliation_cron',''), COALESCE(p->>'enrichment_mode','off'), NULLIF(p->>'enrichment_cron',''), p->>'note', v_uid)
  ON CONFLICT (integration_key) DO UPDATE SET expected_delivery_cron = EXCLUDED.expected_delivery_cron, expected_delivery_tz = EXCLUDED.expected_delivery_tz,
    delivery_grace_minutes = EXCLUDED.delivery_grace_minutes, import_mode = EXCLUDED.import_mode, import_cron = EXCLUDED.import_cron,
    reconciliation_cron = EXCLUDED.reconciliation_cron, enrichment_mode = EXCLUDED.enrichment_mode, enrichment_cron = EXCLUDED.enrichment_cron,
    note = COALESCE(EXCLUDED.note, integration_timing.note), updated_by = v_uid, updated_at = now();
END $$;

CREATE OR REPLACE FUNCTION public.inv_admin_save_bulk_contract(p jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := inv_require_platform_admin(); v_contract boolean := COALESCE((p->>'mark_contracted')::boolean, false);
BEGIN
  IF v_contract AND length(trim(COALESCE(p->>'contract_evidence',''))) < 10 THEN RAISE EXCEPTION 'contract_evidence_required'; END IF;
  IF NOT EXISTS (SELECT 1 FROM bulk_feed_contracts WHERE feed_key = p->>'feed_key') THEN
    INSERT INTO bulk_feed_contracts (feed_key, label, format, compression, delivery_method, delivery_scope, data_refresh_cadence, updated_by)
    VALUES (p->>'feed_key', COALESCE(p->>'label', p->>'feed_key'), p->>'format', COALESCE(p->>'compression','none'), p->>'delivery_method', COALESCE(p->>'delivery_scope','full'), p->>'data_refresh_cadence', v_uid);
  END IF;
  UPDATE bulk_feed_contracts SET
    label = COALESCE(p->>'label', label), format = COALESCE(p->>'format', format), compression = COALESCE(p->>'compression', compression),
    delivery_method = COALESCE(p->>'delivery_method', delivery_method), delivery_scope = COALESCE(p->>'delivery_scope', delivery_scope),
    data_refresh_cadence = COALESCE(p->>'data_refresh_cadence', data_refresh_cadence),
    contracted = CASE WHEN v_contract THEN true ELSE contracted END,
    contract_evidence = COALESCE(NULLIF(p->>'contract_evidence',''), contract_evidence),
    contract_verified_at = CASE WHEN v_contract THEN now() ELSE contract_verified_at END, contract_verified_by = CASE WHEN v_contract THEN v_uid ELSE contract_verified_by END,
    storage_rights = COALESCE(p->>'storage_rights', storage_rights), retention_days = CASE WHEN p ? 'retention_days' THEN NULLIF(p->>'retention_days','')::int ELSE retention_days END,
    replay_rights = COALESCE(p->>'replay_rights', replay_rights), sharing_rights = COALESCE(p->>'sharing_rights', sharing_rights),
    customer_display = COALESCE(p->>'customer_display', customer_display), webhook_secret_ref = COALESCE(NULLIF(p->>'webhook_secret_ref',''), webhook_secret_ref),
    enabled = COALESCE((p->>'enabled')::boolean, enabled), updated_by = v_uid, updated_at = now()
  WHERE feed_key = p->>'feed_key';
END $$;

CREATE OR REPLACE FUNCTION public.inv_admin_resolve_bulk_exception(p_id bigint, p_resolution text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := inv_require_platform_admin();
BEGIN
  IF length(trim(COALESCE(p_resolution, ''))) < 3 THEN RAISE EXCEPTION 'resolution_required'; END IF;
  UPDATE bulk_feed_exceptions SET resolved_at = now(), resolved_by = v_uid, resolution = left(p_resolution, 300) WHERE id = p_id AND resolved_at IS NULL;
END $$;

-- One read model for the delivery timeline and exception queue, across the
-- Files.com feed (from 0004/0006 runs) and any bulk feeds.
CREATE OR REPLACE FUNCTION public.inv_admin_delivery_timeline(p_limit integer DEFAULT 50)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM inv_require_platform_admin();
  RETURN jsonb_build_object(
    'timing', COALESCE((SELECT jsonb_agg(to_jsonb(t) ORDER BY t.integration_key) FROM integration_timing t), '[]'::jsonb),
    'contracts', COALESCE((SELECT jsonb_agg(jsonb_build_object('feed_key', feed_key, 'label', label, 'format', format, 'contracted', contracted, 'enabled', enabled,
        'storage_rights', storage_rights, 'replay_rights', replay_rights, 'sharing_rights', sharing_rights, 'customer_display', customer_display,
        'data_refresh_cadence', data_refresh_cadence, 'webhook_configured', webhook_secret_ref IS NOT NULL)) FROM bulk_feed_contracts), '[]'::jsonb),
    'schemas', COALESCE((SELECT jsonb_agg(jsonb_build_object('feed_key', feed_key, 'version', version, 'release_kind', release_kind, 'status', status,
        'effective_at', effective_at, 'validation_deadline', validation_deadline, 'validated_at', validated_at, 'deprecated_fields', deprecated_fields)
        ORDER BY feed_key, effective_at DESC NULLS FIRST) FROM bulk_feed_schema_versions), '[]'::jsonb),
    'bulk_deliveries', COALESCE((SELECT jsonb_agg(x ORDER BY x.received_at DESC NULLS LAST) FROM (
        SELECT d.id, d.feed_key, d.environment, d.delivery_key, d.scope, d.schema_version, d.status, d.expected_parts,
               (SELECT count(*) FROM bulk_feed_delivery_parts p WHERE p.delivery_id = d.id) AS received_parts,
               (SELECT count(*) FROM bulk_feed_delivery_parts p WHERE p.delivery_id = d.id AND p.integrity = 'ok') AS verified_parts,
               d.completion_evidence, d.row_count, d.expected_row_count, d.expected_at, d.received_at, d.completed_at, d.validated_at, d.imported_at, d.enriched_at,
               d.replay_of, d.error
          FROM bulk_feed_deliveries d ORDER BY d.created_at DESC LIMIT p_limit) x), '[]'::jsonb),
    'filescom_runs', COALESCE((SELECT jsonb_agg(x ORDER BY x.started_at DESC) FROM (
        SELECT r.id, r.path, r.kind, r.status, r.started_at, r.finished_at, r.affected_store_ids, r.failure_reason
          FROM inventory_feed_runs r ORDER BY r.started_at DESC LIMIT p_limit) x), '[]'::jsonb),
    'exceptions', COALESCE((SELECT jsonb_agg(to_jsonb(e) ORDER BY e.opened_at DESC) FROM bulk_feed_exceptions e WHERE e.resolved_at IS NULL), '[]'::jsonb));
END $$;

REVOKE ALL ON FUNCTION public.bulk_feed_open_exception(text, uuid, text, text, text),
  public.bulk_feed_record_part(text, text, text, text, integer, integer, text, bigint, text, text, date),
  public.bulk_feed_mark_complete(uuid, text, text, integer, bigint), public.bulk_feed_commit_decision(uuid), public.bulk_feed_check_schedule() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bulk_feed_open_exception(text, uuid, text, text, text),
  public.bulk_feed_record_part(text, text, text, text, integer, integer, text, bigint, text, text, date),
  public.bulk_feed_mark_complete(uuid, text, text, integer, bigint), public.bulk_feed_commit_decision(uuid), public.bulk_feed_check_schedule() TO service_role;
REVOKE ALL ON FUNCTION public.inv_admin_save_timing(jsonb), public.inv_admin_save_bulk_contract(jsonb), public.inv_admin_resolve_bulk_exception(bigint, text),
  public.inv_admin_delivery_timeline(integer), public.bulk_feed_request_replay(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.inv_admin_save_timing(jsonb), public.inv_admin_save_bulk_contract(jsonb), public.inv_admin_resolve_bulk_exception(bigint, text),
  public.inv_admin_delivery_timeline(integer), public.bulk_feed_request_replay(uuid, text) TO authenticated;
