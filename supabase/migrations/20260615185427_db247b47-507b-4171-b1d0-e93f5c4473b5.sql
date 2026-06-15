REVOKE ALL ON public.audit_log FROM anon;
REVOKE ALL ON public.email_recipients FROM anon;
REVOKE ALL ON public.product_rules FROM anon;
REVOKE ALL ON public.products FROM anon;
REVOKE ALL ON public.tenant_members FROM anon;
REVOKE ALL ON public.vehicle_files FROM anon;

GRANT INSERT ON public.audit_log TO anon;
GRANT SELECT ON public.products TO anon;

REVOKE ALL ON FUNCTION public.is_tenant_manager(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_tenant_manager(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.is_tenant_manager(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_tenant_manager(uuid, uuid) TO service_role;