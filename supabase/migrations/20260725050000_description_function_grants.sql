-- Description Intelligence — lock down function execution + four correctness fixes
--
-- CRITICAL: Postgres grants EXECUTE on every new function to PUBLIC by default.
-- The earlier migrations only added `GRANT ... TO service_role`, which does not
-- remove that default, so every SECURITY DEFINER function in this feature was
-- callable with the public anon key. `next_description_reconcile_batch(NULL, N)`
-- would have returned tenant_id/vehicle_id/vin for every dealer's inventory.
-- The repo's other draft-creating RPCs already revoke; this restores that
-- convention for the description functions.

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname IN (
         'init_description_case','claim_description_job','publish_description_internal',
         'archive_description_case','next_description_reconcile_batch','has_description_authority',
         'resolve_description_conflict','save_description_manual_version','set_description_lock',
         'save_description_settings','approve_description_version','description_publish_allowed',
         'raise_description_exception','mark_description_stale',
         'close_resolved_description_exceptions','enqueue_description_config_change',
         'schedule_description_reconcile','unschedule_description_reconcile',
         'description_case_transition_guard','description_version_immutable',
         'description_case_follow_listing_status')
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.sig);
  END LOOP;
END $$;

-- Re-grant only the RPCs the browser client legitimately calls. Each one
-- self-enforces membership via has_description_authority.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname IN (
         'publish_description_internal','description_publish_allowed','resolve_description_conflict',
         'save_description_manual_version','set_description_lock','save_description_settings',
         'approve_description_version','has_description_authority')
  LOOP
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', r.sig);
  END LOOP;
END $$;

-- CRITICAL 2: this was granted to `authenticated` with no authority check at
-- all, so any signed-in user could null a competitor's processed fingerprints
-- and force their whole fleet through the LLM on the next sweep.
CREATE OR REPLACE FUNCTION public.enqueue_description_config_change(p_tenant_id uuid)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_count integer;
BEGIN
  -- auth.uid() is NULL under the service-role key (automation); an interactive
  -- caller must hold configure authority on this exact tenant.
  IF (SELECT auth.uid()) IS NOT NULL
     AND NOT public.has_description_authority(p_tenant_id, 'configure') THEN
    RAISE EXCEPTION 'insufficient_permission';
  END IF;

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

