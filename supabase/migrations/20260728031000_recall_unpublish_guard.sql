-- ─────────────────────────────────────────────────────────────────────────
-- Do-not-drive recall un-publish guard.
--
-- enforce_prep_gate (20260629100000_ingest_publish_and_install_gate) is
-- TRANSITION-ONLY: it only inspects the recall payload at the moment a row
-- moves INTO 'published'. It has nothing to say when the nightly recall sweep
-- LATER writes do_not_drive onto an already-published car, so a vehicle that
-- was clean (or simply unchecked) at intake stays live on the public passport
-- after MarketCheck/NHTSA says it must not be driven.
--
-- This adds the missing half: whenever recall_check is written, a published
-- listing carrying an un-overridden do-not-drive flag is pulled back to
-- 'draft' and a critical vehicle_exceptions row tells a human why. Every other
-- recall_check write passes through untouched — the guard is a BEFORE trigger
-- that only ever rewrites status/published_at on the row already being updated,
-- so it cannot fail an unrelated recall refresh.
-- ─────────────────────────────────────────────────────────────────────────

-- ── Shared do-not-drive predicate ────────────────────────────────────────
-- The publish gate casts recall_check->>'do_not_drive' directly, which throws
-- on any non-boolean value. The guard and its backfill run across every row in
-- the table, so they need a total function: anything that is not recognisably
-- true reads as false (matching the gate's fail-open-on-unknown posture).
CREATE OR REPLACE FUNCTION public.recall_is_do_not_drive(p jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE jsonb_typeof(p -> 'do_not_drive')
           WHEN 'boolean' THEN (p ->> 'do_not_drive')::boolean
           WHEN 'string'  THEN lower(p ->> 'do_not_drive') IN ('true', 't', 'yes', '1')
           ELSE false
         END;
$$;

-- ── Un-publish trigger ───────────────────────────────────────────────────
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

  -- Telling the dealer is best-effort; pulling the car off the public web is
  -- not. Neither insert may abort the recall write that got us here.
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

-- ── Backfill: pull down anything already live under a do-not-drive recall ──
-- These are the rows the transition-only gate let through. The UPDATE does not
-- touch recall_check, so the guard above does not re-fire on them.
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
-- DISTINCT ON: the canonical tenant/VIN unique index is conditional (see
-- 20260727120000_vehicle_truth_layer), so duplicate tenant/VIN listings can
-- still exist and would hit the exception dedup index twice in one statement.
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
