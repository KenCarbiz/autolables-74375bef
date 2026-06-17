-- Phase 0 (additive) — begin unifying the fragmented vehicle record.
--
-- vehicle_files is already the richest per-VIN record (factory equipment,
-- stickers, signings, aftermarket installs, attached documents, deal
-- lifecycle) and carries UNIQUE (tenant_id, vin). Designate it the canonical
-- hub and link the addendum to it so the signed document is no longer an
-- island keyed only by a VIN string.
--
-- Fully additive and reversible:
--   * a nullable FK (ON DELETE SET NULL — deleting a file never deletes a deal)
--   * a deterministic backfill (UNIQUE (tenant_id, vin) => at most one match)
--   * a BEFORE INSERT trigger that auto-links new addendums, scoped to the
--     row's own tenant so it can never cross tenants
-- Nothing is dropped or renamed.
--
-- NOT linked here on purpose: vehicle_listings and prep_sign_offs scope by a
-- TEXT store_id rather than a tenant_id UUID, so they need a validated
-- store->tenant mapping in a later step. get_ready_records / vin_queue share
-- the clean tenant_id+vin scope and will follow with this same safe pattern.

ALTER TABLE public.addendums
  ADD COLUMN IF NOT EXISTS vehicle_file_id UUID
    REFERENCES public.vehicle_files(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_addendums_vehicle_file_id
  ON public.addendums(vehicle_file_id);

-- Backfill existing addendums. The unique constraint on vehicle_files makes
-- this one-to-one; VIN case/whitespace is normalized on both sides.
UPDATE public.addendums a
   SET vehicle_file_id = vf.id
  FROM public.vehicle_files vf
 WHERE a.vehicle_file_id IS NULL
   AND a.tenant_id IS NOT NULL
   AND a.tenant_id = vf.tenant_id
   AND coalesce(trim(a.vehicle_vin), '') <> ''
   AND upper(trim(a.vehicle_vin)) = upper(trim(vf.vin));

-- Auto-link new addendums to their vehicle file on insert (when the file
-- already exists). Never blocks or errors the insert; only fills a null FK.
CREATE OR REPLACE FUNCTION public.addendum_link_vehicle_file()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.vehicle_file_id IS NULL
     AND NEW.tenant_id IS NOT NULL
     AND coalesce(trim(NEW.vehicle_vin), '') <> '' THEN
    SELECT vf.id INTO NEW.vehicle_file_id
      FROM public.vehicle_files vf
     WHERE vf.tenant_id = NEW.tenant_id
       AND upper(trim(vf.vin)) = upper(trim(NEW.vehicle_vin))
     LIMIT 1;
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_addendum_link_vehicle_file ON public.addendums;
CREATE TRIGGER trg_addendum_link_vehicle_file
  BEFORE INSERT ON public.addendums
  FOR EACH ROW EXECUTE FUNCTION public.addendum_link_vehicle_file();

COMMENT ON COLUMN public.addendums.vehicle_file_id IS
  'Canonical link to the vehicle_files hub (Phase 0 vehicle-record unification).';
