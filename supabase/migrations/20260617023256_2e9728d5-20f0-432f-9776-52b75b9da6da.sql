-- Phase 0
ALTER TABLE public.addendums
  ADD COLUMN IF NOT EXISTS vehicle_file_id UUID REFERENCES public.vehicle_files(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_addendums_vehicle_file_id ON public.addendums(vehicle_file_id);

UPDATE public.addendums a SET vehicle_file_id = vf.id
  FROM public.vehicle_files vf
 WHERE a.vehicle_file_id IS NULL AND a.tenant_id = vf.tenant_id
   AND coalesce(trim(a.vehicle_vin), '') <> ''
   AND upper(trim(a.vehicle_vin)) = upper(trim(vf.vin));

CREATE OR REPLACE FUNCTION public.addendum_link_vehicle_file()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.vehicle_file_id IS NULL AND NEW.tenant_id IS NOT NULL
     AND coalesce(trim(NEW.vehicle_vin), '') <> '' THEN
    SELECT vf.id INTO NEW.vehicle_file_id FROM public.vehicle_files vf
     WHERE vf.tenant_id = NEW.tenant_id
       AND upper(trim(vf.vin)) = upper(trim(NEW.vehicle_vin)) LIMIT 1;
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS trg_addendum_link_vehicle_file ON public.addendums;
CREATE TRIGGER trg_addendum_link_vehicle_file BEFORE INSERT ON public.addendums
  FOR EACH ROW EXECUTE FUNCTION public.addendum_link_vehicle_file();

ALTER TABLE public.get_ready_records
  ADD COLUMN IF NOT EXISTS vehicle_file_id UUID REFERENCES public.vehicle_files(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_get_ready_records_vehicle_file_id ON public.get_ready_records(vehicle_file_id);

UPDATE public.get_ready_records g SET vehicle_file_id = vf.id
  FROM public.vehicle_files vf
 WHERE g.vehicle_file_id IS NULL AND g.tenant_id = vf.tenant_id
   AND coalesce(trim(g.vin), '') <> ''
   AND upper(trim(g.vin)) = upper(trim(vf.vin));

CREATE OR REPLACE FUNCTION public.get_ready_link_vehicle_file()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.vehicle_file_id IS NULL AND NEW.tenant_id IS NOT NULL
     AND coalesce(trim(NEW.vin), '') <> '' THEN
    SELECT vf.id INTO NEW.vehicle_file_id FROM public.vehicle_files vf
     WHERE vf.tenant_id = NEW.tenant_id
       AND upper(trim(vf.vin)) = upper(trim(NEW.vin)) LIMIT 1;
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS trg_get_ready_link_vehicle_file ON public.get_ready_records;
CREATE TRIGGER trg_get_ready_link_vehicle_file BEFORE INSERT ON public.get_ready_records
  FOR EACH ROW EXECUTE FUNCTION public.get_ready_link_vehicle_file();

ALTER TABLE public.vehicle_listings
  ADD COLUMN IF NOT EXISTS vehicle_file_id UUID REFERENCES public.vehicle_files(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_vehicle_listings_vehicle_file_id ON public.vehicle_listings(vehicle_file_id);

ALTER TABLE public.prep_sign_offs
  ADD COLUMN IF NOT EXISTS vehicle_file_id UUID REFERENCES public.vehicle_files(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_prep_sign_offs_vehicle_file_id ON public.prep_sign_offs(vehicle_file_id);

WITH store_map AS (
  SELECT store_id, (array_agg(tenant_id))[1] AS tenant_id FROM (
    SELECT DISTINCT (s->>'id') AS store_id, op.tenant_id
    FROM public.onboarding_profiles op, jsonb_array_elements(op.stores) s
    WHERE coalesce(s->>'id', '') <> ''
  ) d GROUP BY store_id HAVING count(*) = 1
)
UPDATE public.vehicle_listings vl SET vehicle_file_id = vf.id
  FROM store_map sm JOIN public.vehicle_files vf ON vf.tenant_id = sm.tenant_id
 WHERE vl.vehicle_file_id IS NULL AND vl.store_id = sm.store_id
   AND coalesce(trim(vl.vin), '') <> ''
   AND upper(trim(vl.vin)) = upper(trim(vf.vin));

WITH store_map AS (
  SELECT store_id, (array_agg(tenant_id))[1] AS tenant_id FROM (
    SELECT DISTINCT (s->>'id') AS store_id, op.tenant_id
    FROM public.onboarding_profiles op, jsonb_array_elements(op.stores) s
    WHERE coalesce(s->>'id', '') <> ''
  ) d GROUP BY store_id HAVING count(*) = 1
)
UPDATE public.prep_sign_offs p SET vehicle_file_id = vf.id
  FROM store_map sm JOIN public.vehicle_files vf ON vf.tenant_id = sm.tenant_id
 WHERE p.vehicle_file_id IS NULL AND p.store_id = sm.store_id
   AND coalesce(trim(p.vin), '') <> ''
   AND upper(trim(p.vin)) = upper(trim(vf.vin));

CREATE OR REPLACE FUNCTION public.link_vehicle_file_by_store()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_tenant uuid;
BEGIN
  IF NEW.vehicle_file_id IS NULL AND coalesce(trim(NEW.store_id), '') <> ''
     AND coalesce(trim(NEW.vin), '') <> '' THEN
    SELECT op.tenant_id INTO v_tenant
      FROM public.onboarding_profiles op, jsonb_array_elements(op.stores) s
     WHERE s->>'id' = NEW.store_id LIMIT 1;
    IF v_tenant IS NOT NULL THEN
      SELECT vf.id INTO NEW.vehicle_file_id FROM public.vehicle_files vf
       WHERE vf.tenant_id = v_tenant
         AND upper(trim(vf.vin)) = upper(trim(NEW.vin)) LIMIT 1;
    END IF;
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_vehicle_listings_link_vf ON public.vehicle_listings;
CREATE TRIGGER trg_vehicle_listings_link_vf BEFORE INSERT ON public.vehicle_listings
  FOR EACH ROW EXECUTE FUNCTION public.link_vehicle_file_by_store();

DROP TRIGGER IF EXISTS trg_prep_sign_offs_link_vf ON public.prep_sign_offs;
CREATE TRIGGER trg_prep_sign_offs_link_vf BEFORE INSERT ON public.prep_sign_offs
  FOR EACH ROW EXECUTE FUNCTION public.link_vehicle_file_by_store();

-- Phase 2
ALTER TABLE public.vehicle_files
  ADD COLUMN IF NOT EXISTS service_records       JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS warranty_info         JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS available_accessories JSONB NOT NULL DEFAULT '[]'::jsonb;