-- Phase 0.2 (additive) — attach recon (get-ready) records to the canonical
-- vehicle_files hub, using the identical safe pattern as the addendum link.
--
-- get_ready_records carries tenant_id (UUID) + vin, the same clean scope as
-- vehicle_files (UNIQUE tenant_id+vin), so the backfill is one-to-one.
-- Additive and reversible: nullable FK, deterministic backfill, BEFORE INSERT
-- trigger that auto-links new rows within their own tenant. Nothing dropped.

ALTER TABLE public.get_ready_records
  ADD COLUMN IF NOT EXISTS vehicle_file_id UUID
    REFERENCES public.vehicle_files(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_get_ready_records_vehicle_file_id
  ON public.get_ready_records(vehicle_file_id);

UPDATE public.get_ready_records g
   SET vehicle_file_id = vf.id
  FROM public.vehicle_files vf
 WHERE g.vehicle_file_id IS NULL
   AND g.tenant_id = vf.tenant_id
   AND coalesce(trim(g.vin), '') <> ''
   AND upper(trim(g.vin)) = upper(trim(vf.vin));

CREATE OR REPLACE FUNCTION public.get_ready_link_vehicle_file()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.vehicle_file_id IS NULL
     AND NEW.tenant_id IS NOT NULL
     AND coalesce(trim(NEW.vin), '') <> '' THEN
    SELECT vf.id INTO NEW.vehicle_file_id
      FROM public.vehicle_files vf
     WHERE vf.tenant_id = NEW.tenant_id
       AND upper(trim(vf.vin)) = upper(trim(NEW.vin))
     LIMIT 1;
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_get_ready_link_vehicle_file ON public.get_ready_records;
CREATE TRIGGER trg_get_ready_link_vehicle_file
  BEFORE INSERT ON public.get_ready_records
  FOR EACH ROW EXECUTE FUNCTION public.get_ready_link_vehicle_file();

COMMENT ON COLUMN public.get_ready_records.vehicle_file_id IS
  'Canonical link to the vehicle_files hub (Phase 0 vehicle-record unification).';
