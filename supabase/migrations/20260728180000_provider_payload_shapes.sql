-- Provider payload shape drift detection.
--
-- We already capture every paid provider response verbatim (neovin_snapshots)
-- and have never looked at it. This is the ledger that makes that capture
-- load-bearing: one row per distinct response shape per endpoint, so the night
-- a provider changes its schema we find out from an exception instead of from
-- a dealer asking why a window sticker says "no factory build data" for a car
-- the provider answered 200 for.
--
-- That is not hypothetical. NeoVIN returns `features` either as a
-- {category: [...]} map or as a flat array; the parser accepted only the map,
-- silently discarded the array, and wrote a null build sheet. A shape mismatch
-- and a genuine coverage gap were indistinguishable downstream, so both burned
-- paid decode attempts until the VIN was permanently retired.

CREATE TABLE IF NOT EXISTS public.provider_payload_shapes (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider      TEXT NOT NULL,
  endpoint      TEXT NOT NULL,
  shape_hash    TEXT NOT NULL,
  key_names     TEXT[] NOT NULL DEFAULT '{}',
  -- {dependency_key: observed_json_type} for the keys our parser reads.
  dependency_types JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Drift findings recorded the first time this shape was seen.
  findings      JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- False once a shape has produced a usable parse, so the alarm fires once
  -- per shape rather than once per vehicle.
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

-- Service-role only, like neovin_snapshots: raw provider structure is not
-- tenant data and no client has any reason to read it.
ALTER TABLE public.provider_payload_shapes ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.provider_payload_shapes TO service_role;

-- Record a shape observation and report whether it is new. The count-up is
-- done server-side so concurrent decodes cannot lose an increment the way a
-- read-modify-write would.
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
  -- The most recently seen shape for this endpoint, before this observation,
  -- is what "changed" is measured against.
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
    -- A shape that has ever parsed is not a parse failure, however many times
    -- a particular vehicle fails for its own reasons.
    parse_failed = p.parse_failed AND EXCLUDED.parse_failed;

  RETURN QUERY SELECT COALESCE(v_existed, FALSE) = FALSE, v_prior;
END $$;

GRANT EXECUTE ON FUNCTION public.record_provider_payload_shape(TEXT, TEXT, TEXT, TEXT[], JSONB, JSONB, BOOLEAN, TEXT) TO service_role;
