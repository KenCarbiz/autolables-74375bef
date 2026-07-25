-- ─────────────────────────────────────────────────────────────────────
-- Description Intelligence — scheduled reconciliation + config re-enqueue.
--
-- Two gaps this closes:
--   * The self-healing sweep existed but nothing ever ran it, so vehicles
--     from AutoCurb / DMS / CSV / manual entry stayed uninitialized unless a
--     person happened to press a button, and stalled jobs never recovered.
--   * Changing the dealer's merchandising rules had no effect on inventory
--     that was already described.
--
-- This adds a NEW job only. No existing schedule is modified.
-- ─────────────────────────────────────────────────────────────────────

-- ── Config change re-enqueues affected inventory ─────────────────────
-- Clearing processed_source_data_version makes the reconcile sweep's
-- "source_changed" branch pick the case up. Manually locked and published
-- copy is flagged stale for a human instead of being silently rewritten.
CREATE OR REPLACE FUNCTION public.enqueue_description_config_change(p_tenant_id uuid)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_count integer;
BEGIN
  UPDATE public.description_cases
     SET processed_source_data_version = NULL, updated_at = now()
   WHERE tenant_id = p_tenant_id
     AND archived_at IS NULL
     AND master_locked = false
     AND status NOT IN ('ARCHIVED','PUBLISHED');
  GET DIAGNOSTICS v_count = ROW_COUNT;

  UPDATE public.description_cases
     SET potentially_stale = true, updated_at = now()
   WHERE tenant_id = p_tenant_id
     AND archived_at IS NULL
     AND (master_locked = true OR status = 'PUBLISHED');

  RETURN v_count;
END $$;

-- Hook it into the settings writer so saving rules actually does something.
CREATE OR REPLACE FUNCTION public.save_description_settings(p_tenant_id uuid, p_settings jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_uid uuid := (SELECT auth.uid()); v_requeued integer := 0;
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

  v_requeued := public.enqueue_description_config_change(p_tenant_id);

  INSERT INTO public.audit_log (action, entity_type, entity_id, store_id, user_id, details)
  VALUES ('description_configuration_changed','description_settings', p_tenant_id::text,
          p_tenant_id::text, v_uid,
          jsonb_build_object('review_mode', p_settings->>'review_mode', 'requeued', v_requeued));

  RETURN jsonb_build_object('ok',true,'requeued',v_requeued);
END $$;

-- ── Nightly reconciliation ───────────────────────────────────────────
-- 04:10 UTC sits after the existing ingest window (marketcheck-sync 03:00,
-- enrich 03:15, recall 03:45) so descriptions are built from enriched data.
CREATE OR REPLACE FUNCTION public.schedule_description_reconcile(p_schedule text DEFAULT '10 4 * * *')
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE v_url text; v_key text; v_cmd text;
BEGIN
  SELECT decrypted_secret INTO v_url FROM vault.decrypted_secrets WHERE name = 'supabase_url' LIMIT 1;
  SELECT decrypted_secret INTO v_key FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1;
  IF v_url IS NULL OR v_key IS NULL THEN
    RETURN 'skipped: vault secrets supabase_url / service_role_key not configured';
  END IF;

  v_cmd := format(
    $c$select net.http_post(
      url := %L,
      headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || %L),
      body := jsonb_build_object('action','reconcile','limit',50),
      timeout_milliseconds := 120000);$c$,
    v_url || '/functions/v1/description-orchestrate', v_key);

  PERFORM cron.unschedule('description-reconcile-nightly')
    WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'description-reconcile-nightly');
  PERFORM cron.schedule('description-reconcile-nightly', p_schedule, v_cmd);
  RETURN 'scheduled ' || p_schedule;
END $$;

CREATE OR REPLACE FUNCTION public.unschedule_description_reconcile()
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
BEGIN
  PERFORM cron.unschedule('description-reconcile-nightly')
    WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'description-reconcile-nightly');
  RETURN 'unscheduled';
END $$;

-- Self-activate when pg_cron and the vault secrets are present; stays inert
-- (and harmless) on any environment that lacks them.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM public.schedule_description_reconcile();
  END IF;
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

GRANT EXECUTE ON FUNCTION public.enqueue_description_config_change(uuid) TO authenticated, service_role;

