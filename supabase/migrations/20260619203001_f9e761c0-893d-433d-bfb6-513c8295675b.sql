
-- 1) Stop leaking install_token to anonymous visitors. Column-level revoke
-- keeps the rest of the listing publicly readable for the /v/:slug page.
REVOKE SELECT (install_token) ON public.vehicle_listings FROM anon;

-- 2) audit_log: prevent cross-tenant pollution by authenticated users.
DROP POLICY IF EXISTS "Auth users can insert audit events" ON public.audit_log;
CREATE POLICY "Auth users can insert audit events"
  ON public.audit_log FOR INSERT TO authenticated
  WITH CHECK (
    (user_id IS NULL OR user_id = (SELECT auth.uid()))
    AND (
      store_id IS NULL
      OR public.has_role((SELECT auth.uid()), 'admin'::public.app_role)
      OR store_id IN (
        SELECT tm.tenant_id::text
          FROM public.tenant_members tm
         WHERE tm.user_id = (SELECT auth.uid())
           AND tm.accepted_at IS NOT NULL
      )
    )
  );

-- 3) addendum_signings: employee inserts must reference caller's own addendum.
DROP POLICY IF EXISTS "Tenant members insert employee signings" ON public.addendum_signings;
CREATE POLICY "Tenant members insert employee signings"
  ON public.addendum_signings FOR INSERT TO authenticated
  WITH CHECK (
    ((tenant_id IS NULL) OR (tenant_id = public.current_tenant_id()))
    AND signer_type = ANY (ARRAY['employee','salesperson','finance_manager','foreman','service_writer','dealer_principal','other'])
    AND (
      addendum_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.addendums a
         WHERE a.id = addendum_signings.addendum_id
           AND a.tenant_id = public.current_tenant_id()
      )
    )
  );

-- 4) marketcheck_sync_config: only accepted members can read.
DROP POLICY IF EXISTS marketcheck_config_read ON public.marketcheck_sync_config;
CREATE POLICY marketcheck_config_read
  ON public.marketcheck_sync_config FOR SELECT TO authenticated
  USING (
    public.has_role((SELECT auth.uid()), 'admin'::public.app_role)
    OR tenant_id IN (
      SELECT tm.tenant_id FROM public.tenant_members tm
       WHERE tm.user_id = (SELECT auth.uid())
         AND tm.accepted_at IS NOT NULL
    )
  );

-- 5) Pin search_path on the lone function missing it.
CREATE OR REPLACE FUNCTION public.enforce_price_verified_before_sign()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.status = 'signed'
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'signed')
     AND COALESCE(NEW.price_verified, false) IS NOT TRUE
     AND public.tenant_price_verification_on(NEW.tenant_id) THEN
    RAISE EXCEPTION 'price not verified: addendum cannot be signed (status=%)',
      COALESCE(NEW.price_verification_status, 'pending')
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$function$;
