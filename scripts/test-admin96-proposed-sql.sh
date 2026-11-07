#!/usr/bin/env bash
# Applies the Admin 96 proposed migrations to a scratch local Postgres, runs
# the behaviour checks, then applies both rollbacks. TEST_DB is dropped and
# recreated; never point this at a real project.
set -euo pipefail
cd "$(dirname "$0")/.."
DB="${TEST_DB:-admin96_proposed_test}"
case "$DB" in *prod*|postgres) echo "refusing database name $DB" >&2; exit 2;; esac
P="psql -v ON_ERROR_STOP=1 -q -t"
$P -d postgres -c "DROP DATABASE IF EXISTS $DB" -c "CREATE DATABASE $DB"
$P -d "$DB" -f supabase/tests/admin96/00_stub.sql
$P -d "$DB" -f supabase/proposed/20261114000000_admin96_shared_dealer_profile.sql
$P -d "$DB" -f supabase/proposed/20261114010000_admin96_print_calibration.sql
$P -d "$DB" -f supabase/tests/admin96/10_behaviour.sql | sed '/^\s*$/d' | grep -v '^ *0000' | sed 's/^ *//' | grep '^ok' 
$P -d "$DB" -f supabase/proposed/20261114010000_admin96_print_calibration.rollback.sql
$P -d "$DB" -f supabase/proposed/20261114000000_admin96_shared_dealer_profile.rollback.sql
echo "ok  both rollbacks applied"
