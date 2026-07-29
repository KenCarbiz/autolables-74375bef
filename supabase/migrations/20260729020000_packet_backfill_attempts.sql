-- ─────────────────────────────────────────────────────────────────────
-- Negative cache for the OEM packet backfill.
--
-- oem_brochure_links / oem_owners_manual_links record what we FOUND. Nothing
-- records what we looked for and did not find, and that asymmetry is a
-- recurring bill: a 2011 model with no brochure on the manufacturer's site is
-- a Firecrawl search every night, forever, that can only ever return the same
-- nothing. Same for a make absent from the harvest allow-list, which is not
-- going to appear without a deploy.
--
-- So a verdict is a result worth storing. packet-backfill writes one row per
-- (kind, make, model, year) triple it asked about:
--
--   found       the link table now answers this triple; never asked again
--   unsupported the make is not in the OEM domain allow-list; never asked
--               again (an admin forces a re-ask after a deploy adds it)
--   not_found   the OEM site had nothing; re-asked at most a couple more
--               times, weeks apart, because OEMs do publish late
--   error       transient (5xx, timeout); re-asked the next night
--
-- The retry policy itself lives in _shared/packetBackfill.ts and is unit
-- tested; this table only has to hold the verdict and the attempt count. A
-- throttle is deliberately NOT written here — nothing was learned about the
-- triple, and remembering "rate limited" as "this car has no brochure" is
-- exactly the class of bug the invoke.ts retry doctrine exists to prevent.
--
-- Global, not tenant-scoped, for the same reason the link tables are: a
-- brochure for a 2021 Accord is the same brochure for every dealer, and
-- scoping the cache per tenant would multiply the spend by the dealer count.
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.oem_packet_backfill_attempts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind            TEXT NOT NULL CHECK (kind IN ('brochure', 'owners_manual')),
  -- Normalized lookup key. Stored as plain columns rather than an expression
  -- index so PostgREST/RPC can target the unique constraint by name.
  make_key        TEXT NOT NULL,
  model_key       TEXT NOT NULL,
  -- 0 stands for "no model year", so the key is never NULL and the unique
  -- constraint actually constrains.
  year_key        INTEGER NOT NULL DEFAULT 0,
  make            TEXT NOT NULL,
  model           TEXT NOT NULL,
  year            INTEGER,
  outcome         TEXT NOT NULL CHECK (outcome IN ('found', 'not_found', 'unsupported', 'error')),
  detail          TEXT,
  attempts        INTEGER NOT NULL DEFAULT 1,
  last_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_oem_packet_backfill_attempts UNIQUE (kind, make_key, model_key, year_key)
);

COMMENT ON TABLE public.oem_packet_backfill_attempts IS
  'What the OEM packet backfill has already asked for and what came back. Stops a triple with no brochure/manual being re-searched, and re-billed, every night.';

CREATE INDEX IF NOT EXISTS idx_oem_packet_backfill_attempts_open
  ON public.oem_packet_backfill_attempts (last_attempt_at)
  WHERE outcome IN ('not_found', 'error');

ALTER TABLE public.oem_packet_backfill_attempts ENABLE ROW LEVEL SECURITY;

-- Read-only to signed-in staff, like the sibling link catalogues: it answers
-- "why does this car show no brochure" without exposing a write path. There is
-- no tenant_id to scope on — the row describes a make/model/year, not a
-- dealer's data — so the policy asserts a signed-in caller and nothing more.
-- auth.uid() is wrapped so the planner caches it as an initPlan instead of
-- re-evaluating per row.
DROP POLICY IF EXISTS "Authenticated read packet backfill attempts" ON public.oem_packet_backfill_attempts;
CREATE POLICY "Authenticated read packet backfill attempts"
  ON public.oem_packet_backfill_attempts FOR SELECT
  TO authenticated
  USING ((SELECT auth.uid()) IS NOT NULL);

-- No INSERT/UPDATE/DELETE policy: the sweep is the only writer, through the
-- SECURITY DEFINER function below.
GRANT SELECT ON public.oem_packet_backfill_attempts TO authenticated;
GRANT ALL ON public.oem_packet_backfill_attempts TO service_role;

/**
 * Record one harvest verdict, incrementing the attempt count in place.
 *
 * A plain upsert would reset `attempts` to 1 on every write, so the "stop after
 * three tries, ever" ceiling would never be reached and a triple with no
 * brochure would be re-searched forever at the cooldown interval. The increment
 * has to happen inside the conflict clause.
 */
CREATE OR REPLACE FUNCTION public.record_packet_backfill_attempt(
  _kind    TEXT,
  _make    TEXT,
  _model   TEXT,
  _year    INTEGER,
  _outcome TEXT,
  _detail  TEXT DEFAULT NULL
)
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_attempts INTEGER;
BEGIN
  INSERT INTO public.oem_packet_backfill_attempts
    (kind, make_key, model_key, year_key, make, model, year, outcome, detail)
  VALUES (
    _kind,
    lower(btrim(_make)), lower(btrim(_model)), COALESCE(_year, 0),
    btrim(_make), btrim(_model), _year,
    _outcome, left(COALESCE(_detail, ''), 500)
  )
  ON CONFLICT ON CONSTRAINT uq_oem_packet_backfill_attempts DO UPDATE
    SET outcome         = EXCLUDED.outcome,
        detail          = EXCLUDED.detail,
        attempts        = public.oem_packet_backfill_attempts.attempts + 1,
        last_attempt_at = now()
  RETURNING attempts INTO v_attempts;
  RETURN v_attempts;
END $$;

REVOKE ALL ON FUNCTION public.record_packet_backfill_attempt(TEXT, TEXT, TEXT, INTEGER, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_packet_backfill_attempt(TEXT, TEXT, TEXT, INTEGER, TEXT, TEXT)
  TO service_role;
