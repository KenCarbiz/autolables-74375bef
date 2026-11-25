#!/usr/bin/env bash
# Runs the real batch A and batch B execution scripts (supabase/manual) against
# synthetic rows that carry the production tenant, listing ids and VINs. Proves
# every gate aborts with nothing written, and that a clean run retires exactly
# the batch. Only the two placeholders are substituted.
set -euo pipefail
DB="$1"
P="psql -v ON_ERROR_STOP=1 -qtA -d $DB"
D=$(cd "$(dirname "$0")" && pwd)
M="$D/../../manual"
T=3f0f97f5-4151-4e32-88ef-e2d6fc5a3142
G=e400e636-0909-4b36-822e-caa2b5ae7381
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
fail() { echo "FAILED: $1" >&2; exit 1; }
arm() { sed -e "s/<KEN_FINAL_EXECUTION_APPROVAL_TEXT>/Ken approved final execution (harness test only)/" \
            -e "s/c_passport_release_verified constant boolean := false/c_passport_release_verified constant boolean := true/" "$1" > "$2"; }
arm "$M/legacy_retirement_batch_A.sql" "$TMP/A.sql"
arm "$M/legacy_retirement_batch_B.sql" "$TMP/B.sql"
grep -q "Ken approved final execution (harness test only)" "$TMP/A.sql" || fail "approval placeholder not found in batch A"
grep -q "c_passport_release_verified constant boolean := true" "$TMP/B.sql" || fail "release flag not found in batch B"

$P -f "$D/97_legacy_batch_seed.sql" >/dev/null
q() { $P -c "$1"; }
state() { q "SELECT count(*) FILTER (WHERE status='published') || '/' || count(*) FILTER (WHERE status='archived') || '/' || (SELECT count(*) FROM legacy_listing_retirements WHERE tenant_id='$T') || '/' || (SELECT count(*) FROM legacy_retirement_batches WHERE tenant_id='$T') FROM vehicle_listings WHERE tenant_id='$T'"; }
START=$(state)
[ "$START" = "52/0/0/0" ] || fail "unexpected seed state $START"
expect_abort() { # file, expected message, label
  set +e; OUT=$($P -f "$1" 2>&1); RC=$?; set -e
  [ $RC -ne 0 ] || fail "$3: did not abort"
  echo "$OUT" | grep -q "$2" || fail "$3: aborted for another reason: $OUT"
  [ "$(state)" = "$START" ] || fail "$3: rows changed after the abort ($(state))"
  echo "ok  $3 (aborted, nothing written)"
}

expect_abort "$M/legacy_retirement_batch_A.sql" "gate 0: paste" "batch A as committed refuses to run without Ken's approval text"
q "UPDATE inventory_feed_files SET status = 'pending' WHERE path LIKE '%MP95395%'"
expect_abort "$TMP/A.sql" "gate 2: SFTP feeds not freshly imported" "a pending SFTP file stops batch A"
q "UPDATE inventory_feed_files SET status = 'validated', latest_notified_at = now() WHERE path LIKE '%MP95395%'"
expect_abort "$TMP/A.sql" "gate 2: SFTP feeds not freshly imported" "a file notified after the last applied snapshot stops batch A"
q "UPDATE inventory_feed_files SET latest_notified_at = now() - interval '2 hours' WHERE path LIKE '%MP95395%'"
q "INSERT INTO inventory_feed_jobs (path, trigger, status) VALUES ('prod/inventory/vauto/inbound/MP95395_inventory.csv', 'webhook', 'queued')"
expect_abort "$TMP/A.sql" "gate 2: SFTP feeds not freshly imported" "a queued import job stops batch A"
q "UPDATE inventory_feed_jobs SET status = 'succeeded' WHERE path LIKE '%MP95395%'"
q "INSERT INTO store_inventory (store_id, group_id, vin, source_dealer_id, stock_number, condition, feed_price_status, presence) VALUES ('$G', '00000000-0000-0000-0000-00000000cc9f', 'YV4A22PK3J1375505', 'MP95395_inventory', 'X1', 'used', 'unknown', 'present')"
expect_abort "$TMP/A.sql" "gate 3: in an SFTP feed now: YV4A22PK3J1375505" "a batch A car that reappeared in a feed stops batch A"
q "DELETE FROM store_inventory WHERE vin = 'YV4A22PK3J1375505'"
q "INSERT INTO addendum_signings (tenant_id, vin) VALUES ('$T', '1HGCV1F50KA083807')"
expect_abort "$TMP/A.sql" "gate 4: dry run found 1 blocked" "a new customer signing on a batch A car stops batch A"
q "DELETE FROM addendum_signings WHERE vin = '1HGCV1F50KA083807'"
q "INSERT INTO leads (tenant_id, vehicle_vin, source, status) VALUES ('$T', 'JN1BV7AR6FM406806', 'website', 'new')"
expect_abort "$TMP/A.sql" "gate 4: dry run found 1 blocked" "a new open lead on a batch A car stops batch A"
q "DELETE FROM leads WHERE vehicle_vin = 'JN1BV7AR6FM406806'"
q "ALTER TABLE vehicle_listings DISABLE TRIGGER vehicle_listings_owner_assignment_guard"
expect_abort "$TMP/A.sql" "gate 1: a retirement or ownership guard trigger is missing or disabled" "a disabled guard stops batch A"
q "ALTER TABLE vehicle_listings ENABLE TRIGGER vehicle_listings_owner_assignment_guard"

