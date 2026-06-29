-- Dealership job roles for per-role access + role-aware navigation.
--
-- Widens tenant_members.role to the 9 job roles (matching
-- src/lib/permissions/dealerRoleCapabilities.ts) PLUS keeps every legacy value
-- valid so no existing row is rejected and nothing in flight breaks. The
-- meaning of a role (which screens) lives in the frontend capability map; the
-- DB only stores which role a member holds and re-enforces privileged writes
-- via the existing RLS/RPCs. Additive + idempotent.
--
-- Also: a General Manager may now manage the team (rbac_is_tenant_admin), per
-- the product decision that GM — not just owner/admin — assigns roles. GSM and
-- other roles are intentionally NOT tenant-admins here.

ALTER TABLE public.tenant_members DROP CONSTRAINT IF EXISTS tenant_members_role_check;
ALTER TABLE public.tenant_members
  ADD CONSTRAINT tenant_members_role_check
  CHECK (role IN (
    -- job roles
    'owner','admin','general_manager','gsm','sales_manager','salesperson',
    'used_car_manager','inventory_manager','service_manager','service_advisor','office',
    -- additional capability-map roles
    'detail','third_party_vendor','finance','compliance','biller','readonly',
    -- legacy, kept valid for backward-compat
    'manager','staff','sales','viewer'
  ));

-- GM joins owner/admin as a tenant administrator (team management only — this
-- function gates the team RPCs below, not the broader owner/admin RLS policies).
CREATE OR REPLACE FUNCTION public.rbac_is_tenant_admin(p_tenant_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.tenant_members
    WHERE tenant_id = p_tenant_id
      AND user_id = (SELECT auth.uid())
      AND role IN ('owner','admin','general_manager')
  );
$$;

-- Re-create with the union role list. Bodies are identical to
-- 20260617000000_team_rbac.sql except the IN(...) allow-list, preserving the
-- last-owner guard and the no-mint-owner rule on invite.
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
END; $$;

CREATE OR REPLACE FUNCTION public.invite_tenant_member(p_tenant_id uuid, p_email text, p_role text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
  IF NOT public.rbac_is_tenant_admin(p_tenant_id) THEN RAISE EXCEPTION 'not authorized'; END IF;
  IF p_role NOT IN (  -- cannot mint an owner via invite
    'admin','general_manager','gsm','sales_manager','salesperson',
    'used_car_manager','inventory_manager','service_manager','service_advisor','office',
    'detail','third_party_vendor','finance','compliance','biller','readonly',
    'manager','staff','sales','viewer'
  ) THEN RAISE EXCEPTION 'invalid role'; END IF;
  INSERT INTO public.tenant_members (tenant_id, invited_email, role, invited_by)
  VALUES (p_tenant_id, lower(trim(p_email)), p_role, (SELECT auth.uid()))
  ON CONFLICT (tenant_id, invited_email) DO UPDATE SET role = EXCLUDED.role
  RETURNING id INTO v_id;
  RETURN v_id;
END; $$;
