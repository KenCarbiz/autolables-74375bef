-- Description Intelligence — manual editing of a channel variant.
--
-- Channel locks and `manual_edit` semantics already existed, but there was no
-- way to MAKE a manual channel edit: the lock protected copy nobody could
-- write. A dealer who needs AutoTrader worded differently from the master had
-- to accept the generated variant or turn the channel off.
--
-- The edit is validated server-side exactly like a master edit: the row is
-- written with validation_status 'pending' and locked, so automation will not
-- overwrite it and nothing claims it passed until the validator runs.

CREATE OR REPLACE FUNCTION public.save_description_channel_version(
  p_case_id uuid, p_channel text, p_content text,
  p_seo_title text DEFAULT NULL, p_meta_description text DEFAULT NULL,
  p_reason text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_case public.description_cases%ROWTYPE;
  v_existing public.description_channel_versions%ROWTYPE;
  v_limit integer;
  v_uid uuid := (SELECT auth.uid());
  v_id uuid;
BEGIN
  SELECT * INTO v_case FROM public.description_cases WHERE id = p_case_id;
  IF v_case.id IS NULL THEN RETURN jsonb_build_object('ok',false,'error','case_not_found'); END IF;
  IF NOT public.has_description_authority(v_case.tenant_id, 'approve') THEN
    RETURN jsonb_build_object('ok',false,'error','insufficient_permission');
  END IF;
  IF p_content IS NULL OR length(btrim(p_content)) < 20 THEN
    RETURN jsonb_build_object('ok',false,'error','content_too_short');
  END IF;
  IF v_case.current_master_version_id IS NULL THEN
    RETURN jsonb_build_object('ok',false,'error','no_master_version');
  END IF;

  SELECT * INTO v_existing FROM public.description_channel_versions
   WHERE description_case_id = p_case_id AND channel = p_channel
   ORDER BY created_at DESC LIMIT 1;

  v_limit := COALESCE(v_existing.character_limit, 2400);
  IF length(p_content) > v_limit THEN
    RETURN jsonb_build_object('ok',false,'error','over_channel_limit',
                              'limit', v_limit, 'length', length(p_content));
  END IF;

  INSERT INTO public.description_channel_versions
    (tenant_id, vehicle_id, description_case_id, master_version_id, channel, content,
     seo_title, meta_description, character_count, character_limit,
     validation_status, potentially_stale, manual_edit, locked, locked_by, locked_at, lock_reason)
  VALUES (v_case.tenant_id, v_case.vehicle_id, p_case_id, v_case.current_master_version_id,
     p_channel, p_content,
     COALESCE(p_seo_title, v_existing.seo_title), COALESCE(p_meta_description, v_existing.meta_description),
     length(p_content), v_limit,
     -- never 'passed' until the server validator has actually run
     'pending', false, true, true, v_uid, now(), COALESCE(p_reason, 'manual edit'))
  ON CONFLICT (master_version_id, channel) DO UPDATE
    SET content = EXCLUDED.content,
        seo_title = EXCLUDED.seo_title,
        meta_description = EXCLUDED.meta_description,
        character_count = EXCLUDED.character_count,
        validation_status = 'pending',
        potentially_stale = false,
        manual_edit = true,
        locked = true, locked_by = EXCLUDED.locked_by, locked_at = now(),
        lock_reason = EXCLUDED.lock_reason,
        updated_at = now()
  RETURNING id INTO v_id;

  INSERT INTO public.audit_log (action, entity_type, entity_id, store_id, user_id, details)
  VALUES ('description_channel_edited','description_case', p_case_id::text,
          v_case.tenant_id::text, v_uid,
          jsonb_build_object('vin', v_case.vin, 'channel', p_channel,
                             'channel_version_id', v_id, 'reason', p_reason));

  RETURN jsonb_build_object('ok',true,'channel_version_id',v_id,'requires_validation',true);
END $$;

REVOKE ALL ON FUNCTION public.save_description_channel_version(uuid, text, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_description_channel_version(uuid, text, text, text, text, text) TO authenticated, service_role;
