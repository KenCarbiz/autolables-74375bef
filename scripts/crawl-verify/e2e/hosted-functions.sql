-- The crawler's two ledger and queue functions as the hosted project defines
-- them, read from its catalogue (pg_get_functiondef) on 2026-10-29. The
-- repository's migration chain leaves one missing and the other different.
-- Code only; no hosted data.

CREATE OR REPLACE FUNCTION public.advertised_price_crawl_queue(_tenant_id uuid DEFAULT NULL::uuid, _limit integer DEFAULT 500)
 RETURNS SETOF advertised_prices
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT *
  FROM (
    SELECT DISTINCT ON (ap.tenant_id, upper(ap.vin)) ap.*
    FROM public.advertised_prices ap
    WHERE COALESCE(ap.source_url, '') <> ''
      AND (_tenant_id IS NULL OR ap.tenant_id = _tenant_id)
      AND COALESCE(ap.source_channel, '') <> 'feed'
      AND ap.captured_method IS DISTINCT FROM 'marketcheck_syndication'
    ORDER BY ap.tenant_id, upper(ap.vin), ap.captured_at DESC
  ) latest
  ORDER BY latest.captured_at ASC NULLS FIRST
  LIMIT GREATEST(COALESCE(_limit, 500), 1);
$function$
;

CREATE OR REPLACE FUNCTION public.record_advertised_price_crawl_attempt(_tenant_id uuid, _vin text, _source_label text, _source_url text, _outcome text, _http_status integer DEFAULT NULL::integer, _render_status integer DEFAULT NULL::integer, _detail text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_ok boolean := _outcome = 'captured';
BEGIN
  IF _tenant_id IS NULL OR coalesce(trim(_vin), '') = '' THEN RETURN; END IF;
  INSERT INTO public.advertised_price_crawl_attempts AS a (
    tenant_id, vin, source_label, source_url, outcome,
    http_status, render_status, detail, attempts,
    first_attempt_at, last_attempt_at, resolved_at
  ) VALUES (
    _tenant_id, upper(trim(_vin)), coalesce(nullif(_source_label,''),'website'),
    _source_url, _outcome, _http_status, _render_status, left(coalesce(_detail,''),500),
    1, now(), now(), CASE WHEN v_ok THEN now() ELSE NULL END
  )
  ON CONFLICT (tenant_id, upper(vin), source_label) DO UPDATE SET
    source_url = EXCLUDED.source_url, outcome = EXCLUDED.outcome,
    http_status = EXCLUDED.http_status, render_status = EXCLUDED.render_status,
    detail = EXCLUDED.detail,
    attempts = CASE WHEN a.outcome = EXCLUDED.outcome THEN a.attempts + 1 ELSE 1 END,
    last_attempt_at = now(),
    resolved_at = CASE WHEN v_ok THEN now() ELSE NULL END;
EXCEPTION WHEN OTHERS THEN NULL;
END $function$
;
