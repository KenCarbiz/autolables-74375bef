-- ─────────────────────────────────────────────────────────────────────
-- Description Intelligence — durable lifecycle for automated vehicle
-- merchandising copy.
--
-- Design rules honored here:
--   * vehicle_listings.description stays the PUBLISHED PROJECTION only.
--     It is never turned into the version-history store. Passport plumbing
--     that already reads it is untouched.
--   * Every new table is tenant-scoped with the modern RLS shape
--     (tenant_id IN (SELECT ... WHERE user_id = (SELECT auth.uid()))) and a
--     NOT NULL tenant_id — never the weak auth.role()='authenticated' form.
--   * Generated content is immutable and versioned (the generated_documents
--     pattern): new content = new row, never an in-place rewrite.
--   * Market intelligence (value/comps/depreciation/resale) is carried as
--     SUPPORTING context in the fact snapshot and can never be promoted to a
--     verified vehicle fact.
-- ─────────────────────────────────────────────────────────────────────

-- ── 1. Tenant merchandising & SEO configuration ──────────────────────
CREATE TABLE IF NOT EXISTS public.description_settings (
  tenant_id            uuid PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
  review_mode          text NOT NULL DEFAULT 'EXCEPTION_REVIEW'
                         CHECK (review_mode IN ('AUTO_PUBLISH_CLEAN','EXCEPTION_REVIEW','REQUIRE_APPROVAL_ALL','DRAFT_ONLY')),
  -- per-inventory-class overrides: {"new":"AUTO_PUBLISH_CLEAN","cpo":"REQUIRE_APPROVAL_ALL"}
  review_mode_by_class jsonb NOT NULL DEFAULT '{}'::jsonb,
  enabled_channels     jsonb NOT NULL DEFAULT '["vehicle_passport","dealer_website","autotrader","cars_com","cargurus","facebook","google_seo"]'::jsonb,
  internal_publication_enabled boolean NOT NULL DEFAULT true,
  brand_voice          text,
  default_tone         text NOT NULL DEFAULT 'professional',
  dealer_name_format   text,
  primary_city         text,
  state                text,
  selling_areas        jsonb NOT NULL DEFAULT '[]'::jsonb,
  cta_template         text,
  prohibited_phrases   jsonb NOT NULL DEFAULT '[]'::jsonb,
  required_legal_text  text,
  min_length           integer NOT NULL DEFAULT 400,
  max_length           integer NOT NULL DEFAULT 2400,
  -- writing rules keyed by class: new / used / cpo / demo
  class_rules          jsonb NOT NULL DEFAULT '{}'::jsonb,
  warranty_language_allowed boolean NOT NULL DEFAULT false,
  cpo_language_allowed boolean NOT NULL DEFAULT false,
  accessory_language_allowed boolean NOT NULL DEFAULT false,
  -- market context may only be phrased when explicitly enabled by the dealer
  market_context_allowed boolean NOT NULL DEFAULT false,
  price_in_description boolean NOT NULL DEFAULT false,
  quality_threshold    integer NOT NULL DEFAULT 70,
  generation_model     text NOT NULL DEFAULT 'claude-haiku-4-5',
  prompt_version       text NOT NULL DEFAULT 'v1',
  -- deterministic fingerprint of the material settings above
  configuration_version text NOT NULL DEFAULT 'cfg_0',
  updated_by           uuid REFERENCES auth.users(id),
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

-- ── 2. One operational case per tenant/vehicle ───────────────────────
CREATE TABLE IF NOT EXISTS public.description_cases (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                  uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  vehicle_id                 uuid NOT NULL REFERENCES public.vehicle_listings(id) ON DELETE CASCADE,
  vin                        text NOT NULL,
  status                     text NOT NULL DEFAULT 'UNINITIALIZED'
                               CHECK (status IN (
                                 'UNINITIALIZED','QUEUED','BUILDING_FACTS','GENERATING','VALIDATING',
                                 'REVIEW_REQUIRED','READY','PUBLISHING','PARTIALLY_PUBLISHED','PUBLISHED',
                                 'STALE','FAILED_RETRYABLE','FAILED_BLOCKED','ARCHIVED')),
  current_source_data_version   text,
  processed_source_data_version text,
  configuration_version      text,
  current_master_version_id  uuid,
  published_master_version_id uuid,
  review_mode                text,
  publication_eligibility    text NOT NULL DEFAULT 'unknown'
                               CHECK (publication_eligibility IN ('eligible','blocked','review_required','unknown')),
  fact_confidence            integer,
  quality_score              integer,
  master_locked              boolean NOT NULL DEFAULT false,
  master_locked_by           uuid REFERENCES auth.users(id),
  master_locked_at           timestamptz,
  master_lock_reason         text,
  potentially_stale          boolean NOT NULL DEFAULT false,
  open_exception_count       integer NOT NULL DEFAULT 0,
  last_orchestrated_at       timestamptz,
  last_success_at            timestamptz,
  last_failure_at            timestamptz,
  last_error_message         text,
  archived_at                timestamptz,
  -- optimistic concurrency: every mutation bumps this; stale actors are rejected
  lock_version               integer NOT NULL DEFAULT 0,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  updated_at                 timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT description_cases_tenant_vehicle_key UNIQUE (tenant_id, vehicle_id)
);
CREATE INDEX IF NOT EXISTS idx_description_cases_tenant_status ON public.description_cases (tenant_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_description_cases_tenant_vin ON public.description_cases (tenant_id, vin);
CREATE INDEX IF NOT EXISTS idx_description_cases_vehicle ON public.description_cases (vehicle_id);

-- ── 3. Immutable fact snapshot per generation ────────────────────────
CREATE TABLE IF NOT EXISTS public.description_fact_snapshots (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  vehicle_id          uuid NOT NULL,
  description_case_id uuid NOT NULL REFERENCES public.description_cases(id) ON DELETE CASCADE,
  source_data_version text NOT NULL,
  -- { field: { value, source, status, observed_at, usable_in_copy, evidence } }
  facts_json          jsonb NOT NULL DEFAULT '{}'::jsonb,
  source_lineage_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  conflicts_json      jsonb NOT NULL DEFAULT '[]'::jsonb,
  excluded_claims_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- market value / comps / depreciation: SUPPORTING context, never a vehicle fact
  market_context_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  fact_confidence     integer,
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_description_fact_snapshots_case ON public.description_fact_snapshots (description_case_id, created_at DESC);

-- ── 4. Immutable master versions ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.description_versions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  vehicle_id          uuid NOT NULL,
  description_case_id uuid NOT NULL REFERENCES public.description_cases(id) ON DELETE CASCADE,
  parent_version_id   uuid REFERENCES public.description_versions(id) ON DELETE SET NULL,
  fact_snapshot_id    uuid REFERENCES public.description_fact_snapshots(id) ON DELETE SET NULL,
  version_number      integer NOT NULL,
  version_type        text NOT NULL DEFAULT 'generated'
                        CHECK (version_type IN ('generated','manual','regenerated','merged','restored')),
  content             text NOT NULL,
  word_count          integer,
  character_count     integer,
  generation_model    text,
  prompt_version      text,
  configuration_version text,
  source_data_version text,
  created_by_type     text NOT NULL DEFAULT 'automation' CHECK (created_by_type IN ('automation','user')),
  created_by_user_id  uuid REFERENCES auth.users(id),
  manual_edit         boolean NOT NULL DEFAULT false,
  edit_reason         text,
  validation_status   text NOT NULL DEFAULT 'pending'
                        CHECK (validation_status IN ('pending','passed','warning','blocked')),
  approval_status     text NOT NULL DEFAULT 'none'
                        CHECK (approval_status IN ('none','pending','approved','rejected')),
  approved_by         uuid REFERENCES auth.users(id),
  approved_at         timestamptz,
  quality_score       integer,
  created_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT description_versions_case_number_key UNIQUE (description_case_id, version_number)
);
CREATE INDEX IF NOT EXISTS idx_description_versions_case ON public.description_versions (description_case_id, version_number DESC);

ALTER TABLE public.description_cases
  DROP CONSTRAINT IF EXISTS description_cases_current_master_fk;
ALTER TABLE public.description_cases
  ADD CONSTRAINT description_cases_current_master_fk
  FOREIGN KEY (current_master_version_id) REFERENCES public.description_versions(id) ON DELETE SET NULL;
ALTER TABLE public.description_cases
  DROP CONSTRAINT IF EXISTS description_cases_published_master_fk;
ALTER TABLE public.description_cases
  ADD CONSTRAINT description_cases_published_master_fk
  FOREIGN KEY (published_master_version_id) REFERENCES public.description_versions(id) ON DELETE SET NULL;

-- ── 5. Channel derivatives ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.description_channel_versions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  vehicle_id          uuid NOT NULL,
  description_case_id uuid NOT NULL REFERENCES public.description_cases(id) ON DELETE CASCADE,
  master_version_id   uuid NOT NULL REFERENCES public.description_versions(id) ON DELETE CASCADE,
  channel             text NOT NULL,
  content             text NOT NULL,
  seo_title           text,
  meta_description    text,
  character_count     integer,
  character_limit     integer,
  validation_status   text NOT NULL DEFAULT 'pending'
                        CHECK (validation_status IN ('pending','passed','warning','blocked')),
  locked              boolean NOT NULL DEFAULT false,
  locked_by           uuid REFERENCES auth.users(id),
  locked_at           timestamptz,
  lock_reason         text,
  potentially_stale   boolean NOT NULL DEFAULT false,
  manual_edit         boolean NOT NULL DEFAULT false,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT description_channel_versions_master_channel_key UNIQUE (master_version_id, channel)
);
CREATE INDEX IF NOT EXISTS idx_description_channel_versions_case ON public.description_channel_versions (description_case_id, channel);

-- ── 6. Validation findings ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.description_validation_results (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  description_case_id uuid NOT NULL REFERENCES public.description_cases(id) ON DELETE CASCADE,
  version_id          uuid REFERENCES public.description_versions(id) ON DELETE CASCADE,
  channel_version_id  uuid REFERENCES public.description_channel_versions(id) ON DELETE CASCADE,
  validator_code      text NOT NULL,
  severity            text NOT NULL DEFAULT 'info' CHECK (severity IN ('info','warning','blocking')),
  status              text NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved','dismissed')),
  message             text NOT NULL,
  fact_path           text,
  claim_text          text,
  source_reference    text,
  blocking            boolean NOT NULL DEFAULT false,
  created_at          timestamptz NOT NULL DEFAULT now(),
  resolved_at         timestamptz,
  resolved_by         uuid REFERENCES auth.users(id)
);
CREATE INDEX IF NOT EXISTS idx_description_validation_version ON public.description_validation_results (version_id, severity);
CREATE INDEX IF NOT EXISTS idx_description_validation_case ON public.description_validation_results (description_case_id, status);

-- ── 7. Operational exceptions ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.description_exceptions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  vehicle_id          uuid NOT NULL,
  description_case_id uuid NOT NULL REFERENCES public.description_cases(id) ON DELETE CASCADE,
  exception_type      text NOT NULL,
  severity            text NOT NULL DEFAULT 'medium' CHECK (severity IN ('info','low','medium','high','critical')),
  status              text NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','resolved','dismissed')),
  blocking            boolean NOT NULL DEFAULT false,
  title               text NOT NULL,
  summary             text,
  details_json        jsonb NOT NULL DEFAULT '{}'::jsonb,
  channel             text,
  assigned_to         uuid REFERENCES auth.users(id),
  resolution          text,
  resolved_by         uuid REFERENCES auth.users(id),
  resolved_at         timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
-- one OPEN exception of a given type per case (mirrors vehicle_exceptions dedupe)
CREATE UNIQUE INDEX IF NOT EXISTS uq_description_exceptions_open
  ON public.description_exceptions (description_case_id, exception_type, COALESCE(channel,''))
  WHERE status IN ('open','in_progress');
CREATE INDEX IF NOT EXISTS idx_description_exceptions_tenant ON public.description_exceptions (tenant_id, status, severity, created_at DESC);

-- ── 8. Durable jobs (orchestration + retry) ──────────────────────────
CREATE TABLE IF NOT EXISTS public.description_jobs (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  vehicle_id          uuid NOT NULL,
  description_case_id uuid REFERENCES public.description_cases(id) ON DELETE CASCADE,
  job_type            text NOT NULL DEFAULT 'full_generation',
  status              text NOT NULL DEFAULT 'queued'
                        CHECK (status IN ('queued','running','succeeded','failed_retryable','failed_blocked','cancelled')),
  -- tenant + vehicle + source_data_version + configuration_version + job_type
  idempotency_key     text NOT NULL,
  attempt_count       integer NOT NULL DEFAULT 0,
  max_attempts        integer NOT NULL DEFAULT 3,
  scheduled_at        timestamptz NOT NULL DEFAULT now(),
  started_at          timestamptz,
  completed_at        timestamptz,
  failed_at           timestamptz,
  last_error_code     text,
  last_error_message  text,
  payload_json        jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT description_jobs_idempotency_key_key UNIQUE (idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_description_jobs_tenant_status ON public.description_jobs (tenant_id, status, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_description_jobs_case ON public.description_jobs (description_case_id, created_at DESC);

-- ── 9. Publication / delivery records ────────────────────────────────
CREATE TABLE IF NOT EXISTS public.description_deliveries (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  vehicle_id          uuid NOT NULL,
  description_case_id uuid NOT NULL REFERENCES public.description_cases(id) ON DELETE CASCADE,
  version_id          uuid REFERENCES public.description_versions(id) ON DELETE SET NULL,
  channel_version_id  uuid REFERENCES public.description_channel_versions(id) ON DELETE SET NULL,
  destination         text NOT NULL,
  -- internal_projection = a real write we perform; export_only / connector = external
  delivery_mode       text NOT NULL DEFAULT 'export_only'
                        CHECK (delivery_mode IN ('internal_projection','export_only','connector')),
  connector_status    text NOT NULL DEFAULT 'not_configured'
                        CHECK (connector_status IN ('available','not_configured','export_only')),
  status              text NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending','queued','delivered','failed','skipped','unavailable')),
  idempotency_key     text NOT NULL,
  attempt_count       integer NOT NULL DEFAULT 0,
  remote_identifier   text,
  request_metadata    jsonb NOT NULL DEFAULT '{}'::jsonb,
  response_metadata   jsonb NOT NULL DEFAULT '{}'::jsonb,
  published_at        timestamptz,
  failed_at           timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT description_deliveries_idempotency_key_key UNIQUE (idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_description_deliveries_case ON public.description_deliveries (description_case_id, destination, created_at DESC);

-- ── updated_at triggers ──────────────────────────────────────────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['description_settings','description_cases','description_channel_versions',
                           'description_exceptions','description_jobs','description_deliveries'] LOOP
    EXECUTE format(
      'DROP TRIGGER IF EXISTS set_updated_at_%1$s ON public.%1$s;
       CREATE TRIGGER set_updated_at_%1$s BEFORE UPDATE ON public.%1$s
       FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();', t);
  END LOOP;
END $$;

-- ── RLS: tenant isolation (modern shape, accepted members only) ──────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['description_settings','description_cases','description_fact_snapshots',
                           'description_versions','description_channel_versions','description_validation_results',
                           'description_exceptions','description_jobs','description_deliveries'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', t);
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename=t AND policyname='tenant_members_read') THEN
      EXECUTE format($f$
        CREATE POLICY "tenant_members_read" ON public.%I FOR SELECT TO authenticated
        USING (tenant_id IN (SELECT tenant_id FROM public.tenant_members
                             WHERE user_id = (SELECT auth.uid()) AND accepted_at IS NOT NULL));$f$, t);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename=t AND policyname='tenant_members_write') THEN
      EXECUTE format($f$
        CREATE POLICY "tenant_members_write" ON public.%I FOR ALL TO authenticated
        USING (tenant_id IN (SELECT tenant_id FROM public.tenant_members
                             WHERE user_id = (SELECT auth.uid()) AND accepted_at IS NOT NULL))
        WITH CHECK (tenant_id IN (SELECT tenant_id FROM public.tenant_members
                                  WHERE user_id = (SELECT auth.uid()) AND accepted_at IS NOT NULL));$f$, t);
    END IF;
  END LOOP;
END $$;

-- ─────────────────────────────────────────────────────────────────────
-- RPC 1 — initialize a case idempotently (safe to call on every ingest)
-- Returns the case id. Never creates a second case for the same vehicle.
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.init_description_case(p_tenant_id uuid, p_vehicle_id uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_id uuid; v_vin text; v_status text;
BEGIN
  SELECT vin, status INTO v_vin, v_status FROM public.vehicle_listings
   WHERE id = p_vehicle_id AND (tenant_id = p_tenant_id OR tenant_id IS NULL);
  IF v_vin IS NULL THEN RETURN NULL; END IF;
  -- never (re)open a case for inventory that has left the lot
  IF v_status = 'archived' THEN RETURN NULL; END IF;

  SELECT id INTO v_id FROM public.description_cases
   WHERE tenant_id = p_tenant_id AND vehicle_id = p_vehicle_id;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;

  INSERT INTO public.description_cases (tenant_id, vehicle_id, vin, status)
  VALUES (p_tenant_id, p_vehicle_id, v_vin, 'QUEUED')
  ON CONFLICT (tenant_id, vehicle_id) DO UPDATE SET updated_at = now()
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

-- ─────────────────────────────────────────────────────────────────────
-- RPC 2 — atomically claim a job. Returns the job id when THIS caller
-- won the claim, NULL when another worker already holds it. This is the
-- concurrency guard: the unique idempotency_key makes the insert the lock.
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.claim_description_job(
  p_tenant_id uuid, p_vehicle_id uuid, p_case_id uuid,
  p_job_type text, p_idempotency_key text, p_payload jsonb DEFAULT '{}'::jsonb)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_id uuid; v_status text; v_attempts int; v_max int;
BEGIN
  INSERT INTO public.description_jobs
    (tenant_id, vehicle_id, description_case_id, job_type, idempotency_key, payload_json,
     status, attempt_count, started_at)
  VALUES (p_tenant_id, p_vehicle_id, p_case_id, p_job_type, p_idempotency_key, p_payload,
     'running', 1, now())
  ON CONFLICT (idempotency_key) DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NOT NULL THEN RETURN v_id; END IF;

  -- Existing job: only re-claim retryable failures under the attempt ceiling,
  -- or a 'running' job abandoned by a dead worker (>15 min).
  SELECT id, status, attempt_count, max_attempts INTO v_id, v_status, v_attempts, v_max
    FROM public.description_jobs WHERE idempotency_key = p_idempotency_key;

  IF v_status = 'failed_retryable' AND v_attempts < v_max THEN
    UPDATE public.description_jobs
       SET status='running', attempt_count = attempt_count + 1, started_at = now(), updated_at = now()
     WHERE id = v_id;
    RETURN v_id;
  END IF;

  IF v_status = 'running' AND EXISTS (
       SELECT 1 FROM public.description_jobs
        WHERE id = v_id AND started_at < now() - interval '15 minutes') THEN
    UPDATE public.description_jobs
       SET attempt_count = attempt_count + 1, started_at = now(), updated_at = now()
     WHERE id = v_id;
    RETURN v_id;
  END IF;

  RETURN NULL;
END $$;

-- ─────────────────────────────────────────────────────────────────────
-- RPC 3 — internal publication. The ONLY writer of the published
-- projection. Atomic, audited, optimistic-concurrency guarded.
--
-- Refuses to publish when: the version is not validated, the case moved
-- underneath the caller (stale approval), the version is older than the
-- one already published, or the vehicle is archived.
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.publish_description_internal(
  p_case_id uuid, p_version_id uuid, p_expected_lock_version integer)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_case public.description_cases%ROWTYPE;
  v_ver  public.description_versions%ROWTYPE;
  v_pub  public.description_versions%ROWTYPE;
  v_uid  uuid := (SELECT auth.uid());
  v_key  text;
BEGIN
  SELECT * INTO v_case FROM public.description_cases WHERE id = p_case_id FOR UPDATE;
  IF v_case.id IS NULL THEN RETURN jsonb_build_object('ok',false,'error','case_not_found'); END IF;

  -- tenant membership is enforced here because SECURITY DEFINER bypasses RLS
  IF NOT EXISTS (SELECT 1 FROM public.tenant_members
                  WHERE tenant_id = v_case.tenant_id AND user_id = v_uid AND accepted_at IS NOT NULL) THEN
    RETURN jsonb_build_object('ok',false,'error','not_a_member');
  END IF;

  IF v_case.archived_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok',false,'error','case_archived');
  END IF;

  IF p_expected_lock_version IS NOT NULL AND v_case.lock_version <> p_expected_lock_version THEN
    RETURN jsonb_build_object('ok',false,'error','stale_version','current_lock_version',v_case.lock_version);
  END IF;

  SELECT * INTO v_ver FROM public.description_versions WHERE id = p_version_id;
  IF v_ver.id IS NULL OR v_ver.description_case_id <> p_case_id THEN
    RETURN jsonb_build_object('ok',false,'error','version_not_found');
  END IF;
  IF v_ver.validation_status = 'blocked' OR v_ver.validation_status = 'pending' THEN
    RETURN jsonb_build_object('ok',false,'error','validation_not_passed','validation_status',v_ver.validation_status);
  END IF;

  -- never let an older version overwrite a newer published one
  IF v_case.published_master_version_id IS NOT NULL THEN
    SELECT * INTO v_pub FROM public.description_versions WHERE id = v_case.published_master_version_id;
    IF v_pub.id IS NOT NULL AND v_ver.version_number < v_pub.version_number THEN
      RETURN jsonb_build_object('ok',false,'error','older_than_published');
    END IF;
  END IF;

  -- the permitted projection into the field Passport plumbing already reads
  UPDATE public.vehicle_listings SET description = v_ver.content WHERE id = v_case.vehicle_id;

  UPDATE public.description_cases
     SET published_master_version_id = p_version_id,
         current_master_version_id  = COALESCE(current_master_version_id, p_version_id),
         status = 'PUBLISHED',
         publication_eligibility = 'eligible',
         potentially_stale = false,
         last_success_at = now(),
         lock_version = lock_version + 1,
         updated_at = now()
   WHERE id = p_case_id;

  v_key := p_case_id::text || ':' || p_version_id::text || ':vehicle_passport';
  INSERT INTO public.description_deliveries
    (tenant_id, vehicle_id, description_case_id, version_id, destination, delivery_mode,
     connector_status, status, idempotency_key, attempt_count, published_at)
  VALUES (v_case.tenant_id, v_case.vehicle_id, p_case_id, p_version_id, 'vehicle_passport',
     'internal_projection','available','delivered', v_key, 1, now())
  ON CONFLICT (idempotency_key) DO UPDATE
    SET status='delivered', published_at=now(), attempt_count = public.description_deliveries.attempt_count + 1;

  INSERT INTO public.audit_log (action, entity_type, entity_id, store_id, user_id, details)
  VALUES ('description_published_internal','description_case', p_case_id::text,
          v_case.tenant_id::text, v_uid,
          jsonb_build_object('vin', v_case.vin, 'vehicle_id', v_case.vehicle_id,
                             'version_id', p_version_id, 'version_number', v_ver.version_number,
                             'destination','vehicle_passport'));

  RETURN jsonb_build_object('ok',true,'case_id',p_case_id,'version_id',p_version_id,
                            'lock_version', v_case.lock_version + 1);
END $$;

-- ─────────────────────────────────────────────────────────────────────
-- RPC 4 — archive a case when the vehicle is sold/removed. Stops future
-- publication, retains history, clears it from active exception counts.
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.archive_description_case(p_case_id uuid, p_reason text DEFAULT NULL)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_tenant uuid; v_vin text;
BEGIN
  SELECT tenant_id, vin INTO v_tenant, v_vin FROM public.description_cases WHERE id = p_case_id;
  IF v_tenant IS NULL THEN RETURN false; END IF;

  UPDATE public.description_cases
     SET status='ARCHIVED', archived_at = now(), publication_eligibility='blocked',
         open_exception_count = 0, lock_version = lock_version + 1, updated_at = now()
   WHERE id = p_case_id;

  UPDATE public.description_exceptions
     SET status='dismissed', resolution = COALESCE(p_reason,'vehicle archived'), resolved_at = now()
   WHERE description_case_id = p_case_id AND status IN ('open','in_progress');

  UPDATE public.description_jobs SET status='cancelled', updated_at = now()
   WHERE description_case_id = p_case_id AND status IN ('queued','running');

  INSERT INTO public.audit_log (action, entity_type, entity_id, store_id, details)
  VALUES ('description_archived','description_case', p_case_id::text, v_tenant::text,
          jsonb_build_object('vin', v_vin, 'reason', p_reason));
  RETURN true;
END $$;

-- ─────────────────────────────────────────────────────────────────────
-- RPC 5 — reconciliation candidates. Finds active vehicles that never got
-- a case (non-MarketCheck ingest paths) plus cases whose source data moved
-- on, retryable failures, and jobs abandoned mid-flight.
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.next_description_reconcile_batch(
  p_tenant_id uuid DEFAULT NULL, p_limit integer DEFAULT 50)
RETURNS TABLE (tenant_id uuid, vehicle_id uuid, vin text, case_id uuid, reason text)
LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$
  -- 1. active inventory with no description case at all
  SELECT vl.tenant_id, vl.id, vl.vin, NULL::uuid, 'missing_case'::text
    FROM public.vehicle_listings vl
    LEFT JOIN public.description_cases dc
      ON dc.vehicle_id = vl.id AND dc.tenant_id = vl.tenant_id
   WHERE vl.tenant_id IS NOT NULL
     AND vl.status IN ('draft','published')
     AND vl.vin IS NOT NULL
     AND dc.id IS NULL
     AND (p_tenant_id IS NULL OR vl.tenant_id = p_tenant_id)
  UNION ALL
  -- 2. cases whose inputs changed since the last processed version
  SELECT dc.tenant_id, dc.vehicle_id, dc.vin, dc.id, 'source_changed'::text
    FROM public.description_cases dc
   WHERE dc.archived_at IS NULL
     AND dc.status NOT IN ('ARCHIVED','FAILED_BLOCKED')
     AND dc.current_source_data_version IS NOT NULL
     AND dc.current_source_data_version IS DISTINCT FROM dc.processed_source_data_version
     AND (p_tenant_id IS NULL OR dc.tenant_id = p_tenant_id)
  UNION ALL
  -- 3. retryable failures still under the attempt ceiling
  SELECT dc.tenant_id, dc.vehicle_id, dc.vin, dc.id, 'retryable'::text
    FROM public.description_cases dc
   WHERE dc.archived_at IS NULL
     AND dc.status = 'FAILED_RETRYABLE'
     AND (p_tenant_id IS NULL OR dc.tenant_id = p_tenant_id)
  UNION ALL
  -- 4. cases stuck mid-flight because a worker died
  SELECT dc.tenant_id, dc.vehicle_id, dc.vin, dc.id, 'stalled'::text
    FROM public.description_cases dc
   WHERE dc.archived_at IS NULL
     AND dc.status IN ('QUEUED','BUILDING_FACTS','GENERATING','VALIDATING','PUBLISHING')
     AND dc.updated_at < now() - interval '30 minutes'
     AND (p_tenant_id IS NULL OR dc.tenant_id = p_tenant_id)
  LIMIT GREATEST(p_limit, 1);
$$;

-- ─────────────────────────────────────────────────────────────────────
-- Trigger — a sold/archived listing stops description publication.
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.description_case_follow_listing_status()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'archived' AND COALESCE(OLD.status,'') <> 'archived' THEN
    PERFORM public.archive_description_case(dc.id, 'listing archived')
      FROM public.description_cases dc
     WHERE dc.vehicle_id = NEW.id AND dc.archived_at IS NULL;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_description_case_follow_listing ON public.vehicle_listings;
CREATE TRIGGER trg_description_case_follow_listing
AFTER UPDATE OF status ON public.vehicle_listings
FOR EACH ROW EXECUTE FUNCTION public.description_case_follow_listing_status();

GRANT EXECUTE ON FUNCTION public.init_description_case(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_description_job(uuid, uuid, uuid, text, text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.next_description_reconcile_batch(uuid, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.publish_description_internal(uuid, uuid, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.archive_description_case(uuid, text) TO authenticated, service_role;
