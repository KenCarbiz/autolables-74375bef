
-- Fix 1: Remove permissive anon SELECT on addendums.
-- Public signing flow already uses get_addendum_by_token RPC (SECURITY DEFINER).
DROP POLICY IF EXISTS "Anyone can view addendum by signing token" ON public.addendums;

-- Fix 2: Close privilege-escalation hole on tenant_members.
-- The "Owners can invite members" INSERT policy previously allowed
-- ANY authenticated user to insert a row by setting invited_by = auth.uid().
-- Restrict to actual owners/admins of the target tenant.
DROP POLICY IF EXISTS "Owners can invite members" ON public.tenant_members;
CREATE POLICY "Owners can invite members"
  ON public.tenant_members FOR INSERT
  TO authenticated
  WITH CHECK (
    tenant_id IN (
      SELECT tm.tenant_id FROM public.tenant_members tm
      WHERE tm.user_id = (SELECT auth.uid())
        AND tm.role = ANY (ARRAY['owner','admin'])
        AND tm.accepted_at IS NOT NULL
    )
  );
