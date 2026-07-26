-- Security audit D2.1: the k208_signer_allowed compat fallback (20260726105000)
-- judges tenant_members.role, so that field must never be self-serve. Audit of
-- the existing controls: role is constraint-checked (20260630000000), a member
-- cannot change their own role (trg_prevent_tenant_member_self_escalation,
-- 20260703205949, plus the self-only UPDATE policy), and the only tenant-level
-- role writer is set_tenant_member_role gated by rbac_is_tenant_admin. Two
-- residual gaps are closed here, keeping the compat fallback intact so
-- unconfigured stores are not stranded:
--   1. rbac_is_tenant_admin accepted an INVITED-but-unaccepted owner/admin/GM
--      row once user_id was linked — every other authority check in the system
--      requires accepted_at. Align it.
--   2. set_tenant_member_role changed signing-relevant authority with no audit
--      trail; it now writes the same member_role_changed row the platform-admin
--      path (admin_set_member_role) already writes.

CREATE OR REPLACE FUNCTION public.rbac_is_tenant_admin(p_tenant_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.tenant_members
    WHERE tenant_id = p_tenant_id
      AND user_id = (SELECT auth.uid())
      AND accepted_at IS NOT NULL
      AND role IN ('owner','admin','general_manager')
  );
$$;

CREATE OR REPLACE FUNCTION public.set_tenant_member_role(p_member_id uuid, p_role text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_tenant uuid; v_old_role text;
BEGIN
  IF p_role NOT IN (
    'owner','admin','general_manager','gsm','sales_manager','salesperson',
    'used_car_manager','inventory_manager','service_manager','service_advisor','office',
    'detail','third_party_vendor','finance','compliance','biller','readonly',
    'manager','staff','sales','viewer'
  ) THEN
    RAISE EXCEPTION 'invalid role';
  END IF;
  SELECT tenant_id, role INTO v_tenant, v_old_role FROM public.tenant_members WHERE id = p_member_id;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'member not found'; END IF;
  IF NOT public.rbac_is_tenant_admin(v_tenant) THEN RAISE EXCEPTION 'not authorized'; END IF;
  IF v_old_role = 'owner' AND p_role <> 'owner'
     AND (SELECT count(*) FROM public.tenant_members WHERE tenant_id = v_tenant AND role = 'owner') <= 1 THEN
    RAISE EXCEPTION 'cannot remove the last owner';
  END IF;
  UPDATE public.tenant_members SET role = p_role WHERE id = p_member_id;

  INSERT INTO public.audit_log (action, entity_type, entity_id, store_id, user_id, details)
  VALUES ('member_role_changed', 'tenant_member', p_member_id::text, v_tenant::text, (SELECT auth.uid()),
          jsonb_build_object('prev_role', v_old_role, 'new_role', p_role));
END; $$;
