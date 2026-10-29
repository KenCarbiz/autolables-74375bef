-- Undo one applied correction batch. WRITES. Paste-safe. Replace __BATCH_ID__.
-- All or nothing: every vehicle in the batch must still hold exactly the
-- values the batch wrote; if any has moved since (a feed or crawl write),
-- nothing is reverted and the vehicles are named. One audit row per vehicle
-- (pricing_reconciliation_reverted).
DO $revert$
DECLARE
  v_batch constant text := '__BATCH_ID__';
  v_a record;
  v_problems text[] := ARRAY[]::text[];
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.audit_log WHERE action = 'pricing_reconciliation_applied' AND details->>'batch_id' = v_batch) THEN
    RAISE EXCEPTION 'revert refused: batch % has no applied rows', v_batch;
  END IF;
  IF EXISTS (SELECT 1 FROM public.audit_log WHERE action = 'pricing_reconciliation_reverted' AND details->>'batch_id' = v_batch) THEN
    RAISE EXCEPTION 'revert refused: batch % was already reverted', v_batch;
  END IF;
  FOR v_a IN
    SELECT a.entity_id::uuid AS id, a.details, l.price, l.advertised_price_before_doc, l.doc_fee, l.website_sale_price
    FROM public.audit_log a JOIN public.vehicle_listings l ON l.id = a.entity_id::uuid
    WHERE a.action = 'pricing_reconciliation_applied' AND a.details->>'batch_id' = v_batch
    FOR UPDATE OF l
  LOOP
    IF v_a.price IS DISTINCT FROM (v_a.details->'after'->>'price')::numeric
       OR v_a.advertised_price_before_doc IS DISTINCT FROM (v_a.details->'after'->>'advertised_price_before_doc')::numeric
       OR v_a.doc_fee IS DISTINCT FROM (v_a.details->'after'->>'doc_fee')::numeric
       OR v_a.website_sale_price IS DISTINCT FROM (v_a.details->'after'->>'website_sale_price')::numeric THEN
      v_problems := v_problems || v_a.id::text;
    END IF;
  END LOOP;
  IF cardinality(v_problems) > 0 THEN
    RAISE EXCEPTION 'revert refused, nothing written: changed since the correction: %', array_to_string(v_problems, ', ');
  END IF;
  FOR v_a IN
    SELECT a.entity_id::uuid AS id, a.store_id, a.details FROM public.audit_log a
    WHERE a.action = 'pricing_reconciliation_applied' AND a.details->>'batch_id' = v_batch
  LOOP
    UPDATE public.vehicle_listings
    SET price = (v_a.details->'before'->>'price')::numeric,
        advertised_price_before_doc = (v_a.details->'before'->>'advertised_price_before_doc')::numeric,
        doc_fee = (v_a.details->'before'->>'doc_fee')::numeric,
        website_sale_price = (v_a.details->'before'->>'website_sale_price')::numeric
    WHERE id = v_a.id;
    INSERT INTO public.audit_log (action, entity_type, entity_id, store_id, details)
    VALUES ('pricing_reconciliation_reverted', 'vehicle_listing', v_a.id::text, v_a.store_id,
            jsonb_build_object('batch_id', v_batch, 'restored', v_a.details->'before', 'from', v_a.details->'after'));
  END LOOP;
END
$revert$;

SELECT jsonb_build_object('result', 'REVERTED', 'batch_id', '__BATCH_ID__',
  'vehicles', (SELECT count(*) FROM public.audit_log WHERE action = 'pricing_reconciliation_reverted' AND details->>'batch_id' = '__BATCH_ID__')) AS result;
