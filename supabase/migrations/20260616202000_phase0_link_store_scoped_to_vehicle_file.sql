-- Phase 0.3 (additive) — link the store_id-scoped tables (vehicle_listings,
-- prep_sign_offs) to the canonical vehicle_files hub.
--
-- These tables scope by a TEXT store_id (a Store.id from the dealer's
-- onboarding_profiles.stores JSONB), not a tenant_id UUID. The store->tenant
-- mapping is derived from onboarding_profiles: a store belongs to the
-- tenant_id of the profile whose `stores` array contains it. The backfill
-- links ONLY where that mapping is unambiguous (exactly one tenant per
-- store_id), so a row can never be cross-linked to the wrong tenant.
-- Additive + reversible: nullable FKs, guarded backfill, best-effort triggers
-- that only ever fill a null FK and never raise.

ALTER TABLE public.vehicle_listings
  ADD COLUMN IF NOT EXISTS vehicle_file_id UUID
    REFERENCES public.vehicle_files(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_vehicle_listings_vehicle_file_id
  ON public.vehicle_listings(vehicle_file_id);

ALTER TABLE public.prep_sign_offs
  ADD COLUMN IF NOT EXISTS vehicle_file_id UUID
    REFERENCES public.vehicle_files(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_prep_sign_offs_vehicle_file_id
  ON public.prep_sign_offs(vehicle_file_id);

-- Backfill vehicle_listings (only unambiguous store_id -> tenant mappings).
WITH store_map AS (
  SELECT store_id, max(tenant_id) AS tenant_id
  FROM (
    SELECT DISTINCT (s->>'id') AS store_id, op.tenant_id
    FROM public.onboarding_profiles op,
         jsonb_array_elements(op.stores) s
    WHERE coalesce(s->>'id', '') <> ''
  ) d
  GROUP BY store_id
  HAVING count(*) = 1
)
UPDATE public.vehicle_listings vl
   SET vehicle_file_id = vf.id
  FROM store_map sm
  JOIN public.vehicle_files vf ON vf.tenant_id = sm.tenant_id
 WHERE vl.vehicle_file_id IS NULL
   AND vl.store_id = sm.store_id
   AND coalesce(trim(vl.vin), '') <> ''
   AND upper(trim(vl.vin)) = upper(trim(vf.vin));

-- Backfill prep_sign_offs (same guard).
WITH store_map AS (
  SELECT store_id, max(tenant_id) AS tenant_id
  FROM (
    SELECT DISTINCT (s->>'id') AS store_id, op.tenant_id
    FROM public.onboarding_profiles op,
         jsonb_array_elements(op.stores) s
    WHERE coalesce(s->>'id', '') <> ''
  ) d
  GROUP BY store_id
  HAVING count(*) = 1
)
UPDATE public.prep_sign_offs p
   SET vehicle_file_id = vf.id
  FROM store_map sm
  JOIN public.vehicle_files vf ON vf.tenant_id = sm.tenant_id
 WHERE p.vehicle_file_id IS NULL
   AND p.store_id = sm.store_id
   AND coalesce(trim(p.vin), '') <> ''
   AND upper(trim(p.vin)) = upper(trim(vf.vin));

-- Forward-link: resolve the store's tenant, then the vehicle file. Shared by
-- both tables (both carry store_id + vin). Only fills a null FK; never raises.
CREATE OR REPLACE FUNCTION public.link_vehicle_file_by_store()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_tenant uuid;
BEGIN
  IF NEW.vehicle_file_id IS NULL
     AND coalesce(trim(NEW.store_id), '') <> ''
     AND coalesce(trim(NEW.vin), '') <> '' THEN
    SELECT op.tenant_id INTO v_tenant
      FROM public.onboarding_profiles op,
           jsonb_array_elements(op.stores) s
     WHERE s->>'id' = NEW.store_id
     LIMIT 1;
    IF v_tenant IS NOT NULL THEN
      SELECT vf.id INTO NEW.vehicle_file_id
        FROM public.vehicle_files vf
       WHERE vf.tenant_id = v_tenant
         AND upper(trim(vf.vin)) = upper(trim(NEW.vin))
       LIMIT 1;
    END IF;
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_vehicle_listings_link_vf ON public.vehicle_listings;
CREATE TRIGGER trg_vehicle_listings_link_vf
  BEFORE INSERT ON public.vehicle_listings
  FOR EACH ROW EXECUTE FUNCTION public.link_vehicle_file_by_store();

DROP TRIGGER IF EXISTS trg_prep_sign_offs_link_vf ON public.prep_sign_offs;
CREATE TRIGGER trg_prep_sign_offs_link_vf
  BEFORE INSERT ON public.prep_sign_offs
  FOR EACH ROW EXECUTE FUNCTION public.link_vehicle_file_by_store();

COMMENT ON COLUMN public.vehicle_listings.vehicle_file_id IS
  'Canonical link to the vehicle_files hub (Phase 0 vehicle-record unification).';
COMMENT ON COLUMN public.prep_sign_offs.vehicle_file_id IS
  'Canonical link to the vehicle_files hub (Phase 0 vehicle-record unification).';
