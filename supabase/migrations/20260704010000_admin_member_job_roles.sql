-- The platform-admin role changer still enforced the pre-job-roles allow-list
-- ('owner','admin','manager','staff'), so the Members grid could not assign
-- the 18 job roles that 20260630000000_job_roles.sql already allows through
-- the tenant-level set_tenant_member_role. Align the two allow-lists.

CREATE OR REPLACE FUNCTION public.admin_set_member_role(
  _member_id UUID,
  _role      TEXT
) RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_role((SELECT auth.uid()), 'admin') THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  IF _role NOT IN (
    'owner','admin','general_manager','gsm','manager','sales_manager','salesperson',
    'used_car_manager','inventory_manager','service_manager','service_advisor',
    'detail','third_party_vendor','office','finance','compliance','biller','readonly',
    'staff','sales','viewer'
  ) THEN
    RAISE EXCEPTION 'invalid role %', _role;
  END IF;

  UPDATE public.tenant_members SET role = _role WHERE id = _member_id;

  INSERT INTO public.audit_log (
    action, entity_type, entity_id, user_id, details
  ) VALUES (
    'member_role_changed', 'tenant_member', _member_id::text, (SELECT auth.uid()),
    jsonb_build_object('new_role', _role)
  );
  RETURN true;
END;
$$;
