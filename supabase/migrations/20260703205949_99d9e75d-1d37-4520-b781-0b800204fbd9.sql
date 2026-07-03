
DROP POLICY IF EXISTS "Users can accept their own membership" ON public.tenant_members;

CREATE OR REPLACE FUNCTION public.prevent_tenant_member_self_escalation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF (SELECT auth.uid()) = OLD.user_id
     AND NOT public.has_role((SELECT auth.uid()), 'admin'::app_role)
     AND NOT public.is_tenant_manager(OLD.tenant_id, (SELECT auth.uid())) THEN
    IF NEW.role IS DISTINCT FROM OLD.role
       OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
       OR NEW.user_id IS DISTINCT FROM OLD.user_id THEN
      RAISE EXCEPTION 'Only accepted_at may be modified when accepting your own membership';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_tenant_member_self_escalation ON public.tenant_members;
CREATE TRIGGER trg_prevent_tenant_member_self_escalation
  BEFORE UPDATE ON public.tenant_members
  FOR EACH ROW EXECUTE FUNCTION public.prevent_tenant_member_self_escalation();

CREATE POLICY "Users can accept their own membership"
  ON public.tenant_members
  FOR UPDATE
  TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));
