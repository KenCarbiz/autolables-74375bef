CREATE OR REPLACE FUNCTION public.recall_is_do_not_drive(p jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE jsonb_typeof(p -> 'do_not_drive')
           WHEN 'boolean' THEN (p ->> 'do_not_drive')::boolean
           WHEN 'string'  THEN lower(p ->> 'do_not_drive') IN ('true', 't', 'yes', '1')
           ELSE false
         END;
$$;

CREATE OR REPLACE FUNCTION public.unpublish_on_do_not_drive_recall()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM 'published'
     OR NEW.recall_override_by IS NOT NULL
     OR NOT public.recall_is_do_not_drive(NEW.recall_check) THEN
    RETURN NEW;
  END IF;

  NEW.status := 'draft';
  NEW.published_at := NULL;

  BEGIN
    INSERT INTO public.vehicle_exceptions AS ve
      (tenant_id, vehicle_listing_id, vin, exception_type, severity, title, explanation,
       source_values, recommended_action, status)
    VALUES
      (NEW.tenant_id, NEW.id, NEW.vin, 'recall_do_not_drive_unpublished', 'critical',
       'Vehicle un-published: do-not-drive recall',
       'A do-not-drive recall was recorded on this VIN while its customer passport was live. '
         || 'The listing was pulled back to draft automatically and is no longer reachable at its public /v/ URL. '
         || 'It cannot be re-published until the recall is resolved or an admin records an override.',
       jsonb_build_object(
         'recall_check', NEW.recall_check,
         'open_recall_count', NEW.open_recall_count,
         'unpublished_at', now(),
         'source', 'recall_unpublish_guard'),
       'Confirm the campaign with the manufacturer, record the recall service outcome, then re-publish.',
       'open')
    ON CONFLICT (tenant_id, vin, exception_type) WHERE status IN ('open', 'in_progress')
    DO UPDATE SET
      severity      = 'critical',
      source_values = coalesce(ve.source_values, '{}'::jsonb) || EXCLUDED.source_values,
      updated_at    = now();
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  BEGIN
    INSERT INTO public.audit_log (action, entity_type, entity_id, store_id, user_id, details)
    VALUES (
      'recall_do_not_drive_unpublished', 'vehicle_listing', NEW.vin, NEW.tenant_id::text,
      (SELECT auth.uid()),
      jsonb_build_object(
        'listing_id', NEW.id,
        'open_recall_count', NEW.open_recall_count,
        'recall_status', NEW.recall_status));
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_recall_unpublish_guard ON public.vehicle_listings;
CREATE TRIGGER trg_recall_unpublish_guard
  BEFORE UPDATE OF recall_check ON public.vehicle_listings
  FOR EACH ROW
  EXECUTE FUNCTION public.unpublish_on_do_not_drive_recall();

WITH pulled AS (
  UPDATE public.vehicle_listings vl
     SET status = 'draft', published_at = NULL
   WHERE vl.status = 'published'
     AND vl.recall_override_by IS NULL
     AND public.recall_is_do_not_drive(vl.recall_check)
  RETURNING vl.tenant_id, vl.id, vl.vin, vl.recall_check, vl.open_recall_count
)
INSERT INTO public.vehicle_exceptions AS ve
  (tenant_id, vehicle_listing_id, vin, exception_type, severity, title, explanation,
   source_values, recommended_action, status)
SELECT DISTINCT ON (p.tenant_id, p.vin)
  p.tenant_id, p.id, p.vin, 'recall_do_not_drive_unpublished', 'critical',
  'Vehicle un-published: do-not-drive recall',
  'This vehicle was published with a do-not-drive recall on file. The listing was pulled back to draft '
    || 'and is no longer reachable at its public /v/ URL.',
  jsonb_build_object(
    'recall_check', p.recall_check,
    'open_recall_count', p.open_recall_count,
    'unpublished_at', now(),
    'source', 'recall_unpublish_guard_backfill'),
  'Confirm the campaign with the manufacturer, record the recall service outcome, then re-publish.',
  'open'
FROM pulled p
WHERE p.tenant_id IS NOT NULL AND coalesce(btrim(p.vin), '') <> ''
ORDER BY p.tenant_id, p.vin, p.id
ON CONFLICT (tenant_id, vin, exception_type) WHERE status IN ('open', 'in_progress')
DO UPDATE SET
  severity      = 'critical',
  source_values = coalesce(ve.source_values, '{}'::jsonb) || EXCLUDED.source_values,
  updated_at    = now();