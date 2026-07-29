CREATE TABLE IF NOT EXISTS public.oem_distribution_grants (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  store_id             TEXT,
  brand                TEXT NOT NULL,
  status               TEXT NOT NULL DEFAULT 'active'
                         CHECK (status IN ('active', 'revoked')),
  attested_by          UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  attested_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  attestation_version  INTEGER NOT NULL,
  attestation_text     TEXT NOT NULL,
  evidence_note        TEXT,
  revoked_by           UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  revoked_at           TIMESTAMPTZ,
  revoke_reason        TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.oem_distribution_grants IS
  'Per-tenant, per-brand permission to host and serve that manufacturer''s documents. Absence of an active row means link-only. Never inferred from the vehicle''s make.';

GRANT SELECT ON public.oem_distribution_grants TO authenticated;
GRANT ALL ON public.oem_distribution_grants TO service_role;

CREATE UNIQUE INDEX IF NOT EXISTS uq_oem_distribution_grants_active
  ON public.oem_distribution_grants (tenant_id, COALESCE(store_id, ''), lower(brand))
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_oem_distribution_grants_lookup
  ON public.oem_distribution_grants (tenant_id, lower(brand)) WHERE status = 'active';

ALTER TABLE public.oem_distribution_grants ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "oem grants readable by tenant" ON public.oem_distribution_grants;
CREATE POLICY "oem grants readable by tenant"
  ON public.oem_distribution_grants FOR SELECT
  TO authenticated
  USING (
    tenant_id IN (
      SELECT tenant_id FROM public.tenant_members
       WHERE user_id = (SELECT auth.uid())
    )
    OR EXISTS (
      SELECT 1 FROM public.user_roles
       WHERE user_id = (SELECT auth.uid()) AND role = 'admin'
    )
  );

CREATE OR REPLACE FUNCTION public.oem_attestation_text()
RETURNS TABLE (version INTEGER, body TEXT)
LANGUAGE sql IMMUTABLE AS $$
  SELECT 1,
    'I confirm this dealership is a franchised, authorized retailer of this ' ||
    'manufacturer, and that our franchise agreement permits us to distribute ' ||
    'that manufacturer''s owner''s manuals and brochures to our customers in ' ||
    'connection with vehicles we sell. I understand AutoLabels stores and ' ||
    'serves these documents on our behalf and at our direction, that this ' ||
    'permission applies only to this manufacturer''s vehicles, and that we ' ||
    'will withdraw it if the franchise ends.';
$$;

CREATE OR REPLACE FUNCTION public.grant_oem_distribution(
  _tenant_id UUID,
  _brand TEXT,
  _store_id TEXT DEFAULT NULL,
  _evidence_note TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_id UUID;
  v_brand TEXT := lower(btrim(coalesce(_brand, '')));
  v_version INTEGER;
  v_body TEXT;
BEGIN
  IF v_brand = '' THEN
    RAISE EXCEPTION 'brand is required';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.tenant_members
     WHERE tenant_id = _tenant_id
       AND user_id = (SELECT auth.uid())
       AND accepted_at IS NOT NULL
       AND role IN ('owner', 'admin')
  ) AND NOT EXISTS (
    SELECT 1 FROM public.user_roles WHERE user_id = (SELECT auth.uid()) AND role = 'admin'
  ) THEN
    RAISE EXCEPTION 'not authorized to attest for this tenant';
  END IF;

  SELECT version, body INTO v_version, v_body FROM public.oem_attestation_text();

  UPDATE public.oem_distribution_grants
     SET attested_by = (SELECT auth.uid()),
         attested_at = now(),
         attestation_version = v_version,
         attestation_text = v_body,
         evidence_note = COALESCE(_evidence_note, evidence_note),
         updated_at = now()
   WHERE tenant_id = _tenant_id
     AND COALESCE(store_id, '') = COALESCE(_store_id, '')
     AND lower(brand) = v_brand
     AND status = 'active'
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    INSERT INTO public.oem_distribution_grants
      (tenant_id, store_id, brand, status, attested_by, attestation_version, attestation_text, evidence_note)
    VALUES
      (_tenant_id, _store_id, v_brand, 'active', (SELECT auth.uid()), v_version, v_body, _evidence_note)
    RETURNING id INTO v_id;
  END IF;

  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.revoke_oem_distribution(
  _grant_id UUID,
  _reason TEXT DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_tenant UUID;
BEGIN
  SELECT tenant_id INTO v_tenant FROM public.oem_distribution_grants WHERE id = _grant_id;
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'grant not found';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.tenant_members
     WHERE tenant_id = v_tenant
       AND user_id = (SELECT auth.uid())
       AND accepted_at IS NOT NULL
       AND role IN ('owner', 'admin')
  ) AND NOT EXISTS (
    SELECT 1 FROM public.user_roles WHERE user_id = (SELECT auth.uid()) AND role = 'admin'
  ) THEN
    RAISE EXCEPTION 'not authorized to revoke for this tenant';
  END IF;

  UPDATE public.oem_distribution_grants
     SET status = 'revoked', revoked_by = (SELECT auth.uid()), revoked_at = now(),
         revoke_reason = _reason, updated_at = now()
   WHERE id = _grant_id AND status = 'active';
END $$;

CREATE OR REPLACE FUNCTION public.tenant_may_host_oem_documents(
  _tenant_id UUID,
  _brand TEXT,
  _store_id TEXT DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.oem_distribution_grants g
     WHERE g.tenant_id = _tenant_id
       AND g.status = 'active'
       AND lower(g.brand) = lower(btrim(coalesce(_brand, '')))
       AND coalesce(btrim(_brand), '') <> ''
       AND (g.store_id IS NULL OR g.store_id = _store_id)
  );
$$;

GRANT EXECUTE ON FUNCTION public.oem_attestation_text() TO authenticated;
GRANT EXECUTE ON FUNCTION public.grant_oem_distribution(UUID, TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_oem_distribution(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.tenant_may_host_oem_documents(UUID, TEXT, TEXT) TO authenticated, service_role;