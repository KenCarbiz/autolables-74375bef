#!/usr/bin/env bash
# Root-cause review and guarded correction on synthetic look-alikes of the
# October 2026 classes (05_root_cause_fixture.sql). Commits to the throwaway
# verification database only; every outcome is recorded in t.results.
#
#   scripts/db-verify/43_root_cause_and_correction.sh <db>
set -euo pipefail
DB=$1
PSQL=(psql -X -q -At -v ON_ERROR_STOP=1 -U "${PGUSER:-postgres}" -d "$DB")
T5=b0000000-0000-4000-8000-000000000005
TMP=$(mktemp -d)
record() { # <area> <label> <expected> <actual>
  "${PSQL[@]}" -c "INSERT INTO t.results (area, label, principal, expected, actual, pass)
    VALUES (\$a\$$1\$a\$, \$l\$$2\$l\$, 'postgres', \$e\$$3\$e\$, \$x\$$4\$x\$, \$e\$$3\$e\$ = \$x\$$4\$x\$)"
}
q() { "${PSQL[@]}" -c "$1"; }
vrow() { q "SELECT concat_ws('|', price, advertised_price_before_doc, doc_fee, website_sale_price) FROM public.vehicle_listings WHERE id = '$1'"; }
review() { # loads the read-only review for Fifth Example Motors into t.review
  psql -X -q --csv -v ON_ERROR_STOP=1 -U "${PGUSER:-postgres}" -d "$DB" -v tenant="$T5" -f scripts/db-verify/fee-basis-vehicle-review.sql > "$TMP/review.csv"
  local cols; cols=$(head -1 "$TMP/review.csv" | sed 's/,/ text, /g; s/$/ text/')
  q "DROP TABLE IF EXISTS t.review; CREATE TABLE t.review ($cols)"
  "${PSQL[@]}" -c "\\copy t.review FROM '$TMP/review.csv' WITH CSV HEADER"
}
render() { # <template> <placeholder> <value> <out>
  python3 -c 'import sys; t=open(sys.argv[1]).read(); open(sys.argv[4],"w").write(t.replace(sys.argv[2], sys.argv[3]))' "$1" "$2" "$3" "$4"
}
runsql() { "${PSQL[@]}" -f "$1" 2>&1 || true; }   # a refusal is an expected outcome
runjson() { runsql "$1" | grep '^{' || echo 'no result'; }

q "UPDATE t.config SET stage = 'root cause'"
"${PSQL[@]}" -f scripts/db-verify/05_root_cause_fixture.sql >/dev/null

# ── Root cause, read-only ──────────────────────────────────────────────────
before=$(q "SELECT md5(string_agg(v::text, ',' ORDER BY id)) FROM public.vehicle_listings v")
review
after=$(q "SELECT md5(string_agg(v::text, ',' ORDER BY id)) FROM public.vehicle_listings v")
record 'root cause' 'the review writes nothing' "$before" "$after"
record 'root cause' 'each pattern is named (vin suffix:root cause)' '050501:double_fee_subtraction 050502:incentive_gap_suspected 050503:repricing_after_feed_freeze' \
  "$(q "SELECT string_agg(right(vin, 6) || ':' || root_cause, ' ' ORDER BY vin) FROM t.review WHERE root_cause <> ''")"
record 'root cause' 'only class A gets a candidate correction, on the before-fee price alone' '050501:{"to": 60000.00, "from": 59105}' \
  "$(q "SELECT string_agg(right(vin, 6) || ':' || (proposed_correction::jsonb->'advertised_price_before_doc')::text, ' ') FROM t.review WHERE proposed_correction <> ''")"
record 'root cause' 'archived and unpriced vehicles are reported, not proposed for change' \
  '050504:archived: left untouched; outside fee changes unless explicitly included 050505:quarantined: no usable price; never corrected automatically' \
  "$(q "SELECT string_agg(right(vin, 6) || ':' || recommended_classification, ' ' ORDER BY vin) FROM t.review WHERE right(vin, 6) IN ('050504', '050505')")"
