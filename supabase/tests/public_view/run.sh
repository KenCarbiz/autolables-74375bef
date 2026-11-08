#!/usr/bin/env bash
# Real public-listing-view response (the function as it is on main, unchanged)
# against a throwaway Postgres 16 that replays the repo's migration history only.
# No proposed migration is applied. Never touches a Supabase project.
# Usage: supabase/tests/public_view/run.sh   (SERVE=1 keeps the gateway up for screenshots)
set -u
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
HERE="$ROOT/supabase/tests/public_view"
PGBIN="${PGBIN:-/usr/lib/postgresql/16/bin}"
PGPORT="${PUBLIC_VIEW_PG_PORT:-54339}"
GWPORT="${PUBLIC_VIEW_PORT:-54331}"
WORK="$(mktemp -d /tmp/public-view-pg.XXXXXX)"
mkdir -p "$WORK/logs"; chmod 755 "$WORK"; chmod 777 "$WORK/logs"
as_pg() { if [ "$(id -u)" = 0 ]; then runuser -u postgres -- "$@"; else "$@"; fi; }
[ "$(id -u)" = 0 ] && chown postgres "$WORK"
PSQL=("$PGBIN/psql" -h "$WORK" -p "$PGPORT" -U postgres -X -q)
GW_PID=""
cleanup() {
  [ -n "$GW_PID" ] && kill "$GW_PID" 2>/dev/null
  as_pg "$PGBIN/pg_ctl" -D "$WORK/data" -m immediate stop >/dev/null 2>&1
  [ "${KEEP:-0}" = 1 ] && echo "kept $WORK" || rm -rf "$WORK"
}
trap cleanup EXIT
as_pg "$PGBIN/initdb" -D "$WORK/data" -A trust -U postgres >"$WORK/logs/initdb.log" 2>&1 || { echo initdb failed; exit 2; }
as_pg "$PGBIN/pg_ctl" -D "$WORK/data" -o "-p $PGPORT -k $WORK -c listen_addresses=127.0.0.1" -l "$WORK/logs/pg.log" -w start >/dev/null || exit 2
"${PSQL[@]}" -d postgres -c "create database scratch" || exit 2
DB=("${PSQL[@]}" -d scratch)
"${DB[@]}" -f "$ROOT/supabase/tests/rooftopos_stubs.sql" >"$WORK/logs/stubs.log" 2>&1
for f in $(ls "$ROOT"/supabase/migrations/*.sql); do "${DB[@]}" -f "$f" >/dev/null 2>>"$WORK/logs/history.log"; done
"${DB[@]}" -v ON_ERROR_STOP=1 -v with_foundation=0 -f "$HERE/seed.sql" >"$WORK/logs/seed.log" 2>&1 || { cat "$WORK/logs/seed.log"; exit 2; }

export PUBLIC_VIEW_DB_URL="postgresql://postgres@127.0.0.1:$PGPORT/scratch" PUBLIC_VIEW_PORT="$GWPORT"
export SUPABASE_URL="http://127.0.0.1:$GWPORT" SUPABASE_SERVICE_ROLE_KEY="local-service-key-not-real" SUPABASE_ANON_KEY="local-anon-key-not-real"
(cd "$HERE" && deno run -A --node-modules-dir=none --import-map=import_map.json gateway.ts) >"$WORK/logs/gateway.log" 2>&1 &
GW_PID=$!
for _ in $(seq 1 120); do grep -q "gateway listening" "$WORK/logs/gateway.log" && break; sleep 0.5; done
grep -q "gateway listening" "$WORK/logs/gateway.log" || { cat "$WORK/logs/gateway.log"; exit 2; }

rc=0
if [ "${SERVE:-0}" = 1 ]; then
  echo "gateway on http://127.0.0.1:$GWPORT (Ctrl-C to stop)"; wait "$GW_PID"
else
  PUBLIC_VIEW_URL="http://127.0.0.1:$GWPORT" deno test -A --node-modules-dir=none --import-map="$HERE/import_map.json" "$HERE/public_view.test.ts" 2>&1 | tee "$WORK/logs/test.log"
  rc=${PIPESTATUS[0]}
fi
exit $rc
