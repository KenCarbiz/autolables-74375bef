#!/usr/bin/env bash
# Applies the migrations the MarketCheck launch control depends on, then 0018,
# to a scratch Postgres database and runs its behaviour and concurrency tests.
# Needs a local server (PGHOST/PGPORT/PGUSER as for psql). The database named
# by TEST_DB is dropped and recreated; never point this at a real project.
set -euo pipefail
cd "$(dirname "$0")/.."
DB="${TEST_DB:-marketcheck_launch_test}"
case "$DB" in *prod*|postgres) echo "refusing database name $DB" >&2; exit 2;; esac
P="psql -v ON_ERROR_STOP=1 -q"
$P -d postgres -c "DROP DATABASE IF EXISTS $DB" -c "CREATE DATABASE $DB"
$P -d "$DB" -f supabase/tests/inventory_network/00_supabase_stub.sql
$P -d "$DB" -f drizzle/migrations/0004_filescom_inventory_connector.sql
$P -d "$DB" -f drizzle/migrations/0006_multistore_inventory_network.sql
$P -d "$DB" -f drizzle/migrations/0007_marketcheck_pilot_coordinator.sql
$P -d "$DB" -f drizzle/migrations/0008_marketcheck_bulk_feeds.sql
$P -d "$DB" -f supabase/migrations/20261027205000_provider_call_budget.sql
$P -d "$DB" -f drizzle/migrations/0010_store_mapping_review.sql
$P -d "$DB" -f drizzle/migrations/0012_snapshot_shrink_guard.sql
$P -d "$DB" -f drizzle/migrations/0016_feed_completeness_hold.sql
$P -d "$DB" -f supabase/tests/marketcheck_launch/00_cron_stub.sql
# Production state before this release: the owner hold (cap 0, reserve 250).
$P -d "$DB" -c "UPDATE provider_call_budgets SET monthly_call_cap = 0, notes = 'owner hold' WHERE provider = 'marketcheck'"
CORE_BEFORE=$(psql -qtA -d "$DB" -c "SELECT md5(prosrc) FROM pg_proc WHERE proname = 'provider_call_admit'")
$P -d "$DB" -f drizzle/migrations/0018_marketcheck_launch_control.sql
CORE_AFTER=$(psql -qtA -d "$DB" -c "SELECT md5(prosrc) FROM pg_proc WHERE proname = 'provider_call_admit_core'")
[ "$CORE_BEFORE" = "$CORE_AFTER" ] || { echo "FAILED: provider_call_admit body changed ($CORE_BEFORE vs $CORE_AFTER)"; exit 1; }
echo "ok  provider_call_admit body preserved as provider_call_admit_core ($CORE_AFTER)"
$P -d "$DB" -f supabase/tests/marketcheck_launch/10_launch.sql
TEST_DB="$DB" bash scripts/test-marketcheck-launch-concurrency.sh
$P -d "$DB" -f supabase/tests/marketcheck_launch/20_deploy_package.sql
echo "MARKETCHECK LAUNCH SQL TESTS PASSED"
