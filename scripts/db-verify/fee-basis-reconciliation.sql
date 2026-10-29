-- Read-only reconciliation summary: stored vehicle prices against the fee
-- basis contract (supabase/proposed/20261031000000_doc_fee_basis_policy_b.sql).
-- Runs inside a READ ONLY transaction and needs none of the proposed
-- functions, so it can run where they are not installed. It changes nothing
-- and proposes no automatic repricing. Per-vehicle provenance and dates are
-- in fee-basis-vehicle-review.sql (restricted output).
--
--   psql -X --csv -v tenant=<uuid> -f scripts/db-verify/fee-basis-reconciliation.sql
--
-- tenant is optional (every tenant when omitted). Output: one 'row' line per
-- vehicle with a finding, then one 'summary' line per tenant, basis and
-- action with its count (consistent vehicles are counted, not listed).
-- website_sale_price is called the stored sale price: its column name is not
-- evidence of where it came from.
\set ON_ERROR_STOP 1
\if :{?tenant}
\else
\set tenant ''
\endif
BEGIN TRANSACTION READ ONLY;

WITH tenant_settings AS (
  SELECT dp.tenant_id,
         CASE WHEN coalesce((dp.settings->>'doc_fee_enabled')::boolean, false)
              THEN round(coalesce((dp.settings->>'doc_fee_amount')::numeric, 0), 2) ELSE 0 END AS configured_fee,
         lower(btrim(dp.settings->>'advertised_includes_doc_fee')) AS inc,
         lower(btrim(dp.settings->>'advertised_excludes_doc_fee')) AS exc
  FROM public.dealer_profiles dp
  WHERE :'tenant' = '' OR dp.tenant_id::text = :'tenant'
), basis AS (
  -- Same rule as public.doc_fee_basis: only an explicit, readable setting decides.
  SELECT tenant_id, configured_fee,
         CASE
           WHEN (inc IS NOT NULL AND inc NOT IN ('true','false')) OR (exc IS NOT NULL AND exc NOT IN ('true','false')) THEN 'unconfigured'
           WHEN inc IN ('true','false') AND exc IN ('true','false') AND inc = exc THEN 'conflict'
           WHEN inc = 'true' OR (inc IS NULL AND exc = 'false') THEN 'includes_fee'
           WHEN inc = 'false' OR (inc IS NULL AND exc = 'true') THEN 'before_fee'
           ELSE 'unconfigured'
         END AS basis
  FROM tenant_settings
), rows AS (
  SELECT b.tenant_id, b.basis, b.configured_fee,
         l.id AS listing_id, right(l.vin, 6) AS vin_suffix, l.archived_at IS NOT NULL AS archived,
         l.price, l.advertised_price_before_doc AS before_fee, l.doc_fee, l.website_sale_price,
         (SELECT ap.advertised_price FROM public.advertised_prices ap
           WHERE ap.tenant_id = l.tenant_id AND upper(ap.vin) = upper(l.vin) AND coalesce(ap.source_channel, 'website') = 'website'
           ORDER BY ap.captured_at DESC LIMIT 1) AS observed
  FROM basis b
  JOIN public.vehicle_listings l ON l.tenant_id = b.tenant_id
), found AS (
  SELECT r.*,
         array_remove(ARRAY[
           CASE WHEN r.basis IN ('conflict', 'unconfigured') THEN 'basis_' || r.basis END,
           CASE WHEN r.basis = 'includes_fee' AND r.price IS NULL THEN 'no_basis'
                WHEN r.basis = 'before_fee' AND r.before_fee IS NULL THEN 'no_basis' END,
           CASE WHEN r.basis = 'includes_fee' AND r.price IS NOT NULL AND r.price - r.configured_fee <= 0 THEN 'fee_exceeds_price'
                WHEN r.basis = 'before_fee' AND r.before_fee IS NOT NULL AND r.before_fee <= 0 THEN 'fee_exceeds_price' END,
           CASE WHEN r.basis IN ('includes_fee', 'before_fee') AND (r.price IS NOT NULL OR r.before_fee IS NOT NULL)
                 AND r.doc_fee IS DISTINCT FROM r.configured_fee THEN 'fee_differs_from_policy' END,
           CASE WHEN r.basis = 'includes_fee' AND r.price IS NOT NULL AND r.before_fee IS NOT NULL
                 AND abs(r.before_fee + coalesce(r.doc_fee, 0) - r.price) >= 0.01 THEN 'split_mismatch'
                WHEN r.basis = 'before_fee' AND r.price IS NOT NULL AND r.before_fee IS NOT NULL
                 AND abs(r.price - r.before_fee) >= 0.01 THEN 'split_mismatch' END,
           CASE WHEN r.basis = 'before_fee' AND r.before_fee IS NOT NULL
                 AND r.website_sale_price IS DISTINCT FROM round(r.before_fee + coalesce(r.doc_fee, 0), 2) THEN 'derived_total_stale' END,
           CASE WHEN r.basis = 'includes_fee' AND r.price IS NOT NULL AND r.website_sale_price IS NOT NULL
                 AND abs(r.website_sale_price - r.price) >= 0.01 THEN 'sale_price_field_differs_from_total' END,
           CASE WHEN r.observed IS NOT NULL AND r.price IS NOT NULL AND coalesce(r.doc_fee, 0) > 0 AND (
                  (r.basis = 'includes_fee' AND abs(r.observed - r.price) >= 1
                    AND (abs(r.observed - (r.price + r.doc_fee)) < 1 OR abs(r.observed - (r.price - r.doc_fee)) < 1))
                  OR (r.basis = 'before_fee' AND abs(r.observed - (r.price - r.doc_fee)) < 1))
                THEN 'website_observation_contradicts_basis' END
         ], NULL) AS findings,
         CASE WHEN r.basis = 'includes_fee' AND r.price IS NOT NULL THEN round(r.price - r.configured_fee, 2)
              ELSE r.before_fee END AS policy_before_fee,
         CASE WHEN r.basis = 'includes_fee' THEN r.price
              WHEN r.basis = 'before_fee' AND r.before_fee IS NOT NULL THEN round(r.before_fee + r.configured_fee, 2) END AS policy_total
  FROM rows r
), classified AS (
  SELECT f.*,
         CASE
           WHEN findings && ARRAY['basis_conflict', 'basis_unconfigured'] THEN 'set the dealership fee basis explicitly first; no change'
           WHEN 'no_basis' = ANY (findings) THEN 'no price to anchor on; no change'
           WHEN 'fee_exceeds_price' = ANY (findings) THEN 'review: fee leaves no vehicle price; no change'
           WHEN findings && ARRAY['split_mismatch', 'sale_price_field_differs_from_total', 'website_observation_contradicts_basis']
             THEN 'review: stored prices disagree; blocks fee changes; no automatic change'
           WHEN cardinality(findings) > 0 THEN 'derived fields recomputable under the contract after approval'
           ELSE 'consistent'
         END AS action
  FROM found f
)
SELECT 'row' AS kind, tenant_id, basis, action, listing_id::text, vin_suffix, archived,
       price, before_fee, doc_fee, website_sale_price, observed, configured_fee, policy_before_fee, policy_total,
       array_to_string(findings, ';') AS findings, NULL::bigint AS vehicles
FROM classified
WHERE action <> 'consistent'
UNION ALL
SELECT 'summary', tenant_id, basis, action, NULL, NULL, NULL,
       NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, count(*)
FROM classified
GROUP BY tenant_id, basis, action
ORDER BY 1, 2, 4, 6;

ROLLBACK;
