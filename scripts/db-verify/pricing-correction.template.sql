-- Guarded, reversible price-field correction. WRITES. Run only an approved
-- plan, through Lovable's SQL tool, as one statement. Paste-safe.
--
-- Replace __PLAN__ with the approved plan (JSON):
--   {"batch_id": "<unique id>", "approved_by": "<name>", "reason": "<why>",
--    "vehicles": [{"listing_id": "<uuid>",
--                  "expected": {"price": n, "advertised_price_before_doc": n, "doc_fee": n, "website_sale_price": n},
--                  "set": {"advertised_price_before_doc": n},
--                  "evidence": "<what proves the new value>"}]}
--
-- All or nothing: if any vehicle is archived, has no price, is not where the
-- plan expects it (any of the four fields moved since the review), or names a
-- field outside the four price fields, nothing is written and the reason is
-- raised. Verification stamps, parse status and notes are never touched. One
-- audit row per vehicle (pricing_reconciliation_applied) keeps before, after,
-- evidence and the batch id; pricing-correction-revert.template.sql undoes a
-- batch from those rows.
DO $correction$
DECLARE
  v_plan jsonb := $plan$__PLAN__$plan$::jsonb;
  v_item jsonb;
  v_row record;
  v_problems text[] := ARRAY[]::text[];
  v_fields constant text[] := ARRAY['price', 'advertised_price_before_doc', 'doc_fee', 'website_sale_price'];
  v_key text;
  v_before jsonb;
  v_after jsonb;
BEGIN
  IF coalesce(v_plan->>'batch_id', '') = '' OR coalesce(v_plan->>'approved_by', '') = '' THEN
    RAISE EXCEPTION 'correction refused: the plan needs a batch_id and approved_by';
  END IF;
  IF EXISTS (SELECT 1 FROM public.audit_log WHERE action = 'pricing_reconciliation_applied' AND details->>'batch_id' = v_plan->>'batch_id') THEN
    RAISE EXCEPTION 'correction refused: batch % was already applied', v_plan->>'batch_id';
  END IF;
  IF jsonb_array_length(coalesce(v_plan->'vehicles', '[]')) = 0 THEN
    RAISE EXCEPTION 'correction refused: the plan names no vehicle';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(v_plan->'vehicles') LOOP
    SELECT id, archived_at, price, advertised_price_before_doc, doc_fee, website_sale_price INTO v_row
      FROM public.vehicle_listings WHERE id = (v_item->>'listing_id')::uuid FOR UPDATE;
    IF NOT FOUND THEN v_problems := v_problems || format('%s: not found', v_item->>'listing_id'); CONTINUE; END IF;
    IF v_row.archived_at IS NOT NULL THEN v_problems := v_problems || format('%s: archived', v_row.id); END IF;
    IF v_row.price IS NULL THEN v_problems := v_problems || format('%s: no price (quarantined)', v_row.id); END IF;
    FOREACH v_key IN ARRAY v_fields LOOP
      IF NOT (v_item->'expected' ? v_key) THEN
        v_problems := v_problems || format('%s: expected value for %s missing', v_row.id, v_key);
      ELSIF (to_jsonb(v_row)->>v_key)::numeric IS DISTINCT FROM (v_item->'expected'->>v_key)::numeric THEN
        v_problems := v_problems || format('%s: %s is %s, the plan expected %s', v_row.id, v_key, to_jsonb(v_row)->>v_key, v_item->'expected'->>v_key);
      END IF;
    END LOOP;
    FOR v_key IN SELECT jsonb_object_keys(coalesce(v_item->'set', '{}')) LOOP
      IF NOT (v_key = ANY (v_fields)) THEN v_problems := v_problems || format('%s: %s is not a price field', v_row.id, v_key); END IF;
    END LOOP;
    IF coalesce(v_item->'set', '{}') = '{}'::jsonb THEN v_problems := v_problems || format('%s: nothing to set', v_row.id); END IF;
  END LOOP;
  IF cardinality(v_problems) > 0 THEN
    RAISE EXCEPTION 'correction refused, nothing written: %', array_to_string(v_problems, '; ');
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(v_plan->'vehicles') LOOP
    SELECT jsonb_build_object('price', price, 'advertised_price_before_doc', advertised_price_before_doc, 'doc_fee', doc_fee, 'website_sale_price', website_sale_price)
      INTO v_before FROM public.vehicle_listings WHERE id = (v_item->>'listing_id')::uuid;
    UPDATE public.vehicle_listings
    SET price = CASE WHEN v_item->'set' ? 'price' THEN (v_item->'set'->>'price')::numeric ELSE price END,
        advertised_price_before_doc = CASE WHEN v_item->'set' ? 'advertised_price_before_doc' THEN (v_item->'set'->>'advertised_price_before_doc')::numeric ELSE advertised_price_before_doc END,
        doc_fee = CASE WHEN v_item->'set' ? 'doc_fee' THEN (v_item->'set'->>'doc_fee')::numeric ELSE doc_fee END,
        website_sale_price = CASE WHEN v_item->'set' ? 'website_sale_price' THEN (v_item->'set'->>'website_sale_price')::numeric ELSE website_sale_price END
    WHERE id = (v_item->>'listing_id')::uuid
    RETURNING jsonb_build_object('price', price, 'advertised_price_before_doc', advertised_price_before_doc, 'doc_fee', doc_fee, 'website_sale_price', website_sale_price) INTO v_after;
    INSERT INTO public.audit_log (action, entity_type, entity_id, store_id, details)
    SELECT 'pricing_reconciliation_applied', 'vehicle_listing', l.id::text, l.tenant_id::text,
           jsonb_build_object('batch_id', v_plan->>'batch_id', 'approved_by', v_plan->>'approved_by', 'reason', v_plan->>'reason',
                              'before', v_before, 'after', v_after, 'evidence', v_item->>'evidence')
    FROM public.vehicle_listings l WHERE l.id = (v_item->>'listing_id')::uuid;
  END LOOP;
END
$correction$;

SELECT jsonb_build_object('result', 'APPLIED', 'batch_id', ($plan$__PLAN__$plan$::jsonb)->>'batch_id',
  'vehicles', (SELECT count(*) FROM public.audit_log WHERE action = 'pricing_reconciliation_applied'
               AND details->>'batch_id' = ($plan$__PLAN__$plan$::jsonb)->>'batch_id')) AS result;