SI_BEFORE=$(q "SELECT md5(string_agg(to_jsonb(si)::text, ',' ORDER BY id)) FROM store_inventory si")
$P -f "$TMP/A.sql" >/dev/null 2>&1 || fail "clean batch A run failed: $($P -f "$TMP/A.sql" 2>&1 | tail -3)"
[ "$(state)" = "15/37/37/1" ] || fail "after batch A expected 15/37/37/1, got $(state)"
echo "ok  clean batch A run retires exactly the 37 and records one batch"
[ "$(q "SELECT status FROM vehicle_listings WHERE vin = '5N1AT3CB7MC736556'")" = "published" ] || fail "the Rogue changed"
echo "ok  the 2021 Rogue is untouched"
[ "$(q "SELECT md5(string_agg(to_jsonb(si)::text, ',' ORDER BY id)) FROM store_inventory si")" = "$SI_BEFORE" ] || fail "store_inventory changed"
echo "ok  store_inventory byte-identical after batch A"
START=$(state)
expect_abort "$TMP/A.sql" "gate 4: dry run found 37 blocked" "running batch A twice is refused"

# Batch B
expect_abort "$M/legacy_retirement_batch_B.sql" "gate 0: paste" "batch B as committed refuses to run without Ken's approval text"
q "UPDATE store_inventory SET stock_number = 'IN9999' WHERE vin = 'JN8AZ3BB3V9450369'"
expect_abort "$TMP/B.sql" "gate 3: VIN/stock no longer matches George Harte INFINITI: JN8AZ3BB3V9450369" "a stock number change stops batch B"
q "UPDATE store_inventory SET stock_number = 'IN6906' WHERE vin = 'JN8AZ3BB3V9450369'"
q "UPDATE store_inventory SET presence = 'missing' WHERE vin = 'JN8AZ3CC9T9622022'"
expect_abort "$TMP/B.sql" "gate 3: VIN/stock no longer matches" "a car that left George Harte INFINITI's feed stops batch B"
q "UPDATE store_inventory SET presence = 'present' WHERE vin = 'JN8AZ3CC9T9622022'"
q "UPDATE dealer_stores SET subscription_status = 'subscribed', listing_sync_enabled = true WHERE id = '$G'"
expect_abort "$TMP/B.sql" "gate 3: George Harte INFINITI listing sync is on" "George Harte INFINITI listing sync on stops batch B"
q "UPDATE dealer_stores SET listing_sync_enabled = false, subscription_status = 'unsubscribed' WHERE id = '$G'"
SI_BEFORE=$(q "SELECT md5(string_agg(to_jsonb(si)::text, ',' ORDER BY id)) FROM store_inventory si")
$P -f "$TMP/B.sql" >/dev/null 2>&1 || fail "clean batch B run failed: $($P -f "$TMP/B.sql" 2>&1 | tail -3)"
[ "$(state)" = "1/51/51/2" ] || fail "after batch B expected 1/51/51/2, got $(state)"
echo "ok  clean batch B run retires exactly the 14; only the Rogue stays published"
[ "$(q "SELECT md5(string_agg(to_jsonb(si)::text, ',' ORDER BY id)) FROM store_inventory si")" = "$SI_BEFORE" ] || fail "store_inventory changed by batch B"
[ "$(q "SELECT count(*) FROM store_inventory WHERE store_id = '$G' AND presence = 'present'")" = "14" ] || fail "George Harte INFINITI inventory changed"
echo "ok  the 14 cars stay present in George Harte INFINITI's store_inventory, byte-identical"

# Independent rollback of each batch
BA=$(q "SELECT batch_id FROM legacy_retirement_batches WHERE tenant_id = '$T' AND cardinality(listing_ids) = 37")
BB=$(q "SELECT batch_id FROM legacy_retirement_batches WHERE tenant_id = '$T' AND cardinality(listing_ids) = 14")
q "SELECT legacy_listing_restore('$BB', 'Ken approved batch B restore (harness test)')" >/dev/null
[ "$(state)" = "15/37/51/2" ] || fail "restoring B should leave A retired, got $(state)"
echo "ok  batch B restores on its own; batch A stays retired"
q "SELECT legacy_listing_restore('$BA', 'Ken approved batch A restore (harness test)')" >/dev/null
[ "$(state)" = "52/0/51/2" ] || fail "restoring A should republish all, got $(state)"
echo "ok  batch A restores on its own; audit and batch records are kept"
