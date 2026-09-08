-- Correct a payload-shape observation that names the wrong endpoint.
--
-- `record_provider_payload_shape` exists to settle vendor questions: it records
-- the exact key set an endpoint returned, and whether a field arrived as null
-- or was absent entirely. That distinction is the difference between "this VIN
-- has no value" and "your plan does not send this field".
--
-- The call site hardcoded `_provider: 'marketcheck_search'` and
-- `_endpoint: .../v2/search/car/active` while the inventory walk that produced
-- the payload runs against `/v2/dealerships/inventory`. So the one diagnostic
-- built to be shown to a vendor was naming an endpoint it had not called. It
-- misled an entire analysis before anyone compared it to the fetch.
--
-- The code fix is structural: the endpoint now comes back from mcFetch on the
-- response itself, and the provider label is derived from it, so the two can no
-- longer disagree. This migration repairs the row already written under the
-- wrong name.
--
-- Unambiguous, and here is why: the recorder is called from exactly one place,
-- inside the syndication paging loop. `/v2/search/car/active` is used elsewhere
-- in the sync only as a one-shot diagnostic sample that never reaches this RPC.
-- A row recorded by that call site therefore came from the syndication feed,
-- whatever the label says.

DO $$
DECLARE
  v_moved int;
BEGIN
  IF to_regclass('public.provider_payload_shapes') IS NULL THEN
    RAISE NOTICE 'provider_payload_shapes absent; nothing to relabel';
    RETURN;
  END IF;

  -- Do not collide with a correctly-labelled syndication row if one already
  -- exists for the same shape: keep the earlier first_seen_at and drop the dupe.
  DELETE FROM public.provider_payload_shapes a
   WHERE a.provider = 'marketcheck_search'
     AND EXISTS (
       SELECT 1 FROM public.provider_payload_shapes b
        WHERE b.provider = 'marketcheck_syndication'
          AND b.shape_hash = a.shape_hash
     );

  UPDATE public.provider_payload_shapes
     SET provider = 'marketcheck_syndication',
         endpoint = 'https://api.marketcheck.com/v2/dealerships/inventory'
   WHERE provider = 'marketcheck_search';
  GET DIAGNOSTICS v_moved = ROW_COUNT;

  RAISE NOTICE 'relabelled % payload-shape row(s) from marketcheck_search to marketcheck_syndication', v_moved;

  IF EXISTS (
    SELECT 1 FROM public.provider_payload_shapes
     WHERE provider = 'marketcheck_syndication'
       AND endpoint NOT LIKE '%/dealerships/inventory%'
  ) THEN
    RAISE EXCEPTION 'a syndication shape row still names a non-syndication endpoint';
  END IF;
END $$;
