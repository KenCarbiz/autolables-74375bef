#!/usr/bin/env bash
# C-S4 Alternative S1: the one-time Vault key import, end to end, on ONE disposable AutoLabels node
# built from empty (autolabels_node.sh), with the server logging set the way the hosted staging
# projects report it (log_statement=ddl, log_min_duration_statement=-1, log_min_error_statement=error,
# log_parameter_max_length_on_error=0, auto_explain at 10 s with full parameters, pg_stat_statements),
# except pg_stat_statements.track=all (stricter than hosted top). The generated rtgip2-key-import bundle
# is served under Deno with only its compiled literal flipped. 127.0.0.1 only; every key is generated
# by the test and discarded with the cluster. Never connects to Supabase.
#   RTGIP_DENO   Deno 2.x binary (default /tmp/denobin/node_modules/.bin/deno)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
PGBIN="${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
PORT="${RTGIP_KI_PORT:-55491}"
WORK="$(mktemp -d)"; chmod 755 "$WORK"
RUNAS=()
if [ "$(id -u)" = "0" ]; then chown postgres "$WORK"; RUNAS=(runuser -u postgres --); fi
cleanup() { "${RUNAS[@]}" "$PGBIN/pg_ctl" -D "$WORK/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$WORK"; }
trap cleanup EXIT
"${RUNAS[@]}" "$PGBIN/initdb" -D "$WORK/data" -U postgres -A trust >/dev/null
HOSTED_LOGGING=(-c log_statement=ddl -c log_min_duration_statement=-1 -c log_min_error_statement=error -c log_parameter_max_length_on_error=0
  -c shared_preload_libraries=pg_stat_statements,auto_explain -c auto_explain.log_min_duration=10000 -c auto_explain.log_parameter_max_length=-1
  -c pg_stat_statements.track=all)
"${RUNAS[@]}" "$PGBIN/pg_ctl" -D "$WORK/data" -o "-p $PORT -k $WORK -c listen_addresses=127.0.0.1 -c max_connections=100 ${HOSTED_LOGGING[*]}" -l "$WORK/pg.log" -w start >/dev/null
"${RUNAS[@]}" "$PGBIN/createdb" -h 127.0.0.1 -p "$PORT" -U postgres rtgip_ki
cp -r "$ROOT/supabase" "$WORK/sb"; chmod -R a+rX "$WORK/sb"
cp "$ROOT"/src/lib/rooftopos-parked/rtgip2-key-import/key_import.*.sql "$WORK/sb/"; chmod a+r "$WORK"/sb/key_import.*.sql
# shellcheck source=autolabels_node.sh
. "$WORK/sb/tests/rtgip/autolabels_node.sh"
autolabels_node_bootstrap "$PORT" rtgip_ki "$WORK/sb" >/dev/null || exit 1
_al_psql "$PORT" rtgip_ki -v ON_ERROR_STOP=1 -c "CREATE EXTENSION IF NOT EXISTS pg_stat_statements" >/dev/null
_al_psql "$PORT" rtgip_ki -v ON_ERROR_STOP=1 -f "$WORK/sb/tests/rtgip/key_import_vault_stub.sql" >/dev/null
_al_psql "$PORT" rtgip_ki -qAtX -c "SELECT md5(string_agg(p.proname || ':' || pg_get_functiondef(p.oid), '|' ORDER BY p.proname, p.oid)) FROM pg_proc p WHERE p.pronamespace = 'rtgip'::regnamespace AND p.proname NOT LIKE 'key_import%'" > "$WORK/frozen.before"
_al_apply_twice "$PORT" rtgip_ki "$WORK/sb/key_import.staging.sql" || exit 1
echo "key import: delivery node built, logging as hosted, install applied twice"
cd "$ROOT"
RTGIP_PG_URL="postgres://postgres@127.0.0.1:$PORT/rtgip_ki" RTGIP_KI_PGLOG="$WORK/pg.log" RTGIP_KI_PGBIN="$PGBIN" RTGIP_KI_PORT="$PORT" \
RTGIP_KI_REMOVAL="$WORK/sb/key_import.removal.sql" RTGIP_KI_FROZEN_BEFORE="$(cat "$WORK/frozen.before")" RTGIP_KI_REPORT="${RTGIP_KI_REPORT:-}" \
  npx vitest run src/lib/rooftopos-parked/rtgip2-autolabels/key-import.pg.test.ts
