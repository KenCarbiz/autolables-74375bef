#!/usr/bin/env bash
# Fail-closed provider budgets (supabase/proposed/20261106000000 on top of
# 20261103000000) on a throwaway copy of the replica: checks.sql, then two
# concurrency races. Each race starts WORKERS sessions at once, each holding
# its admission transaction open for a moment, against a lane with LIMIT
# units left; exactly LIMIT may be admitted. Then a negative control without
# the lane lock, and the rollback: 20261106's rollback plus a re-run of
# 20261103 must restore both gate functions exactly as they were before 20261106,
# keeping the lane table and every ledger row.
#   BASE_DB=crawl_verify_base PGHOST=... PGPORT=... scripts/budget-verify/failclosed/run.sh
set -euo pipefail
cd "$(dirname "$0")/../../.."
BASE=${BASE_DB:?set BASE_DB to a replica template}
DB=budget_failclosed_verify
WORKERS=${WORKERS:-30}; LIMIT=${LIMIT:-7}
PSQL=(psql -X -q -v ON_ERROR_STOP=1 -U "${PGUSER:-postgres}")
Q=(psql -X -qtA -U "${PGUSER:-postgres}" -d "$DB")
"${PSQL[@]}" -d postgres -c "DROP DATABASE IF EXISTS $DB" -c "CREATE DATABASE $DB TEMPLATE $BASE" >/dev/null 2>&1
DEFS="SELECT md5(pg_get_functiondef('public.provider_call_admit(text,text,text,boolean,uuid,text,numeric)'::regprocedure)) || '|' || md5(pg_get_functiondef('public.provider_call_record(bigint,integer,text,text)'::regprocedure))"
"${PSQL[@]}" -d "$DB" -1 -f supabase/proposed/20261103000000_provider_tenant_budgets.sql >/dev/null 2>&1
BEFORE=$("${Q[@]}" -c "$DEFS")
"${PSQL[@]}" -d "$DB" -1 -f supabase/proposed/20261106000000_provider_budget_fail_closed.sql >/dev/null 2>&1
status=0
"${PSQL[@]}" -d "$DB" -f scripts/budget-verify/failclosed/checks.sql || status=$?

race() {  # $1 label, $2 lane setup SQL, $3 provider, $4 cost or NULL
  "${Q[@]}" -c "DELETE FROM public.provider_call_events; DELETE FROM public.provider_tenant_budgets; $2" >/dev/null
  local pids=()
  for i in $(seq 1 "$WORKERS"); do
    ( "${Q[@]}" -c "BEGIN; SELECT admitted FROM public.provider_call_admit('$3', 'p', 'race-$i', false, NULL, NULL, $4); SELECT pg_sleep(0.3); COMMIT;" >/dev/null ) & pids+=($!)
  done
  for p in "${pids[@]}"; do wait "$p"; done
  local got
  got=$("${Q[@]}" -c "SELECT count(*) FILTER (WHERE outcome = 'admitted') || '|' || count(*) FILTER (WHERE outcome = 'budget_denied') FROM public.provider_call_events WHERE caller LIKE 'race-%'")
  if [[ "$got" == "$LIMIT|$((WORKERS-LIMIT))" ]]; then echo "PASS  race ($1): $WORKERS concurrent workers, $LIMIT admitted, $((WORKERS-LIMIT)) refused"; else echo "FAIL  race ($1): expected $LIMIT|$((WORKERS-LIMIT)) admitted|refused, got $got"; status=1; fi
}
race "call limit" "UPDATE public.provider_lane_budgets SET enabled = true, monthly_call_cap = $LIMIT, monthly_usd_cap = NULL WHERE provider = 'marketcheck' AND lane = 'enrichment'" marketcheck NULL
race "dollar limit" "UPDATE public.provider_lane_budgets SET enabled = true, monthly_call_cap = NULL, monthly_usd_cap = $LIMIT * 0.5 WHERE provider = 'firecrawl' AND lane = 'enrichment'" firecrawl 0.5

# Negative control: the same race against a copy of provider_call_admit with
# the lane lock removed must over-admit, or the race above proves nothing.
sed -n '/^CREATE OR REPLACE FUNCTION public.provider_call_admit(/,/^\$\$;$/p' supabase/proposed/20261106000000_provider_budget_fail_closed.sql \
  | sed 's/WHERE b.provider = p_provider AND b.lane = v_lane FOR UPDATE;/WHERE b.provider = p_provider AND b.lane = v_lane;/' \
  | "${PSQL[@]}" -d "$DB" >/dev/null
"${Q[@]}" -c "DELETE FROM public.provider_call_events; UPDATE public.provider_lane_budgets SET enabled = true, monthly_call_cap = $LIMIT, monthly_usd_cap = NULL WHERE provider = 'marketcheck' AND lane = 'enrichment'" >/dev/null
pids=()
for i in $(seq 1 "$WORKERS"); do
  ( "${Q[@]}" -c "BEGIN; SELECT admitted FROM public.provider_call_admit('marketcheck', 'p', 'race-$i', false, NULL, NULL, NULL); SELECT pg_sleep(0.3); COMMIT;" >/dev/null ) & pids+=($!)
done
for p in "${pids[@]}"; do wait "$p"; done
over=$("${Q[@]}" -c "SELECT count(*) FROM public.provider_call_events WHERE caller LIKE 'race-%' AND outcome = 'admitted'")
if (( over > LIMIT )); then echo "PASS  control: without the lane lock the same race admits $over of $WORKERS against a limit of $LIMIT"; else echo "FAIL  control: without the lane lock only $over were admitted; the race does not exercise the lock"; status=1; fi

events=$("${Q[@]}" -c "SELECT count(*) FROM public.provider_call_events")
"${PSQL[@]}" -d "$DB" -1 -f supabase/proposed/20261106000000_provider_budget_fail_closed.rollback.sql >/dev/null 2>&1
"${PSQL[@]}" -d "$DB" -1 -f supabase/proposed/20261103000000_provider_tenant_budgets.sql >/dev/null 2>&1
got=$("${Q[@]}" -c "$DEFS || '|' || (SELECT count(*) FROM public.provider_call_events) || '|' || (to_regclass('public.provider_lane_budgets') IS NOT NULL) || '|' || (to_regprocedure('public.platform_set_provider_lane_budget(text,text,boolean,integer,numeric,text,text,text)') IS NULL) || '|' || (to_regprocedure('public.provider_call_unreconciled(interval)') IS NULL)")
if [[ "$got" == "$BEFORE|$events|true|true|true" ]]; then echo "PASS  rollback: both gate functions restored exactly, $events ledger rows and the lane table kept, the new functions gone"; else echo "FAIL  rollback: expected $BEFORE|$events|true|true|true, got $got"; status=1; fi
exit $status