REVOKE ALL ON FUNCTION public.enqueue_description_config_change(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_description_config_change(uuid) TO service_role;

-- HIGH 5: an UPSERT that COALESCEs a missing key to '[]' does not "keep the
-- default" — it overwrites the dealer's real channel list with an empty array,
-- silently switching off every marketplace variant. Absent keys must preserve
-- the stored value.
CREATE OR REPLACE FUNCTION public.save_description_settings(p_tenant_id uuid, p_settings jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_before jsonb; v_after jsonb; v_row public.description_settings;
BEGIN
  IF NOT public.has_description_authority(p_tenant_id, 'configure') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'insufficient_permission');
  END IF;

  SELECT * INTO v_row FROM public.description_settings WHERE tenant_id = p_tenant_id;
  v_before := to_jsonb(v_row);

  INSERT INTO public.description_settings AS ds (tenant_id) VALUES (p_tenant_id)
  ON CONFLICT (tenant_id) DO NOTHING;

  UPDATE public.description_settings ds SET
    review_mode           = COALESCE(p_settings->>'review_mode', ds.review_mode),
    review_mode_by_class  = COALESCE(p_settings->'review_mode_by_class', ds.review_mode_by_class),
    enabled_channels      = COALESCE(p_settings->'enabled_channels', ds.enabled_channels),
    default_tone          = COALESCE(p_settings->>'default_tone', ds.default_tone),
    brand_voice           = COALESCE(p_settings->>'brand_voice', ds.brand_voice),
    cta_template          = COALESCE(p_settings->>'cta_template', ds.cta_template),
    required_legal_text   = COALESCE(p_settings->>'required_legal_text', ds.required_legal_text),
    dealer_name_format    = COALESCE(p_settings->>'dealer_name_format', ds.dealer_name_format),
    primary_city          = COALESCE(p_settings->>'primary_city', ds.primary_city),
    state                 = COALESCE(p_settings->>'state', ds.state),
    selling_areas         = COALESCE(p_settings->'selling_areas', ds.selling_areas),
    updated_by            = (SELECT auth.uid()),
    prohibited_phrases    = COALESCE(p_settings->'prohibited_phrases', ds.prohibited_phrases),
    class_rules           = COALESCE(p_settings->'class_rules', ds.class_rules),
    min_length            = COALESCE((p_settings->>'min_length')::integer, ds.min_length),
    max_length            = COALESCE((p_settings->>'max_length')::integer, ds.max_length),
    quality_threshold     = COALESCE((p_settings->>'quality_threshold')::integer, ds.quality_threshold),
    generation_model      = COALESCE(p_settings->>'generation_model', ds.generation_model),
    prompt_version        = COALESCE(p_settings->>'prompt_version', ds.prompt_version),
    warranty_language_allowed     = COALESCE((p_settings->>'warranty_language_allowed')::boolean, ds.warranty_language_allowed),
    cpo_language_allowed          = COALESCE((p_settings->>'cpo_language_allowed')::boolean, ds.cpo_language_allowed),
    accessory_language_allowed    = COALESCE((p_settings->>'accessory_language_allowed')::boolean, ds.accessory_language_allowed),
    market_context_allowed        = COALESCE((p_settings->>'market_context_allowed')::boolean, ds.market_context_allowed),
    price_in_description          = COALESCE((p_settings->>'price_in_description')::boolean, ds.price_in_description),
    internal_publication_enabled  = COALESCE((p_settings->>'internal_publication_enabled')::boolean, ds.internal_publication_enabled),
    updated_at = now()
  WHERE ds.tenant_id = p_tenant_id
  RETURNING * INTO v_row;

  v_after := to_jsonb(v_row);

  -- Only churn the fleet when something actually changed.
  IF v_before IS DISTINCT FROM v_after THEN
    PERFORM public.enqueue_description_config_change(p_tenant_id);
  END IF;

  INSERT INTO public.audit_log (action, entity_type, entity_id, store_id, user_id, details)
  VALUES ('description_settings_saved','description_settings', p_tenant_id::text,
          p_tenant_id::text, (SELECT auth.uid()),
          jsonb_build_object('keys', (SELECT jsonb_agg(k) FROM jsonb_object_keys(p_settings) k)));

  RETURN jsonb_build_object('ok', true, 'settings', v_after);
END $$;

REVOKE ALL ON FUNCTION public.save_description_settings(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_description_settings(uuid, jsonb) TO authenticated, service_role;

-- MEDIUM 6: the authority lists must mirror dealerRoleCapabilities.ts exactly,
-- or the UI enables a button the RPC then refuses (and vice versa).
--   approve  -> can_approve_passport_proof
--   resolve  -> resolve_exceptions
--   configure-> can_manage_settings
CREATE OR REPLACE FUNCTION public.has_description_authority(p_tenant_id uuid, p_level text DEFAULT 'approve')
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.tenant_members tm
     WHERE tm.tenant_id = p_tenant_id
       AND tm.user_id = (SELECT auth.uid())
       AND tm.accepted_at IS NOT NULL
       AND lower(trim(tm.role)) = ANY (
         CASE p_level
           WHEN 'approve' THEN ARRAY[
             'owner','general_manager','gsm','admin','manager',
             'sales_manager','used_car_manager','inventory_manager','service_manager']
           WHEN 'resolve' THEN ARRAY[
             'owner','general_manager','gsm','admin','manager',
             'office','finance','compliance']
           WHEN 'configure' THEN ARRAY[
             'owner','general_manager','gsm','admin','manager']
           ELSE ARRAY[
             'owner','general_manager','gsm','admin','manager',
             'sales_manager','used_car_manager','inventory_manager']
         END)
  ) OR public.has_role((SELECT auth.uid()), 'admin'::public.app_role);
$$;

REVOKE ALL ON FUNCTION public.has_description_authority(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_description_authority(uuid, text) TO authenticated, service_role;

-- MEDIUM 8: the dedupe SELECT is unlocked, so two concurrent runs on the same
-- case both pass the existence check and the second INSERT hits the partial
-- unique index. Swallow that specific collision — the row it wanted already
-- exists — instead of surfacing an error the caller only logs.
CREATE OR REPLACE FUNCTION public.raise_description_exception(
  p_tenant_id uuid, p_vehicle_id uuid, p_case_id uuid,
  p_type text, p_severity text, p_blocking boolean,
  p_title text, p_summary text, p_details jsonb DEFAULT '{}'::jsonb,
  p_channel text DEFAULT NULL, p_field_key text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_id uuid;
BEGIN
  SELECT id INTO v_id FROM public.description_exceptions
   WHERE description_case_id = p_case_id
     AND exception_type = p_type
     AND COALESCE(channel,'') = COALESCE(p_channel,'')
     AND COALESCE(field_key,'') = COALESCE(p_field_key,'')
     AND status IN ('open','in_progress')
   LIMIT 1;

  IF v_id IS NOT NULL THEN
    UPDATE public.description_exceptions
       SET summary = p_summary, details_json = p_details, severity = p_severity,
           blocking = p_blocking, updated_at = now()
     WHERE id = v_id;
  ELSE
    BEGIN
      INSERT INTO public.description_exceptions
        (tenant_id, vehicle_id, description_case_id, exception_type, severity, blocking,
         title, summary, details_json, channel, field_key, status)
      VALUES (p_tenant_id, p_vehicle_id, p_case_id, p_type, p_severity, p_blocking,
              p_title, p_summary, p_details, p_channel, p_field_key, 'open')
      RETURNING id INTO v_id;
    EXCEPTION WHEN unique_violation THEN
      SELECT id INTO v_id FROM public.description_exceptions
       WHERE description_case_id = p_case_id
         AND exception_type = p_type
         AND COALESCE(channel,'') = COALESCE(p_channel,'')
         AND COALESCE(field_key,'') = COALESCE(p_field_key,'')
         AND status IN ('open','in_progress')
       LIMIT 1;
    END;
  END IF;

  UPDATE public.description_cases
     SET open_exception_count = (
           SELECT count(*) FROM public.description_exceptions
            WHERE description_case_id = p_case_id AND status IN ('open','in_progress'))
   WHERE id = p_case_id;

  RETURN v_id;
END $$;

REVOKE ALL ON FUNCTION public.raise_description_exception(uuid, uuid, uuid, text, text, boolean, text, text, jsonb, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.raise_description_exception(uuid, uuid, uuid, text, text, boolean, text, text, jsonb, text, text) TO service_role;

-- HIGH 4: publishing must not resolve exceptions the same run just raised.
-- The orchestrator does its own precise sweep with the set of types it actually
-- raised; publish keeping a hardcoded list silently closed MANUAL_CONTENT_STALE
-- and CHANNEL_GENERATION_FAILED, so a manager never learned their locked copy
-- had drifted.
CREATE OR REPLACE FUNCTION public.close_resolved_description_exceptions(
  p_case_id uuid, p_keep_types text[] DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_count integer;
BEGIN
  -- NULL keep-list means "close nothing"; only an explicit list sweeps.
  IF p_keep_types IS NULL THEN
    UPDATE public.description_cases
       SET open_exception_count = (
             SELECT count(*) FROM public.description_exceptions
              WHERE description_case_id = p_case_id AND status IN ('open','in_progress'))
     WHERE id = p_case_id;
    RETURN 0;
  END IF;

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

REVOKE ALL ON FUNCTION public.close_resolved_description_exceptions(uuid, text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.close_resolved_description_exceptions(uuid, text[]) TO service_role;
