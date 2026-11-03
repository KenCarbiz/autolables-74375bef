#!/usr/bin/env bash
# Concurrency checks for the MarketCheck launch gate, on the scratch database
# left by test-marketcheck-launch-sql.sh: 40 sessions race for a 10-call canary
# (exactly 10 admitted), 30 race for one vehicle's two-call allowance (exactly
# two), 10 dispatcher runs race (one batch), 12 sessions race to activate (one wins), and
# 12 sessions race to add the same rooftop (exactly one wins).
set -euo pipefail
DB="${TEST_DB:-marketcheck_launch_test}"
case "$DB" in *prod*|postgres) echo "refusing database name $DB" >&2; exit 2;; esac
P="psql -v ON_ERROR_STOP=1 -qtA -d $DB"
ADMIN="00000000-0000-0000-0000-00000000a001"
HARTE="3f0f97f5-4151-4e32-88ef-e2d6fc5a3142"

# The ceiling itself, with the workload requirement lifted so 40 sessions can
# race for the same canary VIN.
$P -c "CREATE TABLE IF NOT EXISTS saved_workload AS SELECT workload FROM marketcheck_launch_plans WHERE version = 1;
       UPDATE marketcheck_launch_plans SET workload = NULL, canary_max_calls = 10, hourly_call_ceiling = 1000, daily_call_ceiling = 5000, error_tripwire_per_hour = 1000 WHERE version = 1;
       UPDATE provider_call_budgets SET monthly_call_cap = 5000 WHERE provider = 'marketcheck';
       UPDATE provider_call_events SET at = at - interval '3 days' WHERE provider = 'marketcheck';
       UPDATE store_enrichment_policies SET mode = 'enrichment' WHERE store_id = '45cdc1e0-7e88-4b44-9d07-27369d74ab21';
       UPDATE marketcheck_launch_control SET state = 'activating_canary', plan_version = 1, emergency_stop = false,
         active_store_ids = ARRAY['45cdc1e0-7e88-4b44-9d07-27369d74ab21']::uuid[], canary_started_at = now(), pilot_started_at = NULL WHERE id = 1;" >/dev/null
OUT="$(mktemp -d)"
for i in $(seq 1 40); do
  ( $P -c "SELECT pg_sleep(random() * 0.05); SELECT admitted FROM provider_call_admit_v2('marketcheck', 'neovin', 'marketcheck-specs', 'launch-2026-11-02', false, '$HARTE', '5N1AL1FWXTC358105', 0, NULL, 'neovin')" > "$OUT/$i" ) &
