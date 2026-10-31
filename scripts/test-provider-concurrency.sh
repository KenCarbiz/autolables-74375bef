#!/usr/bin/env bash
# Concurrency check for provider_reserve: 40 parallel sessions race for a
# 10-call quota (no reserve). Exactly 10 must be admitted. Uses the scratch
# database left by test-inventory-network-sql.sh.
set -euo pipefail
DB="${TEST_DB:-inventory_network_test}"
case "$DB" in *prod*|postgres) echo "refusing database name $DB" >&2; exit 2;; esac
P="psql -v ON_ERROR_STOP=1 -qtA -d $DB"
$P -c "UPDATE provider_requests SET status = 'released', quota_units = 0 WHERE account_ref = 'marketcheck_primary';
       UPDATE provider_accounts SET monthly_call_quota = 10, protected_reserve = 0, priority_floors = '{}', monthly_usd_cap = NULL,
         rate_limit_per_minute = 1000, provider_reported_used = NULL, provider_reported_remaining = NULL WHERE account_ref = 'marketcheck_primary';" >/dev/null
OUT="$(mktemp -d)"
for i in $(seq 1 40); do
  ( $P -c "SELECT pg_sleep(random() * 0.05); SELECT provider_reserve('marketcheck_primary', 'neovin', 'race', 'concurrency', 1, NULL, NULL, 'RACE$(printf %013d "$i")')->>'reserved'" > "$OUT/$i" ) &
done
wait
ADMITTED=$(cat "$OUT"/* | grep -c '^true$' || true)
DB_ADMITTED=$($P -c "SELECT count(*) FROM provider_requests WHERE caller = 'race' AND status = 'reserved'")
rm -rf "$OUT"
echo "admitted=$ADMITTED recorded=$DB_ADMITTED"
[ "$ADMITTED" = 10 ] && [ "$DB_ADMITTED" = 10 ] || { echo "CONCURRENCY TEST FAILED"; exit 1; }

# Same VIN and product from 20 sessions at once: one call, the rest join it.
$P -c "UPDATE provider_requests SET status = 'released', quota_units = 0 WHERE account_ref = 'marketcheck_primary'" >/dev/null
for i in $(seq 1 20); do
  ( $P -c "SELECT provider_reserve('marketcheck_primary', 'neovin', 'dupe', 'concurrency', 1, NULL, NULL, 'DUPE0000000000001')->>'reserved'" >/dev/null ) &
done
wait
LIVE=$($P -c "SELECT count(*) FROM provider_requests WHERE caller = 'dupe' AND status = 'reserved'")
JOINED=$($P -c "SELECT count(*) FROM provider_requests WHERE caller = 'dupe' AND status = 'joined'")
echo "duplicate live=$LIVE joined=$JOINED"
[ "$LIVE" = 1 ] && [ "$JOINED" = 19 ] && echo "CONCURRENCY TEST PASSED" || { echo "CONCURRENCY TEST FAILED"; exit 1; }
