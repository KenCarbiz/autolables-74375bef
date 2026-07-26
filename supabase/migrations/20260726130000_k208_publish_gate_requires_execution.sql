-- INTAKE_SPEC S9: an unexecuted K-208 is NEVER customer-visible. The signoff
-- trigger (autopublish_k208_on_signoff) publishes only off an executed
-- inspection, but the generic document workflow (approve -> publish) could
-- still move a k208 generated_documents row to 'published' with no executed
-- inspection behind it. Gate the transition at the row: a k208 document may
-- become 'published' only when the vehicle's NEWEST signed inspection exists
-- and is not a fail (the same newest-signed truth 20260726110000 applies).
-- Fails closed: no vehicle, no signed inspection, or a failed newest signed
-- inspection all RAISE, so no workflow path can expose an unexecuted K-208.

CREATE OR REPLACE FUNCTION public.enforce_k208_publish_requires_execution()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_vin text;
  v_newest_id uuid;
  v_newest_result text;
BEGIN
  IF NEW.document_type IS DISTINCT FROM 'k208' THEN RETURN NEW; END IF;
  IF NEW.document_status IS DISTINCT FROM 'published'
     OR OLD.document_status IS NOT DISTINCT FROM 'published' THEN
    RETURN NEW;
  END IF;

  SELECT vl.vin INTO v_vin FROM public.vehicle_listings vl
  WHERE vl.id = NEW.vehicle_id AND vl.tenant_id = NEW.tenant_id
  LIMIT 1;
  IF v_vin IS NULL THEN
    RAISE EXCEPTION 'k208_publish_requires_execution: no vehicle stands behind this K-208 document, so its inspection state cannot be verified';
  END IF;

  SELECT si.id, si.result INTO v_newest_id, v_newest_result
  FROM public.safety_inspections si
  WHERE si.tenant_id = NEW.tenant_id AND si.vin = v_vin AND si.status = 'signed'
  ORDER BY si.signed_at DESC NULLS LAST, si.created_at DESC
  LIMIT 1;

  IF v_newest_id IS NULL THEN
    RAISE EXCEPTION 'k208_publish_requires_execution: no signed K-208 inspection exists for this vehicle; an unexecuted K-208 is never customer-visible';
  END IF;
  IF v_newest_result IS NOT DISTINCT FROM 'fail' THEN
    RAISE EXCEPTION 'k208_publish_requires_execution: the newest signed K-208 inspection for this vehicle failed; a failed K-208 is never customer-visible';
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_k208_publish_requires_execution ON public.generated_documents;
CREATE TRIGGER trg_k208_publish_requires_execution
  BEFORE UPDATE ON public.generated_documents
  FOR EACH ROW
  WHEN (NEW.document_type = 'k208'
        AND NEW.document_status = 'published'
        AND OLD.document_status IS DISTINCT FROM 'published')
  EXECUTE FUNCTION public.enforce_k208_publish_requires_execution();
