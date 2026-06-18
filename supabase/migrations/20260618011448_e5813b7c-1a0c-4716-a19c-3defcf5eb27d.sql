ALTER TABLE public.install_proofs
  ADD COLUMN IF NOT EXISTS installer_signature_data text,
  ADD COLUMN IF NOT EXISTS installer_signature_type text,
  ADD COLUMN IF NOT EXISTS installer_ip text,
  ADD COLUMN IF NOT EXISTS verified_at timestamptz;

ALTER TABLE public.install_proofs
  ADD COLUMN IF NOT EXISTS is_verified boolean
    GENERATED ALWAYS AS (
      photo_path IS NOT NULL AND photo_path <> ''
      AND installer_signature_data IS NOT NULL AND installer_signature_data <> ''
    ) STORED;

CREATE OR REPLACE FUNCTION public.record_install_proof(
  _install_token uuid, _product_id uuid, _product_name text,
  _installer_name text, _installer_company text,
  _installed_at timestamptz, _photo_path text, _notes text,
  _installer_signature_data text, _installer_signature_type text, _installer_ip text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _vin text; _tenant uuid; _id uuid;
BEGIN
  SELECT vin, tenant_id INTO _vin, _tenant FROM public.vehicle_listings WHERE install_token = _install_token LIMIT 1;
  IF _vin IS NULL THEN RAISE EXCEPTION 'invalid install token'; END IF;
  INSERT INTO public.install_proofs (tenant_id, vehicle_vin, product_id, product_name,
    installer_name, installer_company, installed_at, photo_path, notes,
    installer_signature_data, installer_signature_type, installer_ip,
    verified_at)
  VALUES (_tenant, _vin, _product_id, _product_name, _installer_name, _installer_company,
    COALESCE(_installed_at, now()), _photo_path, _notes,
    _installer_signature_data, _installer_signature_type, _installer_ip,
    CASE WHEN _photo_path IS NOT NULL AND _photo_path <> ''
          AND _installer_signature_data IS NOT NULL AND _installer_signature_data <> ''
         THEN now() ELSE NULL END)
  RETURNING id INTO _id;
  RETURN _id;
END; $$;

GRANT EXECUTE ON FUNCTION public.record_install_proof(
  uuid,uuid,text,text,text,timestamptz,text,text,text,text,text
) TO anon, authenticated;