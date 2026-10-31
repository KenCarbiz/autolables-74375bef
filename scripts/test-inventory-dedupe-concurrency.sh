#!/usr/bin/env bash
# Concurrency checks for duplicate reconciliation. Run after
# scripts/test-inventory-network-sql.sh, against the same scratch database.
set -euo pipefail
cd "$(dirname "$0")/.."
DB="${TEST_DB:-inventory_network_test}"
case "$DB" in *prod*|postgres) echo "refusing database name $DB" >&2; exit 2;; esac
P="psql -v ON_ERROR_STOP=1 -qAt -d $DB"
ADMIN="SELECT set_config('test.uid', '00000000-0000-0000-0000-00000000ad01', false);"
T1="00000000-0000-0000-0000-0000000000d1"; S1="00000000-0000-0000-0000-0000000005a1"
fail() { echo "FAILED: $1" >&2; exit 1; }

# Fixture: an eligible duplicate pair for VIN 20 and an approved preview.
$P >/dev/null <<SQL
$ADMIN
INSERT INTO vehicle_listings (tenant_id, store_id, vin, slug, ymm, trim, condition, status, owning_store_id, feed_source, created_at, published_at)
VALUES ('$T1', '$T1', 'DDV00000000000020', 'est20-000020', '2025 INFINITI QX60', 'LUXE', 'used', 'published', '$S1', 'marketcheck', now() - interval '30 days', now() - interval '20 days'),
       ('$T1', '$T1', 'DDV00000000000020', 'imp20-000020', '2025 INFINITI QX60', 'LUXE', 'used', 'draft', '$S1', 'filescom', now(), NULL);
SELECT set_config('app.inventory_writer', 'filescom_apply', false);
WITH si AS (
  INSERT INTO store_inventory (store_id, group_id, vin, source_dealer_id, condition, feed_price_status, listing_id, first_seen_at)
  SELECT '$S1', '00000000-0000-0000-0000-00000000dd01', 'DDV00000000000020', 'DD1_inventory', 'used', 'unknown', id, now() - interval '1 day'
    FROM vehicle_listings WHERE slug = 'imp20-000020' RETURNING id, listing_id)
UPDATE vehicle_listings l SET inventory_record_id = si.id FROM si WHERE l.id = si.listing_id;
SELECT set_config('app.inventory_writer', '', false);
SELECT inv_dedupe_scan('00000000-0000-0000-0000-00000000dd01');
SQL
PREVIEW=$($P -c "$ADMIN" -c "SELECT inv_dedupe_create_preview(id)::text FROM inventory_dedupe_candidates WHERE vin = 'DDV00000000000020' AND kind = 'duplicate_listings' AND status = 'open'" | tail -1)
PID=$(echo "$PREVIEW" | python3 -c 'import json,sys; print(json.load(sys.stdin)["preview_id"])')
SHA=$(echo "$PREVIEW" | python3 -c 'import json,sys; print(json.load(sys.stdin)["plan_sha256"])')
$P -c "$ADMIN" -c "SELECT inv_dedupe_approve('$PID', '$SHA')" >/dev/null

# 1. Two simultaneous applies of the same preview with different keys: one wins.
$P -c "$ADMIN" -c "SELECT inv_dedupe_apply('$PID', 'conc-key-a')" > /tmp/dedupe_a.out 2>&1 &
$P -c "$ADMIN" -c "SELECT inv_dedupe_apply('$PID', 'conc-key-b')" > /tmp/dedupe_b.out 2>&1 &
wait
APPLIED=$($P -c "SELECT count(*) FROM inventory_dedupe_operations WHERE preview_id = '$PID' AND status = 'applied'")
[ "$APPLIED" = "1" ] || fail "concurrent applies produced $APPLIED applied operations"
grep -q preview_already_applied /tmp/dedupe_a.out /tmp/dedupe_b.out || fail "the losing apply did not report preview_already_applied"
echo "ok  concurrent applies of one preview commit exactly once"

# 2. An import waits for a reconciliation holding the same tenant + VIN lock.
SNAP=$($P <<SQL | tail -1
WITH s AS (INSERT INTO inventory_store_snapshots (path, source_dealer_id, store_id, group_id, mapping_id, source_mtime, content_sha256, clean, valid_count, row_count)
  VALUES ('prod/inventory/vauto/inbound/DD1_inventory.csv', 'DD1_inventory', '$S1', '00000000-0000-0000-0000-00000000dd01', '00000000-0000-0000-0000-0000000006a1', now() + interval '1 day', 'sha-conc', false, 1, 1) RETURNING id),
v AS (INSERT INTO inventory_snapshot_vehicles (snapshot_id, vin, row_number, condition, feed_price_status, photos) SELECT id, 'DDV00000000000021', 2, 'used', 'unknown', '[]'::jsonb FROM s RETURNING snapshot_id)
SELECT snapshot_id FROM v;
SQL
)
$P -c "BEGIN" -c "SELECT inv_dedupe_lock('$T1', 'DDV00000000000021')" -c "SELECT pg_sleep(3)" -c "COMMIT" >/dev/null &
HOLDER=$!
sleep 0.7
if $P -c "SET lock_timeout = '500ms'" -c "SELECT inventory_apply_store_snapshot('$SNAP')" >/tmp/dedupe_c.out 2>&1; then
  fail "the import did not wait for the reconciliation lock"
fi
grep -q "lock timeout" /tmp/dedupe_c.out || fail "expected a lock timeout, got: $(cat /tmp/dedupe_c.out)"
echo "ok  an import blocks on the reconciliation lock for the same tenant and VIN"
wait $HOLDER
$P -c "SELECT inventory_apply_store_snapshot('$SNAP')" >/dev/null
CREATED=$($P -c "SELECT count(*) FROM vehicle_listings WHERE vin = 'DDV00000000000021'")
[ "$CREATED" = "1" ] || fail "expected one listing for VIN 21 after the lock cleared, found $CREATED"
echo "ok  the import proceeds once the lock is released and creates one listing"
