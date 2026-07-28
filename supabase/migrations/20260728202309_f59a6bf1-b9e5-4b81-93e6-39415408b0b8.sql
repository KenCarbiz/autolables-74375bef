-- Provider payload shape drift detection.
CREATE TABLE IF NOT EXISTS public.provider_payload_shapes (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider      TEXT NOT NULL,
  endpoint      TEXT NOT NULL,
  shape_hash    TEXT NOT NULL,
  key_names     TEXT[] NOT NULL DEFAULT '{}',
  dependency_types JSONB NOT NULL DEFAULT '{}'::jsonb,
  findings      JSONB NOT NULL DEFAULT '[]'::jsonb,
  parse_failed  BOOLEAN NOT NULL DEFAULT false,
  observations  INTEGER NOT NULL DEFAULT 1,
  sample_vin    TEXT NULL,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS provider_payload_shapes_identity
  ON public.provider_payload_shapes (provider, endpoint, shape_hash);
CREATE INDEX IF NOT EXISTS provider_payload_shapes_recent
  ON public.provider_payload_shapes (provider, endpoint, last_seen_at DESC);

ALTER TABLE public.provider_payload_shapes ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.provider_payload_shapes TO service_role;

CREATE OR REPLACE FUNCTION public.record_provider_payload_shape(
  _provider TEXT,
  _endpoint TEXT,
  _shape_hash TEXT,
  _key_names TEXT[],
  _dependency_types JSONB,
  _findings JSONB,
  _parse_failed BOOLEAN,
  _sample_vin TEXT
)
RETURNS TABLE (is_new BOOLEAN, prior_keys TEXT[])
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_prior TEXT[]; v_existed BOOLEAN;
BEGIN
  SELECT s.key_names INTO v_prior
    FROM public.provider_payload_shapes s
   WHERE s.provider = _provider AND s.endpoint = _endpoint AND s.shape_hash <> _shape_hash
   ORDER BY s.last_seen_at DESC LIMIT 1;

  SELECT TRUE INTO v_existed
    FROM public.provider_payload_shapes s
   WHERE s.provider = _provider AND s.endpoint = _endpoint AND s.shape_hash = _shape_hash;

  INSERT INTO public.provider_payload_shapes AS p
    (provider, endpoint, shape_hash, key_names, dependency_types, findings, parse_failed, sample_vin)
  VALUES
    (_provider, _endpoint, _shape_hash, _key_names, _dependency_types, _findings, _parse_failed, _sample_vin)
  ON CONFLICT (provider, endpoint, shape_hash) DO UPDATE SET
    observations = p.observations + 1,
    last_seen_at = now(),
    parse_failed = p.parse_failed AND EXCLUDED.parse_failed;

  RETURN QUERY SELECT COALESCE(v_existed, FALSE) = FALSE, v_prior;
END $$;

GRANT EXECUTE ON FUNCTION public.record_provider_payload_shape(TEXT, TEXT, TEXT, TEXT[], JSONB, JSONB, BOOLEAN, TEXT) TO service_role;

-- Atomic append/remove for vehicle_listings.documents.
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