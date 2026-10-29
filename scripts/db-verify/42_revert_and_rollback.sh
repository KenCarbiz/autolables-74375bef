#!/usr/bin/env bash
# The way back, verified. Runs after 40_concurrency.sh.
#
#  1. Data: revert the last policy B apply on Third Example Motors from its
#     audit row (fee-change-revert-from-audit.sql), with one vehicle changed by
#     a later writer, which must be skipped.
#  2. Code: in a second, fresh database at the hosted state, take the
#     fingerprints of the four functions policy B redefines, apply policy B,
#     apply its rollback, and require the same fingerprints and grants, no
#     added function left behind, and the hosted cases (10_live.sql) passing.
# Every outcome is recorded in the main database's t.results.
#
#   scripts/db-verify/42_revert_and_rollback.sh <db>
set -euo pipefail
DB=$1
RB="${DB}_rollback"
PSQL=(psql -X -q -At -v ON_ERROR_STOP=1 -U "${PGUSER:-postgres}")
T3=b0000000-0000-4000-8000-000000000003
record() { # <area> <label> <expected> <actual>
  "${PSQL[@]}" -d "$DB" -c "INSERT INTO t.results (stage, area, label, principal, expected, actual, pass)
    VALUES ('rollback', \$a\$$1\$a\$, \$l\$$2\$l\$, 'postgres', \$e\$$3\$e\$, \$x\$$4\$x\$, \$e\$$3\$e\$ = \$x\$$4\$x\$)"
}
vrow() { "${PSQL[@]}" -d "$DB" -c "SELECT concat_ws('|', price, advertised_price_before_doc, doc_fee, website_sale_price) FROM public.vehicle_listings WHERE id = '$1'"; }

# ── 1. Data revert from the audit row ──────────────────────────────────────
AUDIT=$("${PSQL[@]}" -d "$DB" -c "SELECT id FROM public.audit_log WHERE action = 'doc_fee_policy_applied' AND store_id = '$T3' AND details->>'idempotency_key' = 'conc-e-000001'")
"${PSQL[@]}" -d "$DB" -c "UPDATE public.vehicle_listings SET price = 25100, advertised_price_before_doc = 24175, website_sale_price = 25100 WHERE id = 'c0000000-0000-4000-8000-000000000307'"
OUTCOME=$("${PSQL[@]}" -d "$DB" -v audit_id="$AUDIT" -f scripts/db-verify/fee-change-revert-from-audit.sql | tr '\n' ' ' | sed 's/ $//')
record 'data revert' 'per-vehicle outcome (a later writer changed 025000, so it is skipped)' '025000|skipped: changed since the apply 040420|reverted' "$OUTCOME"
record 'data revert' 'the traced vehicle is back at its before values (price|before-fee|fee|sale price)' '40420.00|39480.00|940.00|40420' "$(vrow c0000000-0000-4000-8000-000000000301)"
record 'data revert' 'the later writer''s values are kept' '25100.00|24175|925.00|25100' "$(vrow c0000000-0000-4000-8000-000000000307)"
record 'data revert' 'the fee setting is back and the revert is audited (amount|reverted|skipped)' '940|["040420"]|["025000"]' \
  "$("${PSQL[@]}" -d "$DB" -c "SELECT concat_ws('|', (SELECT settings->>'doc_fee_amount' FROM public.dealer_profiles WHERE tenant_id = '$T3'),
     (SELECT details->>'reverted' FROM public.audit_log WHERE action = 'doc_fee_policy_reverted'), (SELECT details->>'skipped_changed_since' FROM public.audit_log WHERE action = 'doc_fee_policy_reverted'))")"
record 'data revert' 'verification stamps and parse status untouched by the revert' '2026-10-05|ok' \
  "$("${PSQL[@]}" -d "$DB" -c "SELECT price_last_verified_at::date || '|' || price_parse_status FROM public.vehicle_listings WHERE id = 'c0000000-0000-4000-8000-000000000301'")"

# ── 2. Code rollback in a fresh database ──────────────────────────────────
"${PSQL[@]}" -d postgres -c "DROP DATABASE IF EXISTS $RB" -c "CREATE DATABASE $RB" >/dev/null
for f in scripts/db-verify/00_platform.sql scripts/db-verify/01_prestate.sql \
         supabase/migrations/20261029000000_admin_v2_policy_apply.sql supabase/migrations/20261029001000_admin_v2_settings_authority.sql \
         supabase/migrations/20261029120000_fix_fee_preview_warnings.sql scripts/db-verify/02_harness.sql scripts/db-verify/03_fixture.sql; do
  "${PSQL[@]}" -d "$RB" -f "$f" >/dev/null 2>&1 || { echo "== rollback setup failed at $f" >&2; exit 2; }
done
FP="SELECT string_agg(p.proname || ':' || md5(pg_get_functiondef(p.oid)) || ':' || coalesce(p.proacl::text, 'default'), ' ' ORDER BY p.proname)
    FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
     AND p.proname IN ('admin_doc_fee_change_preview', 'admin_doc_fee_change_apply', 'merge_dealer_settings', 'recalc_tenant_doc_fee')"
ADDED="SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace
       AND proname IN ('doc_fee_change_review', 'doc_fee_evidence_contradicts', 'doc_fee_row_plan', 'doc_fee_basis', 'doc_fee_setting_bool')"
BEFORE=$("${PSQL[@]}" -d "$RB" -c "$FP")
"${PSQL[@]}" -d "$RB" -f supabase/proposed/20261031000000_doc_fee_basis_policy_b.sql >/dev/null
DURING=$("${PSQL[@]}" -d "$RB" -c "$FP")
"${PSQL[@]}" -d "$RB" -f supabase/proposed/20261031000000_doc_fee_basis_policy_b.rollback.sql >/dev/null
AFTER=$("${PSQL[@]}" -d "$RB" -c "$FP")
record 'code rollback' 'policy B changes all four functions' 'true' "$([[ "$BEFORE" != "$DURING" && $(wc -w <<<"$DURING") == 4 ]] && echo true || echo false)"
record 'code rollback' 'after the rollback the four definitions and grants equal the hosted ones' "$BEFORE" "$AFTER"
record 'code rollback' 'no function the proposal added is left' '0' "$("${PSQL[@]}" -d "$RB" -c "$ADDED")"

"${PSQL[@]}" -d "$RB" -c "UPDATE t.config SET stage = 'rollback'"
"${PSQL[@]}" -d "$RB" -f scripts/db-verify/10_live.sql >/dev/null 2>&1 || { echo "== hosted cases failed to run after the rollback" >&2; exit 2; }
"${PSQL[@]}" -d "$RB" -c "\\copy (SELECT stage, 'hosted cases after rollback: ' || area, label, principal, expected, actual, probe_expected, probe_actual, message, pass FROM t.results ORDER BY seq) TO STDOUT WITH CSV" \
  | "${PSQL[@]}" -d "$DB" -c "\\copy t.results (stage, area, label, principal, expected, actual, probe_expected, probe_actual, message, pass) FROM STDIN WITH CSV"
"${PSQL[@]}" -d postgres -c "DROP DATABASE IF EXISTS $RB" >/dev/null
