ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS autocurb_tenant_id TEXT,
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS autocurb_profile JSONB,
  ADD COLUMN IF NOT EXISTS autocurb_synced_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_tenants_autocurb_tenant_id ON public.tenants(autocurb_tenant_id);

CREATE OR REPLACE FUNCTION public.admin_link_autocurb(p_tenant_id uuid, p_autocurb_id text, p_profile jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = (SELECT auth.uid()) AND role = 'admin') THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  UPDATE public.tenants
     SET autocurb_tenant_id = nullif(btrim(p_autocurb_id), ''),
         source = 'autocurb',
         autocurb_profile = p_profile,
         autocurb_synced_at = now()
   WHERE id = p_tenant_id;
END; $$;

REVOKE EXECUTE ON FUNCTION public.admin_link_autocurb(uuid, text, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_link_autocurb(uuid, text, jsonb) TO authenticated;

COMMENT ON COLUMN public.tenants.autocurb_tenant_id IS 'Opaque Autocurb sync key (UUID or slug); stored verbatim.';
COMMENT ON COLUMN public.tenants.autocurb_profile IS 'Mirror of the Autocurb-owned dealer profile (identity, branding, stores). Re-syncable; AutoLabels-owned data lives elsewhere.';