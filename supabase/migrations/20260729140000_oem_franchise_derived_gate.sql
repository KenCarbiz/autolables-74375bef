-- Who may host a manufacturer's documents, and on what evidence.
--
-- Linking to an OEM's brochure or owner's manual needs no permission -- a URL
-- is not the work. Serving OUR copy of the bytes is redistribution, and that
-- right belongs to the franchised dealer for their own brand. An INFINITI
-- store may serve INFINITI documents for the INFINITI it is selling; the used
-- Honda on the same lot gets a link, and so does a used INFINITI on a Honda
-- lot -- even when we already hold that PDF for some other dealer. Possession
-- is not permission.
--
-- The permission is DERIVED, not asked for. New-vehicle franchises are
-- exclusive: only the franchised dealer may sell new units of a brand, so new
-- inventory of that brand IS the evidence of the franchise. Nothing here is a
-- checkbox a dealer can tick, and nothing is a checkbox they can untick.
--
-- Nothing in this file stores a document. This is the gate the hosting step
-- has to pass, landed first on purpose: default deny is only true if it exists
-- before the thing it governs.

-- vehicle_listings has no make column, only the free-text ymm
-- ("2025 INFINITI QX55 LUXE"). Splitting on whitespace and taking token 2 is
-- correct for one-word brands and silently wrong for every multi-word one:
-- "2024 Land Rover Defender" becomes "Land". This mirrors MULTI_WORD_MAKES in
-- src/lib/factorySticker/ymm.ts -- keep the two lists in step.
CREATE OR REPLACE FUNCTION public.oem_make_from_ymm(_ymm TEXT)
RETURNS TEXT
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  v_text TEXT := lower(btrim(regexp_replace(coalesce(_ymm, ''), '\s+', ' ', 'g')));
  v_rest TEXT;
  v_multi TEXT;
BEGIN
  IF v_text = '' THEN RETURN ''; END IF;
  -- Drop a leading 4-digit model year, if present.
  v_rest := btrim(regexp_replace(v_text, '^(19|20)\d{2}\s+', ''));
  IF v_rest = '' THEN RETURN ''; END IF;

  FOREACH v_multi IN ARRAY ARRAY[
    'mercedes-benz', 'mercedes benz', 'aston martin', 'rolls-royce', 'rolls royce',
    'general motors', 'range rover', 'alfa romeo', 'land rover', 'am general', 'great wall'
  ] LOOP
    IF v_rest = v_multi OR v_rest LIKE v_multi || ' %' THEN
      -- Range Rover is a Land Rover model line the feed sometimes files as a make.
      IF v_multi = 'range rover' THEN RETURN 'land rover'; END IF;
      IF v_multi = 'mercedes benz' THEN RETURN 'mercedes-benz'; END IF;
      IF v_multi = 'rolls royce' THEN RETURN 'rolls-royce'; END IF;
      RETURN v_multi;
    END IF;
  END LOOP;

  RETURN split_part(v_rest, ' ', 1);
END $$;

-- How much new inventory of a brand counts as proof of the franchise.
-- The failure directions are not symmetric: a false positive hosts documents
-- we had no right to, a false negative just links. So this asks for more than
-- one car, which a single mis-keyed condition could produce.
CREATE OR REPLACE FUNCTION public.oem_franchise_min_new_units()
RETURNS INTEGER LANGUAGE sql IMMUTABLE AS $$ SELECT 3 $$;

-- The brands a tenant demonstrably holds a new-vehicle franchise for.
-- Archived listings still count: a store does not stop being an INFINITI
-- dealer because it sold through its new inventory this month.
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

-- The only thing a human can change: a platform-level block, for a takedown
-- or a dispute. There is no dealer-facing grant, because the franchise is not
-- ours to give, and no dealer-facing revoke, because it is not theirs to
-- refuse. Absence of a row here means the derivation stands.
CREATE TABLE IF NOT EXISTS public.oem_distribution_blocks (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- NULL tenant blocks the brand across the whole platform.
  tenant_id     UUID REFERENCES public.tenants(id) ON DELETE CASCADE,
  brand         TEXT NOT NULL,
  reason        TEXT NOT NULL,
  blocked_by    UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.oem_distribution_blocks IS
  'Platform-level override that stops document hosting for a brand, optionally for one tenant. The permission itself is derived from new-vehicle inventory and is not editable by dealers.';

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

-- The gate. Default deny: hosting requires a derived franchise for that exact
-- brand and no block against it. Everything else -- a used off-brand car, a
-- brand we never sold new, a blank make, a brand under takedown -- links, and
-- links whether or not we happen to hold the file already.
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

-- Supersede the attestation model.
--
-- An earlier revision asked the dealer to tick a box confirming the franchise.
-- That was wrong twice over: the franchise is not ours to grant, and it is not
-- the dealer's to decline. The permission is derived above, so the grant table
-- and its RPCs are dead -- and a dead SECURITY DEFINER function still granted
-- to authenticated is worse than dead, because it can still be called and will
-- write rows nothing reads.
DROP FUNCTION IF EXISTS public.grant_oem_distribution(UUID, TEXT, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.revoke_oem_distribution(UUID, TEXT);
DROP FUNCTION IF EXISTS public.oem_attestation_text();
DROP TABLE IF EXISTS public.oem_distribution_grants;