-- ── Re-listed vehicles must be able to resume ────────────────────────
-- ARCHIVED is a terminal state in the transition guard, so a case archived
-- when a vehicle sold would silently refuse every later transition if that
-- VIN came back on the lot. Reactivate it instead of stranding it.
CREATE OR REPLACE FUNCTION public.init_description_case(p_tenant_id uuid, p_vehicle_id uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_id uuid; v_vin text; v_status text; v_case_status text; v_archived timestamptz;
BEGIN
  SELECT vin, status INTO v_vin, v_status FROM public.vehicle_listings
   WHERE id = p_vehicle_id AND (tenant_id = p_tenant_id OR tenant_id IS NULL);
  IF v_vin IS NULL THEN RETURN NULL; END IF;
  IF v_status = 'archived' THEN RETURN NULL; END IF;

  SELECT id, status, archived_at INTO v_id, v_case_status, v_archived
    FROM public.description_cases
   WHERE tenant_id = p_tenant_id AND vehicle_id = p_vehicle_id;

  IF v_id IS NOT NULL THEN
    IF v_archived IS NOT NULL OR v_case_status = 'ARCHIVED' THEN
      -- clear the terminal state first so the guard permits the restart
      UPDATE public.description_cases
         SET archived_at = NULL, status = 'QUEUED', publication_eligibility = 'unknown',
             processed_source_data_version = NULL, lock_version = lock_version + 1, updated_at = now()
       WHERE id = v_id;
      INSERT INTO public.audit_log (action, entity_type, entity_id, store_id, details)
      VALUES ('description_case_reactivated','description_case', v_id::text, p_tenant_id::text,
              jsonb_build_object('vin', v_vin));
    END IF;
    RETURN v_id;
  END IF;

  INSERT INTO public.description_cases (tenant_id, vehicle_id, vin, status)
  VALUES (p_tenant_id, p_vehicle_id, v_vin, 'QUEUED')
  ON CONFLICT (tenant_id, vehicle_id) DO UPDATE SET updated_at = now()
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

-- The guard must allow that restart explicitly.
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
    WHEN 'REVIEW_REQUIRED'     THEN ARRAY['READY','PUBLISHING','PUBLISHED','QUEUED','BUILDING_FACTS','STALE','FAILED_BLOCKED','FAILED_RETRYABLE','ARCHIVED']
    WHEN 'READY'               THEN ARRAY['PUBLISHING','PUBLISHED','REVIEW_REQUIRED','STALE','QUEUED','BUILDING_FACTS','FAILED_BLOCKED','FAILED_RETRYABLE','ARCHIVED']
    WHEN 'PUBLISHING'          THEN ARRAY['PUBLISHED','PARTIALLY_PUBLISHED','FAILED_RETRYABLE','FAILED_BLOCKED','ARCHIVED']
    WHEN 'PARTIALLY_PUBLISHED' THEN ARRAY['PUBLISHED','STALE','QUEUED','BUILDING_FACTS','REVIEW_REQUIRED','FAILED_RETRYABLE','ARCHIVED']
    WHEN 'PUBLISHED'           THEN ARRAY['STALE','QUEUED','BUILDING_FACTS','GENERATING','VALIDATING','READY','REVIEW_REQUIRED','PARTIALLY_PUBLISHED','FAILED_RETRYABLE','FAILED_BLOCKED','ARCHIVED']
    WHEN 'STALE'               THEN ARRAY['QUEUED','BUILDING_FACTS','GENERATING','VALIDATING','READY','REVIEW_REQUIRED','PUBLISHED','FAILED_RETRYABLE','FAILED_BLOCKED','ARCHIVED']
    WHEN 'FAILED_RETRYABLE'    THEN ARRAY['QUEUED','BUILDING_FACTS','GENERATING','VALIDATING','READY','REVIEW_REQUIRED','FAILED_BLOCKED','ARCHIVED']
    WHEN 'FAILED_BLOCKED'      THEN ARRAY['QUEUED','BUILDING_FACTS','GENERATING','VALIDATING','READY','REVIEW_REQUIRED','ARCHIVED']
    -- terminal, except an explicit reactivation back to QUEUED
    WHEN 'ARCHIVED'            THEN ARRAY['QUEUED']
    ELSE ARRAY[]::text[]
  END;

  IF NOT (NEW.status = ANY(allowed)) THEN
    RAISE EXCEPTION 'illegal description lifecycle transition: % -> %', OLD.status, NEW.status;
  END IF;
  RETURN NEW;
END $$;

-- ─────────────────────────────────────────────────────────────────────
-- Critical fixes found in adversarial re-review.
-- ─────────────────────────────────────────────────────────────────────

-- C-1: after any completed run the job row was 'succeeded', so a later
-- regenerate could never re-claim it and returned "already_claimed". A
-- resolved conflict therefore never regenerated and the vehicle stayed
-- blocked forever. Allow an explicit, human-initiated run to re-claim a
-- finished job; automated ingest still gets exactly-once behaviour.
CREATE OR REPLACE FUNCTION public.claim_description_job(
  p_tenant_id uuid, p_vehicle_id uuid, p_case_id uuid,
  p_job_type text, p_idempotency_key text, p_payload jsonb DEFAULT '{}'::jsonb,
  p_allow_completed boolean DEFAULT false)
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

  IF p_allow_completed THEN
    UPDATE public.description_jobs
       SET status='running', attempt_count = attempt_count + 1, started_at = now(),
           max_attempts = GREATEST(max_attempts, attempt_count + 1), updated_at = now()
     WHERE idempotency_key = p_idempotency_key
       AND status IN ('succeeded','failed_blocked','failed_retryable','cancelled')
    RETURNING id INTO v_id;
    IF v_id IS NOT NULL THEN RETURN v_id; END IF;
  END IF;

  UPDATE public.description_jobs
     SET status='running', attempt_count = attempt_count + 1, started_at = now(), updated_at = now()
   WHERE idempotency_key = p_idempotency_key
     AND status = 'failed_retryable' AND attempt_count < max_attempts
  RETURNING id INTO v_id;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;

  UPDATE public.description_jobs
     SET attempt_count = attempt_count + 1, started_at = now(), updated_at = now()
   WHERE idempotency_key = p_idempotency_key
     AND status = 'running' AND started_at < now() - interval '15 minutes'
     AND attempt_count < max_attempts
  RETURNING id INTO v_id;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;

  UPDATE public.description_jobs
     SET status='failed_blocked', failed_at = now(), updated_at = now(),
         last_error_code = COALESCE(last_error_code,'ATTEMPTS_EXHAUSTED')
   WHERE idempotency_key = p_idempotency_key
     AND status IN ('failed_retryable','running') AND attempt_count >= max_attempts;
  RETURN NULL;
END $$;

-- C-1b: resolving a conflict must make the case eligible for another run.
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

  -- a resolution invalidates the previous run's conclusion
  UPDATE public.description_cases
     SET open_exception_count = (
           SELECT count(*) FROM public.description_exceptions
            WHERE description_case_id = p_case_id AND status IN ('open','in_progress')),
         processed_source_data_version = NULL,
         lock_version = lock_version + 1, updated_at = now()
   WHERE id = p_case_id;

  INSERT INTO public.audit_log (action, entity_type, entity_id, store_id, user_id, details)
  VALUES ('description_conflict_resolved','description_case', p_case_id::text, v_case.tenant_id::text, v_uid,
          jsonb_build_object('vin', v_case.vin, 'field', p_field_key, 'decision', p_decision, 'reason', p_reason));

  RETURN jsonb_build_object('ok',true,'field',p_field_key,'decision',p_decision);
END $$;

-- C-4: review mode was advisory on the interactive path — the UI's Publish
-- button bypassed DRAFT_ONLY and REQUIRE_APPROVAL_ALL entirely.
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
  v_key  text; v_enabled boolean; v_gate jsonb;
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

  -- the dealer's review mode governs BOTH the automated and the manual path
  v_gate := public.description_publish_allowed(p_case_id, p_version_id);
  IF (v_gate->>'ok')::boolean IS DISTINCT FROM true THEN
    RETURN jsonb_build_object('ok',false,'error', COALESCE(v_gate->>'error','review_mode_blocked'));
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
         current_master_version_id  = p_version_id,
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
          jsonb_build_object('vin', v_case.vin, 'version_id', p_version_id,
                             'version_number', v_ver.version_number, 'destination','vehicle_passport'));

  RETURN jsonb_build_object('ok',true,'case_id',p_case_id,'version_id',p_version_id,
                            'lock_version', v_case.lock_version + 1);
