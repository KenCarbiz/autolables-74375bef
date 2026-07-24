-- Auto-publish the CT K-208 to the customer passport the moment the service
-- department completes and signs the safety inspection — no manual publish.
--
-- The customer passport (get_published_documents_public) shows a generated
-- document once its document_status = 'published'. Rather than make a manager
-- click "publish," this fires on the safety_inspections row itself, so it works
-- for EVERY sign-off path: the QR /ready flow, the Service Desk, and the
-- submit_safety_inspection RPC. The K-208 becomes shopper-visible exactly when
-- service finishes their end, and never before (an unsigned inspection is never
-- shown). Requires the widened status constraint from 20260724000000.

CREATE OR REPLACE FUNCTION public.autopublish_k208_on_signoff()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'signed'
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'signed') THEN
    UPDATE public.generated_documents g
    SET document_status = 'published',
        published_at = COALESCE(g.published_at, now()),
        updated_at = now()
    FROM public.vehicle_listings vl
    WHERE vl.tenant_id = NEW.tenant_id
      AND vl.vin = NEW.vin
      AND g.vehicle_id = vl.id
      AND g.tenant_id = NEW.tenant_id
      AND g.document_type = 'k208'
      AND g.document_status NOT IN ('published', 'superseded', 'archived', 'rejected');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_autopublish_k208_on_signoff ON public.safety_inspections;
CREATE TRIGGER trg_autopublish_k208_on_signoff
  AFTER INSERT OR UPDATE OF status ON public.safety_inspections
  FOR EACH ROW
  EXECUTE FUNCTION public.autopublish_k208_on_signoff();

-- Backfill: any vehicle whose safety inspection is ALREADY signed but whose
-- K-208 doc is still an un-published draft gets published now.
UPDATE public.generated_documents g
SET document_status = 'published',
    published_at = COALESCE(g.published_at, now()),
    updated_at = now()
FROM public.vehicle_listings vl
JOIN public.safety_inspections si
  ON si.tenant_id = vl.tenant_id AND si.vin = vl.vin AND si.status = 'signed'
WHERE g.vehicle_id = vl.id
  AND g.tenant_id = vl.tenant_id
  AND g.document_type = 'k208'
  AND g.document_status NOT IN ('published', 'superseded', 'archived', 'rejected');
