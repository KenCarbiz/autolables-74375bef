-- Team / RBAC backend. tenant_members already carries role + invited_email;
-- this adds the management RPCs (admin-gated, last-owner protected) and
-- widens the role set. Security-sensitive: every mutating RPC verifies the
-- caller is an owner/admin of the SAME tenant before acting, and the last
-- owner can never be demoted or removed.

-- Widen the allowed roles (additive — only adds values).
ALTER TABLE public.tenant_members DROP CONSTRAINT IF EXISTS tenant_members_role_check;
ALTER TABLE public.tenant_members
  ADD CONSTRAINT tenant_members_role_check
  CHECK (role IN ('owner','admin','manager','staff','sales','finance','viewer'));

-- Is the caller an accepted owner/admin of this tenant?
CREATE OR REPLACE FUNCTION public.rbac_is_tenant_admin(p_tenant_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.tenant_members
    WHERE tenant_id = p_tenant_id
      AND user_id = (SELECT auth.uid())
      AND role IN ('owner','admin')
  );
$$;

-- List the team (any member of the tenant may read). Joins auth.users for the
-- email via SECURITY DEFINER so the client never queries auth.users directly.
CREATE OR REPLACE FUNCTION public.list_tenant_members(p_tenant_id uuid)
RETURNS TABLE(id uuid, user_id uuid, email text, role text, accepted_at timestamptz, invited_email text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT tm.id, tm.user_id, coalesce(u.email, tm.invited_email) AS email,
         tm.role, tm.accepted_at, tm.invited_email
  FROM public.tenant_members tm
  LEFT JOIN auth.users u ON u.id = tm.user_id
  WHERE tm.tenant_id = p_tenant_id
    AND EXISTS (
      SELECT 1 FROM public.tenant_members me
      WHERE me.tenant_id = p_tenant_id AND me.user_id = (SELECT auth.uid())
    )
  ORDER BY
    CASE tm.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 WHEN 'manager' THEN 2 ELSE 3 END,
    email;
$$;

-- Change a member's role. Admin-only; never strands a tenant without an owner.
CREATE OR REPLACE FUNCTION public.set_tenant_member_role(p_member_id uuid, p_role text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_tenant uuid; v_old_role text;
BEGIN
  IF p_role NOT IN ('owner','admin','manager','staff','sales','finance','viewer') THEN
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

-- Remove a member. Admin-only; never removes the last owner.
CREATE OR REPLACE FUNCTION public.remove_tenant_member(p_member_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_tenant uuid; v_role text;
BEGIN
  SELECT tenant_id, role INTO v_tenant, v_role FROM public.tenant_members WHERE id = p_member_id;
  IF v_tenant IS NULL THEN RETURN; END IF;
  IF NOT public.rbac_is_tenant_admin(v_tenant) THEN RAISE EXCEPTION 'not authorized'; END IF;
  IF v_role = 'owner'
     AND (SELECT count(*) FROM public.tenant_members WHERE tenant_id = v_tenant AND role = 'owner') <= 1 THEN
    RAISE EXCEPTION 'cannot remove the last owner';
  END IF;
  DELETE FROM public.tenant_members WHERE id = p_member_id;
END; $$;

-- Invite a teammate by email (creates a pending membership row; the email is
-- linked to a user_id when they sign up). Admin-only; cannot mint an owner.
CREATE OR REPLACE FUNCTION public.invite_tenant_member(p_tenant_id uuid, p_email text, p_role text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
  IF NOT public.rbac_is_tenant_admin(p_tenant_id) THEN RAISE EXCEPTION 'not authorized'; END IF;
  IF p_role NOT IN ('admin','manager','staff','sales','finance','viewer') THEN RAISE EXCEPTION 'invalid role'; END IF;
  INSERT INTO public.tenant_members (tenant_id, invited_email, role, invited_by)
  VALUES (p_tenant_id, lower(trim(p_email)), p_role, (SELECT auth.uid()))
  ON CONFLICT (tenant_id, invited_email) DO UPDATE SET role = EXCLUDED.role
  RETURNING id INTO v_id;
  RETURN v_id;
END; $$;

GRANT EXECUTE ON FUNCTION public.rbac_is_tenant_admin(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_tenant_members(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_tenant_member_role(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.remove_tenant_member(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.invite_tenant_member(uuid, text, text) TO authenticated;
