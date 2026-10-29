#!/usr/bin/env bash
# Isolated database verification for the Administration V2 server authority.
#
# Builds a throwaway database on a local PostgreSQL, recreates the hosted
# pre-state, applies the two applied migrations verbatim from
# supabase/migrations, checks the functions and policies against fingerprints
# read from the hosted project, then runs the role-by-role cases in stages:
#
#   live          the hosted state as it is
#   preview fix   plus supabase/migrations/20261029120000_fix_fee_preview_warnings.sql
#   pricing       plus the proposed pricing-authority migration (--proposed)
#   fee conflict  a fee-inclusive tenant through the deployed fee functions,
#                 and the read-only reconciliation report
#   policy B      plus the proposed fee basis migration (--policy-b), with
#                 two-session concurrency, a reload export and the SQL/TypeScript
#                 parity grid
#   rollback      the data revert from an apply's audit row, then the code
#                 rollback in a fresh database checked against the hosted
#                 fingerprints and the hosted cases
#
# Nothing here connects to a hosted project.
#
#   PGHOST=/path/to/socket PGPORT=54329 scripts/db-verify/run.sh [--proposed] [--policy-b]
set -euo pipefail
cd "$(dirname "$0")/../.."
DB=${VERIFY_DB:-admin_v2_verify}
OUT=${VERIFY_OUT:-scripts/db-verify/last-run.csv}
PSQL=(psql -X -q -v ON_ERROR_STOP=1 -U "${PGUSER:-postgres}")
"${PSQL[@]}" -d postgres -c "DROP DATABASE IF EXISTS $DB" -c "CREATE DATABASE $DB" >/dev/null 2>&1
run() {
  local out status=0
  out=$("${PSQL[@]}" -d "$DB" -f "$1" 2>&1) || status=$?
  grep -vE '(^|: )NOTICE:|^ check|^-+$|^\(1 row\)$|^ *$' <<<"$out" || true
  if [[ $status -ne 0 ]]; then echo "== $1 failed; stopping" >&2; exit 2; fi
}
stage() { "${PSQL[@]}" -d "$DB" -c "UPDATE t.config SET stage = '$1'"; }

run scripts/db-verify/00_platform.sql
run scripts/db-verify/01_prestate.sql
run supabase/migrations/20261029000000_admin_v2_policy_apply.sql
run supabase/migrations/20261029001000_admin_v2_settings_authority.sql

echo "== Fidelity: local functions and policies against the hosted fingerprints"
"${PSQL[@]}" -d "$DB" -tA -c "
  WITH expected AS (SELECT * FROM json_to_recordset(pg_read_file('$(pwd)/scripts/db-verify/hosted-fingerprints.json')::json) AS x(kind text, name text, fp text)),
  local_all AS (
    SELECT 'function'::text AS kind, p.proname::text AS name, md5(pg_get_functiondef(p.oid)) AS fp FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
    UNION ALL
    SELECT 'policy', tablename || '|' || policyname, md5(cmd || roles::text || coalesce(qual,'') || coalesce(with_check,'')) FROM pg_policies WHERE schemaname = 'public')
  SELECT CASE WHEN l.fp = e.fp THEN 'match    ' ELSE 'MISMATCH ' END || e.kind || ' ' || e.name
  FROM expected e LEFT JOIN local_all l USING (kind, name) ORDER BY 1 DESC" | tee /dev/stderr | grep -c '^match' | xargs -I{} echo "== {} of $(grep -c '"kind"' scripts/db-verify/hosted-fingerprints.json) fingerprints match" >&2

run scripts/db-verify/02_harness.sql
run scripts/db-verify/03_fixture.sql
run scripts/db-verify/10_live.sql

stage 'preview fix'
run supabase/migrations/20261029120000_fix_fee_preview_warnings.sql
run scripts/db-verify/10_live.sql

