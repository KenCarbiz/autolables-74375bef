#!/usr/bin/env bash
# The generated rtgip/2 runtime bundle, served under Deno, against ONE disposable AutoLabels node
# built from empty (autolabels_node.sh). The only change to the node is lifting the CHECK that pins
# delivery_config.transport_enabled to false, in this throwaway cluster, so the database kill switch
# can be exercised. 127.0.0.1 only; never Supabase, never a live key.
#   RTGIP_DENO   path to a Deno 2.x binary (default /tmp/denobin/node_modules/.bin/deno)
#   DENO_CERT    extra CA bundle for the npm download (default /root/.ccr/ca-bundle.crt)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
PGBIN="${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
PORT="${RTGIP_RT_PORT:-55471}"
WORK="$(mktemp -d)"; chmod 755 "$WORK"
RUNAS=()
if [ "$(id -u)" = "0" ]; then chown postgres "$WORK"; RUNAS=(runuser -u postgres --); fi
cleanup() { "${RUNAS[@]}" "$PGBIN/pg_ctl" -D "$WORK/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$WORK"; }
trap cleanup EXIT
"${RUNAS[@]}" "$PGBIN/initdb" -D "$WORK/data" -U postgres -A trust >/dev/null
"${RUNAS[@]}" "$PGBIN/pg_ctl" -D "$WORK/data" -o "-p $PORT -k $WORK -c listen_addresses=127.0.0.1 -c max_connections=100" -l "$WORK/pg.log" -w start >/dev/null
"${RUNAS[@]}" "$PGBIN/createdb" -h 127.0.0.1 -p "$PORT" -U postgres rtgip_rt
cp -r "$ROOT/supabase" "$WORK/sb"; chmod -R a+rX "$WORK/sb"
# shellcheck source=autolabels_node.sh
. "$WORK/sb/tests/rtgip/autolabels_node.sh"
autolabels_node_bootstrap "$PORT" rtgip_rt "$WORK/sb" || exit 1
SEED="$(autolabels_node_seed "$PORT" rtgip_rt "$WORK/sb")" || exit 1
for kv in $SEED; do export "${kv?}"; done
cd "$ROOT"
RTGIP_PG_URL="postgres://postgres@127.0.0.1:$PORT/rtgip_rt" npx vitest run src/lib/rooftopos-parked/rtgip2-autolabels/runtime.pg.test.ts
