
-- 1. get_ready_nudge_log — enable RLS + admin-only read
ALTER TABLE public.get_ready_nudge_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins read nudge log" ON public.get_ready_nudge_log;
CREATE POLICY "Admins read nudge log" ON public.get_ready_nudge_log
  FOR SELECT TO authenticated
  USING (public.has_role((SELECT auth.uid()), 'admin'::public.app_role));
-- service_role bypasses RLS, writes still work from edge functions.
REVOKE ALL ON public.get_ready_nudge_log FROM anon, authenticated;
GRANT SELECT ON public.get_ready_nudge_log TO authenticated;
GRANT ALL  ON public.get_ready_nudge_log TO service_role;

-- 2. passport_sms_verifications — make fail-closed explicit for authenticated
REVOKE SELECT, INSERT, UPDATE, DELETE ON public.passport_sms_verifications FROM anon, authenticated;
GRANT ALL ON public.passport_sms_verifications TO service_role;
DROP POLICY IF EXISTS "No authenticated read of sms verifications" ON public.passport_sms_verifications;
CREATE POLICY "No authenticated read of sms verifications"
  ON public.passport_sms_verifications
  FOR SELECT TO authenticated
  USING (false);

-- 3. service-docs storage policies — tenant-scoped writes; reads stay via public URL.
DROP POLICY IF EXISTS "service-docs tenant insert"  ON storage.objects;
DROP POLICY IF EXISTS "service-docs tenant update"  ON storage.objects;
DROP POLICY IF EXISTS "service-docs tenant delete"  ON storage.objects;
DROP POLICY IF EXISTS "service-docs anon no write"  ON storage.objects;

CREATE POLICY "service-docs tenant insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'service-docs'
    AND (storage.foldername(name))[1]::uuid IN (
      SELECT tenant_id FROM public.tenant_members
       WHERE user_id = (SELECT auth.uid()) AND accepted_at IS NOT NULL
    )
  );

CREATE POLICY "service-docs tenant update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'service-docs'
    AND (storage.foldername(name))[1]::uuid IN (
      SELECT tenant_id FROM public.tenant_members
       WHERE user_id = (SELECT auth.uid()) AND accepted_at IS NOT NULL
    )
  )
  WITH CHECK (
    bucket_id = 'service-docs'
    AND (storage.foldername(name))[1]::uuid IN (
      SELECT tenant_id FROM public.tenant_members
       WHERE user_id = (SELECT auth.uid()) AND accepted_at IS NOT NULL
    )
  );

CREATE POLICY "service-docs tenant delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'service-docs'
    AND (storage.foldername(name))[1]::uuid IN (
      SELECT tenant_id FROM public.tenant_members
       WHERE user_id = (SELECT auth.uid()) AND accepted_at IS NOT NULL
    )
  );

-- 4. Revoke EXECUTE from anon + authenticated on admin/internal SECURITY DEFINER functions.
--    Service-role + cron callers (which run as postgres) are unaffected.
DO $$
DECLARE
  fn text;
  fns text[] := ARRAY[
    'admin_clear_synced_inventory(uuid)',
    'admin_create_tenant(text,text,text,text,text,text,integer)',
    'admin_invite_member(uuid,text,text)',
    'admin_link_autocurb(uuid,text,jsonb)',
    'admin_override_entitlement(uuid,text,text,text,timestamptz,integer)',
    'admin_set_member_role(uuid,text)',
    'admin_set_tenant_active(uuid,boolean)',
    'admin_set_tenant_features(uuid,jsonb)',
    'save_marketcheck_config(uuid,boolean,text,integer,text,integer,integer)',
    'save_marketcheck_config(uuid,boolean,text,integer,text,integer,integer,text)',
    'schedule_marketcheck_sync(text,text,text)',
    'schedule_reengage_abandoned_signings(text,text,text)',
    'unschedule_marketcheck_sync()',
    'unschedule_reengage_abandoned_signings()',
    'set_marketcheck_allowed(uuid,boolean)',
    'marketcheck_prune_inventory(uuid,text[])',
    'find_abandoned_signings(integer,integer,integer)',
    'next_enrich_batch(timestamptz,integer)',
    'mark_addendum_executed(uuid)',
    'record_evidence_receipt(text,text,jsonb,text)',
    'record_signing_reengagement(uuid,text,jsonb)',
    'verify_addendum_price(uuid,numeric)',
    'verify_audit_chain(text)',
    'get_cron_job_status(text)',
    'get_tenant_billing(uuid)',
    'get_reengage_schedule()',
    'get_ready_nudge_payload(uuid)',
    'autocurb_cancel_subscription(text)',
    'autocurb_upsert_dealer(text,uuid,text,text,text,text,boolean,text,text,timestamptz,text)'
  ];
BEGIN
  FOREACH fn IN ARRAY fns LOOP
    BEGIN
      EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%s FROM anon, authenticated, PUBLIC', fn);
    EXCEPTION WHEN undefined_function THEN
      -- skip if signature missing
      NULL;
    END;
  END LOOP;
END $$;
