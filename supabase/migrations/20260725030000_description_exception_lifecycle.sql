-- ─────────────────────────────────────────────────────────────────────
-- Description Intelligence — exception lifecycle + publish-gate repairs.
--
-- Found in the third adversarial pass:
--   CRIT-1  Nothing ever closed an exception once its condition cleared, so a
--           vehicle that regenerated clean and published still showed
--           "Blocked" forever and the queue never drained.
--   CRIT-2  CPO conflicts were raised without a field, so the resolver wrote
--           an override under a key the snapshot never reads.
--   CRIT-3  The exception dedupe key ignored WHICH field was disputed, so a
--           second equipment conflict overwrote the first.
--   HIGH-1  publish_description_internal never checked master_locked.
--   HIGH-2  FAILED_* -> PUBLISHED was an illegal transition, so the manual
--           rescue path raised a 500 instead of returning a result.
--   HIGH-3  Saving settings re-generated the whole published fleet.
-- ─────────────────────────────────────────────────────────────────────

-- CRIT-3: the disputed field belongs in the identity of the exception.
ALTER TABLE public.description_exceptions
  ADD COLUMN IF NOT EXISTS field_key text;

DROP INDEX IF EXISTS public.uq_description_exceptions_open;
CREATE UNIQUE INDEX IF NOT EXISTS uq_description_exceptions_open
  ON public.description_exceptions
     (description_case_id, exception_type, COALESCE(channel,''), COALESCE(field_key,''))
  WHERE status IN ('open','in_progress');

