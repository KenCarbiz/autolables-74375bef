
-- Fix mutable search_path on vehicle_work_events_block_locked trigger fn
CREATE OR REPLACE FUNCTION public.vehicle_work_events_block_locked()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF OLD.locked THEN
    RAISE EXCEPTION 'work_event_locked: signed work events are immutable; submit a correction event instead';
  END IF;
  RETURN NEW;
END;
$$;

-- Tenant-scoped SELECT policy on the now-private service-docs bucket.
-- Paths are laid down as `<tenant_id>/<vin>/...` by signoff-upload,
-- so scope reads by the top-level folder matching the caller's tenant.
DROP POLICY IF EXISTS "service_docs_tenant_read" ON storage.objects;
CREATE POLICY "service_docs_tenant_read"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'service-docs'
    AND (
      (storage.foldername(name))[1]::uuid IN (
        SELECT tenant_id FROM public.tenant_members
        WHERE user_id = (SELECT auth.uid())
      )
    )
  );
