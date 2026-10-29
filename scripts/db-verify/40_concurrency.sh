#!/usr/bin/env bash
# Two real sessions against the throwaway verification database, committing:
# concurrent applies with different review keys, then with the same key.
# Runs last (it moves Third Example Motors to a $925 fee for good), then
# exports the reloaded rows and dry-runs for the screen tests.
#
#   scripts/db-verify/40_concurrency.sh <db> <export.json>
set -euo pipefail
DB=$1
EXPORT=$2
PSQL=(psql -X -q -At -v ON_ERROR_STOP=1 -U "${PGUSER:-postgres}" -d "$DB")
T3=b0000000-0000-4000-8000-000000000003
TMP=$(mktemp -d)

apply_in_session() { # <outfile> <delay-before> <hold-after> <fee> <version> <key>
  sleep "$2"
  "${PSQL[@]}" -c "BEGIN" -c "SELECT t.become('fee_owner')" \
    -c "SELECT (public.admin_doc_fee_change_apply('$T3', true, $4, $5, '$6'))->>'status'" \
    -c "SELECT pg_sleep($3)" -c "COMMIT" 2>&1 | grep -vE '^$|^ *$' | head -2 | tail -1 > "$1"
}
record() { # <label> <expected> <actual>
  "${PSQL[@]}" -c "INSERT INTO t.results (area, label, principal, expected, actual, pass)
                   VALUES ('concurrency', \$l\$$1\$l\$, 'fee_owner', \$e\$$2\$e\$, \$a\$$3\$a\$, \$e\$$2\$e\$ = \$a\$$3\$a\$)"
}
state() { "${PSQL[@]}" -c "SELECT concat_ws('|', (SELECT doc_fee FROM public.vehicle_listings WHERE id = 'c0000000-0000-4000-8000-000000000301'),
  (SELECT policy_version FROM public.dealer_profiles WHERE tenant_id = '$T3'),
  (SELECT string_agg(idempotency_key, ',' ORDER BY created_at, idempotency_key) FROM public.admin_policy_applications WHERE tenant_id = '$T3'),
  (SELECT count(*) FROM public.vehicle_listings WHERE tenant_id = '$T3' AND archived_at IS NULL AND price IS NOT NULL AND price - doc_fee <> advertised_price_before_doc))"; }

# Different keys on the same reviewed version: the first holds the profile
# lock; the second waits, then finds the version moved.
apply_in_session "$TMP/a" 0 3 925 1 conc-a-000001 &
apply_in_session "$TMP/b" 1 0 950 1 conc-b-000001 &
wait
record 'two reviews of the same version applied at once: the first applies, the second waits and conflicts (first|second)' 'applied|conflict' "$(cat "$TMP/a")|$(cat "$TMP/b")"
record 'after them: one fee, one version step, one ledger row, every split adds up (fee|version|keys|rows off)' '925.00|2|conc-a-000001|0' "$(state)"

# The same key twice at once: the second waits on the lock and is answered
# from the ledger as a duplicate.
apply_in_session "$TMP/c" 0 3 940 2 conc-c-000001 &
apply_in_session "$TMP/d" 1 0 940 2 conc-c-000001 &
wait
record 'the same review key applied twice at once: applied once, answered once as a duplicate (first|second)' 'applied|duplicate' "$(cat "$TMP/c")|$(cat "$TMP/d")"
record 'after them: one more version step and one more ledger row (fee|version|keys|rows off)' '940.00|3|conc-a-000001,conc-c-000001|0' "$(state)"

# Back to the traced fee, then export what a reload reads.
apply_in_session "$TMP/e" 0 0 925 3 conc-e-000001
record 'a third review on the current version applies' 'applied' "$(cat "$TMP/e")"

"${PSQL[@]}" -c "BEGIN" -c "SELECT t.become('fee_owner')" -c "SELECT jsonb_build_object(
    'tenant', 'Third Example Motors (synthetic)',
    'settings', (SELECT settings - 'dealer_name' FROM public.dealer_profiles WHERE tenant_id = '$T3'),
    'rows', (SELECT jsonb_agg(jsonb_build_object('vin_suffix', right(vin, 6), 'condition', condition, 'archived', archived_at IS NOT NULL,
               'price', price, 'advertised_price_before_doc', advertised_price_before_doc, 'doc_fee', doc_fee, 'website_sale_price', website_sale_price) ORDER BY vin)
             FROM public.vehicle_listings WHERE tenant_id = '$T3'),
    'preview_at_saved_fee', public.admin_doc_fee_change_preview('$T3', true, 925) - 'computed_at',
    'preview_draft_950', public.admin_doc_fee_change_preview('$T3', true, 950) - 'computed_at')" -c "ROLLBACK" \
  | grep '^{' | python3 -c 'import json,sys; print(json.dumps(json.load(sys.stdin), indent=1, sort_keys=True))' > "$EXPORT"
rm -rf "$TMP"
