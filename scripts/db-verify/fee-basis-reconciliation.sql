-- Read-only reconciliation report: stored vehicle prices against the fee
-- basis contract (supabase/proposed/20261031000000_doc_fee_basis_policy_b.sql).
-- Runs inside a READ ONLY transaction and needs none of the proposed
-- functions, so it can run where they are not installed. It changes nothing
-- and proposes no automatic repricing: a website price that disagrees with
-- the advertised total is listed for a person to review, not resolved.
--
--   psql -X --csv -v tenant=<uuid> -f scripts/db-verify/fee-basis-reconciliation.sql
--
-- tenant is optional (every tenant when omitted). Output: one 'row' line per
-- vehicle with a finding, then one 'summary' line per tenant, basis and
-- action with its count (consistent vehicles are counted, not listed).
\set ON_ERROR_STOP 1
\if :{?tenant}
\else
\set tenant ''
\endif
BEGIN TRANSACTION READ ONLY;

WITH tenant_basis AS (
  SELECT dp.tenant_id,
         CASE WHEN coalesce((dp.settings->>'doc_fee_enabled')::boolean, false)
              THEN round(coalesce((dp.settings->>'doc_fee_amount')::numeric, 0), 2) ELSE 0 END AS configured_fee,
         lower(btrim(dp.settings->>'advertised_includes_doc_fee')) AS inc,
         lower(btrim(dp.settings->>'advertised_excludes_doc_fee')) AS exc,
         dp.settings->>'price_display_mode' AS mode
  FROM public.dealer_profiles dp
  WHERE :'tenant' = '' OR dp.tenant_id::text = :'tenant'
), basis AS (
  -- Same rule as public.doc_fee_basis.
  SELECT tenant_id, configured_fee,
         CASE
           WHEN inc IN ('true','false') AND exc IN ('true','false') AND inc = exc THEN 'conflict'
           WHEN inc = 'true' THEN 'includes_fee'
           WHEN inc = 'false' THEN 'before_fee'
           WHEN exc = 'true' THEN 'before_fee'
           WHEN exc = 'false' THEN 'includes_fee'
           WHEN mode = 'website_sale_price' THEN 'includes_fee'
           ELSE 'before_fee'
         END AS basis,
         CASE
           WHEN inc IN ('true','false') AND exc IN ('true','false') AND inc = exc THEN 'settings_conflict'
           WHEN inc IN ('true','false') THEN 'advertised_includes_doc_fee'
           WHEN exc IN ('true','false') THEN 'advertised_excludes_doc_fee'
           ELSE 'price_display_mode'
         END AS basis_source
  FROM tenant_basis
), rows AS (
  SELECT b.tenant_id, b.basis, b.basis_source, b.configured_fee,
         l.id AS listing_id, right(l.vin, 6) AS vin_suffix, l.archived_at IS NOT NULL AS archived,
         l.price, l.advertised_price_before_doc AS before_fee, l.doc_fee, l.website_sale_price,
         array_remove(ARRAY[
           CASE WHEN b.basis = 'conflict' THEN 'basis_conflict' END,
           CASE WHEN b.basis = 'includes_fee' AND l.price IS NULL THEN 'no_basis'
                WHEN b.basis = 'before_fee' AND l.advertised_price_before_doc IS NULL THEN 'no_basis' END,
           CASE WHEN b.basis = 'includes_fee' AND l.price IS NOT NULL AND l.price - b.configured_fee <= 0 THEN 'fee_exceeds_price'
                WHEN b.basis = 'before_fee' AND l.advertised_price_before_doc IS NOT NULL AND l.advertised_price_before_doc <= 0 THEN 'fee_exceeds_price' END,
           CASE WHEN (l.price IS NOT NULL OR l.advertised_price_before_doc IS NOT NULL)
                 AND l.doc_fee IS DISTINCT FROM b.configured_fee THEN 'fee_differs_from_policy' END,
           CASE WHEN b.basis = 'includes_fee' AND l.price IS NOT NULL
                 AND l.advertised_price_before_doc IS DISTINCT FROM round(l.price - coalesce(l.doc_fee, 0), 2) THEN 'derived_split_stale'
                WHEN b.basis = 'before_fee' AND l.advertised_price_before_doc IS NOT NULL
                 AND l.website_sale_price IS DISTINCT FROM round(l.advertised_price_before_doc + coalesce(l.doc_fee, 0), 2) THEN 'derived_total_stale' END,
           CASE WHEN b.basis = 'includes_fee' AND l.price IS NOT NULL AND l.website_sale_price IS NOT NULL
                 AND abs(l.website_sale_price - l.price) >= 0.01 THEN 'website_price_differs_from_total'
                WHEN b.basis = 'before_fee' AND l.price IS NOT NULL AND l.advertised_price_before_doc IS NOT NULL
                 AND abs(l.price - l.advertised_price_before_doc) >= 0.01 THEN 'inventory_price_differs_from_before_fee' END
         ], NULL) AS findings,
         CASE WHEN b.basis = 'includes_fee' AND l.price IS NOT NULL THEN round(l.price - b.configured_fee, 2)
              ELSE l.advertised_price_before_doc END AS policy_before_fee,
         CASE WHEN b.basis = 'includes_fee' THEN l.price
              WHEN l.advertised_price_before_doc IS NOT NULL THEN round(l.advertised_price_before_doc + b.configured_fee, 2) END AS policy_total
  FROM basis b
  JOIN public.vehicle_listings l ON l.tenant_id = b.tenant_id
), classified AS (
  SELECT r.*,
         CASE
           WHEN 'basis_conflict' = ANY (findings) THEN 'resolve the fee basis setting first; no change'
           WHEN 'no_basis' = ANY (findings) THEN 'no price to anchor on; no change'
           WHEN 'fee_exceeds_price' = ANY (findings) THEN 'review: fee leaves no vehicle price; no change'
           WHEN 'website_price_differs_from_total' = ANY (findings) OR 'inventory_price_differs_from_before_fee' = ANY (findings)
             THEN 'review source mismatch; observed prices kept, no automatic change'
           WHEN 'derived_split_stale' = ANY (findings)
             THEN 'review: before-fee price and total disagree; skipped by fee changes, no automatic change'
           WHEN cardinality(findings) > 0 THEN 'derived fields recomputable under the contract after approval'
           ELSE 'consistent'
         END AS action
  FROM rows r
)
SELECT 'row' AS kind, tenant_id, basis, basis_source, action, listing_id::text, vin_suffix, archived,
       price, before_fee, doc_fee, website_sale_price, configured_fee, policy_before_fee, policy_total,
       array_to_string(findings, ';') AS findings, NULL::bigint AS vehicles
FROM classified
WHERE action <> 'consistent'
UNION ALL
SELECT 'summary', tenant_id, basis, basis_source, action, NULL, NULL, NULL,
       NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, count(*)
FROM classified
GROUP BY tenant_id, basis, basis_source, action
ORDER BY 1, 2, 5, 7;

ROLLBACK;
