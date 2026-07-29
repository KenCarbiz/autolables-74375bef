-- Atomic append/remove for vehicle_listings.documents.
--
-- Five separate places read the documents array, build a new array in
-- application memory, and write the whole thing back. Two of them are worse
-- than the usual race: save-owners-manual reads the array, then spends 45+
-- seconds fetching and uploading an OEM PDF, then writes the stale array; and
-- the Vehicle File builds its `next` from React state, so a tab left open ten
-- minutes writes a ten-minute-old array. Anything attached in that window --
-- a CARFAX link, a K-208, an inspection report, a sticker PDF -- is silently
-- deleted by the later writer.
--
-- Same shape as the mc_attributes bug: a whole-value rebuild where whatever
-- the writer did not know about is simply gone. The fix is to stop moving the
-- array through the client at all and let Postgres do the concat.

CREATE OR REPLACE FUNCTION public.append_vehicle_document(
  _vehicle_id UUID,
  _doc JSONB
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_docs JSONB;
BEGIN
  IF _doc IS NULL OR jsonb_typeof(_doc) <> 'object' THEN
    RAISE EXCEPTION 'document must be a json object';
  END IF;

  -- Caller must be a member of the owning tenant. SECURITY DEFINER bypasses
  -- RLS, so the check has to be explicit.
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
DECLARE v_docs JSONB;
BEGIN
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
