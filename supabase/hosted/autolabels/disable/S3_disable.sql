-- Forward recovery for S3 (vehicle history foundation, PR #46 content): signed-in staff and the service role
-- lose EXECUTE on every history and integration RPC and staff lose SELECT on the history tables. The
-- append-only and custody-guard triggers stay ENABLED on purpose: disabling them would open the history to
-- mutation, which is the opposite of recovery. No row is deleted. Re-running S3 restores the grants.
-- Run before S1_disable; it does not restore the spine bodies of integration_claim_inbox/integration_apply_event.
DO $$
DECLARE f text; t text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.integration_claim_inbox(integer,integer)','public.integration_apply_event(uuid,jsonb)',
    'public.integration_delivery_allowed(uuid)','public.integration_quarantine(public.integration_inbox,text)',
    'public.integration_replay_inbox(uuid,uuid[],text)',
    'public.vehicle_history_is_service()','public.vehicle_history_audit_write(uuid,text,text,text,text,jsonb,jsonb)',
    'public.vehicle_history_flag(uuid,uuid,text)','public.vehicle_history_can_read(public.vehicle_access_grants,text,uuid,timestamptz)',
    'public.vehicle_history_backfill_tenant(uuid,boolean)','public.vehicle_history_is_platform_admin()',
    'public.vehicle_history_is_manager(uuid)','public.vehicle_history_effective_setting(uuid,uuid,text)',
    'public.vehicle_history_set_setting(text,uuid,text,jsonb,integer,text)',
    'public.vehicle_history_record_milestone(uuid,text,timestamptz,text,text,text,text,uuid,uuid,text,bigint)',
    'public.vehicle_history_flag_reappearance(uuid,uuid,text,uuid,text,text)',
    'public.vehicle_history_resolve_reappearance(uuid,text,text)',
    'public.vehicle_history_grant_access(uuid,text,uuid,text,uuid,text,text,text[],text,timestamptz,timestamptz)',
    'public.vehicle_history_end_access(uuid,text,timestamptz,text)',
    'public.vehicle_history_set_transaction_retention(uuid,timestamptz,text)',
    'public.vehicle_history_owner_view(text)','public.vehicle_history_apply_identity_correction(uuid)',
    'public.vehicle_history_next_state(text,text)'] LOOP
    IF to_regprocedure(f) IS NOT NULL THEN
      EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM authenticated, service_role', f);
    END IF;
  END LOOP;
  FOREACH t IN ARRAY ARRAY['vehicle_identity_quarantine','vehicle_identity_corrections','vehicle_custody_milestones','service_visits',
    'repair_item_status_history','vehicle_reappearance_reviews','vehicle_access_grants','vehicle_history_setting_keys',
    'vehicle_history_settings','vehicle_history_audit'] LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('REVOKE SELECT ON public.%I FROM authenticated', t);
      EXECUTE format('REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.%I FROM service_role', t);
    END IF;
  END LOOP;
END $$;
NOTIFY pgrst, 'reload schema';
