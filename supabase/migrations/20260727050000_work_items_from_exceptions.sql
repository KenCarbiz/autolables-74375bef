-- ──────────────────────────────────────────────────────────────────────
-- Populate the Work Queue from vehicle exceptions.
--
-- dealer_work_items (20260726210000_deploy_work_queue_foundation.sql) is
-- deployed but nothing writes it, while the cross-department exception
-- source of truth is vehicle_exceptions (written by
-- supabase/functions/_shared/intake-autoprovision.ts as
-- 'artifact_autogen_failed' and by marketcheck-sync as price_change,
-- missing_required_field, duplicate_stock, etc.). Bridge them: every new
-- exception opens a matching work item so /queue shows the real backlog.
--
--   * department: service when the exception text mentions safety/recall,
--     passport for failed intake artifacts (the customer packet docs),
--     inventory for feed/data exceptions.
--   * priority: high when the text mentions safety or recall, else normal.
--   * dedupe: skipped when a live (not completed/cancelled) work item with
--     the same (tenant_id, vin, work_type) already exists — mirrors the
--     vehicle_exceptions_open_dedup_idx one-open-row-per-type invariant.
--   * the trigger swallows its own errors: exception recording must never
--     fail ingest, so the bridge must never fail exception recording.
--
-- No new policies: dealer_work_items already carries the canonical
-- tenant-scoped RLS (tenant_members + (SELECT auth.uid())); the trigger
-- function is SECURITY DEFINER so both service-role and member-inserted
-- exceptions bridge identically.

CREATE OR REPLACE FUNCTION public.work_item_from_vehicle_exception()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_text text;
  v_work_type text;
  v_department text;
  v_priority text;
  v_title text;
  v_meta jsonb;
BEGIN
  BEGIN
    v_work_type := 'exception_' || coalesce(NEW.exception_type, 'unknown');
    v_text := coalesce(NEW.title, '') || ' ' || coalesce(NEW.explanation, '') || ' ' || coalesce(NEW.exception_type, '');
    v_priority := CASE WHEN v_text ~* '(safety|recall)' THEN 'high' ELSE 'normal' END;
    v_department := CASE
      WHEN v_text ~* '(safety|recall)' THEN 'service'
      WHEN NEW.exception_type = 'artifact_autogen_failed' THEN 'passport'
      ELSE 'inventory'
    END;

    IF EXISTS (
      SELECT 1 FROM public.dealer_work_items w
       WHERE w.tenant_id = NEW.tenant_id
         AND w.vin = NEW.vin
         AND w.work_type = v_work_type
         AND w.status NOT IN ('completed','cancelled')
    ) THEN
      RETURN NEW;
    END IF;

    SELECT ymm INTO v_title FROM public.vehicle_listings WHERE id = NEW.vehicle_listing_id;

    v_meta := jsonb_build_object(
      'exception_id', NEW.id,
      'exception_type', NEW.exception_type,
      'severity', NEW.severity);
    IF NEW.vehicle_listing_id IS NOT NULL THEN
      v_meta := v_meta || jsonb_build_object('deep_link', '/vehicle-file/' || NEW.vehicle_listing_id::text);
    END IF;

    INSERT INTO public.dealer_work_items
      (tenant_id, vehicle_id, vin, stock, vehicle_title, work_type, title, description,
       status, priority, department, source, metadata)
    VALUES
      (NEW.tenant_id, NEW.vehicle_listing_id, NEW.vin, NEW.stock_number, v_title,
       v_work_type, coalesce(nullif(btrim(NEW.title), ''), 'Vehicle exception'),
       coalesce(NEW.explanation, NEW.recommended_action),
       'open', v_priority, v_department, 'vehicle_exception', v_meta);
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS vehicle_exceptions_open_work_item ON public.vehicle_exceptions;
CREATE TRIGGER vehicle_exceptions_open_work_item
  AFTER INSERT ON public.vehicle_exceptions
  FOR EACH ROW EXECUTE FUNCTION public.work_item_from_vehicle_exception();

-- ── Backfill: open a work item for every unresolved exception. The open-
-- rows unique index guarantees at most one live exception per
-- (tenant, vin, type), so NOT EXISTS is a complete dedupe here too. ─────
INSERT INTO public.dealer_work_items
  (tenant_id, vehicle_id, vin, stock, vehicle_title, work_type, title, description,
   status, priority, department, source, metadata)
SELECT e.tenant_id, e.vehicle_listing_id, e.vin, e.stock_number, l.ymm,
       'exception_' || coalesce(e.exception_type, 'unknown'),
       coalesce(nullif(btrim(e.title), ''), 'Vehicle exception'),
       coalesce(e.explanation, e.recommended_action),
       'open',
       CASE WHEN t.txt ~* '(safety|recall)' THEN 'high' ELSE 'normal' END,
       CASE
         WHEN t.txt ~* '(safety|recall)' THEN 'service'
         WHEN e.exception_type = 'artifact_autogen_failed' THEN 'passport'
         ELSE 'inventory'
       END,
       'vehicle_exception',
       jsonb_build_object(
         'exception_id', e.id,
         'exception_type', e.exception_type,
         'severity', e.severity)
       || CASE WHEN e.vehicle_listing_id IS NOT NULL
               THEN jsonb_build_object('deep_link', '/vehicle-file/' || e.vehicle_listing_id::text)
               ELSE '{}'::jsonb END
  FROM public.vehicle_exceptions e
  LEFT JOIN public.vehicle_listings l ON l.id = e.vehicle_listing_id
 CROSS JOIN LATERAL (
   SELECT coalesce(e.title, '') || ' ' || coalesce(e.explanation, '') || ' ' || coalesce(e.exception_type, '') AS txt
 ) t
 WHERE e.resolved_at IS NULL
   AND e.status IN ('open','in_progress')
   AND NOT EXISTS (
     SELECT 1 FROM public.dealer_work_items w
      WHERE w.tenant_id = e.tenant_id
        AND w.vin = e.vin
        AND w.work_type = 'exception_' || coalesce(e.exception_type, 'unknown')
        AND w.status NOT IN ('completed','cancelled')
   );
