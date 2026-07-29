-- ──────────────────────────────────────────────────────────────────────
-- A single-runner lock for sweeps that cost money.
--
-- specs-backfill decodes VINs against a paid provider and self-chains
-- until the inventory is done. Nothing stopped two of them running at
-- once: before this, that took a deliberate curl, but the sweep is now
-- reachable by any signed-in admin from the app, so two clicks — or a
-- click landing on top of the nightly cron — start two chains that both
-- decode the same VIN and are billed twice for one answer.
--
-- Advisory locks are the usual reach here and are the wrong tool: they are
-- session-scoped, and edge functions reach Postgres through a pooler that
-- does not keep a session per caller. So the lock is a row, with an
-- explicit expiry rather than an unlock call — a function that times out
-- or crashes mid-sweep must not hold the lock forever.
-- ──────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.service_locks (
  lock_key    text PRIMARY KEY,
  holder      text,
  acquired_at timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL
);

COMMENT ON TABLE public.service_locks IS
  'Single-runner locks for chained background sweeps. Expiry-based: a crashed holder releases automatically.';

ALTER TABLE public.service_locks ENABLE ROW LEVEL SECURITY;
-- No policies: the service role is the only caller, and a client has no
-- reason to read or take an infrastructure lock.

/**
 * Take `_key` for `_ttl_seconds`, or report that someone else holds it.
 *
 * The INSERT ... ON CONFLICT DO UPDATE with a WHERE clause is what makes
 * this atomic: two callers racing both attempt the same upsert and exactly
 * one row is written, so exactly one gets a row back.
 */
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

/** Release early. A missed release is harmless — the expiry still applies. */
CREATE OR REPLACE FUNCTION public.release_service_lock(_key text)
RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  DELETE FROM public.service_locks WHERE lock_key = _key;
$$;

REVOKE ALL ON FUNCTION public.try_acquire_service_lock(text, integer, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.release_service_lock(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.try_acquire_service_lock(text, integer, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_service_lock(text) TO service_role;