record 'root cause' 'a consistent vehicle whose page agrees with the feed is not listed' '0' "$(q "SELECT count(*) FROM t.review WHERE right(vin, 6) = '050506'")"

# A feed refresh that rewrites the stored fields of the B2 vehicle so they
# agree with each other must not hide that the page disagrees with the feed.
q "UPDATE public.vehicle_listings SET advertised_price_before_doc = price - 895, website_sale_price = price WHERE id = 'c0000000-0000-4000-8000-000000000502'"
review
record 'root cause' 'after a feed write that makes the stored fields agree, the website-versus-feed gap is still reported (disagreement|root cause|gap)' \
  'consistent|incentive_gap_suspected|10000.00' \
  "$(q "SELECT concat_ws('|', disagreement, root_cause, website_minus_feed_before_fee) FROM t.review WHERE right(vin, 6) = '050502'")"
q "UPDATE public.vehicle_listings SET advertised_price_before_doc = 89105, website_sale_price = 90000 WHERE id = 'c0000000-0000-4000-8000-000000000502'"

# ── Guarded correction and its reverse ─────────────────────────────────────
A='{"listing_id": "c0000000-0000-4000-8000-000000000501", "expected": {"price": 60895, "advertised_price_before_doc": 59105, "doc_fee": 895, "website_sale_price": 60000}, "set": {"advertised_price_before_doc": 60000}, "evidence": "page 60000 = feed 60895 - fee 895; feed price_includes_fees"}'
plan() { echo "{\"batch_id\": \"$1\", \"approved_by\": \"owner (synthetic)\", \"reason\": \"class A\", \"vehicles\": [$2]}"; }
stamps() { q "SELECT concat_ws('|', coalesce(price_last_verified_at::text, 'null'), price_parse_status, left(price_parse_notes, 20), coalesce(price_recalculated_at::text, 'null')) FROM public.vehicle_listings WHERE id = 'c0000000-0000-4000-8000-000000000501'"; }
STAMPS0=$(stamps)

render scripts/db-verify/pricing-correction.template.sql __PLAN__ "$(plan rc-batch-0001 "$A")" "$TMP/apply1.sql"
record 'correction' 'an approved class A plan applies' '{"result": "APPLIED", "batch_id": "rc-batch-0001", "vehicles": 1}' "$(runjson "$TMP/apply1.sql")"
record 'correction' 'only the before-fee price moved (price|before-fee|fee|sale price)' '60895.00|60000|895|60000' "$(vrow c0000000-0000-4000-8000-000000000501)"
record 'correction' 'verification stamp, parse status, notes and recalculation stamp untouched' "$STAMPS0" "$(stamps)"
record 'correction' 'the audit row keeps before, after and evidence' '59105>60000|page 60000 = feed 60895 - fee 895; feed price_includes_fees' \
  "$(q "SELECT (details->'before'->>'advertised_price_before_doc') || '>' || (details->'after'->>'advertised_price_before_doc') || '|' || (details->>'evidence') FROM public.audit_log WHERE action = 'pricing_reconciliation_applied' AND details->>'batch_id' = 'rc-batch-0001'")"
record 'correction' 'the same batch cannot be applied twice' 'refused' "$(runsql "$TMP/apply1.sql" | grep -q 'already applied' && echo refused || echo applied)"

render scripts/db-verify/pricing-correction-revert.template.sql __BATCH_ID__ rc-batch-0001 "$TMP/revert1.sql"
record 'correction' 'the batch reverts' '{"result": "REVERTED", "batch_id": "rc-batch-0001", "vehicles": 1}' "$(runjson "$TMP/revert1.sql")"
record 'correction' 'after the revert the row is exactly as before' '60895.00|59105|895|60000' "$(vrow c0000000-0000-4000-8000-000000000501)"
record 'correction' 'a batch cannot be reverted twice' 'refused' "$(runsql "$TMP/revert1.sql" | grep -q 'already reverted' && echo refused || echo reverted)"

