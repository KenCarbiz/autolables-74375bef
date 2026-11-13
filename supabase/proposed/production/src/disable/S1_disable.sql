-- Forward recovery for S1 (RooftopOS spine): the service role loses EXECUTE on the spine RPCs and write access
-- to the spine tables; signed-in staff lose SELECT. Triggers (updated_at) are harmless and stay. No row is
-- deleted. Re-running S1 restores the grants. Run after S3_disable.
DO $$
DECLARE f text; t text;
BEGIN
  FOREACH f IN ARRAY ARRAY['public.integration_key_secret(text)','public.integration_record_source_version(uuid,text,bigint)',
    'public.integration_connection_secrets(uuid)','public.integration_fail_inbox(uuid,text,integer,boolean)',
    'public.integration_claim_inbox(integer,integer)','public.integration_apply_event(uuid,jsonb)'] LOOP
    IF to_regprocedure(f) IS NOT NULL THEN
      EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM authenticated, service_role', f);
    END IF;
  END LOOP;
  FOREACH t IN ARRAY ARRAY['vehicles','vehicle_instances','vehicle_external_refs','integration_connections','integration_connection_keys',
    'integration_inbox','integration_source_versions','integration_outbox','integration_direction_flags','inspection_evidence',
    'repair_items','acquisition_records'] LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('REVOKE SELECT ON public.%I FROM authenticated', t);
      EXECUTE format('REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.%I FROM service_role', t);
    END IF;
  END LOOP;
END $$;
NOTIFY pgrst, 'reload schema';
