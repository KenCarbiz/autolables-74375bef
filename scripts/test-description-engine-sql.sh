#!/usr/bin/env bash
# Applies the proposed description store settings and vAuto export gate
# migrations to a scratch Postgres database and runs their behaviour tests,
# then checks both rollbacks. Needs a local server: PGHOST/PGPORT/PGUSER as for
# psql. The database named by TEST_DB is dropped and recreated; never point
# this at a real project.
set -euo pipefail
cd "$(dirname "$0")/.."
DB="${TEST_DB:-description_engine_test}"
case "$DB" in *prod*|postgres) echo "refusing database name $DB" >&2; exit 2;; esac
P="psql -v ON_ERROR_STOP=1 -q -t"
$P -d postgres -c "DROP DATABASE IF EXISTS $DB" -c "CREATE DATABASE $DB"
$P -d "$DB" -f supabase/tests/description_engine/00_stub.sql
$P -d "$DB" -f supabase/proposed/20261109000000_description_store_settings.sql
$P -d "$DB" -f supabase/proposed/20261109000100_vauto_export_gate.sql
$P -d "$DB" -f supabase/tests/description_engine/10_behaviour.sql 2>&1 | sed 's/^psql:[^ ]* NOTICE:  //'
$P -d "$DB" -f supabase/proposed/20261109000100_vauto_export_gate.rollback.sql
$P -d "$DB" -f supabase/proposed/20261109000000_description_store_settings.rollback.sql
LEFT=$($P -d "$DB" -c "SELECT count(*) FROM pg_class WHERE relname IN ('description_store_settings','description_store_disclosures','description_export_checks','description_export_approvals')" | tr -d ' ')
[ "$LEFT" = 0 ] && echo "ok  rollbacks remove every new table" || { echo "FAILED: rollback left $LEFT tables"; exit 1; }
