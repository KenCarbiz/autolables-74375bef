-- COMPLIANCE FIX: a signed FAILED K-208 must never auto-publish to the
-- customer passport. The autopublish trigger (20260724010000) fired on
-- status = 'signed' alone, so a service tech signing a FAIL result pushed the
-- unexecuted K-208 customer-visible. Executed means signed AND result is not
-- 'fail' (isExecutedSignoff semantics). Also un-publish at runtime if a signed
-- inspection is edited to a fail, and backfill any doc already published off a
-- signed fail.

CREATE OR REPLACE FUNCTION public.autopublish_k208_on_signoff()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'signed'
     AND NEW.result IS DISTINCT FROM 'fail'
     AND (TG_OP = 'INSERT'
          OR OLD.status IS DISTINCT FROM 'signed'
          OR OLD.result IS NOT DISTINCT FROM 'fail') THEN
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

  -- A signed FAIL retracts a published K-208 unless another signed non-fail
  -- inspection still stands for the VIN (a failed working copy is never
  -- customer-visible).
  IF NEW.status = 'signed' AND NEW.result IS NOT DISTINCT FROM 'fail' THEN
    UPDATE public.generated_documents g
    SET document_status = 'draft',
        published_at = NULL,
        updated_at = now()
    FROM public.vehicle_listings vl
    WHERE vl.tenant_id = NEW.tenant_id
      AND vl.vin = NEW.vin
      AND g.vehicle_id = vl.id
      AND g.tenant_id = NEW.tenant_id
      AND g.document_type = 'k208'
      AND g.document_status = 'published'
      AND NOT EXISTS (
        SELECT 1 FROM public.safety_inspections si
        WHERE si.tenant_id = NEW.tenant_id
          AND si.vin = NEW.vin
          AND si.id <> NEW.id
          AND si.status = 'signed'
          AND si.result IS DISTINCT FROM 'fail'
      );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_autopublish_k208_on_signoff ON public.safety_inspections;
CREATE TRIGGER trg_autopublish_k208_on_signoff
  AFTER INSERT OR UPDATE OF status, result ON public.safety_inspections
  FOR EACH ROW
  EXECUTE FUNCTION public.autopublish_k208_on_signoff();

-- Backfill: un-publish every K-208 doc published off a signed FAIL where no
-- signed non-fail inspection exists for the VIN. Audit rows are best-effort so
-- the audit hash-chain trigger can never roll back the compliance retraction.
DO $$
DECLARE v_ids uuid[];
BEGIN
  WITH unpub AS (
    UPDATE public.generated_documents g
    SET document_status = 'draft',
        published_at = NULL,
        updated_at = now()
    FROM public.vehicle_listings vl
    WHERE g.vehicle_id = vl.id
      AND g.tenant_id = vl.tenant_id
      AND g.document_type = 'k208'
      AND g.document_status = 'published'
      AND EXISTS (
        SELECT 1 FROM public.safety_inspections si
        WHERE si.tenant_id = vl.tenant_id AND si.vin = vl.vin
          AND si.status = 'signed' AND si.result IS NOT DISTINCT FROM 'fail'
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.safety_inspections si2
        WHERE si2.tenant_id = vl.tenant_id AND si2.vin = vl.vin
          AND si2.status = 'signed' AND si2.result IS DISTINCT FROM 'fail'
      )
    RETURNING g.id, g.tenant_id
  )
  SELECT array_agg(id) INTO v_ids FROM unpub;

  IF v_ids IS NOT NULL THEN
    BEGIN
      INSERT INTO public.audit_log (action, entity_type, entity_id, details)
      SELECT 'k208_unpublished_failed_inspection', 'generated_document', u.id::text,
             jsonb_build_object('reason', 'signed inspection result is fail; an unexecuted K-208 is never customer-visible')
      FROM unnest(v_ids) AS u(id);
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
  END IF;
END $$;
