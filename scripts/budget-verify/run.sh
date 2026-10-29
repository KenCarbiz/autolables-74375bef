#!/usr/bin/env bash
# Isolated checks of the per-dealership provider budgets on throwaway copies of
# the replica (the full migration chain on local stand-ins, aligned to the
# hosted catalogue, with the hosted provider_call_admit), in three stages:
#
#   hosted    the gate as deployed today: the platform rule and a reproduction
#             of a dealership with no limit
#   proposed  supabase/proposed/20261103000000 applied: every check
#   rollback  applied, then its rollback: the hosted gate must be restored
#             byte for byte and the platform rule must still hold
#
# Uses a template database when BASE_DB names one (for example
# crawl_verify_base from scripts/crawl-verify/e2e/run.sh); otherwise builds it.
#
#   PGHOST=/path/to/socket PGPORT=54329 scripts/budget-verify/run.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
PSQL=(psql -X -q -v ON_ERROR_STOP=1 -U "${PGUSER:-postgres}")
BASE=${BASE_DB:-budget_verify_base}
MIG=supabase/proposed/20261103000000_provider_tenant_budgets.sql
ROLLBACK=supabase/proposed/20261103000000_provider_tenant_budgets.rollback.sql

if [[ -z "${BASE_DB:-}" ]]; then
  EXT=$(pg_config --sharedir 2>/dev/null || echo /usr/share/postgresql/16)/extension
  for x in pg_cron pg_net; do
    [[ -f $EXT/$x.control ]] || { printf "comment = 'local stand-in'\ndefault_version = '1.0'\nrelocatable = false\n" > "$EXT/$x.control"; echo "-- stand-in" > "$EXT/$x--1.0.sql"; }
  done
  "${PSQL[@]}" -d postgres -c "DROP DATABASE IF EXISTS $BASE" -c "CREATE DATABASE $BASE" >/dev/null 2>&1
  "${PSQL[@]}" -d "$BASE" -f scripts/db-verify/00_platform.sql >/dev/null 2>&1
  "${PSQL[@]}" -d "$BASE" -f scripts/sync-verify/platform.sql >/dev/null 2>&1
  applied=0; failed=0
  for f in supabase/migrations/*.sql; do
    if "${PSQL[@]}" -d "$BASE" -1 -f "$f" >/dev/null 2>&1; then applied=$((applied+1)); else failed=$((failed+1)); fi
  done
  echo "== Migration chain: $applied applied, $failed did not apply on the local stand-ins"
  for f in scripts/sync-verify/align.sql scripts/sync-verify/hosted-functions.sql; do "${PSQL[@]}" -d "$BASE" -f "$f" >/dev/null; done
fi
fp() { "${PSQL[@]}" -tA -d "$1" -c "SELECT md5(pg_get_functiondef('public.provider_call_admit(text,text,text,boolean,uuid,text,numeric)'::regprocedure))"; }
HOSTED_FP=$(fp "$BASE")
echo "== Hosted provider_call_admit fingerprint on the replica: $HOSTED_FP"

overall=0
for STAGE in hosted proposed rollback; do
  DB=budget_verify_$STAGE
  "${PSQL[@]}" -d postgres -c "DROP DATABASE IF EXISTS $DB" -c "CREATE DATABASE $DB TEMPLATE $BASE" >/dev/null 2>&1
  proposed=false
  if [[ $STAGE != hosted ]]; then "${PSQL[@]}" -d "$DB" -1 -f "$MIG" >/dev/null 2>&1; proposed=true; fi
  if [[ $STAGE == rollback ]]; then
    "${PSQL[@]}" -d "$DB" -1 -f "$ROLLBACK" >/dev/null 2>&1
    proposed=false
    left=$("${PSQL[@]}" -tA -d "$DB" -c "SELECT count(*) FROM pg_class WHERE relname IN ('provider_tenant_budgets','provider_unit_prices','platform_alert_settings','provider_budget_alerts')")
    echo "== Stage rollback: tables left $left; provider_call_admit fingerprint $(fp "$DB") (hosted $HOSTED_FP)"
    [[ $left == 0 && $(fp "$DB") == "$HOSTED_FP" ]] || { echo "FAIL  rollback did not restore the hosted gate"; overall=1; }
  fi
  echo
  echo "======== Stage $STAGE"
  status=0
  psql -X -q -U "${PGUSER:-postgres}" -d "$DB" -v proposed=$proposed -f scripts/budget-verify/checks.sql || status=$?
  echo "== Stage $STAGE exit $status"
  [[ $status != 0 ]] && overall=1
done
exit $overall