CREATE OR REPLACE FUNCTION public.raise_description_exception(
  p_tenant_id uuid, p_vehicle_id uuid, p_case_id uuid, p_type text,
  p_severity text, p_blocking boolean, p_title text, p_summary text,
  p_details jsonb DEFAULT '{}'::jsonb, p_channel text DEFAULT NULL,
  p_field_key text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_id uuid;
BEGIN
  SELECT id INTO v_id FROM public.description_exceptions
   WHERE description_case_id = p_case_id AND exception_type = p_type
     AND COALESCE(channel,'') = COALESCE(p_channel,'')
     AND COALESCE(field_key,'') = COALESCE(p_field_key,'')
     AND status IN ('open','in_progress')
   LIMIT 1;
  IF v_id IS NOT NULL THEN
    UPDATE public.description_exceptions
       SET title = p_title, summary = p_summary, details_json = p_details,
           severity = p_severity, blocking = p_blocking, updated_at = now()
     WHERE id = v_id;
  ELSE
    INSERT INTO public.description_exceptions
      (tenant_id, vehicle_id, description_case_id, exception_type, severity,
       blocking, title, summary, details_json, channel, field_key, status)
    VALUES (p_tenant_id, p_vehicle_id, p_case_id, p_type, p_severity,
       p_blocking, p_title, p_summary, p_details, p_channel, p_field_key, 'open')
    RETURNING id INTO v_id;
  END IF;

  UPDATE public.description_cases
     SET open_exception_count = (
           SELECT count(*) FROM public.description_exceptions
            WHERE description_case_id = p_case_id AND status IN ('open','in_progress'))
   WHERE id = p_case_id;
  RETURN v_id;
END $$;

-- CRIT-1: close the exceptions a clean run has resolved. Conflict exceptions
-- are NOT auto-closed — those record a human decision and stay until someone
-- makes one; everything derived from the last run is superseded by this one.
CREATE OR REPLACE FUNCTION public.close_resolved_description_exceptions(
  p_case_id uuid, p_keep_types text[] DEFAULT ARRAY['EQUIPMENT_CONFLICT','CPO_STATUS_CONFLICT'])
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_count integer;
BEGIN
  UPDATE public.description_exceptions
     SET status='resolved', resolution='superseded by a clean run', resolved_at = now()
   WHERE description_case_id = p_case_id
     AND status IN ('open','in_progress')
     AND NOT (exception_type = ANY(p_keep_types));
  GET DIAGNOSTICS v_count = ROW_COUNT;

  UPDATE public.description_cases
     SET open_exception_count = (
           SELECT count(*) FROM public.description_exceptions
            WHERE description_case_id = p_case_id AND status IN ('open','in_progress'))
   WHERE id = p_case_id;
  RETURN v_count;
END $$;

-- HIGH-2: a blocked case that a human has repaired must be publishable.
CREATE OR REPLACE FUNCTION public.description_case_transition_guard()
RETURNS trigger
LANGUAGE plpgsql SET search_path = public
AS $$
DECLARE allowed text[];
BEGIN
  IF NEW.status = OLD.status THEN RETURN NEW; END IF;
  allowed := CASE OLD.status
    WHEN 'UNINITIALIZED'       THEN ARRAY['QUEUED','BUILDING_FACTS','ARCHIVED']
    WHEN 'QUEUED'              THEN ARRAY['BUILDING_FACTS','GENERATING','FAILED_RETRYABLE','FAILED_BLOCKED','ARCHIVED']
    WHEN 'BUILDING_FACTS'      THEN ARRAY['GENERATING','REVIEW_REQUIRED','FAILED_RETRYABLE','FAILED_BLOCKED','ARCHIVED']
    WHEN 'GENERATING'          THEN ARRAY['VALIDATING','BUILDING_FACTS','FAILED_RETRYABLE','FAILED_BLOCKED','ARCHIVED']
    WHEN 'VALIDATING'          THEN ARRAY['READY','REVIEW_REQUIRED','PUBLISHED','BUILDING_FACTS','GENERATING','FAILED_BLOCKED','FAILED_RETRYABLE','ARCHIVED']
    WHEN 'REVIEW_REQUIRED'     THEN ARRAY['READY','PUBLISHING','PUBLISHED','QUEUED','BUILDING_FACTS','GENERATING','VALIDATING','STALE','FAILED_BLOCKED','FAILED_RETRYABLE','ARCHIVED']
    WHEN 'READY'               THEN ARRAY['PUBLISHING','PUBLISHED','REVIEW_REQUIRED','STALE','QUEUED','BUILDING_FACTS','GENERATING','VALIDATING','FAILED_BLOCKED','FAILED_RETRYABLE','ARCHIVED']
    WHEN 'PUBLISHING'          THEN ARRAY['PUBLISHED','PARTIALLY_PUBLISHED','READY','REVIEW_REQUIRED','BUILDING_FACTS','GENERATING','VALIDATING','FAILED_RETRYABLE','FAILED_BLOCKED','ARCHIVED']
    WHEN 'PARTIALLY_PUBLISHED' THEN ARRAY['PUBLISHED','STALE','QUEUED','BUILDING_FACTS','GENERATING','VALIDATING','READY','REVIEW_REQUIRED','FAILED_RETRYABLE','FAILED_BLOCKED','ARCHIVED']
    WHEN 'PUBLISHED'           THEN ARRAY['STALE','QUEUED','BUILDING_FACTS','GENERATING','VALIDATING','READY','REVIEW_REQUIRED','PARTIALLY_PUBLISHED','FAILED_RETRYABLE','FAILED_BLOCKED','ARCHIVED']
    WHEN 'STALE'               THEN ARRAY['QUEUED','BUILDING_FACTS','GENERATING','VALIDATING','READY','REVIEW_REQUIRED','PUBLISHED','FAILED_RETRYABLE','FAILED_BLOCKED','ARCHIVED']
    -- a human can repair a failed case and publish it
    WHEN 'FAILED_RETRYABLE'    THEN ARRAY['QUEUED','BUILDING_FACTS','GENERATING','VALIDATING','READY','REVIEW_REQUIRED','PUBLISHED','FAILED_BLOCKED','ARCHIVED']
    WHEN 'FAILED_BLOCKED'      THEN ARRAY['QUEUED','BUILDING_FACTS','GENERATING','VALIDATING','READY','REVIEW_REQUIRED','PUBLISHED','FAILED_RETRYABLE','ARCHIVED']
    WHEN 'ARCHIVED'            THEN ARRAY['QUEUED']
    ELSE ARRAY[]::text[]
  END;
  IF NOT (NEW.status = ANY(allowed)) THEN
    RAISE EXCEPTION 'illegal description lifecycle transition: % -> %', OLD.status, NEW.status;
  END IF;
  RETURN NEW;
END $$;

-- HIGH-1: a locked master must not be displaced by publishing a newer version.
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

  -- the lock protects the published copy from being replaced by automation
  -- OR by a one-click publish of a newer generated version
  IF v_case.master_locked
     AND v_case.published_master_version_id IS NOT NULL
     AND v_case.published_master_version_id <> p_version_id THEN
    RETURN jsonb_build_object('ok',false,'error','master_locked');
  END IF;

  SELECT internal_publication_enabled INTO v_enabled
    FROM public.description_settings WHERE tenant_id = v_case.tenant_id;
  IF v_enabled IS NOT NULL AND v_enabled = false THEN
    RETURN jsonb_build_object('ok',false,'error','internal_publication_disabled');
  END IF;

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

  -- publishing clears everything the previous run flagged
  PERFORM public.close_resolved_description_exceptions(p_case_id);

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

-- HIGH-3: only re-enqueue when the configuration actually changed, and never
-- silently rewrite live published copy.
CREATE OR REPLACE FUNCTION public.enqueue_description_config_change(p_tenant_id uuid)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_count integer;
BEGIN
  UPDATE public.description_cases
     SET processed_source_data_version = NULL, updated_at = now()
   WHERE tenant_id = p_tenant_id AND archived_at IS NULL
     AND master_locked = false
     AND status NOT IN ('ARCHIVED','PUBLISHED');
  GET DIAGNOSTICS v_count = ROW_COUNT;

  -- live and locked copy is flagged for a human, not regenerated underneath
  UPDATE public.description_cases
     SET potentially_stale = true, updated_at = now()
   WHERE tenant_id = p_tenant_id AND archived_at IS NULL
     AND (master_locked = true OR status = 'PUBLISHED');
  RETURN v_count;
END $$;

CREATE OR REPLACE FUNCTION public.save_description_settings(p_tenant_id uuid, p_settings jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_uid uuid := (SELECT auth.uid()); v_requeued integer := 0; v_before jsonb; v_after jsonb;
BEGIN
  IF NOT public.has_description_authority(p_tenant_id, 'configure') THEN
    RETURN jsonb_build_object('ok',false,'error','insufficient_permission');
  END IF;

  -- fingerprint the settings that can change generated output
  SELECT to_jsonb(ds) - 'updated_at' - 'created_at' - 'updated_by' - 'configuration_version'
    INTO v_before FROM public.description_settings ds WHERE ds.tenant_id = p_tenant_id;

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

  SELECT to_jsonb(ds) - 'updated_at' - 'created_at' - 'updated_by' - 'configuration_version'
    INTO v_after FROM public.description_settings ds WHERE ds.tenant_id = p_tenant_id;

  IF v_before IS DISTINCT FROM v_after THEN
    v_requeued := public.enqueue_description_config_change(p_tenant_id);
  END IF;

  INSERT INTO public.audit_log (action, entity_type, entity_id, store_id, user_id, details)
  VALUES ('description_configuration_changed','description_settings', p_tenant_id::text,
          p_tenant_id::text, v_uid,
          jsonb_build_object('review_mode', p_settings->>'review_mode',
                             'requeued', v_requeued, 'changed', v_before IS DISTINCT FROM v_after));

  RETURN jsonb_build_object('ok',true,'requeued',v_requeued,'changed', v_before IS DISTINCT FROM v_after);
END $$;

-- MED-1: retire the superseded overloads so a positional call cannot become
-- ambiguous and the stale claim logic can never be reached.
DROP FUNCTION IF EXISTS public.claim_description_job(uuid, uuid, uuid, text, text, jsonb);
DROP FUNCTION IF EXISTS public.archive_description_case(uuid, text);
DROP FUNCTION IF EXISTS public.raise_description_exception(uuid, uuid, uuid, text, text, boolean, text, text, jsonb, text);

GRANT EXECUTE ON FUNCTION public.raise_description_exception(uuid, uuid, uuid, text, text, boolean, text, text, jsonb, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.close_resolved_description_exceptions(uuid, text[]) TO service_role;
