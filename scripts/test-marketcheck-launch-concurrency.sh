#!/usr/bin/env bash
# Concurrency checks for the MarketCheck launch gate, on the scratch database
# left by test-marketcheck-launch-sql.sh: 40 sessions race for a 10-call canary
# (exactly 10 admitted), and 12 sessions race to activate (exactly one wins).
set -euo pipefail
DB="${TEST_DB:-marketcheck_launch_test}"
case "$DB" in *prod*|postgres) echo "refusing database name $DB" >&2; exit 2;; esac
P="psql -v ON_ERROR_STOP=1 -qtA -d $DB"
ADMIN="00000000-0000-0000-0000-00000000a001"
HARTE="3f0f97f5-4151-4e32-88ef-e2d6fc5a3142"

$P -c "UPDATE marketcheck_launch_plans SET canary_max_calls = 10, hourly_call_ceiling = 1000, daily_call_ceiling = 5000, error_tripwire_per_hour = 1000 WHERE version = 1;
       UPDATE provider_call_budgets SET monthly_call_cap = 5000 WHERE provider = 'marketcheck';
       UPDATE provider_call_events SET at = at - interval '3 days' WHERE provider = 'marketcheck';
       UPDATE marketcheck_launch_control SET state = 'activating_canary', plan_version = 1, emergency_stop = false,
         active_store_ids = ARRAY['45cdc1e0-7e88-4b44-9d07-27369d74ab21']::uuid[], canary_started_at = now(), pilot_started_at = NULL WHERE id = 1;" >/dev/null
OUT="$(mktemp -d)"
for i in $(seq 1 40); do
  ( $P -c "SELECT pg_sleep(random() * 0.05); SELECT admitted FROM provider_call_admit_v2('marketcheck', 'neovin', 'marketcheck-sync', 'launch-2026-11-02', false, '$HARTE', NULL, 0)" > "$OUT/$i" ) &
done
wait
ADMITTED=$(cat "$OUT"/* | grep -c '^t$' || true)
rm -rf "$OUT"
STATE=$($P -c "SELECT state || ':' || COALESCE(paused_reason, '') FROM marketcheck_launch_control")
echo "canary race: admitted=$ADMITTED state=$STATE"
[ "$ADMITTED" = 10 ] && [ "$STATE" = "paused:canary_ceiling_reached" ] || { echo "CONCURRENCY TEST FAILED (canary ceiling)"; exit 1; }

# Activation race: back to OFF, then 12 simultaneous activations.
$P -c "SELECT set_config('test.uid', '$ADMIN', false); SELECT marketcheck_launch_rollback('ROLLBACK');
       UPDATE marketcheck_launch_plans SET canary_max_calls = 40 WHERE version = 1;
       UPDATE provider_call_events SET at = at - interval '3 days' WHERE provider = 'marketcheck';" >/dev/null
MARK=$($P -c "SELECT COALESCE(max(id), 0) FROM marketcheck_launch_events")
OUT="$(mktemp -d)"
for i in $(seq 1 12); do
  ( $P -c "SELECT marketcheck_launch_activate(1, 'START')->>'ok' FROM (SELECT set_config('test.uid', '$ADMIN', false)) s" > "$OUT/$i" 2>&1 ) &
done
wait
WON=$(cat "$OUT"/* | grep -c '^true$' || true)
rm -rf "$OUT"
ACTIVATED=$($P -c "SELECT count(*) FROM marketcheck_launch_events WHERE action = 'activate' AND result = 'ok' AND id > $MARK")
echo "activation race: winners=$WON audited=$ACTIVATED"
[ "$WON" = 1 ] && [ "$ACTIVATED" = 1 ] || { echo "CONCURRENCY TEST FAILED (activation)"; exit 1; }
echo "LAUNCH CONCURRENCY TEST PASSED"
