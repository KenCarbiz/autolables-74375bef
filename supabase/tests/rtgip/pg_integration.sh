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
# shellcheck source=autolabels_node.sh
. "$WORK/sb/tests/rtgip/autolabels_node.sh"
autolabels_node_bootstrap "$PORT" rtgip_it "$WORK/sb" || exit 1
SEED="$(autolabels_node_seed "$PORT" rtgip_it "$WORK/sb")" || exit 1
for kv in $SEED; do export "${kv?}"; done
echo "Postgres $("${PSQL[@]}" -c 'SHOW server_version'): AutoLabels node bootstrapped from empty and seeded"
"${PSQL[@]}" -v ON_ERROR_STOP=1 -f "$WORK/sb/tests/rtgip/labels_effects_sql.sql" 2>&1 | sed -n 's/.*NOTICE:  //p'
[ "${PIPESTATUS[0]}" = "0" ] || { echo "FAIL  labels_effects_sql.sql"; exit 1; }
cd "$ROOT"
RTGIP_PG_URL="postgres://postgres@127.0.0.1:$PORT/rtgip_it" npx vitest run src/lib/rooftopos-parked/rtgip2-pg
