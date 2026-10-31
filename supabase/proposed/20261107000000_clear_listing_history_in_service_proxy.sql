-- PROPOSED, NOT APPLIED. Removes warranty start dates that were inferred from
-- listing history (corrective handoff 2026-10-31, finding 5).
--
-- vehicle-enrich used to copy the first NEW-car listing date (or, failing
-- that, the first time the VIN was seen in any feed) into
-- history_payload.inServiceDate and vehicle_listings.in_service_date, and
-- public-listing-view used that value to start used/CPO warranty countdowns.
-- When a VIN was first advertised is not when it was delivered, so every such
-- date is cleared. A date that does not match any listing-history date (for
-- example one a dealer typed into warranty_info) is kept.
--
-- Every changed value is copied to in_service_proxy_audit first, so the
-- rollback can restore the exact prior state. No provider call is involved.
--
-- Dry run (read-only): run the SELECT in the CTE `proxy` below and count rows.

CREATE TABLE IF NOT EXISTS public.in_service_proxy_audit (
  listing_id uuid NOT NULL,
  column_name text NOT NULL CHECK (column_name IN ('in_service_date', 'warranty_info.in_service_date', 'history_payload.inServiceDate')),
  prior_value text NOT NULL,
  cleared_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (listing_id, column_name)
);
ALTER TABLE public.in_service_proxy_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.in_service_proxy_audit FROM anon, authenticated;

CREATE OR REPLACE FUNCTION pg_temp.history_dates(h jsonb) RETURNS text[] LANGUAGE sql IMMUTABLE AS $$
  SELECT COALESCE(array_agg(DISTINCT d) FILTER (WHERE d IS NOT NULL), '{}')
  FROM (
    SELECT left(h->>'inServiceDate', 10) AS d
    UNION ALL SELECT left(h->>'firstSeen', 10)
    UNION ALL SELECT left(h->>'firstNewListingSeen', 10)
    UNION ALL SELECT left(e->>'first_seen', 10)
      FROM jsonb_array_elements(CASE WHEN jsonb_typeof(h->'entries') = 'array' THEN h->'entries' ELSE '[]'::jsonb END) e
  ) s;
$$;

BEGIN;

INSERT INTO public.in_service_proxy_audit (listing_id, column_name, prior_value)
SELECT id, 'in_service_date', in_service_date::text
  FROM public.vehicle_listings
 WHERE in_service_date IS NOT NULL
   AND history_payload IS NOT NULL
   AND in_service_date::text = ANY (pg_temp.history_dates(history_payload))
ON CONFLICT DO NOTHING;

INSERT INTO public.in_service_proxy_audit (listing_id, column_name, prior_value)
SELECT id, 'warranty_info.in_service_date', warranty_info->>'in_service_date'
  FROM public.vehicle_listings
 WHERE warranty_info ? 'in_service_date'
   AND history_payload IS NOT NULL
   AND left(warranty_info->>'in_service_date', 10) = ANY (pg_temp.history_dates(history_payload))
ON CONFLICT DO NOTHING;

INSERT INTO public.in_service_proxy_audit (listing_id, column_name, prior_value)
SELECT id, 'history_payload.inServiceDate', history_payload->>'inServiceDate'
  FROM public.vehicle_listings
 WHERE history_payload ? 'inServiceDate' AND history_payload->>'inServiceDate' IS NOT NULL
ON CONFLICT DO NOTHING;

UPDATE public.vehicle_listings v
   SET in_service_date = NULL
  FROM public.in_service_proxy_audit a
 WHERE a.listing_id = v.id AND a.column_name = 'in_service_date';

UPDATE public.vehicle_listings v
   SET warranty_info = v.warranty_info - 'in_service_date'
  FROM public.in_service_proxy_audit a
 WHERE a.listing_id = v.id AND a.column_name = 'warranty_info.in_service_date';

UPDATE public.vehicle_listings v
   SET history_payload = jsonb_set(v.history_payload, '{inServiceDate}', 'null'::jsonb)
  FROM public.in_service_proxy_audit a
 WHERE a.listing_id = v.id AND a.column_name = 'history_payload.inServiceDate';

COMMENT ON COLUMN public.vehicle_listings.in_service_date IS
  'Recorded in-service (delivery) date only. Never inferred from listing history; see 20261107000000.';

COMMIT;
