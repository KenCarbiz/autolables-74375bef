CREATE OR REPLACE FUNCTION public.get_install_proofs_public(_slug text)
RETURNS TABLE (id uuid, product_name text, installer_company text, installed_at timestamptz, photo_path text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT ip.id, ip.product_name, ip.installer_company, ip.installed_at, ip.photo_path
  FROM public.install_proofs ip
  JOIN public.vehicle_listings v ON v.vin = ip.vehicle_vin AND v.tenant_id = ip.tenant_id
  WHERE v.slug = _slug ORDER BY ip.created_at DESC;
$$;

GRANT EXECUTE ON FUNCTION public.get_install_proofs_public(text) TO anon, authenticated;