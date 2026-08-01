-- Make the equipment projection safe for writers that only know item_type.
--
-- 20260801180000 gave customer_status a DEFAULT of 'optional' and had the
-- trigger always derive item_type from it. Any existing writer that inserts
-- item_type without customer_status therefore had its value silently
-- overwritten — a row saved as 'installed' came back as 'available_upgrade',
-- moving pre-installed equipment to Optional and dropping it out of the
-- adjusted total.
--
-- The projection is now directional: whichever field the writer supplied is
-- the input, and the other is derived from it.

-- Drop the default so "not supplied" is distinguishable from "chose optional".
ALTER TABLE public.vehicle_addendum_items ALTER COLUMN customer_status DROP DEFAULT;
ALTER TABLE public.vehicle_addendum_items ALTER COLUMN customer_status DROP NOT NULL;

CREATE OR REPLACE FUNCTION public.sync_addendum_item_projection()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.customer_status IS NULL THEN
    -- Legacy writer: item_type is the input.
    NEW.customer_status := CASE NEW.item_type
      WHEN 'installed' THEN 'pre_installed'
      WHEN 'benefit'   THEN 'included_benefit'
      ELSE 'optional'
    END;
  ELSE
    -- customer_status is authoritative; item_type mirrors it.
    NEW.customer_status := coalesce(NEW.customer_status, 'optional');
    NEW.item_type := CASE NEW.customer_status
      WHEN 'pre_installed'    THEN 'installed'
      WHEN 'included_benefit' THEN 'benefit'
      ELSE 'available_upgrade'
    END;
  END IF;

  NEW.is_installed := NEW.customer_status = 'pre_installed';
  NEW.is_included  := NEW.customer_status = 'included_benefit';
  IF NEW.external_ref IS NULL THEN NEW.external_ref := NEW.id::text; END IF;
  RETURN NEW;
END $$;

-- Fire on every insert/update so a legacy update of item_type alone still
-- lands, rather than only when customer_status is named in the statement.
DROP TRIGGER IF EXISTS trg_addendum_item_projection ON public.vehicle_addendum_items;
CREATE TRIGGER trg_addendum_item_projection
  BEFORE INSERT OR UPDATE ON public.vehicle_addendum_items
  FOR EACH ROW EXECUTE FUNCTION public.sync_addendum_item_projection();

-- Repair any row a save may already have flipped: item_type is the survivor of
-- record for rows whose two fields disagree and that carry no proof workflow.
UPDATE public.vehicle_addendum_items
   SET customer_status = CASE item_type
         WHEN 'installed' THEN 'pre_installed'
         WHEN 'benefit'   THEN 'included_benefit'
         ELSE 'optional'
       END
 WHERE workflow_status = 'not_applicable'
   AND customer_status IS DISTINCT FROM CASE item_type
         WHEN 'installed' THEN 'pre_installed'
         WHEN 'benefit'   THEN 'included_benefit'
         ELSE 'optional'
       END;