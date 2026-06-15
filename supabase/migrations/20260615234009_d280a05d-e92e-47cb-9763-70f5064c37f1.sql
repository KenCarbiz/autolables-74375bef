
-- 1. Per-vehicle install token
ALTER TABLE public.vehicle_listings
  ADD COLUMN IF NOT EXISTS install_token uuid NOT NULL DEFAULT gen_random_uuid();
CREATE INDEX IF NOT EXISTS idx_vehicle_listings_install_token ON public.vehicle_listings (install_token);

-- 2. Install proof records
CREATE TABLE IF NOT EXISTS public.install_proofs (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid,
  vehicle_vin      text NOT NULL,
  product_id       uuid,
  product_name     text,
  installer_name   text,
  installer_company text,
  installed_at     timestamptz,
  photo_path       text,
  notes            text,
  created_at       timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.install_proofs TO authenticated;
GRANT ALL ON public.install_proofs TO service_role;

ALTER TABLE public.install_proofs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "install_proofs_tenant_read" ON public.install_proofs
  FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT tenant_id FROM public.tenant_members WHERE user_id = (SELECT auth.uid())));

REVOKE UPDATE, DELETE, TRUNCATE ON public.install_proofs FROM authenticated, anon;

CREATE INDEX IF NOT EXISTS idx_install_proofs_vin ON public.install_proofs (vehicle_vin, created_at DESC);

-- 3. Anon installer submits through token-keyed definer RPC
CREATE OR REPLACE FUNCTION public.record_install_proof(
  _install_token uuid, _product_id uuid, _product_name text,
  _installer_name text, _installer_company text,
  _installed_at timestamptz, _photo_path text, _notes text DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _vin text; _tenant uuid; _id uuid;
BEGIN
  SELECT vin, tenant_id INTO _vin, _tenant FROM public.vehicle_listings WHERE install_token = _install_token LIMIT 1;
  IF _vin IS NULL THEN RAISE EXCEPTION 'invalid install token'; END IF;
  INSERT INTO public.install_proofs (tenant_id, vehicle_vin, product_id, product_name,
    installer_name, installer_company, installed_at, photo_path, notes)
  VALUES (_tenant, _vin, _product_id, _product_name, _installer_name, _installer_company,
    COALESCE(_installed_at, now()), _photo_path, _notes)
  RETURNING id INTO _id;
  RETURN _id;
END; $$;

GRANT EXECUTE ON FUNCTION public.record_install_proof(uuid,uuid,text,text,text,timestamptz,text,text) TO anon, authenticated;

-- 4. Storage policies for install-proofs bucket (bucket created via storage tool)
CREATE POLICY "install_proofs_upload" ON storage.objects FOR INSERT TO anon, authenticated
  WITH CHECK (bucket_id = 'install-proofs');

CREATE POLICY "install_proofs_view" ON storage.objects FOR SELECT TO anon, authenticated
  USING (bucket_id = 'install-proofs');
