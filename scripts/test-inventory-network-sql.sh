#!/usr/bin/env bash
# Applies the Files.com connector migrations to a scratch Postgres database and
# runs the inventory-network behaviour tests. Needs a local server:
#   PGHOST/PGPORT/PGUSER as for psql. The database named by TEST_DB is dropped
#   and recreated; never point this at a real project.
set -euo pipefail
cd "$(dirname "$0")/.."
DB="${TEST_DB:-inventory_network_test}"
case "$DB" in *prod*|postgres) echo "refusing database name $DB" >&2; exit 2;; esac
P="psql -v ON_ERROR_STOP=1 -q"
$P -d postgres -c "DROP DATABASE IF EXISTS $DB" -c "CREATE DATABASE $DB"
$P -d "$DB" -f supabase/tests/inventory_network/00_supabase_stub.sql
$P -d "$DB" -f drizzle/migrations/0004_filescom_inventory_connector.sql
$P -d "$DB" -f drizzle/migrations/0006_multistore_inventory_network.sql
$P -d "$DB" -f drizzle/migrations/0007_marketcheck_pilot_coordinator.sql
$P -d "$DB" -f drizzle/migrations/0008_marketcheck_bulk_feeds.sql
$P -d "$DB" -f supabase/manual/files_inventory_worker_schedule.sql
$P -d "$DB" -f supabase/tests/inventory_network/10_behaviour.sql
$P -d "$DB" -f supabase/tests/inventory_network/20_pilot_coordinator.sql
$P -d "$DB" -f supabase/tests/inventory_network/30_bulk_feeds.sql
$P -d "$DB" -f drizzle/migrations/0010_store_mapping_review.sql
$P -d "$DB" -f supabase/tests/inventory_network/40_mapping_review.sql
$P -d "$DB" -f drizzle/migrations/0012_snapshot_shrink_guard.sql
$P -d "$DB" -f supabase/tests/inventory_network/50_shrink_guard.sql
