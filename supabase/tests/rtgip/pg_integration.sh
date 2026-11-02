#!/usr/bin/env bash
# TypeScript-to-Postgres integration for the PROPOSED rtgip/2 trust boundaries: the server
# admission boundary against rtgip.inbox_admit, and the AutoLabels source readers against the
# PR #46 custody tables. Throwaway local cluster on 127.0.0.1 only; never connects to Supabase.
# Loads the platform stubs, replays the repo migration history, the (unapplied) spine and
# vehicle-history proposals, then the rtgip proposals, and runs the rtgip2-pg Vitest files.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
PGBIN="${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
PORT="${RTGIP_PG_PORT:-55433}"
WORK="$(mktemp -d)"; chmod 755 "$WORK"
RUNAS=()
if [ "$(id -u)" = "0" ]; then chown postgres "$WORK"; RUNAS=(runuser -u postgres --); fi
PSQL=("${RUNAS[@]}" "$PGBIN/psql" -h 127.0.0.1 -p "$PORT" -U postgres -d rtgip_it -qAtX)
cleanup() { "${RUNAS[@]}" "$PGBIN/pg_ctl" -D "$WORK/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$WORK"; }
trap cleanup EXIT
"${RUNAS[@]}" "$PGBIN/initdb" -D "$WORK/data" -U postgres -A trust >/dev/null
"${RUNAS[@]}" "$PGBIN/pg_ctl" -D "$WORK/data" -o "-p $PORT -k $WORK -c listen_addresses=127.0.0.1 -c max_connections=200" -l "$WORK/pg.log" -w start >/dev/null
"${RUNAS[@]}" "$PGBIN/createdb" -h 127.0.0.1 -p "$PORT" -U postgres rtgip_it
cp -r "$ROOT/supabase" "$WORK/sb"; chmod -R a+rX "$WORK/sb"
"${PSQL[@]}" -v ON_ERROR_STOP=1 -f "$WORK/sb/tests/rooftopos_stubs.sql" >/dev/null
# As on Supabase: pgcrypto lives in the extensions schema, which is on the search path.
"${PSQL[@]}" -v ON_ERROR_STOP=1 -c "CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions; GRANT USAGE ON SCHEMA extensions TO PUBLIC;
  ALTER DATABASE rtgip_it SET search_path = \"\$user\", public, extensions" >/dev/null
for f in $(ls "$WORK"/sb/migrations/*.sql | grep -v rooftopos_spine); do "${PSQL[@]}" -f "$f" >/dev/null 2>>"$WORK/history.err" || true; done
echo "migration history replayed ($(grep -c 'ERROR:' "$WORK/history.err" || true) replay errors, as in rooftopos_harness.sh)"
"${PSQL[@]}" -v ON_ERROR_STOP=1 -f "$WORK/sb/proposed/20261030000000_rooftopos_spine.sql" >/dev/null 2>&1
# Stand-in for drizzle 0006 (multistore inventory network), which supabase/migrations does not replay:
# dealer_stores with its status, and the listing's owning store.
"${PSQL[@]}" -v ON_ERROR_STOP=1 -c "CREATE TABLE IF NOT EXISTS public.dealer_stores (id uuid PRIMARY KEY, tenant_id uuid NOT NULL);
  ALTER TABLE public.dealer_stores ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active';
  ALTER TABLE public.vehicle_listings ADD COLUMN IF NOT EXISTS owning_store_id uuid" >/dev/null
"${PSQL[@]}" -v ON_ERROR_STOP=1 -f "$WORK/sb/proposed/20261109000000_vehicle_history_foundation.sql" >/dev/null 2>&1 \
  || { "${PSQL[@]}" -v ON_ERROR_STOP=1 -f "$WORK/sb/proposed/20261109000000_vehicle_history_foundation.sql"; exit 1; }
"${PSQL[@]}" -c "ALTER DEFAULT PRIVILEGES GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
  ALTER DEFAULT PRIVILEGES GRANT ALL ON TABLES TO anon, authenticated, service_role;
  ALTER DEFAULT PRIVILEGES GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;" >/dev/null
for f in rtgip_v2_delivery.proposed.sql rtgip_source_readers.proposed.sql rtgip_labels_effects.proposed.sql; do
  "${PSQL[@]}" -v ON_ERROR_STOP=1 -f "$WORK/sb/proposed/$f" >/dev/null 2>&1 || { "${PSQL[@]}" -v ON_ERROR_STOP=1 -f "$WORK/sb/proposed/$f"; exit 1; }
  "${PSQL[@]}" -v ON_ERROR_STOP=1 -f "$WORK/sb/proposed/$f" >/dev/null 2>&1 || { echo "FAIL  $f is not idempotent"; exit 1; }
done
echo "Postgres $("${PSQL[@]}" -c 'SHOW server_version'): spine, PR #46 foundation, delivery ledger, source readers and consumer effects applied twice"
"${PSQL[@]}" -v ON_ERROR_STOP=1 -f "$WORK/sb/tests/rtgip/labels_effects_sql.sql" 2>&1 | sed -n 's/.*NOTICE:  //p'
[ "${PIPESTATUS[0]}" = "0" ] || { echo "FAIL  labels_effects_sql.sql"; exit 1; }
cd "$ROOT"
RTGIP_PG_URL="postgres://postgres@127.0.0.1:$PORT/rtgip_it" npx vitest run src/lib/rooftopos-parked/rtgip2-pg
