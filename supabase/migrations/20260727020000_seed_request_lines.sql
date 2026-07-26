-- Seed service_request_lines from the request's estimate fields so every
-- request is line-decidable the moment it lands: est_parts / est_labor /
-- sublet_cost become one line each. Requests created by a future lined
-- form skip the seed (lines already present). Backfills open requests.

CREATE OR REPLACE FUNCTION public.seed_service_request_lines()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.service_request_lines WHERE request_id = NEW.id) THEN
      IF coalesce(NEW.est_parts, 0) > 0 THEN
        INSERT INTO public.service_request_lines (tenant_id, request_id, item, line_type, amount)
        VALUES (NEW.tenant_id, NEW.id, coalesce(nullif(NEW.work_requested, ''), 'Parts') || ' (parts)', 'parts', NEW.est_parts);
      END IF;
      IF coalesce(NEW.est_labor, 0) > 0 THEN
        INSERT INTO public.service_request_lines (tenant_id, request_id, item, line_type, amount)
        VALUES (NEW.tenant_id, NEW.id, coalesce(nullif(NEW.work_requested, ''), 'Labor') || ' (labor)', 'labor', NEW.est_labor);
      END IF;
      IF coalesce(NEW.sublet_cost, 0) > 0 THEN
        INSERT INTO public.service_request_lines (tenant_id, request_id, item, line_type, amount)
        VALUES (NEW.tenant_id, NEW.id, coalesce(nullif(NEW.work_requested, ''), 'Sublet') || ' (sublet)', 'sublet', NEW.sublet_cost);
      END IF;
    END IF;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_seed_service_request_lines ON public.service_requests;
CREATE TRIGGER trg_seed_service_request_lines
  AFTER INSERT ON public.service_requests
  FOR EACH ROW EXECUTE FUNCTION public.seed_service_request_lines();

-- Backfill open requests that predate lines.
INSERT INTO public.service_request_lines (tenant_id, request_id, item, line_type, amount)
SELECT r.tenant_id, r.id, coalesce(nullif(r.work_requested, ''), 'Parts') || ' (parts)', 'parts', r.est_parts
FROM public.service_requests r
WHERE r.status IN ('pending','clarify') AND coalesce(r.est_parts, 0) > 0
  AND NOT EXISTS (SELECT 1 FROM public.service_request_lines l WHERE l.request_id = r.id);
INSERT INTO public.service_request_lines (tenant_id, request_id, item, line_type, amount)
SELECT r.tenant_id, r.id, coalesce(nullif(r.work_requested, ''), 'Labor') || ' (labor)', 'labor', r.est_labor
FROM public.service_requests r
WHERE r.status IN ('pending','clarify') AND coalesce(r.est_labor, 0) > 0
  AND NOT EXISTS (SELECT 1 FROM public.service_request_lines l WHERE l.request_id = r.id AND l.line_type = 'labor');
INSERT INTO public.service_request_lines (tenant_id, request_id, item, line_type, amount)
SELECT r.tenant_id, r.id, coalesce(nullif(r.work_requested, ''), 'Sublet') || ' (sublet)', 'sublet', r.sublet_cost
FROM public.service_requests r
WHERE r.status IN ('pending','clarify') AND coalesce(r.sublet_cost, 0) > 0
  AND NOT EXISTS (SELECT 1 FROM public.service_request_lines l WHERE l.request_id = r.id AND l.line_type = 'sublet');