stage 'fee conflict (deployed)'
run scripts/db-verify/04_fee_basis_fixture.sql
run scripts/db-verify/31_fee_conflict_deployed.sql
RECON=$(mktemp)
CHECKSUM="SELECT md5(string_agg(t::text, ',' ORDER BY id)) FROM public.vehicle_listings t"
"${PSQL[@]}" -d "$DB" -c "CREATE TABLE t.recon_checksums (checksum text); GRANT SELECT ON t.recon_checksums TO authenticated" \
  -c "INSERT INTO t.recon_checksums $CHECKSUM"
"${PSQL[@]}" -d "$DB" --csv -f scripts/db-verify/fee-basis-reconciliation.sql > "$RECON"
"${PSQL[@]}" -d "$DB" -c "INSERT INTO t.recon_checksums $CHECKSUM" \
  -c "CREATE TABLE t.recon (kind text, tenant_id uuid, basis text, action text, listing_id text, vin_suffix text, archived boolean,
        price numeric, before_fee numeric, doc_fee numeric, website_sale_price numeric, observed numeric, configured_fee numeric, policy_before_fee numeric, policy_total numeric,
        findings text, vehicles bigint); GRANT SELECT ON t.recon TO authenticated" \
  -c "\\copy t.recon FROM '$RECON' WITH CSV HEADER"
cp "$RECON" "${OUT%.csv}-reconciliation.csv"; rm -f "$RECON"
run scripts/db-verify/32_fee_reconciliation.sql

if [[ " $* " == *" --policy-b "* ]]; then
  stage 'policy B'
  run supabase/proposed/20261031000000_doc_fee_basis_policy_b.sql
  # Example Motors states its basis explicitly (before the fee), without a
  # version step, so the hosted cases keep their expected versions.
  "${PSQL[@]}" -d "$DB" -c "SET session_replication_role = replica" \
    -c "UPDATE public.dealer_profiles SET settings = settings || '{\"advertised_includes_doc_fee\": false}' WHERE tenant_id = 'b0000000-0000-4000-8000-000000000001'"
  run scripts/db-verify/10_live.sql
  run scripts/db-verify/30_fee_basis.sql
  "${PSQL[@]}" -d "$DB" -f scripts/db-verify/41_parity_export.sql > "${PARITY_EXPORT:-scripts/admin-parity/evidence/pricing/policy-b-sql-plans.json}"
  scripts/db-verify/40_concurrency.sh "$DB" "${RELOAD_EXPORT:-scripts/admin-parity/evidence/pricing/policy-b-reload.json}"
  scripts/db-verify/42_revert_and_rollback.sh "$DB"
fi

if [[ " $* " == *" --proposed "* ]]; then
  stage 'pricing proposal'
  run supabase/proposed/20261030000000_pricing_authority_delegation.sql
  run scripts/db-verify/20_proposed.sql
fi

echo "== Results by stage and area"
"${PSQL[@]}" -d "$DB" -c "SELECT * FROM t.summary()"
FAILED=$("${PSQL[@]}" -d "$DB" -tA -c "SELECT count(*) FROM t.results WHERE NOT pass")
if [[ "$FAILED" != "0" ]]; then
  echo "== Failures"
  "${PSQL[@]}" -d "$DB" -c "SELECT stage, area, label, principal, expected, actual, probe_expected, probe_actual, left(message, 80) AS message FROM t.results WHERE NOT pass ORDER BY seq"
fi
"${PSQL[@]}" -d "$DB" -c "\\copy (SELECT seq, stage, area, label, principal, expected, actual, probe_expected, probe_actual, pass FROM t.results ORDER BY seq) TO '$(pwd)/$OUT' WITH CSV HEADER" 2>/dev/null \
  || "${PSQL[@]}" -d "$DB" -c "\\copy (SELECT seq, stage, area, label, principal, expected, actual, probe_expected, probe_actual, pass FROM t.results ORDER BY seq) TO '$OUT' WITH CSV HEADER"
echo "== $("${PSQL[@]}" -d "$DB" -tA -c "SELECT count(*) FROM t.results") cases, $FAILED failed; results in $OUT"
[[ "$FAILED" == "0" ]]