STALE='{"listing_id": "c0000000-0000-4000-8000-000000000501", "expected": {"price": 60895, "advertised_price_before_doc": 59000, "doc_fee": 895, "website_sale_price": 60000}, "set": {"advertised_price_before_doc": 60000}, "evidence": "stale"}'
render scripts/db-verify/pricing-correction.template.sql __PLAN__ "$(plan rc-batch-0002 "$STALE")" "$TMP/apply2.sql"
record 'correction' 'a plan made against values that have since moved is refused, nothing written' 'refused|60895.00|59105|895|60000' \
  "$(runsql "$TMP/apply2.sql" | grep -q 'the plan expected' && echo -n refused || echo -n applied)|$(vrow c0000000-0000-4000-8000-000000000501)"

QUAR='{"listing_id": "c0000000-0000-4000-8000-000000000504", "expected": {"price": 12000, "advertised_price_before_doc": 12000, "doc_fee": 895, "website_sale_price": 12895}, "set": {"advertised_price_before_doc": 11105}, "evidence": "x"}, {"listing_id": "c0000000-0000-4000-8000-000000000505", "expected": {"price": null, "advertised_price_before_doc": null, "doc_fee": null, "website_sale_price": null}, "set": {"price": 1}, "evidence": "x"}'
render scripts/db-verify/pricing-correction.template.sql __PLAN__ "$(plan rc-batch-0003 "$A, $QUAR")" "$TMP/apply3.sql"
out3=$(runsql "$TMP/apply3.sql")
record 'correction' 'a plan touching an archived or unpriced vehicle is refused whole, the good vehicle included (archived|quarantined|row 501)' \
  'archived|quarantined|60895.00|59105|895|60000' \
  "$(grep -q ': archived' <<<"$out3" && echo -n archived || echo -n missing)|$(grep -q 'no price (quarantined)' <<<"$out3" && echo -n quarantined || echo -n missing)|$(vrow c0000000-0000-4000-8000-000000000501)"

BADFIELD='{"listing_id": "c0000000-0000-4000-8000-000000000501", "expected": {"price": 60895, "advertised_price_before_doc": 59105, "doc_fee": 895, "website_sale_price": 60000}, "set": {"mc_raw": 1}, "evidence": "x"}'
render scripts/db-verify/pricing-correction.template.sql __PLAN__ "$(plan rc-batch-0004 "$BADFIELD")" "$TMP/apply4.sql"
record 'correction' 'a plan naming a non-price field is refused' 'refused' "$(runsql "$TMP/apply4.sql" | grep -q 'not a price field' && echo refused || echo applied)"

render scripts/db-verify/pricing-correction.template.sql __PLAN__ "$(plan rc-batch-0005 "$A")" "$TMP/apply5.sql"
runsql "$TMP/apply5.sql" >/dev/null
q "UPDATE public.vehicle_listings SET website_sale_price = 60895 WHERE id = 'c0000000-0000-4000-8000-000000000501'"
render scripts/db-verify/pricing-correction-revert.template.sql __BATCH_ID__ rc-batch-0005 "$TMP/revert5.sql"
record 'correction' 'a revert after a later write is refused, nothing written (refused|row)' 'refused|60895.00|60000|895|60895' \
  "$(runsql "$TMP/revert5.sql" | grep -q 'changed since the correction' && echo -n refused || echo -n reverted)|$(vrow c0000000-0000-4000-8000-000000000501)"
q "UPDATE public.vehicle_listings SET advertised_price_before_doc = 59105, website_sale_price = 60000 WHERE id = 'c0000000-0000-4000-8000-000000000501'"
rm -rf "$TMP"
