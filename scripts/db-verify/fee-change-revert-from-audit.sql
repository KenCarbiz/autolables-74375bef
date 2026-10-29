-- Revert one policy B fee change from its own audit row. WRITES. Use only
-- under an authorized rollback, after the code rollback or with it.
--
--   psql -X -v audit_id=<doc_fee_policy_applied audit_log id> -f scripts/db-verify/fee-change-revert-from-audit.sql
--
-- For every vehicle in the audit row's "changes", the before values are put
-- back only where the row still holds exactly the after values, so a price
-- the feed or the crawl wrote since then is never overwritten; such rows are
-- listed and left alone. The dealership fee setting is put back the same way.
-- Verification stamps, parse status and notes are not touched. One audit row
-- records what was reverted and what was skipped.
\set ON_ERROR_STOP 1
BEGIN;

CREATE TEMP TABLE revert_src ON COMMIT DROP AS
SELECT a.id AS audit_id, a.store_id::uuid AS tenant_id, a.details
FROM public.audit_log a
WHERE a.id = :'audit_id'::uuid AND a.action = 'doc_fee_policy_applied';

DO $$
BEGIN
  IF (SELECT count(*) FROM revert_src) <> 1 THEN
    RAISE EXCEPTION 'no doc_fee_policy_applied audit row with that id';
  END IF;
END $$;

CREATE TEMP TABLE revert_rows ON COMMIT DROP AS
SELECT (c->>'listing_id')::uuid AS listing_id, c->>'vin_suffix' AS vin_suffix, c->'before' AS before, c->'after' AS after,
       (l.advertised_price_before_doc IS NOT DISTINCT FROM (c->'after'->>'advertised_price_before_doc')::numeric
        AND l.doc_fee IS NOT DISTINCT FROM (c->'after'->>'doc_fee')::numeric
        AND l.website_sale_price IS NOT DISTINCT FROM (c->'after'->>'website_sale_price')::numeric
        AND l.price IS NOT DISTINCT FROM (c->'after'->>'price')::numeric) AS untouched_since
FROM revert_src s
CROSS JOIN LATERAL jsonb_array_elements(s.details->'changes') c
JOIN public.vehicle_listings l ON l.id = (c->>'listing_id')::uuid;

UPDATE public.vehicle_listings l
SET advertised_price_before_doc = (r.before->>'advertised_price_before_doc')::numeric,
    doc_fee = (r.before->>'doc_fee')::numeric,
    website_sale_price = (r.before->>'website_sale_price')::numeric,
    price_recalculated_at = now()
FROM revert_rows r
WHERE l.id = r.listing_id AND r.untouched_since;

UPDATE public.dealer_profiles dp
SET settings = dp.settings
      || jsonb_build_object('doc_fee_enabled', s.details->'prev'->'doc_fee_enabled', 'doc_fee_amount', s.details->'prev'->'doc_fee_amount')
FROM revert_src s
WHERE dp.tenant_id = s.tenant_id
  AND dp.settings->'doc_fee_enabled' IS NOT DISTINCT FROM s.details->'next'->'doc_fee_enabled'
  AND dp.settings->'doc_fee_amount' IS NOT DISTINCT FROM s.details->'next'->'doc_fee_amount';

INSERT INTO public.audit_log (action, entity_type, entity_id, store_id, details)
SELECT 'doc_fee_policy_reverted', 'tenant', s.tenant_id::text, s.tenant_id::text,
       jsonb_build_object('reverted_audit_id', s.audit_id,
         'reverted', (SELECT coalesce(jsonb_agg(vin_suffix ORDER BY vin_suffix), '[]') FROM revert_rows WHERE untouched_since),
         'skipped_changed_since', (SELECT coalesce(jsonb_agg(vin_suffix ORDER BY vin_suffix), '[]') FROM revert_rows WHERE NOT untouched_since))
FROM revert_src s;

SELECT vin_suffix, CASE WHEN untouched_since THEN 'reverted' ELSE 'skipped: changed since the apply' END AS outcome
FROM revert_rows ORDER BY vin_suffix;

COMMIT;
