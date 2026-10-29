-- RESTRICTED per-vehicle pricing review. Read-only (READ ONLY transaction).
-- Lists every vehicle whose stored price fields disagree under the fee basis
-- contract, with the provenance of each field, the observation dates and a
-- recommended classification. It proposes corrections; it applies none.
--
-- The output names real vehicles and prices: keep it out of the repository
-- and share it only with the people who resolve the conflicts.
--
--   psql -X --csv -v tenant=<uuid> -f scripts/db-verify/fee-basis-vehicle-review.sql > review.csv
--
-- Provenance of a stored price, by actual writer (price_parse_notes is the
-- writer's own stamp; the observation tables are the evidence):
--   verified_website_observation  equals the latest website observation in
--                                 advertised_prices for the VIN
--   dealer_feed                   equals the feed record's price (mc_raw)
--   derived_calculation           before-fee + fee or total - fee, written by
--                                 the feed, the crawl or a reviewed apply
--   legacy_recalculation          last written by recalc_tenant_doc_fee
--   uncertain_provenance          none of the above can be shown
-- website_sale_price is never treated as website evidence just because of
-- its column name.
--
-- root_cause compares the latest website observation with the feed, which
-- catches a disagreement even after a feed write makes the stored fields
-- agree with each other:
--   double_fee_subtraction       the website shows total - fee (the feed says
--                                its price includes the fee) and the stored
--                                before-fee price is the website figure - fee
--   incentive_gap_suspected      new vehicle; website before-fee minus feed
--                                before-fee is a whole multiple of $500
--   repricing_after_feed_freeze  the website matched the feed before, and the
--                                latest website figure is newer than the feed
--   unexplained                  none of the above
\set ON_ERROR_STOP 1
\if :{?tenant}
\else
\set tenant ''
\endif
BEGIN TRANSACTION READ ONLY;

WITH settings AS (
  SELECT dp.tenant_id,
         CASE WHEN coalesce((dp.settings->>'doc_fee_enabled')::boolean, false)
              THEN round(coalesce((dp.settings->>'doc_fee_amount')::numeric, 0), 2) ELSE 0 END AS configured_fee,
         lower(btrim(dp.settings->>'advertised_includes_doc_fee')) AS inc,
         lower(btrim(dp.settings->>'advertised_excludes_doc_fee')) AS exc
  FROM public.dealer_profiles dp
  WHERE :'tenant' = '' OR dp.tenant_id::text = :'tenant'
), basis AS (
  -- Same rule as public.doc_fee_basis: only an explicit setting decides.
  SELECT tenant_id, configured_fee,
         CASE
           WHEN inc IN ('true','false') AND exc IN ('true','false') AND inc = exc THEN 'conflict'
           WHEN (inc IS NOT NULL AND inc NOT IN ('true','false')) OR (exc IS NOT NULL AND exc NOT IN ('true','false')) THEN 'unconfigured'
           WHEN inc = 'true' OR exc = 'false' THEN 'includes_fee'
           WHEN inc = 'false' OR exc = 'true' THEN 'before_fee'
           ELSE 'unconfigured'
         END AS basis
  FROM settings
), latest_web AS (
  SELECT DISTINCT ON (ap.tenant_id, upper(ap.vin))
         ap.tenant_id, upper(ap.vin) AS vin, ap.advertised_price AS web_price, ap.captured_at AS web_captured_at,
         ap.captured_method AS web_method, (ap.screenshot_url IS NOT NULL OR ap.screenshot_sha256 IS NOT NULL) AS web_screenshot
  FROM public.advertised_prices ap
  WHERE coalesce(ap.source_channel, 'website') = 'website'
  ORDER BY ap.tenant_id, upper(ap.vin), ap.captured_at DESC
), feed_seen_values AS (
  SELECT DISTINCT tenant_id, upper(vin) AS vin, advertised_price AS value
  FROM public.advertised_prices
  WHERE captured_method = 'marketcheck_syndication'
), web_counts AS (
  SELECT tenant_id, upper(vin) AS vin, count(*) AS web_observations, min(captured_at) AS web_first_at
  FROM public.advertised_prices
  WHERE coalesce(source_channel, 'website') = 'website'
  GROUP BY 1, 2
), rows AS (
  SELECT b.tenant_id, b.basis, b.configured_fee,
         l.id AS listing_id, l.vin, l.mc_attributes->>'stock_no' AS stock, l.status, l.archived_at,
         l.price, l.advertised_price_before_doc AS before_fee, l.doc_fee, l.website_sale_price,
         l.price_parse_status, left(l.price_parse_notes, 160) AS price_parse_notes,
         l.price_last_verified_at, l.price_recalculated_at, l.updated_at,
         nullif(l.mc_raw->>'price', '')::numeric AS feed_price,
         CASE WHEN coalesce(l.mc_raw->>'last_seen_at', l.mc_raw->>'scraped_at') ~ '^[0-9]+$'
              THEN to_timestamp(coalesce(l.mc_raw->>'last_seen_at', l.mc_raw->>'scraped_at')::bigint)
              ELSE nullif(coalesce(l.mc_raw->>'last_seen_at_date', l.mc_raw->>'scraped_at_date'), '')::timestamptz END AS feed_seen,
         w.web_price, w.web_captured_at, w.web_method, w.web_screenshot,
         coalesce(c.web_observations, 0) AS web_observations,
         l.condition, lower(coalesce(l.mc_raw->>'price_includes_fees', '')) = 'true' AS feed_includes_fees,
         EXISTS (SELECT 1 FROM public.advertised_prices o JOIN feed_seen_values fv ON fv.tenant_id = o.tenant_id AND fv.vin = upper(o.vin)
                 WHERE o.tenant_id = l.tenant_id AND upper(o.vin) = upper(l.vin) AND o.captured_method = 'dealer_vdp_observation'
                   AND abs(o.advertised_price - fv.value) < 1) AS website_matched_feed_before
  FROM basis b
  JOIN public.vehicle_listings l ON l.tenant_id = b.tenant_id
  LEFT JOIN latest_web w ON w.tenant_id = l.tenant_id AND w.vin = upper(l.vin)
  LEFT JOIN web_counts c ON c.tenant_id = l.tenant_id AND c.vin = upper(l.vin)
), judged AS (
  SELECT r.*,
    CASE
      WHEN r.price IS NULL THEN 'no_price'
      WHEN r.basis IN ('conflict', 'unconfigured') THEN 'basis_' || r.basis
      WHEN r.basis = 'includes_fee' AND r.price - r.configured_fee <= 0 THEN 'fee_exceeds_price'
      WHEN r.basis = 'includes_fee' AND r.before_fee IS NOT NULL AND abs(r.before_fee + coalesce(r.doc_fee, 0) - r.price) >= 0.01 THEN 'split_mismatch'
      WHEN r.basis = 'includes_fee' AND r.website_sale_price IS NOT NULL AND abs(r.website_sale_price - r.price) >= 0.01 THEN 'sale_price_field_differs'
      WHEN r.basis = 'before_fee' AND r.before_fee IS NOT NULL AND abs(r.price - r.before_fee) >= 0.01 THEN 'inventory_price_differs_from_before_fee'
      ELSE 'consistent'
    END AS disagreement,
    CASE WHEN r.price IS NULL THEN NULL
         WHEN r.feed_price IS NOT NULL AND abs(r.feed_price - r.price) < 1 THEN 'dealer_feed'
         WHEN r.web_price IS NOT NULL AND abs(r.web_price - r.price) < 1 THEN 'verified_website_observation'
         ELSE 'uncertain_provenance' END AS total_provenance,
    CASE WHEN r.before_fee IS NULL THEN NULL
         WHEN r.price_parse_notes LIKE 'Doc fee updated in admin%' THEN 'legacy_recalculation'
         WHEN r.web_price IS NOT NULL AND abs(r.web_price - r.before_fee) < 1 THEN 'verified_website_observation'
         WHEN r.web_price IS NOT NULL AND abs(r.web_price - coalesce(r.doc_fee, 0) - r.before_fee) < 1 THEN 'derived_calculation'
         WHEN r.feed_price IS NOT NULL AND abs(r.feed_price - r.before_fee) < 1 THEN 'dealer_feed'
         WHEN r.feed_price IS NOT NULL AND abs(r.feed_price - coalesce(r.doc_fee, 0) - r.before_fee) < 1 THEN 'derived_calculation'
         WHEN r.price_recalculated_at IS NOT NULL THEN 'derived_calculation'
         ELSE 'uncertain_provenance' END AS before_fee_provenance,
    CASE WHEN r.website_sale_price IS NULL THEN NULL
         WHEN r.price_parse_notes LIKE 'Doc fee updated in admin%' THEN 'legacy_recalculation'
         WHEN r.web_price IS NOT NULL AND abs(r.web_price - r.website_sale_price) < 1 THEN 'verified_website_observation'
         WHEN r.feed_price IS NOT NULL AND abs(r.feed_price - r.website_sale_price) < 1 THEN 'dealer_feed'
         WHEN r.before_fee IS NOT NULL AND abs(r.before_fee + coalesce(r.doc_fee, 0) - r.website_sale_price) < 0.01 THEN 'derived_calculation'
         ELSE 'uncertain_provenance' END AS sale_price_provenance,
    CASE
      WHEN r.price IS NULL OR r.web_price IS NULL THEN NULL
      WHEN r.feed_includes_fees AND coalesce(r.doc_fee, 0) > 0 AND abs(r.web_price - (r.price - r.doc_fee)) < 1
           AND r.before_fee IS NOT NULL AND abs(r.before_fee - (r.web_price - r.doc_fee)) < 1 THEN 'double_fee_subtraction'
      WHEN lower(coalesce(r.condition, '')) = 'new' AND abs(r.web_price - (r.price - coalesce(r.doc_fee, 0))) >= 1
           AND mod(round(r.web_price - (r.price - coalesce(r.doc_fee, 0))), 500) = 0 THEN 'incentive_gap_suspected'
      WHEN r.website_matched_feed_before AND abs(r.web_price - r.price) >= 1
           AND (r.feed_seen IS NULL OR r.web_captured_at > r.feed_seen) THEN 'repricing_after_feed_freeze'
      WHEN abs(r.web_price - r.price) < 1 THEN 'agrees'
      ELSE 'unexplained'
    END AS root_cause
  FROM rows r
)
SELECT
  CASE WHEN archived_at IS NULL THEN 1 ELSE 2 END AS priority,
  dense_rank() OVER (ORDER BY tenant_id) AS tenant_n, tenant_id, listing_id, vin, stock, status,
  archived_at IS NOT NULL AS archived, basis, configured_fee,
  price, before_fee, doc_fee, website_sale_price,
  round(coalesce(before_fee, 0) + coalesce(doc_fee, 0) - price, 2) AS split_minus_total,
  total_provenance, before_fee_provenance, sale_price_provenance,
  feed_price, feed_seen, web_price, web_captured_at, web_method, web_screenshot, web_observations,
  price_last_verified_at, price_recalculated_at, updated_at, price_parse_status, price_parse_notes,
  disagreement, root_cause, round(web_price - price, 2) AS website_minus_total,
  round(web_price - (price - coalesce(doc_fee, 0)), 2) AS website_minus_feed_before_fee,
  CASE
    WHEN archived_at IS NOT NULL THEN 'archived: left untouched; outside fee changes unless explicitly included'
    WHEN disagreement = 'no_price' THEN 'quarantined: no usable price; never corrected automatically'
    WHEN disagreement = 'fee_exceeds_price' THEN 'quarantined: the configured fee exceeds the stored total; confirm the real price with the dealer'
    WHEN disagreement LIKE 'basis_%' THEN 'set the dealership fee basis explicitly before reviewing this vehicle'
    WHEN root_cause = 'double_fee_subtraction' THEN 'A: derived before-fee price lost the fee twice; candidate correction of advertised_price_before_doc only'
    WHEN root_cause = 'incentive_gap_suspected' THEN 'B2: feed and website differ by a round amount on a new vehicle; incentive treatment to confirm; no change'
    WHEN root_cause = 'repricing_after_feed_freeze' THEN 'B1: the dealer page moved after the feed stopped; confirm the current price; no change'
    WHEN root_cause = 'unexplained' THEN 'F: check the dealer page and the feed manually; no change'
    ELSE 'consistent'
  END AS recommended_classification,
  CASE
    WHEN archived_at IS NULL AND root_cause = 'double_fee_subtraction' AND disagreement = 'split_mismatch'
      THEN jsonb_build_object('advertised_price_before_doc', jsonb_build_object('from', before_fee, 'to', round(price - doc_fee, 2)),
                              'unchanged', jsonb_build_array('price', 'doc_fee', 'website_sale_price'))
  END AS proposed_correction
FROM judged
WHERE disagreement <> 'consistent' OR coalesce(root_cause, 'agrees') <> 'agrees'
ORDER BY priority, tenant_n, recommended_classification, vin;

ROLLBACK;