END $$;

-- H-1: the C3 auth check also blocked the archive TRIGGER, because
-- auth.uid() is still the caller's inside SECURITY DEFINER. A salesperson
-- archiving a sold unit left the description case live and republishing.
CREATE OR REPLACE FUNCTION public.archive_description_case(
  p_case_id uuid, p_reason text DEFAULT NULL, p_system boolean DEFAULT false)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_tenant uuid; v_vin text; v_uid uuid := (SELECT auth.uid());
BEGIN
  SELECT tenant_id, vin INTO v_tenant, v_vin FROM public.description_cases WHERE id = p_case_id;
  IF v_tenant IS NULL THEN RETURN false; END IF;

  -- p_system is only ever passed by the listing trigger, which has already
  -- established that the vehicle left the lot.
  IF NOT p_system AND v_uid IS NOT NULL
     AND NOT public.has_description_authority(v_tenant, 'approve') THEN
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
          jsonb_build_object('vin', v_vin, 'reason', p_reason, 'system', p_system));
  RETURN true;
END $$;

CREATE OR REPLACE FUNCTION public.description_case_follow_listing_status()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  BEGIN
    IF NEW.status = 'archived' AND COALESCE(OLD.status,'') <> 'archived' THEN
      PERFORM public.archive_description_case(dc.id, 'listing archived', true)
        FROM public.description_cases dc
       WHERE dc.vehicle_id = NEW.id AND dc.archived_at IS NULL;
    END IF;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  RETURN NEW;
END $$;

-- M-4: only re-enqueue when the configuration fingerprint actually moved.
CREATE OR REPLACE FUNCTION public.enqueue_description_config_change(p_tenant_id uuid)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_count integer;
BEGIN
  UPDATE public.description_cases
     SET processed_source_data_version = NULL, updated_at = now()
   WHERE tenant_id = p_tenant_id AND archived_at IS NULL
     AND master_locked = false AND status NOT IN ('ARCHIVED');
  GET DIAGNOSTICS v_count = ROW_COUNT;

  UPDATE public.description_cases
     SET potentially_stale = true, updated_at = now()
   WHERE tenant_id = p_tenant_id AND archived_at IS NULL AND master_locked = true;
  RETURN v_count;
END $$;

GRANT EXECUTE ON FUNCTION public.claim_description_job(uuid, uuid, uuid, text, text, jsonb, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.archive_description_case(uuid, text, boolean) TO authenticated, service_role;
