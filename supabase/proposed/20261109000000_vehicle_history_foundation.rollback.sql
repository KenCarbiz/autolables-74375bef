-- Rollback for 20261109000000_vehicle_history_foundation.sql. PROPOSED, NOT APPLIED.
-- Disables the new writers and readers. Keeps every collected row: vehicles, episodes,
-- milestones, service visits, evidence, repair history, quarantine, grants, settings,
-- inbox/outbox and audit. Nothing is dropped and nothing cascades.

-- 1. Stop new effects at the point of use: platform-level holds win over any tenant value.
DO $$
DECLARE v integer;
BEGIN
  SELECT COALESCE(max(version), 0) INTO v FROM public.vehicle_history_settings WHERE scope_type = 'platform' AND key = 'integration.apply_paused';
  INSERT INTO public.vehicle_history_settings (scope_type, scope_id, key, value, version, reason)
  VALUES ('platform', NULL, 'integration.apply_paused', 'true', v + 1, 'rollback: pause application');
  SELECT COALESCE(max(version), 0) INTO v FROM public.vehicle_history_settings WHERE scope_type = 'platform' AND key = 'service.attach_enabled';
  INSERT INTO public.vehicle_history_settings (scope_type, scope_id, key, value, version, reason)
  VALUES ('platform', NULL, 'service.attach_enabled', 'false', v + 1, 'rollback: stop service attachment');
  SELECT COALESCE(max(version), 0) INTO v FROM public.vehicle_history_settings WHERE scope_type = 'platform' AND key = 'integration.outbound_capture_enabled';
  INSERT INTO public.vehicle_history_settings (scope_type, scope_id, key, value, version, reason)
  VALUES ('platform', NULL, 'integration.outbound_capture_enabled', 'false', v + 1, 'rollback: stop outbound capture');
  SELECT COALESCE(max(version), 0) INTO v FROM public.vehicle_history_settings WHERE scope_type = 'platform' AND key = 'lifecycle.emergency_hold';
  INSERT INTO public.vehicle_history_settings (scope_type, scope_id, key, value, version, reason)
  VALUES ('platform', NULL, 'lifecycle.emergency_hold', 'true', v + 1, 'rollback: freeze lifecycle writes');
END $$;

-- 2. Remove client entry points. Service role keeps them for supervised recovery.
DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
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
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM authenticated', f);
  END LOOP;
END $$;

-- 3. Staff read access to the retained history stays in place (tenant-scoped RLS), so
--    archive lookup keeps working. To also hide it, revoke SELECT per table; never DROP.
