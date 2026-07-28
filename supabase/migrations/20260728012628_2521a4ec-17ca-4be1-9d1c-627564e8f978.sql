CREATE TABLE IF NOT EXISTS public.service_locks (
  lock_key    text PRIMARY KEY,
  holder      text,
  acquired_at timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL
);

COMMENT ON TABLE public.service_locks IS
  'Single-runner locks for chained background sweeps. Expiry-based: a crashed holder releases automatically.';

ALTER TABLE public.service_locks ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.try_acquire_service_lock(
  _key text,
  _ttl_seconds integer DEFAULT 900,
  _holder text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE got boolean;
BEGIN
  INSERT INTO public.service_locks (lock_key, holder, acquired_at, expires_at)
  VALUES (_key, _holder, now(), now() + make_interval(secs => greatest(_ttl_seconds, 1)))
  ON CONFLICT (lock_key) DO UPDATE
    SET holder = EXCLUDED.holder,
        acquired_at = EXCLUDED.acquired_at,
        expires_at = EXCLUDED.expires_at
    WHERE public.service_locks.expires_at < now()
  RETURNING true INTO got;
  RETURN coalesce(got, false);
END $$;

CREATE OR REPLACE FUNCTION public.release_service_lock(_key text)
RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  DELETE FROM public.service_locks WHERE lock_key = _key;
$$;

REVOKE ALL ON FUNCTION public.try_acquire_service_lock(text, integer, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.release_service_lock(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.try_acquire_service_lock(text, integer, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_service_lock(text) TO service_role;