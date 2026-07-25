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
