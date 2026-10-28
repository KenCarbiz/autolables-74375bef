#!/usr/bin/env bash
# Reproducible RooftopOS spine verification on a throwaway local Postgres 16.
# Never touches a Supabase project. Usage: supabase/tests/rooftopos_harness.sh
# Env: PGBIN (default /usr/lib/postgresql/16/bin), ROOFTOP_PG_PORT (default 54329),
#      KEEP=1 keeps the cluster and logs, SKIP_DENO=1 / SKIP_VITEST=1 skip those stages.
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PGBIN="${PGBIN:-/usr/lib/postgresql/16/bin}"
PORT="${ROOFTOP_PG_PORT:-54329}"
WORK="$(mktemp -d /tmp/rooftopos-pg.XXXXXX)"
LOGS="$WORK/logs"
mkdir -p "$LOGS"
chmod 755 "$WORK"; chmod 777 "$LOGS"

as_pg() { if [ "$(id -u)" = 0 ]; then runuser -u postgres -- "$@"; else "$@"; fi; }
[ "$(id -u)" = 0 ] && chown postgres "$WORK"

PSQL=("$PGBIN/psql" -h "$WORK" -p "$PORT" -U postgres -X -q)
RESULTS=()
FAILED=0

record() { RESULTS+=("$2"$'\t'"$1"$'\t'"$3"); [ "$2" = "PASS" ] || FAILED=1; }

cleanup() {
  as_pg "$PGBIN/pg_ctl" -D "$WORK/data" -m immediate stop >/dev/null 2>&1
  if [ "${KEEP:-0}" != "1" ]; then rm -rf "$WORK"; else echo "kept: $WORK"; fi
}
trap cleanup EXIT

as_pg "$PGBIN/initdb" -D "$WORK/data" -A trust -U postgres >"$LOGS/initdb.log" 2>&1 || { echo "initdb failed"; exit 2; }
as_pg "$PGBIN/pg_ctl" -D "$WORK/data" -o "-p $PORT -k $WORK -c listen_addresses=127.0.0.1" -l "$LOGS/postgres.log" -w start >/dev/null || { echo "postgres failed to start"; exit 2; }
"${PSQL[@]}" -d postgres -c "create database scratch" || exit 2
SCRATCH=("${PSQL[@]}" -d scratch -v ON_ERROR_STOP=1)
URL="postgresql://postgres@127.0.0.1:$PORT/scratch"

"${SCRATCH[@]}" -f "$ROOT/supabase/tests/rooftopos_stubs.sql" >"$LOGS/stubs.log" 2>&1
record "platform stubs (roles, auth, vault, storage, cron)" "$([ $? = 0 ] && echo PASS || echo FAIL)" "$LOGS/stubs.log"

# Replay the repo's real migration history (everything before the spine). Some historic
# migrations error on a fresh replay (extensions, drift); statements continue and the
# errors are counted, not hidden.
: >"$LOGS/history.log"
n=0
for f in $(ls "$ROOT"/supabase/migrations/*.sql | grep -v rooftopos_spine); do
  "${PSQL[@]}" -d scratch -f "$f" >/dev/null 2>>"$LOGS/history.log"
  n=$((n + 1))
done
errs=$(grep -c "ERROR:" "$LOGS/history.log")
tables=$("${PSQL[@]}" -d scratch -Atc "select count(*) from information_schema.tables where table_schema='public'")
record "real migration history replay ($n files, $errs replay errors, $tables public tables)" "$([ "$tables" -gt 100 ] && echo PASS || echo FAIL)" "$LOGS/history.log"

SPINE="$ROOT/supabase/migrations/20261030000000_rooftopos_spine.sql"
"${SCRATCH[@]}" -f "$SPINE" >"$LOGS/spine1.log" 2>&1
record "spine migration, first apply" "$([ $? = 0 ] && echo PASS || echo FAIL)" "$LOGS/spine1.log"
"$PGBIN/pg_dump" -h "$WORK" -p "$PORT" -U postgres -d scratch --schema-only --no-owner >"$LOGS/schema1.sql" 2>/dev/null

"${SCRATCH[@]}" -f "$SPINE" >"$LOGS/spine2.log" 2>&1
record "spine migration, second apply (must be clean)" "$([ $? = 0 ] && echo PASS || echo FAIL)" "$LOGS/spine2.log"
"$PGBIN/pg_dump" -h "$WORK" -p "$PORT" -U postgres -d scratch --schema-only --no-owner >"$LOGS/schema2.sql" 2>/dev/null
diff -q <(grep -v "restrict" "$LOGS/schema1.sql") <(grep -v "restrict" "$LOGS/schema2.sql") >/dev/null
record "schema identical after second apply (idempotent)" "$([ $? = 0 ] && echo PASS || echo FAIL)" "$LOGS/schema2.sql"

for t in rooftopos_spine_rls rooftopos_apply_sql; do
  "${SCRATCH[@]}" -f "$ROOT/supabase/tests/$t.sql" >"$LOGS/$t.log" 2>&1
  rc=$?
  passes=$(grep -c "NOTICE:  PASS" "$LOGS/$t.log")
  record "$t.sql ($passes PASS notices)" "$([ $rc = 0 ] && [ "$passes" -gt 0 ] && echo PASS || echo FAIL)" "$LOGS/$t.log"
done

if [ "${SKIP_DENO:-0}" != "1" ]; then
  if command -v deno >/dev/null 2>&1; then
    ROOFTOP_TEST_DB_URL="$URL" deno test -A "$ROOT/supabase/tests/deno/" >"$LOGS/deno.log" 2>&1
    rc=$?
    summary=$(sed 's/\x1b\[[0-9;]*m//g' "$LOGS/deno.log" | grep -E "^(ok|FAILED) \|" | tail -1 | tr -d '\r')
    record "deno HTTP + concurrency tests: $summary" "$([ $rc = 0 ] && echo PASS || echo FAIL)" "$LOGS/deno.log"
  else
    record "deno HTTP + concurrency tests (deno not installed: npm i -g deno)" "SKIP" "-"
  fi
fi

if [ "${SKIP_VITEST:-0}" != "1" ]; then
  (cd "$ROOT" && bunx vitest run supabase/functions/_shared/integrations) >"$LOGS/vitest.log" 2>&1
  rc=$?
  summary=$(grep -E "^\s+Tests " "$LOGS/vitest.log" | tail -1 | sed 's/^ *//')
  record "vitest integration unit tests: $summary" "$([ $rc = 0 ] && echo PASS || echo FAIL)" "$LOGS/vitest.log"
fi

echo
echo "RooftopOS harness results"
for r in "${RESULTS[@]}"; do
  IFS=$'\t' read -r status name log <<<"$r"
  printf '  %-5s %s\n' "$status" "$name"
done
if [ "$FAILED" != "0" ]; then
  KEEP=1
  echo "FAILED; logs in $LOGS"
  exit 1
fi
echo "ALL PASS"
