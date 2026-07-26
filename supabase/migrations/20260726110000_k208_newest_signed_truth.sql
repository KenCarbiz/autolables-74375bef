-- The publish/retract trigger must agree with the app: the NEWEST signed
-- inspection is the word on the car. "Any signed pass exists" kept an old
-- executed K-208 customer-visible after a failed reinspection.

CREATE OR REPLACE FUNCTION public.autopublish_k208_on_signoff()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_newest public.safety_inspections%ROWTYPE;
BEGIN
  IF NEW.status <> 'signed' THEN RETURN NEW; END IF;

  SELECT * INTO v_newest FROM public.safety_inspections
    WHERE tenant_id = NEW.tenant_id AND vin = NEW.vin AND status = 'signed'
    ORDER BY signed_at DESC NULLS LAST, created_at DESC LIMIT 1;
  IF v_newest.id IS NULL THEN v_newest := NEW; END IF;

  IF v_newest.result IS DISTINCT FROM 'fail' THEN
    UPDATE public.generated_documents g
    SET document_status = 'published',
        published_at = COALESCE(g.published_at, now()), updated_at = now()
    FROM public.vehicle_listings vl
    WHERE vl.tenant_id = NEW.tenant_id AND vl.vin = NEW.vin
      AND g.vehicle_id = vl.id AND g.tenant_id = NEW.tenant_id
      AND g.document_type = 'k208'
      AND g.document_status NOT IN ('published','superseded','archived','rejected');
  ELSE
    UPDATE public.generated_documents g
    SET document_status = 'draft', published_at = NULL, updated_at = now()
    FROM public.vehicle_listings vl
    WHERE vl.tenant_id = NEW.tenant_id AND vl.vin = NEW.vin
      AND g.vehicle_id = vl.id AND g.tenant_id = NEW.tenant_id
      AND g.document_type = 'k208' AND g.document_status = 'published';
  END IF;
  RETURN NEW;
END $$;

-- Backfill: retract any published K-208 whose NEWEST signed inspection failed.
UPDATE public.generated_documents g
SET document_status = 'draft', published_at = NULL, updated_at = now()
FROM public.vehicle_listings vl
WHERE g.vehicle_id = vl.id AND g.tenant_id = vl.tenant_id
  AND g.document_type = 'k208' AND g.document_status = 'published'
  AND 'fail' IS NOT DISTINCT FROM (
    SELECT si.result FROM public.safety_inspections si
    WHERE si.tenant_id = vl.tenant_id AND si.vin = vl.vin AND si.status = 'signed'
    ORDER BY si.signed_at DESC NULLS LAST, si.created_at DESC LIMIT 1);
