-- Two defects on the "save a copy into the passport" path.
--
-- 1. append_vehicle_document / remove_vehicle_document require auth.uid() to
--    be a tenant member or an admin. save-owners-manual runs with verify_jwt
--    off and calls them on the service-role key, where the JWT carries a role
--    claim but no sub -- so auth.uid() is NULL, neither EXISTS matches, and
--    the RPC has been raising 'not authorized for this vehicle' on every
--    call. The manual uploads to storage first, so each attempt also orphaned
--    a stored PDF. The service role is the trust boundary itself (the edge
--    function has already checked the car is published, and resolves the
--    manual URL server-side), so it is admitted explicitly here rather than
--    being made to impersonate a user.
--
-- 2. The vehicle-docs bucket caps objects at 25 MB while save-owners-manual
--    accepts 60 MB, so a manual between the two passed the function's check
--    and then failed at upload with an opaque storage error. Owner's manuals
--    for current models genuinely run 30-50 MB, so the bucket is raised to
--    match rather than the feature being narrowed. Keep this number in step
--    with VEHICLE_DOCS_MAX_BYTES in supabase/functions/_shared/vehicleDocs.ts.

CREATE OR REPLACE FUNCTION public.append_vehicle_document(
  _vehicle_id UUID,
  _doc JSONB
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_docs JSONB;
  v_role TEXT := COALESCE(
    NULLIF(current_setting('request.jwt.claim.role', true), ''),
    NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role');
BEGIN
  IF _doc IS NULL OR jsonb_typeof(_doc) <> 'object' THEN
    RAISE EXCEPTION 'document must be a json object';
  END IF;

  -- Caller must be a member of the owning tenant. SECURITY DEFINER bypasses
  -- RLS, so the check has to be explicit. The service role is exempt: it has
  -- no sub claim to check, and reaching it already required the service key.
  IF v_role IS DISTINCT FROM 'service_role' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.vehicle_listings vl
       WHERE vl.id = _vehicle_id
         AND vl.tenant_id IN (
           SELECT tenant_id FROM public.tenant_members
            WHERE user_id = (SELECT auth.uid()) AND accepted_at IS NOT NULL)
    ) AND NOT EXISTS (
      SELECT 1 FROM public.user_roles WHERE user_id = (SELECT auth.uid()) AND role = 'admin'
    ) THEN
      RAISE EXCEPTION 'not authorized for this vehicle';
    END IF;
  END IF;

  -- One statement: read and write cannot interleave, so a concurrent attach
  -- cannot be lost.
  UPDATE public.vehicle_listings
     SET documents = COALESCE(documents, '[]'::jsonb) || jsonb_build_array(_doc)
   WHERE id = _vehicle_id
  RETURNING documents INTO v_docs;

  RETURN COALESCE(v_docs, '[]'::jsonb);
END $$;

CREATE OR REPLACE FUNCTION public.remove_vehicle_document(
  _vehicle_id UUID,
  _name TEXT,
  _url TEXT,
  _type TEXT
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_docs JSONB;
  v_role TEXT := COALESCE(
    NULLIF(current_setting('request.jwt.claim.role', true), ''),
    NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role');
BEGIN
  IF v_role IS DISTINCT FROM 'service_role' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.vehicle_listings vl
       WHERE vl.id = _vehicle_id
         AND vl.tenant_id IN (
           SELECT tenant_id FROM public.tenant_members
            WHERE user_id = (SELECT auth.uid()) AND accepted_at IS NOT NULL)
    ) AND NOT EXISTS (
      SELECT 1 FROM public.user_roles WHERE user_id = (SELECT auth.uid()) AND role = 'admin'
    ) THEN
      RAISE EXCEPTION 'not authorized for this vehicle';
    END IF;
  END IF;

  -- Removes only the matching entry; every other document is untouched
  -- regardless of what the client believed the array contained.
  UPDATE public.vehicle_listings
     SET documents = COALESCE((
           SELECT jsonb_agg(d)
             FROM jsonb_array_elements(COALESCE(documents, '[]'::jsonb)) d
            WHERE NOT (d->>'url' IS NOT DISTINCT FROM _url
                   AND d->>'name' IS NOT DISTINCT FROM _name
                   AND d->>'type' IS NOT DISTINCT FROM _type)
         ), '[]'::jsonb)
   WHERE id = _vehicle_id
  RETURNING documents INTO v_docs;

  RETURN COALESCE(v_docs, '[]'::jsonb);
END $$;

GRANT EXECUTE ON FUNCTION public.append_vehicle_document(UUID, JSONB) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.remove_vehicle_document(UUID, TEXT, TEXT, TEXT) TO authenticated, service_role;

UPDATE storage.buckets SET file_size_limit = 62914560 WHERE id = 'vehicle-docs';
