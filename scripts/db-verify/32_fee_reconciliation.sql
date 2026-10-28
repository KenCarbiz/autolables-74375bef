-- The read-only reconciliation report (fee-basis-reconciliation.sql), run by
-- run.sh against the fixture and loaded here as CSV. It lists every vehicle
-- with a finding, proposes no automatic repricing, and writes nothing.

SELECT t.expect('fee reconciliation', 'the report changed no row (vehicle_listings checksum before = after)', 'owner',
  $q$SELECT (count(DISTINCT checksum) = 1 AND count(*) = 2)::text FROM t.recon_checksums$q$, 'true');
SELECT t.expect('fee reconciliation', 'a website price that disagrees with the advertised total is listed for review, not repriced', 'owner',
  $q$SELECT concat_ws('|', basis, action, findings, price, website_sale_price, policy_total) FROM t.recon WHERE kind = 'row' AND vin_suffix = '030000'$q$,
  'includes_fee|review source mismatch; observed prices kept, no automatic change|website_price_differs_from_total|30000.00|30500|30000.00');
SELECT t.expect('fee reconciliation', 'a before-fee price that does not add up to the total is listed for review, with the contract value shown but not applied', 'owner',
  $q$SELECT concat_ws('|', action, findings, before_fee, policy_before_fee, policy_total) FROM t.recon WHERE kind = 'row' AND vin_suffix = '020000'$q$,
  'review: before-fee price and total disagree; skipped by fee changes, no automatic change|derived_split_stale|20000|19105.00|20000.00');
SELECT t.expect('fee reconciliation', 'vehicles without a price are listed as having no basis (tenant suffixes)', 'owner',
  $q$SELECT string_agg(right(tenant_id::text, 1) || ':' || vin_suffix, ' ' ORDER BY tenant_id, vin_suffix) FROM t.recon WHERE kind = 'row' AND findings = 'no_basis'$q$,
  '1:000005 3:000000');
SELECT t.expect('fee reconciliation', 'consistent vehicles are counted, not listed (tenant:basis:count)', 'owner',
  $q$SELECT string_agg(right(tenant_id::text, 1) || ':' || basis || ':' || vehicles, ' ' ORDER BY tenant_id) FROM t.recon WHERE kind = 'summary' AND action = 'consistent'$q$,
  '1:before_fee:4 3:includes_fee:3');
