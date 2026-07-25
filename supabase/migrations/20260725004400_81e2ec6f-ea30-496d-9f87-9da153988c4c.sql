-- ─────────────────────────────────────────────────────────────────────
-- Description Intelligence — durable lifecycle for automated vehicle
-- merchandising copy.
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.description_settings (
  tenant_id            uuid PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
  review_mode          text NOT NULL DEFAULT 'EXCEPTION_REVIEW'
                         CHECK (review_mode IN ('AUTO_PUBLISH_CLEAN','EXCEPTION_REVIEW','REQUIRE_APPROVAL_ALL','DRAFT_ONLY')),
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
  class_rules          jsonb NOT NULL DEFAULT '{}'::jsonb,
  warranty_language_allowed boolean NOT NULL DEFAULT false,
  cpo_language_allowed boolean NOT NULL DEFAULT false,
  accessory_language_allowed boolean NOT NULL DEFAULT false,
  market_context_allowed boolean NOT NULL DEFAULT false,
  price_in_description boolean NOT NULL DEFAULT false,
  quality_threshold    integer NOT NULL DEFAULT 70,
  generation_model     text NOT NULL DEFAULT 'claude-haiku-4-5',
  prompt_version       text NOT NULL DEFAULT 'v1',
  configuration_version text NOT NULL DEFAULT 'cfg_0',
  updated_by           uuid REFERENCES auth.users(id),
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

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
  lock_version               integer NOT NULL DEFAULT 0,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  updated_at                 timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT description_cases_tenant_vehicle_key UNIQUE (tenant_id, vehicle_id)
);
CREATE INDEX IF NOT EXISTS idx_description_cases_tenant_status ON public.description_cases (tenant_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_description_cases_tenant_vin ON public.description_cases (tenant_id, vin);
CREATE INDEX IF NOT EXISTS idx_description_cases_vehicle ON public.description_cases (vehicle_id);

CREATE TABLE IF NOT EXISTS public.description_fact_snapshots (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  vehicle_id          uuid NOT NULL,
  description_case_id uuid NOT NULL REFERENCES public.description_cases(id) ON DELETE CASCADE,
  source_data_version text NOT NULL,
  facts_json          jsonb NOT NULL DEFAULT '{}'::jsonb,
  source_lineage_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  conflicts_json      jsonb NOT NULL DEFAULT '[]'::jsonb,
  excluded_claims_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  market_context_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  fact_confidence     integer,
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_description_fact_snapshots_case ON public.description_fact_snapshots (description_case_id, created_at DESC);

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
CREATE UNIQUE INDEX IF NOT EXISTS uq_description_exceptions_open
  ON public.description_exceptions (description_case_id, exception_type, COALESCE(channel,''))
  WHERE status IN ('open','in_progress');
CREATE INDEX IF NOT EXISTS idx_description_exceptions_tenant ON public.description_exceptions (tenant_id, status, severity, created_at DESC);

CREATE TABLE IF NOT EXISTS public.description_jobs (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  vehicle_id          uuid NOT NULL,
  description_case_id uuid REFERENCES public.description_cases(id) ON DELETE CASCADE,
  job_type            text NOT NULL DEFAULT 'full_generation',
  status              text NOT NULL DEFAULT 'queued'
                        CHECK (status IN ('queued','running','succeeded','failed_retryable','failed_blocked','cancelled')),
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

CREATE TABLE IF NOT EXISTS public.description_deliveries (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  vehicle_id          uuid NOT NULL,
  description_case_id uuid NOT NULL REFERENCES public.description_cases(id) ON DELETE CASCADE,
  version_id          uuid REFERENCES public.description_versions(id) ON DELETE SET NULL,
  channel_version_id  uuid REFERENCES public.description_channel_versions(id) ON DELETE SET NULL,
  destination         text NOT NULL,
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

-- Grants (needed for authenticated read + service_role admin writes)
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['description_settings','description_cases','description_fact_snapshots',
                           'description_versions','description_channel_versions','description_validation_results',
                           'description_exceptions','description_jobs','description_deliveries'] LOOP
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated;', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role;', t);
  END LOOP;
END $$;

-- RLS read policies (writes go through SECURITY DEFINER RPCs below)
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
  END LOOP;
END $$;

-- init_description_case
CREATE OR REPLACE FUNCTION public.init_description_case(p_tenant_id uuid, p_vehicle_id uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_id uuid; v_vin text; v_status text;
BEGIN
  SELECT vin, status INTO v_vin, v_status FROM public.vehicle_listings
   WHERE id = p_vehicle_id AND (tenant_id = p_tenant_id OR tenant_id IS NULL);
  IF v_vin IS NULL THEN RETURN NULL; END IF;
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

-- Hardening: fact overrides + role gate + RPCs
CREATE TABLE IF NOT EXISTS public.description_fact_overrides (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  vehicle_id          uuid NOT NULL,
  description_case_id uuid NOT NULL REFERENCES public.description_cases(id) ON DELETE CASCADE,
  field_key           text NOT NULL,
  decision            text NOT NULL CHECK (decision IN ('include','exclude')),
  value               text,
  reason              text,
  source_note         text,
  decided_by          uuid REFERENCES auth.users(id),
  decided_at          timestamptz NOT NULL DEFAULT now(),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT description_fact_overrides_case_field_key UNIQUE (description_case_id, field_key)
);
CREATE INDEX IF NOT EXISTS idx_description_fact_overrides_case ON public.description_fact_overrides (description_case_id);
GRANT SELECT ON public.description_fact_overrides TO authenticated;
GRANT ALL ON public.description_fact_overrides TO service_role;

DROP TRIGGER IF EXISTS set_updated_at_description_fact_overrides ON public.description_fact_overrides;
CREATE TRIGGER set_updated_at_description_fact_overrides BEFORE UPDATE ON public.description_fact_overrides
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.description_fact_overrides ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public'
                  AND tablename='description_fact_overrides' AND policyname='tenant_members_read') THEN
    CREATE POLICY "tenant_members_read" ON public.description_fact_overrides FOR SELECT TO authenticated
    USING (tenant_id IN (SELECT tenant_id FROM public.tenant_members
                         WHERE user_id = (SELECT auth.uid()) AND accepted_at IS NOT NULL));
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.has_description_authority(p_tenant_id uuid, p_level text DEFAULT 'approve')
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.tenant_members tm
     WHERE tm.tenant_id = p_tenant_id
       AND tm.user_id = (SELECT auth.uid())
       AND tm.accepted_at IS NOT NULL
       AND (
         CASE p_level
           WHEN 'configure' THEN tm.role IN ('owner','general_manager','gsm','admin','manager')
           ELSE tm.role IN ('owner','general_manager','gsm','admin','manager',
                            'sales_manager','used_car_manager','inventory_manager','service_manager')
         END
       )
  ) OR public.has_role((SELECT auth.uid()), 'admin'::public.app_role);
$$;

CREATE OR REPLACE FUNCTION public.resolve_description_conflict(
  p_case_id uuid, p_exception_id uuid, p_field_key text,
  p_decision text, p_value text DEFAULT NULL, p_reason text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_case public.description_cases%ROWTYPE; v_uid uuid := (SELECT auth.uid());
BEGIN
  SELECT * INTO v_case FROM public.description_cases WHERE id = p_case_id;
  IF v_case.id IS NULL THEN RETURN jsonb_build_object('ok',false,'error','case_not_found'); END IF;
  IF NOT public.has_description_authority(v_case.tenant_id, 'approve') THEN
    RETURN jsonb_build_object('ok',false,'error','insufficient_permission');
  END IF;
  IF p_decision NOT IN ('include','exclude') THEN
    RETURN jsonb_build_object('ok',false,'error','invalid_decision');
  END IF;

  INSERT INTO public.description_fact_overrides
    (tenant_id, vehicle_id, description_case_id, field_key, decision, value, reason, decided_by)
  VALUES (v_case.tenant_id, v_case.vehicle_id, p_case_id, p_field_key, p_decision, p_value, p_reason, v_uid)
  ON CONFLICT (description_case_id, field_key) DO UPDATE
    SET decision = EXCLUDED.decision, value = EXCLUDED.value, reason = EXCLUDED.reason,
        decided_by = EXCLUDED.decided_by, decided_at = now(), updated_at = now();

  IF p_exception_id IS NOT NULL THEN
    UPDATE public.description_exceptions
       SET status='resolved', resolution = p_decision, resolved_by = v_uid, resolved_at = now()
     WHERE id = p_exception_id AND description_case_id = p_case_id;
  END IF;

  UPDATE public.description_cases
     SET open_exception_count = GREATEST(0, open_exception_count - 1),
         lock_version = lock_version + 1, updated_at = now()
   WHERE id = p_case_id;

  INSERT INTO public.audit_log (action, entity_type, entity_id, store_id, user_id, details)
  VALUES ('description_conflict_resolved','description_case', p_case_id::text, v_case.tenant_id::text, v_uid,
          jsonb_build_object('vin', v_case.vin, 'field', p_field_key, 'decision', p_decision, 'reason', p_reason));

  RETURN jsonb_build_object('ok',true,'field',p_field_key,'decision',p_decision);
END $$;

CREATE OR REPLACE FUNCTION public.save_description_manual_version(
  p_case_id uuid, p_content text, p_reason text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_case public.description_cases%ROWTYPE;
  v_last public.description_versions%ROWTYPE;
  v_uid uuid := (SELECT auth.uid()); v_id uuid;
BEGIN
  SELECT * INTO v_case FROM public.description_cases WHERE id = p_case_id;
  IF v_case.id IS NULL THEN RETURN jsonb_build_object('ok',false,'error','case_not_found'); END IF;
  IF NOT public.has_description_authority(v_case.tenant_id, 'approve') THEN
    RETURN jsonb_build_object('ok',false,'error','insufficient_permission');
  END IF;
  IF p_content IS NULL OR length(btrim(p_content)) < 20 THEN
    RETURN jsonb_build_object('ok',false,'error','content_too_short');
  END IF;

  SELECT * INTO v_last FROM public.description_versions
   WHERE description_case_id = p_case_id ORDER BY version_number DESC LIMIT 1;

  INSERT INTO public.description_versions
    (tenant_id, vehicle_id, description_case_id, parent_version_id, fact_snapshot_id,
     version_number, version_type, content, word_count, character_count,
     configuration_version, source_data_version, created_by_type, created_by_user_id,
     manual_edit, edit_reason, validation_status)
  VALUES (v_case.tenant_id, v_case.vehicle_id, p_case_id, v_last.id, v_last.fact_snapshot_id,
     COALESCE(v_last.version_number,0) + 1, 'manual', p_content,
     array_length(regexp_split_to_array(btrim(p_content), '\s+'), 1), length(p_content),
     v_case.configuration_version, v_case.current_source_data_version, 'user', v_uid,
     true, p_reason, 'pending')
  RETURNING id INTO v_id;

  UPDATE public.description_cases
     SET current_master_version_id = v_id, lock_version = lock_version + 1, updated_at = now()
   WHERE id = p_case_id;

  INSERT INTO public.audit_log (action, entity_type, entity_id, store_id, user_id, details)
  VALUES ('description_edited','description_case', p_case_id::text, v_case.tenant_id::text, v_uid,
          jsonb_build_object('vin', v_case.vin, 'version_id', v_id,
                             'version_number', COALESCE(v_last.version_number,0) + 1, 'reason', p_reason));

  RETURN jsonb_build_object('ok',true,'version_id',v_id,'requires_validation',true);
END $$;

CREATE OR REPLACE FUNCTION public.set_description_lock(
  p_case_id uuid, p_scope text, p_locked boolean,
  p_channel_version_id uuid DEFAULT NULL, p_reason text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_case public.description_cases%ROWTYPE; v_uid uuid := (SELECT auth.uid());
BEGIN
  SELECT * INTO v_case FROM public.description_cases WHERE id = p_case_id;
  IF v_case.id IS NULL THEN RETURN jsonb_build_object('ok',false,'error','case_not_found'); END IF;
  IF NOT public.has_description_authority(v_case.tenant_id, 'approve') THEN
    RETURN jsonb_build_object('ok',false,'error','insufficient_permission');
  END IF;

  IF p_scope = 'master' THEN
    UPDATE public.description_cases
       SET master_locked = p_locked,
           master_locked_by = CASE WHEN p_locked THEN v_uid ELSE NULL END,
           master_locked_at = CASE WHEN p_locked THEN now() ELSE NULL END,
           master_lock_reason = CASE WHEN p_locked THEN p_reason ELSE NULL END,
           lock_version = lock_version + 1, updated_at = now()
     WHERE id = p_case_id;
  ELSIF p_scope = 'channel' AND p_channel_version_id IS NOT NULL THEN
    UPDATE public.description_channel_versions
       SET locked = p_locked,
           locked_by = CASE WHEN p_locked THEN v_uid ELSE NULL END,
           locked_at = CASE WHEN p_locked THEN now() ELSE NULL END,
           lock_reason = CASE WHEN p_locked THEN p_reason ELSE NULL END,
           updated_at = now()
     WHERE id = p_channel_version_id AND description_case_id = p_case_id;
  ELSE
    RETURN jsonb_build_object('ok',false,'error','invalid_scope');
  END IF;

  INSERT INTO public.audit_log (action, entity_type, entity_id, store_id, user_id, details)
  VALUES (CASE WHEN p_locked THEN 'description_locked' ELSE 'description_unlocked' END,
          'description_case', p_case_id::text, v_case.tenant_id::text, v_uid,
          jsonb_build_object('vin', v_case.vin, 'scope', p_scope,
                             'channel_version_id', p_channel_version_id, 'reason', p_reason));

  RETURN jsonb_build_object('ok',true,'scope',p_scope,'locked',p_locked);
END $$;

CREATE OR REPLACE FUNCTION public.save_description_settings(p_tenant_id uuid, p_settings jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_uid uuid := (SELECT auth.uid());
BEGIN
  IF NOT public.has_description_authority(p_tenant_id, 'configure') THEN
    RETURN jsonb_build_object('ok',false,'error','insufficient_permission');
  END IF;

  INSERT INTO public.description_settings AS ds (
    tenant_id, review_mode, review_mode_by_class, enabled_channels, internal_publication_enabled,
    brand_voice, default_tone, dealer_name_format, primary_city, state, cta_template,
    prohibited_phrases, required_legal_text, min_length, max_length, class_rules,
    warranty_language_allowed, cpo_language_allowed, accessory_language_allowed,
    market_context_allowed, price_in_description, quality_threshold, updated_by)
  VALUES (
    p_tenant_id,
    COALESCE(p_settings->>'review_mode','EXCEPTION_REVIEW'),
    COALESCE(p_settings->'review_mode_by_class','{}'::jsonb),
    COALESCE(p_settings->'enabled_channels','[]'::jsonb),
    COALESCE((p_settings->>'internal_publication_enabled')::boolean, true),
    p_settings->>'brand_voice', COALESCE(p_settings->>'default_tone','professional'),
    p_settings->>'dealer_name_format', p_settings->>'primary_city', p_settings->>'state',
    p_settings->>'cta_template', COALESCE(p_settings->'prohibited_phrases','[]'::jsonb),
    p_settings->>'required_legal_text',
    COALESCE((p_settings->>'min_length')::int, 400), COALESCE((p_settings->>'max_length')::int, 2400),
    COALESCE(p_settings->'class_rules','{}'::jsonb),
    COALESCE((p_settings->>'warranty_language_allowed')::boolean, false),
    COALESCE((p_settings->>'cpo_language_allowed')::boolean, false),
    COALESCE((p_settings->>'accessory_language_allowed')::boolean, false),
    COALESCE((p_settings->>'market_context_allowed')::boolean, false),
    COALESCE((p_settings->>'price_in_description')::boolean, false),
    COALESCE((p_settings->>'quality_threshold')::int, 70), v_uid)
  ON CONFLICT (tenant_id) DO UPDATE SET
    review_mode = EXCLUDED.review_mode, review_mode_by_class = EXCLUDED.review_mode_by_class,
    enabled_channels = EXCLUDED.enabled_channels,
    internal_publication_enabled = EXCLUDED.internal_publication_enabled,
    brand_voice = EXCLUDED.brand_voice, default_tone = EXCLUDED.default_tone,
    dealer_name_format = EXCLUDED.dealer_name_format, primary_city = EXCLUDED.primary_city,
    state = EXCLUDED.state, cta_template = EXCLUDED.cta_template,
    prohibited_phrases = EXCLUDED.prohibited_phrases, required_legal_text = EXCLUDED.required_legal_text,
    min_length = EXCLUDED.min_length, max_length = EXCLUDED.max_length,
    class_rules = EXCLUDED.class_rules,
    warranty_language_allowed = EXCLUDED.warranty_language_allowed,
    cpo_language_allowed = EXCLUDED.cpo_language_allowed,
    accessory_language_allowed = EXCLUDED.accessory_language_allowed,
    market_context_allowed = EXCLUDED.market_context_allowed,
    price_in_description = EXCLUDED.price_in_description,
    quality_threshold = EXCLUDED.quality_threshold,
    updated_by = EXCLUDED.updated_by, updated_at = now();

  INSERT INTO public.audit_log (action, entity_type, entity_id, store_id, user_id, details)
  VALUES ('description_configuration_changed','description_settings', p_tenant_id::text,
          p_tenant_id::text, v_uid, jsonb_build_object('review_mode', p_settings->>'review_mode'));

  RETURN jsonb_build_object('ok',true);
END $$;

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
  v_key  text; v_enabled boolean;
BEGIN
  SELECT * INTO v_case FROM public.description_cases WHERE id = p_case_id FOR UPDATE;
  IF v_case.id IS NULL THEN RETURN jsonb_build_object('ok',false,'error','case_not_found'); END IF;

  IF v_uid IS NOT NULL AND NOT public.has_description_authority(v_case.tenant_id, 'approve') THEN
    RETURN jsonb_build_object('ok',false,'error','insufficient_permission');
  END IF;

  IF v_case.archived_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok',false,'error','case_archived');
  END IF;

  SELECT internal_publication_enabled INTO v_enabled
    FROM public.description_settings WHERE tenant_id = v_case.tenant_id;
  IF v_enabled IS NOT NULL AND v_enabled = false THEN
    RETURN jsonb_build_object('ok',false,'error','internal_publication_disabled');
  END IF;

  IF p_expected_lock_version IS NOT NULL AND v_case.lock_version <> p_expected_lock_version THEN
    RETURN jsonb_build_object('ok',false,'error','stale_version','current_lock_version',v_case.lock_version);
  END IF;

  SELECT * INTO v_ver FROM public.description_versions WHERE id = p_version_id;
  IF v_ver.id IS NULL OR v_ver.description_case_id <> p_case_id THEN
    RETURN jsonb_build_object('ok',false,'error','version_not_found');
  END IF;
  IF v_ver.validation_status IN ('blocked','pending') THEN
    RETURN jsonb_build_object('ok',false,'error','validation_not_passed','validation_status',v_ver.validation_status);
  END IF;

  IF v_case.published_master_version_id IS NOT NULL THEN
    SELECT * INTO v_pub FROM public.description_versions WHERE id = v_case.published_master_version_id;
    IF v_pub.id IS NOT NULL AND v_ver.version_number < v_pub.version_number THEN
      RETURN jsonb_build_object('ok',false,'error','older_than_published');
    END IF;
  END IF;

  UPDATE public.vehicle_listings SET description = v_ver.content WHERE id = v_case.vehicle_id;

  UPDATE public.description_cases
     SET published_master_version_id = p_version_id,
         current_master_version_id  = COALESCE(current_master_version_id, p_version_id),
         status = 'PUBLISHED', publication_eligibility = 'eligible',
         potentially_stale = false, last_success_at = now(),
         lock_version = lock_version + 1, updated_at = now()
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

CREATE OR REPLACE FUNCTION public.mark_description_stale(p_case_id uuid, p_reason text DEFAULT NULL)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  UPDATE public.description_cases
     SET potentially_stale = true,
         status = CASE WHEN status IN ('PUBLISHED','READY','PARTIALLY_PUBLISHED') THEN 'STALE' ELSE status END,
         updated_at = now()
   WHERE id = p_case_id AND archived_at IS NULL;
  RETURN FOUND;
END $$;

CREATE OR REPLACE FUNCTION public.archive_description_case(p_case_id uuid, p_reason text DEFAULT NULL)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_tenant uuid; v_vin text; v_uid uuid := (SELECT auth.uid());
BEGIN
  SELECT tenant_id, vin INTO v_tenant, v_vin FROM public.description_cases WHERE id = p_case_id;
  IF v_tenant IS NULL THEN RETURN false; END IF;

  IF v_uid IS NOT NULL AND NOT public.has_description_authority(v_tenant, 'approve') THEN
    RETURN false;
  END IF;

  UPDATE public.description_cases
     SET status='ARCHIVED', archived_at = now(), publication_eligibility='blocked',
         open_exception_count = 0, lock_version = lock_version + 1, updated_at = now()
   WHERE id = p_case_id;

  UPDATE public.description_exceptions
     SET status='dismissed', resolution = COALESCE(p_reason,'vehicle archived'), resolved_at = now()
   WHERE description_case_id = p_case_id AND status IN ('open','in_progress');

  UPDATE public.description_jobs SET status='cancelled', updated_at = now()
   WHERE description_case_id = p_case_id AND status IN ('queued','running');

  INSERT INTO public.audit_log (action, entity_type, entity_id, store_id, user_id, details)
  VALUES ('description_archived','description_case', p_case_id::text, v_tenant::text, v_uid,
          jsonb_build_object('vin', v_vin, 'reason', p_reason));
  RETURN true;
END $$;

CREATE OR REPLACE FUNCTION public.description_case_follow_listing_status()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  BEGIN
    IF NEW.status = 'archived' AND COALESCE(OLD.status,'') <> 'archived' THEN
      PERFORM public.archive_description_case(dc.id, 'listing archived')
        FROM public.description_cases dc
       WHERE dc.vehicle_id = NEW.id AND dc.archived_at IS NULL;
    END IF;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_description_case_follow_listing ON public.vehicle_listings;
CREATE TRIGGER trg_description_case_follow_listing
AFTER UPDATE OF status ON public.vehicle_listings
FOR EACH ROW EXECUTE FUNCTION public.description_case_follow_listing_status();

CREATE OR REPLACE FUNCTION public.description_versions_immutable()
RETURNS trigger
LANGUAGE plpgsql SET search_path = public
AS $$
BEGIN
  IF NEW.content IS DISTINCT FROM OLD.content
     OR NEW.version_number IS DISTINCT FROM OLD.version_number
     OR NEW.description_case_id IS DISTINCT FROM OLD.description_case_id
     OR NEW.fact_snapshot_id IS DISTINCT FROM OLD.fact_snapshot_id
     OR NEW.source_data_version IS DISTINCT FROM OLD.source_data_version
     OR NEW.created_by_user_id IS DISTINCT FROM OLD.created_by_user_id THEN
    RAISE EXCEPTION 'description_versions are immutable; save a new version instead';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_description_versions_immutable ON public.description_versions;
CREATE TRIGGER trg_description_versions_immutable
BEFORE UPDATE ON public.description_versions
FOR EACH ROW EXECUTE FUNCTION public.description_versions_immutable();

CREATE OR REPLACE FUNCTION public.description_case_transition_guard()
RETURNS trigger
LANGUAGE plpgsql SET search_path = public
AS $$
DECLARE allowed text[];
BEGIN
  IF NEW.status = OLD.status THEN RETURN NEW; END IF;

  allowed := CASE OLD.status
    WHEN 'UNINITIALIZED'       THEN ARRAY['QUEUED','ARCHIVED']
    WHEN 'QUEUED'              THEN ARRAY['BUILDING_FACTS','FAILED_RETRYABLE','FAILED_BLOCKED','ARCHIVED']
    WHEN 'BUILDING_FACTS'      THEN ARRAY['GENERATING','REVIEW_REQUIRED','FAILED_RETRYABLE','FAILED_BLOCKED','ARCHIVED']
    WHEN 'GENERATING'          THEN ARRAY['VALIDATING','FAILED_RETRYABLE','FAILED_BLOCKED','ARCHIVED']
    WHEN 'VALIDATING'          THEN ARRAY['READY','REVIEW_REQUIRED','FAILED_BLOCKED','FAILED_RETRYABLE','ARCHIVED']
    WHEN 'REVIEW_REQUIRED'     THEN ARRAY['READY','PUBLISHING','PUBLISHED','QUEUED','BUILDING_FACTS','STALE','FAILED_BLOCKED','ARCHIVED']
    WHEN 'READY'               THEN ARRAY['PUBLISHING','PUBLISHED','REVIEW_REQUIRED','STALE','QUEUED','BUILDING_FACTS','FAILED_RETRYABLE','ARCHIVED']
    WHEN 'PUBLISHING'          THEN ARRAY['PUBLISHED','PARTIALLY_PUBLISHED','FAILED_RETRYABLE','ARCHIVED']
    WHEN 'PARTIALLY_PUBLISHED' THEN ARRAY['PUBLISHED','STALE','QUEUED','BUILDING_FACTS','FAILED_RETRYABLE','ARCHIVED']
    WHEN 'PUBLISHED'           THEN ARRAY['STALE','QUEUED','BUILDING_FACTS','REVIEW_REQUIRED','PARTIALLY_PUBLISHED','ARCHIVED']
    WHEN 'STALE'               THEN ARRAY['QUEUED','BUILDING_FACTS','GENERATING','VALIDATING','READY','REVIEW_REQUIRED','PUBLISHED','FAILED_RETRYABLE','ARCHIVED']
    WHEN 'FAILED_RETRYABLE'    THEN ARRAY['QUEUED','BUILDING_FACTS','GENERATING','FAILED_BLOCKED','ARCHIVED']
    WHEN 'FAILED_BLOCKED'      THEN ARRAY['QUEUED','BUILDING_FACTS','REVIEW_REQUIRED','ARCHIVED']
    WHEN 'ARCHIVED'            THEN ARRAY[]::text[]
    ELSE ARRAY[]::text[]
  END;

  IF NOT (NEW.status = ANY(allowed)) THEN
    RAISE EXCEPTION 'illegal description lifecycle transition: % -> %', OLD.status, NEW.status;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_description_case_transition ON public.description_cases;
CREATE TRIGGER trg_description_case_transition
BEFORE UPDATE OF status ON public.description_cases
FOR EACH ROW EXECUTE FUNCTION public.description_case_transition_guard();

CREATE OR REPLACE FUNCTION public.description_publish_allowed(p_case_id uuid, p_version_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_case public.description_cases%ROWTYPE; v_ver public.description_versions%ROWTYPE;
  v_mode text; v_cls text; v_by_class jsonb;
BEGIN
  SELECT * INTO v_case FROM public.description_cases WHERE id = p_case_id;
  SELECT * INTO v_ver  FROM public.description_versions WHERE id = p_version_id;
  IF v_case.id IS NULL OR v_ver.id IS NULL THEN RETURN jsonb_build_object('ok',false,'error','not_found'); END IF;

  SELECT COALESCE(ds.review_mode,'EXCEPTION_REVIEW'), COALESCE(ds.review_mode_by_class,'{}'::jsonb)
    INTO v_mode, v_by_class
    FROM public.description_settings ds WHERE ds.tenant_id = v_case.tenant_id;
  v_mode := COALESCE(v_mode,'EXCEPTION_REVIEW');

  SELECT lower(COALESCE(vl.condition,'used')) INTO v_cls
    FROM public.vehicle_listings vl WHERE vl.id = v_case.vehicle_id;
  IF v_by_class ? v_cls THEN v_mode := v_by_class->>v_cls; END IF;

  IF v_mode = 'DRAFT_ONLY' AND v_ver.approval_status <> 'approved' THEN
    RETURN jsonb_build_object('ok',false,'error','draft_only_requires_approval');
  END IF;
  IF v_mode = 'REQUIRE_APPROVAL_ALL' AND v_ver.approval_status <> 'approved' THEN
    RETURN jsonb_build_object('ok',false,'error','approval_required');
  END IF;
  RETURN jsonb_build_object('ok',true,'review_mode',v_mode);
END $$;

CREATE OR REPLACE FUNCTION public.approve_description_version(
  p_case_id uuid, p_version_id uuid, p_approve boolean DEFAULT true, p_note text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_case public.description_cases%ROWTYPE; v_uid uuid := (SELECT auth.uid());
BEGIN
  SELECT * INTO v_case FROM public.description_cases WHERE id = p_case_id;
  IF v_case.id IS NULL THEN RETURN jsonb_build_object('ok',false,'error','case_not_found'); END IF;
  IF NOT public.has_description_authority(v_case.tenant_id, 'approve') THEN
    RETURN jsonb_build_object('ok',false,'error','insufficient_permission');
  END IF;

  UPDATE public.description_versions
     SET approval_status = CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END,
         approved_by = v_uid, approved_at = now()
   WHERE id = p_version_id AND description_case_id = p_case_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','version_not_found'); END IF;

  UPDATE public.description_cases SET lock_version = lock_version + 1, updated_at = now()
   WHERE id = p_case_id;

  INSERT INTO public.audit_log (action, entity_type, entity_id, store_id, user_id, details)
  VALUES (CASE WHEN p_approve THEN 'description_version_approved' ELSE 'description_version_rejected' END,
          'description_case', p_case_id::text, v_case.tenant_id::text, v_uid,
          jsonb_build_object('vin', v_case.vin, 'version_id', p_version_id, 'note', p_note));

  RETURN jsonb_build_object('ok',true,'approved',p_approve);
END $$;

CREATE OR REPLACE FUNCTION public.raise_description_exception(
  p_tenant_id uuid, p_vehicle_id uuid, p_case_id uuid, p_type text,
  p_severity text, p_blocking boolean, p_title text, p_summary text,
  p_details jsonb DEFAULT '{}'::jsonb, p_channel text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_id uuid;
BEGIN
  SELECT id INTO v_id FROM public.description_exceptions
   WHERE description_case_id = p_case_id AND exception_type = p_type
     AND COALESCE(channel,'') = COALESCE(p_channel,'')
     AND status IN ('open','in_progress')
   LIMIT 1;
  IF v_id IS NOT NULL THEN
    UPDATE public.description_exceptions
       SET title = p_title, summary = p_summary, details_json = p_details,
           severity = p_severity, blocking = p_blocking, updated_at = now()
     WHERE id = v_id;
    RETURN v_id;
  END IF;

  INSERT INTO public.description_exceptions
    (tenant_id, vehicle_id, description_case_id, exception_type, severity,
     blocking, title, summary, details_json, channel, status)
  VALUES (p_tenant_id, p_vehicle_id, p_case_id, p_type, p_severity,
     p_blocking, p_title, p_summary, p_details, p_channel, 'open')
  RETURNING id INTO v_id;

  UPDATE public.description_cases
     SET open_exception_count = (
           SELECT count(*) FROM public.description_exceptions
            WHERE description_case_id = p_case_id AND status IN ('open','in_progress'))
   WHERE id = p_case_id;
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.claim_description_job(
  p_tenant_id uuid, p_vehicle_id uuid, p_case_id uuid,
  p_job_type text, p_idempotency_key text, p_payload jsonb DEFAULT '{}'::jsonb)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_id uuid;
BEGIN
  INSERT INTO public.description_jobs
    (tenant_id, vehicle_id, description_case_id, job_type, idempotency_key, payload_json,
     status, attempt_count, started_at)
  VALUES (p_tenant_id, p_vehicle_id, p_case_id, p_job_type, p_idempotency_key, p_payload,
     'running', 1, now())
  ON CONFLICT (idempotency_key) DO NOTHING
  RETURNING id INTO v_id;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;

  UPDATE public.description_jobs
     SET status='running', attempt_count = attempt_count + 1, started_at = now(), updated_at = now()
   WHERE idempotency_key = p_idempotency_key
     AND status = 'failed_retryable'
     AND attempt_count < max_attempts
  RETURNING id INTO v_id;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;

  UPDATE public.description_jobs
     SET attempt_count = attempt_count + 1, started_at = now(), updated_at = now()
   WHERE idempotency_key = p_idempotency_key
     AND status = 'running'
     AND started_at < now() - interval '15 minutes'
     AND attempt_count < max_attempts
  RETURNING id INTO v_id;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;

  UPDATE public.description_jobs
     SET status='failed_blocked', failed_at = now(), updated_at = now(),
         last_error_code = COALESCE(last_error_code,'ATTEMPTS_EXHAUSTED')
   WHERE idempotency_key = p_idempotency_key
     AND status IN ('failed_retryable','running')
     AND attempt_count >= max_attempts;

  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION public.next_description_reconcile_batch(
  p_tenant_id uuid DEFAULT NULL, p_limit integer DEFAULT 50)
RETURNS TABLE (tenant_id uuid, vehicle_id uuid, vin text, case_id uuid, reason text)
LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$
  WITH candidates AS (
    SELECT dc.tenant_id, dc.vehicle_id, dc.vin, dc.id AS case_id, 'stalled'::text AS reason, 1 AS pri
      FROM public.description_cases dc
     WHERE dc.archived_at IS NULL
       AND dc.status IN ('QUEUED','BUILDING_FACTS','GENERATING','VALIDATING','PUBLISHING')
       AND dc.updated_at < now() - interval '30 minutes'
    UNION ALL
    SELECT dc.tenant_id, dc.vehicle_id, dc.vin, dc.id, 'source_changed', 2
      FROM public.description_cases dc
     WHERE dc.archived_at IS NULL
       AND dc.status NOT IN ('ARCHIVED','FAILED_BLOCKED')
       AND dc.current_source_data_version IS NOT NULL
       AND dc.current_source_data_version IS DISTINCT FROM dc.processed_source_data_version
    UNION ALL
    SELECT dc.tenant_id, dc.vehicle_id, dc.vin, dc.id, 'retryable', 3
      FROM public.description_cases dc
     WHERE dc.archived_at IS NULL AND dc.status = 'FAILED_RETRYABLE'
       AND EXISTS (SELECT 1 FROM public.description_jobs j
                    WHERE j.description_case_id = dc.id
                      AND j.status = 'failed_retryable' AND j.attempt_count < j.max_attempts)
    UNION ALL
    SELECT vl.tenant_id, vl.id, vl.vin, NULL::uuid, 'missing_case', 4
      FROM public.vehicle_listings vl
      LEFT JOIN public.description_cases dc
        ON dc.vehicle_id = vl.id AND dc.tenant_id = vl.tenant_id
     WHERE vl.tenant_id IS NOT NULL AND vl.status IN ('draft','published')
       AND vl.vin IS NOT NULL AND dc.id IS NULL
  )
  SELECT tenant_id, vehicle_id, vin, case_id, reason
    FROM candidates
   WHERE (p_tenant_id IS NULL OR tenant_id = p_tenant_id)
   ORDER BY pri, vehicle_id
   LIMIT GREATEST(p_limit, 1);
$$;

GRANT EXECUTE ON FUNCTION public.init_description_case(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_description_job(uuid, uuid, uuid, text, text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.next_description_reconcile_batch(uuid, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.publish_description_internal(uuid, uuid, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.archive_description_case(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.has_description_authority(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.resolve_description_conflict(uuid, uuid, text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_description_manual_version(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_description_lock(uuid, text, boolean, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_description_settings(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_description_stale(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.approve_description_version(uuid, uuid, boolean, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.description_publish_allowed(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.raise_description_exception(uuid, uuid, uuid, text, text, boolean, text, text, jsonb, text) TO service_role;