done
wait
ADMITTED=$(cat "$OUT"/* | grep -c '^t$' || true)
rm -rf "$OUT"
STATE=$($P -c "SELECT state || ':' || COALESCE(paused_reason, '') FROM marketcheck_launch_control")
echo "canary race: admitted=$ADMITTED state=$STATE"
[ "$ADMITTED" = 10 ] && [ "$STATE" = "paused:canary_ceiling_reached" ] || { echo "CONCURRENCY TEST FAILED (canary ceiling)"; exit 1; }

# Per-vehicle allowance: 30 sessions race to spend on one dispatched vehicle
# whose plan allows two calls; exactly two are admitted.
$P -c "UPDATE marketcheck_launch_plans SET workload = (SELECT workload FROM saved_workload) WHERE version = 1;
       UPDATE provider_call_events SET at = at - interval '3 days' WHERE provider = 'marketcheck';
       UPDATE marketcheck_launch_control SET state = 'pilot_active', paused_reason = NULL, pilot_started_at = now() WHERE id = 1;
       UPDATE marketcheck_launch_work SET status = 'dispatched', dispatched_at = now(), admissions = 0, attempts = 1
        WHERE plan_version = 1 AND vin = '5N1AL1FWXTC358105';" >/dev/null
OUT="$(mktemp -d)"
for i in $(seq 1 30); do
  ( $P -c "SELECT pg_sleep(random() * 0.05); SELECT admitted FROM provider_call_admit_v2('marketcheck', 'neovin', 'marketcheck-specs', 'launch-2026-11-02', false, '$HARTE', '5N1AL1FWXTC358105', 0, NULL, 'neovin')" > "$OUT/$i" ) &
done
wait
ADMITTED=$(cat "$OUT"/* | grep -c '^t$' || true)
rm -rf "$OUT"
ITEM=$($P -c "SELECT admissions FROM marketcheck_launch_work WHERE plan_version = 1 AND vin = '5N1AL1FWXTC358105'")
echo "per-vehicle race: admitted=$ADMITTED item_admissions=$ITEM"
[ "$ADMITTED" = 2 ] && [ "$ITEM" = 2 ] || { echo "CONCURRENCY TEST FAILED (per-vehicle allowance)"; exit 1; }

# Dispatcher race: 10 simultaneous dispatcher runs never exceed the batch.
$P -c "UPDATE provider_call_events SET at = at - interval '3 days' WHERE provider = 'marketcheck';
       UPDATE marketcheck_launch_work SET status = 'queued', dispatched_at = NULL, request_id = NULL, admissions = 0, attempts = 0 WHERE plan_version = 1;
       DELETE FROM test_http;" >/dev/null
OUT="$(mktemp -d)"
for i in $(seq 1 10); do
  ( $P -c "SELECT marketcheck_launch_dispatch()->>'dispatched'" > "$OUT/$i" 2>&1 ) &
done
wait
rm -rf "$OUT"
SENT=$($P -c "SELECT count(*) FROM test_http")
INFLIGHT=$($P -c "SELECT count(*) FROM marketcheck_launch_work WHERE status = 'dispatched'")
echo "dispatcher race: requests=$SENT in_flight=$INFLIGHT"
[ "$SENT" = 2 ] && [ "$INFLIGHT" = 2 ] || { echo "CONCURRENCY TEST FAILED (dispatcher batch)"; exit 1; }

# Activation race: back to OFF, then 12 simultaneous activations.
$P -c "UPDATE marketcheck_launch_control SET state = 'paused', paused_reason = 'test' WHERE id = 1;
       UPDATE marketcheck_launch_work SET status = 'cancelled' WHERE plan_version = 1;
       -- Every earlier canary VIN has now been asked once, so it is never queued
       -- again; two newly arrived cars give the restarted plan its work.
       INSERT INTO vehicle_listings (store_id, tenant_id, vin, owning_store_id, condition, status)
       SELECT 'harte', '$HARTE', v, '45cdc1e0-7e88-4b44-9d07-27369d74ab21', 'new', 'published' FROM unnest(ARRAY['5N1AL1FW0TC000010','5N1AL1FW0TC000011']) v;" >/dev/null
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

# Expansion race: from the pilot, 12 simultaneous requests to add Harte Nissan.
$P -c "UPDATE provider_call_events SET at = at - interval '3 days' WHERE provider = 'marketcheck';
       UPDATE marketcheck_launch_control SET state = 'pilot_active', pilot_started_at = now() - interval '3 days', last_expanded_at = NULL,
         active_store_ids = ARRAY['45cdc1e0-7e88-4b44-9d07-27369d74ab21']::uuid[] WHERE id = 1;
       UPDATE store_enrichment_policies SET mode = 'feed_only' WHERE store_id = '35d5584b-93d4-4419-9a50-6daead08e7a9';
       INSERT INTO inventory_store_snapshots (path, source_dealer_id, store_id, group_id, source_mtime, content_sha256, clean, status, applied_at)
       VALUES ('prod/inventory/vauto/inbound/MP15397_inventory.csv', 'MP15397', '35d5584b-93d4-4419-9a50-6daead08e7a9', '79feb0ce-0214-48b4-8709-f8d94bdecb5b', now(), 'race', true, 'applied', now());" >/dev/null
MARK=$($P -c "SELECT COALESCE(max(id), 0) FROM marketcheck_launch_events")
OUT="$(mktemp -d)"
for i in $(seq 1 12); do
  ( $P -c "SELECT marketcheck_launch_expand('35d5584b-93d4-4419-9a50-6daead08e7a9', 'EXPAND')->>'ok' FROM (SELECT set_config('test.uid', '$ADMIN', false)) s" > "$OUT/$i" 2>&1 ) &
done
wait
WON=$(cat "$OUT"/* | grep -c '^true$' || true)
rm -rf "$OUT"
EXPANDED=$($P -c "SELECT count(*) FROM marketcheck_launch_events WHERE action = 'expand' AND result = 'ok' AND id > $MARK")
STORES=$($P -c "SELECT cardinality(active_store_ids) FROM marketcheck_launch_control")
echo "expansion race: winners=$WON audited=$EXPANDED active_stores=$STORES"
[ "$WON" = 1 ] && [ "$EXPANDED" = 1 ] && [ "$STORES" = 2 ] || { echo "CONCURRENCY TEST FAILED (expansion)"; exit 1; }
echo "LAUNCH CONCURRENCY TEST PASSED"
