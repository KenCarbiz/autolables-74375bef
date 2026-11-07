#!/usr/bin/env bash
# Two sessions map different dealer ids to the same store with the same loaded
# version. The first holds its transaction open; the second blocks on the row
# lock and, once the first commits, must be refused as stale. Synthetic data.
set -euo pipefail
DB="$1"
P="psql -v ON_ERROR_STOP=1 -qtA -d $DB"
S=00000000-0000-0000-0000-00000000e5a1
ADMIN=00000000-0000-0000-0000-00000000ad01
V=$($P -c "SELECT updated_at FROM dealer_stores WHERE id = '$S'")
EV="{\"source\":\"concurrency_test\",\"confirmed_destination\":\"$S\"}"
call() { echo "SELECT set_config('test.uid', '$ADMIN', false); SELECT inv_admin_map_provider_dealer('$S', '$1', 'map', '$V', '$EV', 'Concurrent mapping test');"; }
( { echo "BEGIN;"; call 7000001; echo "SELECT pg_sleep(2); COMMIT;"; } | $P >/dev/null ) &
A=$!
sleep 0.7
set +e
OUT_B=$(call 7000002 | $P 2>&1)
RC_B=$?
set -e
wait $A
fail() { echo "FAILED: $1" >&2; exit 1; }
[ "$RC_B" -ne 0 ] || fail "the second concurrent request was not refused"
echo "$OUT_B" | grep -q store_changed_since_loaded || fail "the second request failed for another reason: $OUT_B"
echo "ok  concurrent request with the same version is refused after the first commits"
IDS=$($P -c "SELECT dealer_store_mc_dealer_ids(provider_ids)::text FROM dealer_stores WHERE id = '$S'")
echo "$IDS" | grep -q 7000001 || fail "the first request did not land: $IDS"
echo "$IDS" | grep -q 7000002 && fail "the refused request changed the store: $IDS"
echo "ok  only the first request changed the store ($IDS)"
N=$($P -c "SELECT count(*) FROM store_provider_mapping_events WHERE provider_dealer_id IN ('7000001','7000002')")
[ "$N" = "1" ] || fail "expected exactly one recorded event, got $N"
echo "ok  exactly one mapping event recorded"
# Leave the fixture as it was: unmap through the same reviewed path.
V2=$($P -c "SELECT updated_at FROM dealer_stores WHERE id = '$S'")
$P -c "SELECT set_config('test.uid', '$ADMIN', false); SELECT inv_admin_map_provider_dealer('$S', '7000001', 'unmap', '$V2', '$EV', 'Concurrency test cleanup');" >/dev/null
echo "ok  cleanup unmap recorded"
