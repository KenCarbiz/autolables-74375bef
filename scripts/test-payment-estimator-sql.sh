#!/usr/bin/env bash
# Applies the payment estimator migration to a scratch Postgres database and
# runs its behaviour tests. Needs a local server: PGHOST/PGPORT/PGUSER as for
# psql. The database named by TEST_DB is dropped and recreated; never point
# this at a real project.
set -euo pipefail
cd "$(dirname "$0")/.."
DB="${TEST_DB:-payment_estimator_test}"
case "$DB" in *prod*|postgres) echo "refusing database name $DB" >&2; exit 2;; esac
P="psql -v ON_ERROR_STOP=1 -q -t"
$P -d postgres -c "DROP DATABASE IF EXISTS $DB" -c "CREATE DATABASE $DB"
$P -d "$DB" -f supabase/tests/payment_estimator/00_supabase_stub.sql
$P -d "$DB" -f supabase/migrations/20261031130000_passport_payment_estimator.sql
$P -d "$DB" -f supabase/tests/payment_estimator/10_behaviour.sql

# Two first-ever applies for the same rooftop racing in separate sessions: one
# commits version 1, the other is told its draft is stale.
$P -d "$DB" -c "INSERT INTO onboarding_profiles (tenant_id, stores) VALUES ('00000000-0000-0000-0000-0000000000c1', '[{\"id\":\"race\"}]')" \
  -c "INSERT INTO tenants (id, name) VALUES ('00000000-0000-0000-0000-0000000000c1', 'Race')" \
  -c "INSERT INTO tenant_members (tenant_id, user_id, role) VALUES ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-00000000aa01', 'owner')"
RACE_SQL="SELECT set_config('test.uid', '00000000-0000-0000-0000-00000000aa01', false);
BEGIN;
SELECT public.apply_payment_estimator_settings('00000000-0000-0000-0000-0000000000c1', 'race', 0,
  '{\"enabled\":false,\"downPayment\":{\"mode\":\"percent\",\"percent\":RATE,\"amount\":null},\"shopperControls\":{\"downPayment\":true,\"term\":true,\"aprOverride\":true},\"rules\":[]}'::jsonb, gen_random_uuid());
SELECT pg_sleep(1);
COMMIT;"
OUT=$(mktemp -d)
( psql -q -t -d "$DB" -c "${RACE_SQL//RATE/10}" >"$OUT/a" 2>&1 || true ) &
( sleep 0.3; psql -q -t -d "$DB" -c "${RACE_SQL//RATE/20}" >"$OUT/b" 2>&1 || true ) &
wait
WINNERS=$(cat "$OUT/a" "$OUT/b" | grep -c '"version": 1' || true)
STALE=$(cat "$OUT/a" "$OUT/b" | grep -c 'stale_version' || true)
ROWS=$($P -d "$DB" -c "SELECT count(*) FROM passport_payment_estimator_versions WHERE store_id = 'race'" | tr -d ' ')
if [ "$WINNERS" = 1 ] && [ "$STALE" = 1 ] && [ "$ROWS" = 1 ]; then echo "ok  concurrent first applies: one wins, one stale"; else echo "FAILED: concurrent first applies (winners=$WINNERS stale=$STALE rows=$ROWS)"; cat "$OUT/a" "$OUT/b"; exit 1; fi
