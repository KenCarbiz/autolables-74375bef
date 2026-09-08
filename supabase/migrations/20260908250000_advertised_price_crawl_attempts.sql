-- A failure ledger for the advertised-price crawl.
--
-- advertised_prices records only successes. When the crawl stopped working on
-- 2026-08-24 it left no queryable trace: 15 days of total failure looked
-- identical to 15 days of "no price changed". The cause had to be found by
-- invoking the function's own test mode by hand.
--
-- Worse, the outcome was mislabelled. Firecrawl was answering HTTP 402
-- "Insufficient credits", and the crawler recorded that as reason
-- "bot_challenge" -- a billing problem wearing a bot-wall's name, which is
-- what made it look like a dealer-site issue for two weeks.
--
-- This table records every attempt, success or not, one row per
-- (tenant, vin, channel), upserted so a permanently failing VIN shows a rising
-- attempt count rather than thousands of rows. Same shape as
-- oem_document_copy_attempts, which exists for exactly this reason.

CREATE TABLE IF NOT EXISTS public.advertised_price_crawl_attempts (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL,
  vin               text NOT NULL,
  source_label      text NOT NULL DEFAULT 'website',
  source_url        text,
  outcome           text NOT NULL,
  http_status       integer,
  render_status     integer,
  detail            text,
  attempts          integer NOT NULL DEFAULT 1,
  first_attempt_at  timestamptz NOT NULL DEFAULT now(),
  last_attempt_at   timestamptz NOT NULL DEFAULT now(),
  resolved_at       timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_ap_crawl_attempts_target
  ON public.advertised_price_crawl_attempts (tenant_id, upper(vin), source_label);

CREATE INDEX IF NOT EXISTS idx_ap_crawl_attempts_outcome
  ON public.advertised_price_crawl_attempts (outcome, last_attempt_at DESC);

CREATE INDEX IF NOT EXISTS idx_ap_crawl_attempts_tenant
  ON public.advertised_price_crawl_attempts (tenant_id, last_attempt_at DESC);

ALTER TABLE public.advertised_price_crawl_attempts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tenant members read crawl attempts"
  ON public.advertised_price_crawl_attempts;
CREATE POLICY "tenant members read crawl attempts"
  ON public.advertised_price_crawl_attempts FOR SELECT
  TO authenticated
  USING (
    tenant_id IN (
      SELECT tenant_id FROM public.tenant_members
      WHERE user_id = (SELECT auth.uid()) AND accepted_at IS NOT NULL
    )
  );

DROP POLICY IF EXISTS "service role writes crawl attempts"
  ON public.advertised_price_crawl_attempts;
CREATE POLICY "service role writes crawl attempts"
  ON public.advertised_price_crawl_attempts FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

-- Upsert one attempt. Never raises: a ledger that can fail a price run is
-- worse than no ledger. resolved_at is stamped on success and cleared when a
-- previously-good target starts failing again, so "when did this break" is a
-- single query.
CREATE OR REPLACE FUNCTION public.record_advertised_price_crawl_attempt(
  _tenant_id     uuid,
  _vin           text,
  _source_label  text,
  _source_url    text,
  _outcome       text,
  _http_status   integer DEFAULT NULL,
  _render_status integer DEFAULT NULL,
  _detail        text    DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ok boolean := _outcome = 'captured';
BEGIN
  IF _tenant_id IS NULL OR coalesce(trim(_vin), '') = '' THEN RETURN; END IF;

  INSERT INTO public.advertised_price_crawl_attempts AS a (
    tenant_id, vin, source_label, source_url, outcome,
    http_status, render_status, detail, attempts,
    first_attempt_at, last_attempt_at, resolved_at
  ) VALUES (
    _tenant_id, upper(trim(_vin)), coalesce(nullif(_source_label, ''), 'website'),
    _source_url, _outcome, _http_status, _render_status, left(coalesce(_detail, ''), 500),
    1, now(), now(), CASE WHEN v_ok THEN now() ELSE NULL END
  )
  ON CONFLICT (tenant_id, upper(vin), source_label) DO UPDATE SET
    source_url    = EXCLUDED.source_url,
    outcome       = EXCLUDED.outcome,
    http_status   = EXCLUDED.http_status,
    render_status = EXCLUDED.render_status,
    detail        = EXCLUDED.detail,
    -- A repeat of the same failure increments; a change of state restarts the
    -- count, so "failing 40 times" and "failed once after working" are
    -- distinguishable.
    attempts      = CASE WHEN a.outcome = EXCLUDED.outcome THEN a.attempts + 1 ELSE 1 END,
    last_attempt_at = now(),
    resolved_at   = CASE WHEN v_ok THEN now() ELSE NULL END;
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

REVOKE ALL ON FUNCTION public.record_advertised_price_crawl_attempt(uuid, text, text, text, text, integer, integer, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_advertised_price_crawl_attempt(uuid, text, text, text, text, integer, integer, text)
  TO service_role;

-- Operator view: what is the crawl actually doing, and since when.
CREATE OR REPLACE FUNCTION public.advertised_price_crawl_health(_tenant_id uuid DEFAULT NULL)
RETURNS TABLE (
  outcome        text,
  vins           bigint,
  total_attempts bigint,
  oldest_failure timestamptz,
  newest_attempt timestamptz,
  sample_detail  text
)
-- SECURITY INVOKER on purpose. The table's RLS already scopes reads to the
-- caller's accepted tenants, so the policy does the authorization and
-- _tenant_id is only ever a narrowing filter. A SECURITY DEFINER version
-- would have to re-implement that check, and the obvious shape --
-- "_tenant_id IS NOT NULL OR <membership>" -- silently lets any caller read
-- any tenant by simply supplying an id.
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public
AS $$
  SELECT a.outcome,
         count(*)::bigint,
         sum(a.attempts)::bigint,
         min(a.last_attempt_at) FILTER (WHERE a.resolved_at IS NULL),
         max(a.last_attempt_at),
         left(min(a.detail), 200)
  FROM public.advertised_price_crawl_attempts a
  WHERE (_tenant_id IS NULL OR a.tenant_id = _tenant_id)
  GROUP BY a.outcome
  ORDER BY 2 DESC;
$$;

REVOKE ALL ON FUNCTION public.advertised_price_crawl_health(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.advertised_price_crawl_health(uuid) TO authenticated, service_role;
