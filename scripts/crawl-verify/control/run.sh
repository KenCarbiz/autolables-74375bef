#!/usr/bin/env bash
# Isolated checks of the crawl controls (supabase/proposed/20261104000000) on a
# throwaway copy of the replica: checks.sql, then two concurrency checks that
# need two sessions:
#   hold first      an admin's hold is mid-transaction when a promotion starts:
#                   the promotion waits for it and then writes nothing
#   promotion first a promotion is mid-transaction when the hold is set: the
#                   hold waits for it; the promotion that began before the
#                   hold completes, and the next one is held
#   BASE_DB=crawl_verify_base PGHOST=... PGPORT=... scripts/crawl-verify/control/run.sh
set -euo pipefail
cd "$(dirname "$0")/../../.."
BASE=${BASE_DB:?set BASE_DB to a replica template, e.g. crawl_verify_base}
DB=crawl_control_verify
PSQL=(psql -X -q -v ON_ERROR_STOP=1 -U "${PGUSER:-postgres}")
"${PSQL[@]}" -d postgres -c "DROP DATABASE IF EXISTS $DB" -c "CREATE DATABASE $DB TEMPLATE $BASE" >/dev/null 2>&1
for f in supabase/proposed/20261101000000_price_component_evidence.sql supabase/proposed/20261102000000_crawl_observation_basis.sql supabase/proposed/20261104000000_crawl_control.sql; do
  "${PSQL[@]}" -d "$DB" -1 -f "$f" >/dev/null 2>&1
done
status=0
"${PSQL[@]}" -d "$DB" -f scripts/crawl-verify/control/checks.sql || status=$?

Q=(psql -X -qtA -U "${PGUSER:-postgres}" -d "$DB")
reset() { "${Q[@]}" -c "UPDATE public.vehicle_listings SET advertised_price_before_doc = 20000, doc_fee = 500, website_sale_price = 20500 WHERE id = 'c3000000-0000-4000-8000-000000000001'; UPDATE public.crawl_control SET promotion_enabled = true, execution_enabled = true" >/dev/null; }
ADMIN_SET="SELECT set_config('request.jwt.claims', '{\"sub\":\"c1000000-0000-4000-8000-000000000001\",\"role\":\"authenticated\"}', true); SET LOCAL ROLE authenticated; SELECT version FROM public.platform_set_crawl_control(false, false, 'hold for review', (SELECT version FROM public.crawl_control));"
pass=0; fail=0
report() { if [[ "$2" == "$3" ]]; then pass=$((pass+1)); echo "PASS  $1"; else fail=$((fail+1)); echo "FAIL  $1"; echo "      expected $2"; echo "      actual   $3"; fi; }

# Hold first: the admin's transaction holds the row lock for 2 s.
reset
( "${Q[@]}" -c "BEGIN; $ADMIN_SET SELECT pg_sleep(2); COMMIT;" >/dev/null ) & H=$!
sleep 0.5
t0=$(date +%s%N)
out=$("${Q[@]}" -c "SET ROLE service_role; SELECT cv.promote(19000);" | tail -1)
waited=$(( ($(date +%s%N) - t0) / 1000000 ))
wait $H
report "hold first: the promotion waited for the hold (>= 1000 ms) and wrote nothing" "held_promotion_off|20000|500|20500|waited" "$out|$("${Q[@]}" -c "SELECT cv.pricing()")|$([[ $waited -ge 1000 ]] && echo waited || echo "no wait ($waited ms)")"

# Promotion first: the crawler's promotion transaction holds its share lock for 2 s.
reset
( "${Q[@]}" -c "BEGIN; SET LOCAL ROLE service_role; SELECT cv.promote(19000); SELECT pg_sleep(2); COMMIT;" >/dev/null ) & P=$!
sleep 0.5
t0=$(date +%s%N)
"${Q[@]}" -c "BEGIN; $ADMIN_SET COMMIT;" >/dev/null
waited=$(( ($(date +%s%N) - t0) / 1000000 ))
wait $P
after=$("${Q[@]}" -c "SET ROLE service_role; SELECT cv.promote(18000);" | tail -1)
report "promotion first: the hold waited (>= 1000 ms) for the in-flight promotion, which completed; the next one is held" "waited|19000|500|19500|held_promotion_off|19000|500|19500" "$([[ $waited -ge 1000 ]] && echo waited || echo "no wait ($waited ms)")|$("${Q[@]}" -c "SELECT cv.pricing()")|$after|$("${Q[@]}" -c "SELECT cv.pricing()")"

echo "concurrency: $pass of $((pass+fail)) checks passed"
[[ $fail != 0 ]] && status=1
exit $status
