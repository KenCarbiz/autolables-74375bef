-- Who may host a manufacturer's documents, and on what evidence (derived, default deny).
CREATE OR REPLACE FUNCTION public.oem_make_from_ymm(_ymm TEXT)
RETURNS TEXT
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  v_text TEXT := lower(btrim(regexp_replace(coalesce(_ymm, ''), '\s+', ' ', 'g')));
  v_rest TEXT;
  v_multi TEXT;
BEGIN
  IF v_text = '' THEN RETURN ''; END IF;
  v_rest := btrim(regexp_replace(v_text, '^(19|20)\d{2}\s+', ''));
  IF v_rest = '' THEN RETURN ''; END IF;

  FOREACH v_multi IN ARRAY ARRAY[
    'mercedes-benz', 'mercedes benz', 'aston martin', 'rolls-royce', 'rolls royce',
    'general motors', 'range rover', 'alfa romeo', 'land rover', 'am general', 'great wall'
  ] LOOP
    IF v_rest = v_multi OR v_rest LIKE v_multi || ' %' THEN
      IF v_multi = 'range rover' THEN RETURN 'land rover'; END IF;
      IF v_multi = 'mercedes benz' THEN RETURN 'mercedes-benz'; END IF;
      IF v_multi = 'rolls royce' THEN RETURN 'rolls-royce'; END IF;
      RETURN v_multi;
    END IF;
  END LOOP;

  RETURN split_part(v_rest, ' ', 1);
END $$;

CREATE OR REPLACE FUNCTION public.oem_franchise_min_new_units()
RETURNS INTEGER LANGUAGE sql IMMUTABLE AS $$ SELECT 3 $$;

CREATE OR REPLACE FUNCTION public.derive_oem_franchise_brands(_tenant_id UUID)
RETURNS TABLE (brand TEXT, new_units BIGINT, latest_listed_at TIMESTAMPTZ)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.oem_make_from_ymm(vl.ymm) AS brand,
         count(*) AS new_units,
         max(vl.created_at) AS latest_listed_at
    FROM public.vehicle_listings vl
   WHERE vl.tenant_id = _tenant_id
     AND lower(coalesce(vl.condition, '')) = 'new'
     AND public.oem_make_from_ymm(vl.ymm) <> ''
   GROUP BY 1
  HAVING count(*) >= public.oem_franchise_min_new_units();
$$;

CREATE TABLE IF NOT EXISTS public.oem_distribution_blocks (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID REFERENCES public.tenants(id) ON DELETE CASCADE,
  brand         TEXT NOT NULL,
  reason        TEXT NOT NULL,
  blocked_by    UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.oem_distribution_blocks IS
  'Platform-level override that stops document hosting for a brand, optionally for one tenant. The permission itself is derived from new-vehicle inventory and is not editable by dealers.';

GRANT SELECT ON public.oem_distribution_blocks TO authenticated;
GRANT ALL ON public.oem_distribution_blocks TO service_role;

CREATE UNIQUE INDEX IF NOT EXISTS uq_oem_distribution_blocks
  ON public.oem_distribution_blocks (COALESCE(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(brand));

ALTER TABLE public.oem_distribution_blocks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "oem blocks readable by tenant" ON public.oem_distribution_blocks;
CREATE POLICY "oem blocks readable by tenant"
  ON public.oem_distribution_blocks FOR SELECT
  TO authenticated
  USING (
    tenant_id IS NULL
    OR tenant_id IN (
      SELECT tenant_id FROM public.tenant_members
       WHERE user_id = (SELECT auth.uid())
    )
    OR EXISTS (
      SELECT 1 FROM public.user_roles
       WHERE user_id = (SELECT auth.uid()) AND role = 'admin'
    )
  );

DROP FUNCTION IF EXISTS public.tenant_may_host_oem_documents(UUID, TEXT, TEXT);
CREATE OR REPLACE FUNCTION public.tenant_may_host_oem_documents(
  _tenant_id UUID,
  _brand TEXT,
  _store_id TEXT DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(btrim(_brand), '') <> ''
     AND _tenant_id IS NOT NULL
     AND EXISTS (
           SELECT 1 FROM public.derive_oem_franchise_brands(_tenant_id) f
            WHERE f.brand = lower(btrim(_brand))
         )
     AND NOT EXISTS (
           SELECT 1 FROM public.oem_distribution_blocks b
            WHERE lower(b.brand) = lower(btrim(_brand))
              AND (b.tenant_id IS NULL OR b.tenant_id = _tenant_id)
         );
$$;

GRANT EXECUTE ON FUNCTION public.oem_make_from_ymm(TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.oem_franchise_min_new_units() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.derive_oem_franchise_brands(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.tenant_may_host_oem_documents(UUID, TEXT, TEXT) TO authenticated, service_role;

-- Supersede the attestation model: drop every overload of the dead RPCs.
DO $do$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname IN ('grant_oem_distribution', 'revoke_oem_distribution', 'oem_attestation_text')
  LOOP
    EXECUTE format('DROP FUNCTION IF EXISTS %s', r.sig);
  END LOOP;
END $do$;

DROP TABLE IF EXISTS public.oem_distribution_grants;