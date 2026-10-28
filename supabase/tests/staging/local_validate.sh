#!/usr/bin/env bash
# LOCAL VALIDATION ONLY. Rehearses the staging procedure end to end on a throwaway
# local Postgres 16 plus local_shim.ts; never contacts any Supabase project.
# Order: stub, 00, 01, spine, 00, 04, 02, phase1 (flag off), phase2 (flag on),
# 03 rollback, 00, re-apply spine, 00, 04, 02, phase2 again.
# Usage: supabase/tests/staging/local_validate.sh   (KEEP=1 keeps the cluster)
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
S="$ROOT/supabase/tests/staging"
PGBIN="${PGBIN:-/usr/lib/postgresql/16/bin}"
PORT="${STAGING_LOCAL_PG_PORT:-54331}"
SHIM_PORT="${STAGING_LOCAL_SHIM_PORT:-54341}"
WORK="$(mktemp -d /tmp/rooftopos-staging.XXXXXX)"
chmod 755 "$WORK"
as_pg() { if [ "$(id -u)" = 0 ]; then runuser -u postgres -- "$@"; else "$@"; fi; }
[ "$(id -u)" = 0 ] && chown postgres "$WORK"
SHIM_PID=""
FAILED=0
cleanup() {
  [ -n "$SHIM_PID" ] && kill "$SHIM_PID" 2>/dev/null
  as_pg "$PGBIN/pg_ctl" -D "$WORK/data" -m immediate stop >/dev/null 2>&1
  if [ "${KEEP:-0}" = 1 ]; then echo "kept: $WORK"; else rm -rf "$WORK"; fi
}
trap cleanup EXIT

as_pg "$PGBIN/initdb" -D "$WORK/data" -A trust -U postgres >/dev/null 2>&1 || { echo "initdb failed"; exit 2; }
as_pg "$PGBIN/pg_ctl" -D "$WORK/data" -o "-p $PORT -k $WORK -c listen_addresses=127.0.0.1" -l "$WORK/pg.log" -w start >/dev/null || exit 2
"$PGBIN/psql" -h "$WORK" -p "$PORT" -U postgres -Xq -d postgres -c "create database staging" || exit 2
DB_URL="postgresql://postgres@127.0.0.1:$PORT/staging"

step() {
  local label="$1" file="$2" expect="${3:-}"
  local out
  out=$("$PGBIN/psql" -h "$WORK" -p "$PORT" -U postgres -Xq -d staging -v ON_ERROR_STOP=1 -f "$file" 2>&1)
  local rc=$?
  if [ $rc -ne 0 ] || { [ -n "$expect" ] && ! grep -q "$expect" <<<"$out"; }; then
    echo "FAIL  $label"; echo "$out" | tail -5; FAILED=1
  else
    echo "PASS  $label"
  fi
}

printf '{"imports":{"https://esm.sh/@supabase/supabase-js@2":"data:application/javascript,export const createClient=()=>{throw new Error(\\"stub\\")};"}}' >"$WORK/import_map.json"
ANON_KEY="local-anon-$(od -An -N8 -tx1 /dev/urandom | tr -d ' \n')"
CRON_SECRET="$(od -An -N24 -tx1 /dev/urandom | tr -d ' \n')"

start_shim() {
  [ -n "$SHIM_PID" ] && kill "$SHIM_PID" 2>/dev/null && wait "$SHIM_PID" 2>/dev/null
  SHIM_PORT="$SHIM_PORT" SHIM_DB_URL="$DB_URL" SHIM_ANON_KEY="$ANON_KEY" CRON_SHARED_SECRET="$CRON_SECRET" \
    ROOFTOP_INTEGRATIONS_ENABLED="$1" SHIM_DISPATCH_HOST="staging-shim.local" \
    deno run -A --quiet --import-map="$WORK/import_map.json" "$S/local_shim.ts" >"$WORK/shim-$1.log" 2>&1 &
  SHIM_PID=$!
  for _ in $(seq 1 100); do grep -q listening "$WORK/shim-$1.log" 2>/dev/null && return 0; sleep 0.2; done
  echo "shim failed to start"; cat "$WORK/shim-$1.log"; exit 2
}

runner() {
  STAGING_URL="http://127.0.0.1:$SHIM_PORT" STAGING_ANON_KEY="$ANON_KEY" STAGING_CRON_SECRET="$CRON_SECRET" STAGING_DB_URL="$DB_URL" \
    deno run -A --quiet "$S/run_staging.ts" "$1" --dispatch-base=https://staging-shim.local --out="${RESULTS_DIR:-$WORK/results}"
  [ $? -eq 0 ] || FAILED=1
}

step "local platform stub" "$S/local_platform_stub.sql"
step "00 isolation (empty project)" "$S/00_isolation_check.sql" PASS
step "01 dependencies" "$S/01_dependencies.sql"
step "01 dependencies, re-run" "$S/01_dependencies.sql"
step "spine migration" "$ROOT/supabase/migrations/20261030000000_rooftopos_spine.sql"
step "00 isolation (after spine)" "$S/00_isolation_check.sql" PASS
step "04 verify schema" "$S/04_verify_schema.sql" PASS
step "02 seed" "$S/02_seed_synthetic.sql" rooftopos-staging-b-native
step "02 seed, re-run" "$S/02_seed_synthetic.sql" rooftopos-staging-b-native

start_shim false
echo "-- phase 1 (ROOFTOP_INTEGRATIONS_ENABLED unset)"; runner phase1
start_shim true
echo "-- phase 2 (ROOFTOP_INTEGRATIONS_ENABLED=true)"; runner phase2
kill "$SHIM_PID" 2>/dev/null; wait "$SHIM_PID" 2>/dev/null; SHIM_PID=""

step "03 rollback" "$S/03_rollback.sql" PASS
step "00 isolation (after rollback)" "$S/00_isolation_check.sql" PASS
step "spine re-apply" "$ROOT/supabase/migrations/20261030000000_rooftopos_spine.sql"
step "00 isolation (after re-apply)" "$S/00_isolation_check.sql" PASS
step "04 verify schema (after re-apply)" "$S/04_verify_schema.sql" PASS
step "02 seed (after re-apply)" "$S/02_seed_synthetic.sql" rooftopos-staging-b-native
start_shim true
echo "-- phase 2 after rollback + re-apply"; runner phase2

[ $FAILED -eq 0 ] && echo "ALL PASS" || echo "FAILURES"
exit $FAILED
