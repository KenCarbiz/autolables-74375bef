
-- Security hardening: tighten RLS policies and close anon UPDATE bypass

-- 1) addendums: remove the anon UPDATE policy. Customer signing
--    goes through the SECURITY DEFINER RPC record_customer_signing,
--    which validates the token server-side. There is no need for
--    an anon-callable UPDATE policy on addendums.
DROP POLICY IF EXISTS "Anyone can update addendum via signing token" ON public.addendums;

-- 2) audit_log: tenant-scope SELECT instead of USING(true).
DROP POLICY IF EXISTS "Auth users can view audit log" ON public.audit_log;

CREATE POLICY "Audit log readable by admins, owner, or tenant members"
  ON public.audit_log
  FOR SELECT
  TO authenticated
  USING (
    public.has_role((SELECT auth.uid()), 'admin'::public.app_role)
    OR user_id = (SELECT auth.uid())
    OR (
      store_id IS NOT NULL
      AND store_id IN (
        SELECT tm.tenant_id::text
          FROM public.tenant_members tm
         WHERE tm.user_id = (SELECT auth.uid())
           AND tm.accepted_at IS NOT NULL
      )
    )
  );

-- 3) current_tenant_id(): make deterministic for multi-tenant users.
CREATE OR REPLACE FUNCTION public.current_tenant_id()
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT tenant_id FROM public.tenant_members
  WHERE user_id = auth.uid() AND accepted_at IS NOT NULL
  ORDER BY accepted_at DESC, tenant_id ASC
  LIMIT 1;
$function$;

-- 4) profiles: restrict SELECT to own profile or same-tenant members.
DROP POLICY IF EXISTS "Profiles viewable by authenticated" ON public.profiles;

CREATE POLICY "Profiles viewable by self, same-tenant members, or admins"
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    OR public.has_role((SELECT auth.uid()), 'admin'::public.app_role)
    OR user_id IN (
      SELECT tm.user_id
        FROM public.tenant_members tm
       WHERE tm.tenant_id IN (
              SELECT tm2.tenant_id
                FROM public.tenant_members tm2
               WHERE tm2.user_id = (SELECT auth.uid())
                 AND tm2.accepted_at IS NOT NULL
            )
         AND tm.accepted_at IS NOT NULL
    )
  );

-- 5) tenant_members: prevent role escalation via the "accept own
--    membership" UPDATE policy. Lock down WITH CHECK so users can
--    only accept (toggle accepted_at) on their own row and cannot
--    change role, tenant_id, or user_id. Admin updates remain
--    available via the "Admins update all members" policy and the
--    admin_set_member_role RPC.
DROP POLICY IF EXISTS "Users can accept their own membership" ON public.tenant_members;

CREATE POLICY "Users can accept their own membership"
  ON public.tenant_members
  FOR UPDATE
  TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (
    user_id = (SELECT auth.uid())
    AND role = (SELECT tm.role FROM public.tenant_members tm WHERE tm.id = tenant_members.id)
    AND tenant_id = (SELECT tm.tenant_id FROM public.tenant_members tm WHERE tm.id = tenant_members.id)
    AND user_id = (SELECT tm.user_id FROM public.tenant_members tm WHERE tm.id = tenant_members.id)
  );
