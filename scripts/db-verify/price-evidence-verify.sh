#!/usr/bin/env bash
# Verifies the PROPOSED price_component_evidence migration in a throwaway
# local database: append-only, one row per reading, tenant-scoped reads,
# service-role-only writes, and a clean rollback. Never touches a hosted
# database.
#
#   PGHOST=/home/pgtest/sock PGPORT=54329 scripts/db-verify/price-evidence-verify.sh
set -eu  # no pipefail: grep -q closing a pipe early is not a failure here
DB=price_evidence_verify
PSQL=(psql -X -q -At -U "${PGUSER:-postgres}")
T1=b0000000-0000-4000-8000-0000000000e1
T2=b0000000-0000-4000-8000-0000000000e2
U1=a0000000-0000-4000-8000-0000000000e1
U2=a0000000-0000-4000-8000-0000000000e2
pass=0; fail=0
as_user_all() { "${PSQL[@]}" -d "$DB" -c "SET ROLE authenticated; SELECT set_config('request.jwt.claims', '{\"sub\":\"$1\",\"role\":\"authenticated\"}', false);" -c "$2" 2>&1; }
check() { # <label> <expected> <actual>
  if [[ "$2" == "$3" ]]; then pass=$((pass + 1)); echo "PASS  $1"; else fail=$((fail + 1)); echo "FAIL  $1 (expected '$2', got '$3')"; fi
}
q() { "${PSQL[@]}" -d "$DB" -c "$1" 2>&1; }
as_user() { "${PSQL[@]}" -d "$DB" -c "SET ROLE authenticated; SELECT set_config('request.jwt.claims', '{\"sub\":\"$1\",\"role\":\"authenticated\"}', false);" -c "$2" 2>&1 | grep -v '^{' | tail -1; }

"${PSQL[@]}" -d postgres -c "DROP DATABASE IF EXISTS $DB" -c "CREATE DATABASE $DB" >/dev/null
"${PSQL[@]}" -d "$DB" -f scripts/db-verify/00_platform.sql >/dev/null
"${PSQL[@]}" -d "$DB" -c "CREATE TABLE IF NOT EXISTS public.tenant_members (user_id uuid, tenant_id uuid, role text);
  INSERT INTO public.tenant_members VALUES ('$U1', '$T1', 'owner'), ('$U2', '$T2', 'owner');
  GRANT SELECT ON public.tenant_members TO authenticated;" >/dev/null
"${PSQL[@]}" -d "$DB" -f supabase/proposed/20261101000000_price_component_evidence.sql >/dev/null

RECORDS=$(bun scripts/db-verify/price-evidence-records.ts "$T1")
INSERT="INSERT INTO public.price_component_evidence (tenant_id, vin, captured_at, source_url, extractor_version, page_sha256, widget_sha256,
  screenshot_sha256, stack_status, component_role, label, amount, printed_sign, line_index, details, record_sha256)
  SELECT tenant_id, vin, captured_at, source_url, extractor_version, page_sha256, widget_sha256, screenshot_sha256, stack_status,
         component_role, label, amount, printed_sign, line_index, details, record_sha256
  FROM jsonb_populate_recordset(NULL::public.price_component_evidence, \$j\$$RECORDS\$j\$::jsonb)"

check "the service role writes a reading's components" "INSERT 0 $(jq length <<<"$RECORDS")" \
  "$(psql -X -At -U "${PGUSER:-postgres}" -d "$DB" -c "SET ROLE service_role" -c "$INSERT" 2>&1 | grep '^INSERT')"
check "the incentive row keeps its own eligibility and evidence" "incentive|Retail Cash|10000.00|unknown" \
  "$(q "SELECT concat_ws('|', component_role, label, amount, details->>'eligibility') FROM public.price_component_evidence WHERE component_role = 'incentive'")"
check "the page disclaimer is stored apart from the widget" "disclaimer_page|fee_excluded" \
  "$(q "SELECT concat_ws('|', component_role, label) FROM public.price_component_evidence WHERE component_role LIKE 'disclaimer%'")"
check "the same reading cannot be stored twice" "refused" \
  "$("${PSQL[@]}" -d "$DB" -c "SET ROLE service_role" -c "$INSERT" 2>&1 | grep -q 'duplicate key' && echo refused || echo stored)"
check "the service role cannot update a row" "refused" \
  "$(q "SET ROLE service_role; UPDATE public.price_component_evidence SET amount = 1" | grep -q 'permission denied' && echo refused || echo updated)"
check "the owner cannot update a row (trigger)" "refused" \
  "$(q "UPDATE public.price_component_evidence SET amount = 1" | grep -q 'append-only' && echo refused || echo updated)"
check "the owner cannot delete a row (trigger)" "refused" \
  "$(q "DELETE FROM public.price_component_evidence" | grep -q 'append-only' && echo refused || echo deleted)"
check "the owner cannot truncate the table (trigger)" "refused" \
  "$(q "TRUNCATE public.price_component_evidence" | grep -q 'append-only' && echo refused || echo truncated)"
check "a member of the tenant reads its rows" "$(jq length <<<"$RECORDS")" "$(as_user "$U1" "SELECT count(*) FROM public.price_component_evidence")"
check "a member of another tenant reads none" "0" "$(as_user "$U2" "SELECT count(*) FROM public.price_component_evidence")"
check "an authenticated user cannot insert" "refused" \
  "$(as_user_all "$U1" "INSERT INTO public.price_component_evidence (tenant_id, vin, captured_at, source_url, extractor_version, page_sha256, stack_status, component_role, record_sha256) VALUES ('$T1', '5XTEST0000000A001', now(), 'x', 'x', repeat('a', 64), 'x', 'msrp', repeat('b', 64))" | grep -q 'permission denied' && echo refused || echo inserted)"
check "every stored hash still matches its row" "0" \
  "$(q "SELECT count(*) FROM public.price_component_evidence WHERE record_sha256 !~ '^[0-9a-f]{64}\$'")"

"${PSQL[@]}" -d "$DB" -f supabase/proposed/20261101000000_price_component_evidence.rollback.sql >/dev/null
check "the rollback removes the table and its function" "0|0" \
  "$(q "SELECT (SELECT count(*) FROM pg_class WHERE relname = 'price_component_evidence') || '|' || (SELECT count(*) FROM pg_proc WHERE proname = 'price_component_evidence_immutable')")"

"${PSQL[@]}" -d postgres -c "DROP DATABASE IF EXISTS $DB" >/dev/null
echo "== $pass passed, $fail failed"
[[ $fail -eq 0 ]]
