#!/usr/bin/env bash
# Disposable test for the AutoLabels hosted package (supabase/hosted/autolabels). Builds a node "as hosted
# today" (platform stand-ins, minimal hosted prerequisites, Supabase default privileges, the 0009 estimator
# body, and no RooftopOS object), then runs the ordered apply plan step by step, re-applies it for
# idempotence, runs the post checks, the security verification and the forward-recovery files, and verifies
# checksums. Throwaway socket-only cluster, synthetic data only; never connects to Supabase or Lovable.
#   bash supabase/tests/rtgip/al-hosted-package-test.sh                  run the checks
#   bash supabase/tests/rtgip/al-hosted-package-test.sh --write-expected  refresh expected-fingerprint.json and SHA256SUMS
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
SB="$ROOT/supabase"
PKG="$SB/hosted/autolabels"
T="$SB/tests"
PGBIN="${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
PORT="${RTGIP_PG_PORT:-55484}"
WRITE=0; [ "${1:-}" = "--write-expected" ] && WRITE=1
WORK="$(mktemp -d)"; chmod 755 "$WORK"
RUNAS=()
if [ "$(id -u)" = "0" ]; then chown postgres "$WORK"; RUNAS=(runuser -u postgres --); fi
PASS=0; FAIL=0
cleanup() { "${RUNAS[@]}" "$PGBIN/pg_ctl" -D "$WORK/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$WORK"; }
trap cleanup EXIT
"${RUNAS[@]}" "$PGBIN/initdb" -D "$WORK/data" -U postgres -A trust >/dev/null
"${RUNAS[@]}" "$PGBIN/pg_ctl" -D "$WORK/data" -o "-p $PORT -k $WORK -c listen_addresses=''" -l "$WORK/pg.log" -w start >/dev/null

if [ ${#RUNAS[@]} -gt 0 ]; then
  printf '#!/bin/sh\nexec runuser -u postgres -- env PGOPTIONS="-c client_min_messages=warning" %s/psql "$@"\n' "$PGBIN" > "$WORK/psql"
else
  printf '#!/bin/sh\nexec env PGOPTIONS="-c client_min_messages=warning" %s/psql "$@"\n' "$PGBIN" > "$WORK/psql"
fi
chmod 755 "$WORK/psql"
export PSQL="$WORK/psql"

conn() { echo "host=$WORK port=$PORT dbname=$1 user=postgres"; }
psqlq() { local db="$1"; shift; "$PSQL" "$(conn "$db")" -v ON_ERROR_STOP=1 -qAtX "$@"; }
install() { psqlq "$1" --single-transaction -f "$2" >/dev/null; }
plan() { local db="$1"; shift; AL_CONN="$(conn "$db")" "$PKG/apply-plan.sh" "$@"; }
rc() { local r=0; "$@" >/dev/null 2>&1 || r=$?; echo "$r"; }
check() { if [ "$2" = "$3" ]; then PASS=$((PASS+1)); echo "PASS  $1"; else FAIL=$((FAIL+1)); echo "FAIL  $1 -> got [$2] want [$3]"; fi; }
jq_() { python3 -c "import json,sys; d=json.load(sys.stdin); print(eval(sys.argv[1]))" "$1"; }
fp() { PGOPTIONS="-c default_transaction_read_only=on -c client_min_messages=warning" psqlq "$1" -f "$PKG/al-hosted-fingerprint.sql"; }
states() { fp "$1" | jq_ "' '.join(k+'='+d['components'][k]['state'] for k in sorted(d['components']))"; }
digests() { fp "$1" | jq_ "json.dumps({k: d['components'][k]['digest'] for k in sorted(d['components'])}, sort_keys=True)"; }
can() { psqlq "$1" -c "SELECT has_function_privilege('$2', '$3', 'EXECUTE')"; }
STEPS=(S1 S2 S3 D R E)
declare -A FILE=(
  [S1]="$SB/proposed/20261030000000_rooftopos_spine.sql" [S2]="$SB/proposed/20261108000000_canonical_store_registry.sql"
  [S3]="$SB/proposed/20261109000000_vehicle_history_foundation.sql" [D]="$SB/proposed/rtgip_v2_delivery.proposed.sql"
  [R]="$SB/proposed/rtgip_source_readers.proposed.sql" [E]="$SB/proposed/rtgip_labels_effects.proposed.sql")
approve() { for s in "${STEPS[@]}"; do export "AL_APPROVED_$s=$(sha256sum "${FILE[$s]}" | cut -d' ' -f1)"; done; }
unapprove() { for s in "${STEPS[@]}"; do unset "AL_APPROVED_$s"; done; }
acl() { psqlq "$1" -c "SELECT md5(string_agg(k || ':' || a, ';' ORDER BY k)) FROM (
    SELECT 'f ' || p.oid::regprocedure::text AS k, coalesce((SELECT string_agg(x::text, ',' ORDER BY x::text) FROM unnest(p.proacl) x), '-') AS a FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname IN ('rtgip','rtgip_src','rtgip_fx') OR (n.nspname = 'public' AND (p.proname ~ '^(integration_|vehicle_history_)' OR p.proname IN ('tenant_store_registry','apply_payment_estimator_settings','repair_items_record_status','vehicle_instances_custody_guard')))
    UNION ALL SELECT 't ' || n.nspname || '.' || c.relname, coalesce((SELECT string_agg(x::text, ',' ORDER BY x::text) FROM unnest(c.relacl) x), '-') FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE c.relkind IN ('r','p') AND (n.nspname IN ('rtgip','rtgip_src','rtgip_fx') OR (n.nspname = 'public' AND c.relname ~ '^(vehicles|vehicle_instances|vehicle_external_refs|integration_.*|inspection_evidence|repair_items|acquisition_records|vehicle_identity_.*|vehicle_custody_milestones|service_visits|repair_item_status_history|vehicle_reappearance_reviews|vehicle_access_grants|vehicle_history_.*)$'))
    UNION ALL SELECT 'r ' || rolname, rolcanlogin::text || rolinherit::text FROM pg_roles WHERE rolname LIKE 'rtgip\_%') x"; }
hosted_today() {
  "${RUNAS[@]}" "$PGBIN/createdb" -h "$WORK" -p "$PORT" -U postgres "$1"
  install "$1" "$T/rooftopos_stubs.sql"
  install "$1" "$T/rtgip/al-hosted-seed.sql"
  install "$1" "$T/rtgip/al-hosted-default-privileges.sql"
  install "$1" "$SB/proposed/20261108000000_canonical_store_registry.rollback.sql"
}

# 0. Static facts about the package.
check "the delivery ledger is the frozen file (sha256 matches the contract freeze pin)" "$(sha256sum "$SB/proposed/rtgip_v2_delivery.proposed.sql" | cut -d' ' -f1)" "$(python3 -c "import json; print(json.load(open('$ROOT/src/lib/rooftopos-parked/rtgip2/rtgip2-contract-freeze.v1.json'))['delivery_sql']['supabase/proposed/rtgip_v2_delivery.proposed.sql'])")"
check "the fingerprint holds no write or DDL keyword" "$(grep -v '^--' "$PKG/al-hosted-fingerprint.sql" | sed "s/'[^']*'//g" | grep -ciwE "insert|update|delete|create|alter|drop|grant|revoke|truncate|set" || true)" "0"
check "the package holds no non-ASCII character (no emoji)" "$(grep -rlP '[^\x00-\x7F]' "$PKG" "$T/rtgip/al-hosted-seed.sql" "$T/rtgip/al-hosted-package-test.sh" 2>/dev/null | wc -l | tr -d ' ')" "0"
check "no component creates a cron schedule" "$(grep -il 'cron.schedule' "$PKG"/*.sql "$PKG"/checks/*.sql "$PKG"/disable/*.sql | wc -l | tr -d ' ')" "0"
check "the committed hosted fingerprint recorded every component missing" "$(jq_ "' '.join(k+'='+v['state'] for k,v in sorted(d['result']['components'].items()))" < "$PKG/hosted-fingerprint-2026-11-03.json")" "D=missing E=missing R=missing S1=missing S2=missing S3=missing"

# 1. Hosted today: prerequisites present, 0009 estimator body, every component missing.
hosted_today al_h
HOSTED_APPLY_MD5="$(jq_ "d['result']['prerequisites']['function public.apply_payment_estimator_settings (pre-S2 or S2 body)']['detail'][0]['body_md5']" < "$PKG/hosted-fingerprint-2026-11-03.json")"
check "the 0009 estimator body used here is byte-identical to hosted (md5)" "$(psqlq al_h -c "SELECT md5(prosrc) FROM pg_proc WHERE proname = 'apply_payment_estimator_settings'")" "$HOSTED_APPLY_MD5"
F0="$(fp al_h)"
check "hosted-today node: every prerequisite present" "$(echo "$F0" | jq_ "[k for k,v in d['prerequisites'].items() if not v['present']]")" "[]"
check "hosted-today node: every component missing" "$(states al_h)" "D=missing E=missing R=missing S1=missing S2=missing S3=missing"
check "hosted-today node: no rtgip role, schema or table" "$(echo "$F0" | jq_ "[d['roles'], d['security']['tables']]")" "[{}, []]"
check "the fingerprint ran in a read-only transaction and wrote nothing" "$(psqlq al_h -c "SELECT count(*) FROM pg_namespace WHERE nspname LIKE 'rtgip%'")" "0"

# 2. Backup gate.
unapprove
check "gate refuses without a backup record" "$(rc env -u AL_BACKUP_RECORD "$PKG/apply-plan.sh" gate)" "1"
printf 'pitr_or_snapshot_id=snap-1\ntaken_at=2026-11-03T00:00:00Z\nrestore_rehearsed=no\noperator=op\n' > "$WORK/rec_bad"
check "gate refuses when the restore was not rehearsed" "$(rc env AL_BACKUP_RECORD="$WORK/rec_bad" "$PKG/apply-plan.sh" gate)" "1"
printf 'pitr_or_snapshot_id=snap-1\ntaken_at=2026-11-03T00:00:00Z\nrestore_rehearsed=yes\noperator=op\n' > "$WORK/rec_ok"
check "gate passes with a complete backup record" "$(rc env AL_BACKUP_RECORD="$WORK/rec_ok" "$PKG/apply-plan.sh" gate)" "0"
check "backup-prerequisites.sql runs read only and captures the estimator definition" "$(PGOPTIONS='-c default_transaction_read_only=on' psqlq al_h -f "$PKG/backup-prerequisites.sql" | grep -c '^apply_payment_estimator_settings_definition|')" "1"

# 3. Prerequisites between components are enforced; a refused file leaves nothing behind.
check "plan: S3 refuses without the spine" "$(rc plan al_h step S3 pre)" "1"
check "plan: R refuses without S1 and S3" "$(rc plan al_h step R pre)" "1"
check "plan: E refuses without D and R" "$(rc plan al_h step E pre)" "1"
check "plan: apply refuses without the per-file approval" "$(rc plan al_h step S1 apply)" "1"
if install al_h "${FILE[R]}" 2>/dev/null; then check "R file refuses without S3 (single transaction)" "applied" "refused"; else check "R file refuses without S3 (single transaction)" "refused" "refused"; fi
if install al_h "${FILE[S3]}" 2>/dev/null; then check "S3 file refuses without the spine (single transaction)" "applied" "refused"; else check "S3 file refuses without the spine (single transaction)" "refused" "refused"; fi
check "refused files install nothing" "$(states al_h)" "D=missing E=missing R=missing S1=missing S2=missing S3=missing"
hosted_today al_part
psqlq al_part -c "CREATE TABLE public.vehicles (vin text PRIMARY KEY)" >/dev/null
check "plan: a partial component stops the plan" "$(rc plan al_part step S1 pre)" "1"
check "plan: a partial component is reported as partial" "$(states al_part | grep -o 'S1=[a-z]*')" "S1=partial"

# 4. The ordered plan, one component at a time. Only that component's digest changes.
approve
declare -A DIG=()
want="D=missing E=missing R=missing S1=missing S2=missing S3=missing"
for s in "${STEPS[@]}"; do
  check "plan: $s pre passes" "$(rc plan al_h step "$s" pre)" "0"
  check "plan: $s run (pre, apply, post)" "$(rc plan al_h step "$s" run)" "0"
  want="${want/$s=missing/$s=installed}"
  check "after $s: $want" "$(states al_h)" "$want"
  for k in "${!DIG[@]}"; do
    check "after $s: $k digest unchanged" "$(fp al_h | jq_ "d['components']['$k']['digest']")" "${DIG[$k]}"
  done
  DIG[$s]="$(fp al_h | jq_ "d['components']['$s']['digest']")"
done
F1="$(fp al_h)"
COMP="$(digests al_h)"; A1="$(acl al_h)"
check "every component fully present" "$(echo "$F1" | jq_ "[(k, v['present'], v['total']) for k, v in sorted(d['components'].items())] == [(k, v['total'], v['total']) for k, v in sorted(d['components'].items())]")" "True"
check "transport stays disabled" "$(echo "$F1" | jq_ "'\"transport_enabled\":false' in (d['transport'] or '').replace(' ', '')")" "True"
check "every rtgip role is NOLOGIN" "$(echo "$F1" | jq_ "all(not v['login'] for v in d['roles'].values())")" "True"
check "no rtgip table is open to anon or authenticated" "$(echo "$F1" | jq_ "d['security']['rtgip_tables_open_to_api']")" "[]"
check "every SECURITY DEFINER package function pins search_path" "$(echo "$F1" | jq_ "d['security']['definer_without_search_path']")" "[]"
check "the shared inbox runs the AutoLabels effect" "$(echo "$F1" | jq_ "'labels_apply' in d['consumer_effect']")" "True"
check "plan: verify (RLS and grants) passes" "$(rc plan al_h verify)" "0"

# 5. Idempotent: the plan skips installed components, and re-applying every file changes nothing.
for s in "${STEPS[@]}"; do check "plan: $s is skipped when installed" "$(rc plan al_h step "$s" run)" "10"; done
for s in "${STEPS[@]}"; do install al_h "${FILE[$s]}"; install al_h "${FILE[$s]}"; done
check "re-applying every file twice changes no component digest" "$(digests al_h)" "$COMP"
check "re-applying every file twice changes no grant" "$(acl al_h)" "$A1"
for s in "${STEPS[@]}"; do check "plan: $s post still passes after re-apply" "$(rc plan al_h step "$s" post)" "0"; done

# 6. The verification queries catch what they claim to.
psqlq al_h -c "GRANT SELECT ON rtgip.outbox TO anon" >/dev/null
check "verify fails when anon can read an rtgip table" "$(rc plan al_h verify)" "1"
check "D post fails when anon can read an rtgip table" "$(rc plan al_h step D post)" "1"
psqlq al_h -c "REVOKE SELECT ON rtgip.outbox FROM anon" >/dev/null
psqlq al_h -c "GRANT SELECT ON rtgip_fx.applied TO authenticated" >/dev/null
check "verify fails when authenticated can read an rtgip_fx table" "$(rc plan al_h verify)" "1"
psqlq al_h -c "REVOKE SELECT ON rtgip_fx.applied FROM authenticated" >/dev/null
psqlq al_h -c "CREATE FUNCTION rtgip_src.zz_unpinned() RETURNS int LANGUAGE sql SECURITY DEFINER AS 'SELECT 1'; REVOKE ALL ON FUNCTION rtgip_src.zz_unpinned() FROM PUBLIC, anon, authenticated, service_role" >/dev/null
check "verify fails on a SECURITY DEFINER function without search_path" "$(rc plan al_h verify)" "1"
psqlq al_h -c "DROP FUNCTION rtgip_src.zz_unpinned()" >/dev/null
check "verify passes again after the probes are removed" "$(rc plan al_h verify)" "0"
check "the grants are back to the installed state" "$(acl al_h)" "$A1"

# 7. Forward recovery, newest first. Rows survive; only grants and the inbox effect change.
TENANT="$(cat /proc/sys/kernel/random/uuid)"; STORE="$(cat /proc/sys/kernel/random/uuid)"
psqlq al_h -c "INSERT INTO public.tenants (id) VALUES ('$TENANT'); INSERT INTO public.dealer_stores (id, tenant_id, display_name) VALUES ('$STORE', '$TENANT', 's');
  INSERT INTO rtgip_src.rooftop_stores (tenant_id, rooftop_id, store_id, mapped_by, reason) VALUES ('$TENANT', 'rf-test-01', '$STORE', '$TENANT', 'package test row');
  INSERT INTO rtgip.audit_log (actor, action) VALUES ('package_test', 'seed')" >/dev/null
ROWS_BEFORE="$(psqlq al_h -c "SELECT (SELECT count(*) FROM rtgip_src.rooftop_stores) || '/' || (SELECT count(*) FROM public.tenants) || '/' || (SELECT count(*) FROM rtgip.audit_log) || '/' || (SELECT count(*) FROM public.vehicles)")"
check "seed row exists in rtgip_src.rooftop_stores" "${ROWS_BEFORE%%/*}" "1"
check "before disable: the consumer can apply" "$(can al_h rtgip_labels_consumer 'rtgip_fx.labels_apply(jsonb)')" "t"
plan al_h step E disable
check "E disabled: the consumer cannot apply" "$(can al_h rtgip_labels_consumer 'rtgip_fx.labels_apply(jsonb)')" "f"
check "E disabled: the shared inbox gets no_consumer" "$(psqlq al_h -c "SELECT rtgip.consumer_effect('{}'::jsonb)->>'reason'")" "no_consumer"
check "E disabled: the receiver no longer assumes the consumer role" "$(psqlq al_h -c "SELECT pg_has_role('rtgip_inbox_receiver', 'rtgip_labels_consumer', 'MEMBER')")" "f"
check "E disabled: the E post check fails" "$(rc plan al_h step E post)" "1"
plan al_h step R disable
check "R disabled: the reader cannot read episodes" "$(can al_h rtgip_source_reader 'rtgip_src.labels_episode_history(uuid,text,uuid)')" "f"
plan al_h step D disable
check "D disabled: the dispatcher cannot claim" "$(can al_h rtgip_dispatcher 'rtgip.outbox_claim(text,integer,integer)')" "f"
check "D disabled: the receiver cannot admit" "$(can al_h rtgip_inbox_receiver 'rtgip.inbox_admit(jsonb,text,text,jsonb)')" "f"
check "D disabled: the operator cannot read the ledger" "$(psqlq al_h -c "SELECT has_table_privilege('rtgip_operator', 'rtgip.outbox', 'SELECT')")" "f"
plan al_h step S3 disable
check "S3 disabled: staff cannot record milestones" "$(can al_h authenticated 'public.vehicle_history_record_milestone(uuid,text,timestamptz,text,text,text,text,uuid,uuid,text,bigint)')" "f"
check "S3 disabled: the service role cannot claim the inbox" "$(can al_h service_role 'public.integration_claim_inbox(integer,integer)')" "f"
check "S3 disabled: staff cannot read the custody history" "$(psqlq al_h -c "SELECT has_table_privilege('authenticated', 'public.vehicle_custody_milestones', 'SELECT')")" "f"
check "S3 disabled: the append-only and custody-guard triggers stay enabled" "$(psqlq al_h -c "SELECT count(*) FROM pg_trigger WHERE tgname IN ('vehicle_custody_milestones_append_only','vehicle_history_audit_append_only','vehicle_history_settings_append_only','vehicle_instances_custody_guard') AND tgenabled = 'O'")" "4"
plan al_h step S1 disable
check "S1 disabled: the service role cannot read connection secrets" "$(can al_h service_role 'public.integration_connection_secrets(uuid)')" "f"
plan al_h step S2 disable
check "S2 disabled: staff cannot call the registry reader" "$(can al_h authenticated 'public.tenant_store_registry(uuid)')" "f"
check "disables keep every row" "$(psqlq al_h -c "SELECT (SELECT count(*) FROM rtgip_src.rooftop_stores) || '/' || (SELECT count(*) FROM public.tenants) || '/' || (SELECT count(*) FROM rtgip.audit_log) || '/' || (SELECT count(*) FROM public.vehicles)")" "$ROWS_BEFORE"
check "disables drop no object; E reads partial because the inbox effect is unwired" "$(states al_h)" "D=installed E=partial R=installed S1=installed S2=installed S3=installed"
check "disables change no other component digest" "$(digests al_h | jq_ "json.dumps({k: v for k, v in d.items() if k != 'E'}, sort_keys=True)")" "$(echo "$COMP" | jq_ "json.dumps({k: v for k, v in d.items() if k != 'E'}, sort_keys=True)")"
check "plan: a disabled E stops the plan (partial) instead of silently re-applying" "$(rc plan al_h step E pre)" "1"
check "verify still passes on the disabled node (nothing is more open)" "$(rc plan al_h verify)" "0"

# 8. Recovery round trip: re-applying the files restores every grant and the same digests.
for s in "${STEPS[@]}"; do install al_h "${FILE[$s]}"; done
check "re-applied after disable: same component digests" "$(digests al_h)" "$COMP"
check "re-applied after disable: same grants" "$(acl al_h)" "$A1"
check "re-applied after disable: the consumer can apply again" "$(can al_h rtgip_labels_consumer 'rtgip_fx.labels_apply(jsonb)')" "t"
check "re-applied after disable: rows are intact" "$(psqlq al_h -c "SELECT (SELECT count(*) FROM rtgip_src.rooftop_stores) || '/' || (SELECT count(*) FROM public.tenants) || '/' || (SELECT count(*) FROM rtgip.audit_log) || '/' || (SELECT count(*) FROM public.vehicles)")" "$ROWS_BEFORE"
for s in "${STEPS[@]}"; do check "plan: $s post passes after the round trip" "$(rc plan al_h step "$s" post)" "0"; done

# 9. Expected values and checksums the hosted operator compares against.
EXP="$PKG/expected-fingerprint.json"
NEW="$(python3 - "$COMP" "$A1" "$HOSTED_APPLY_MD5" "$(echo "$F1" | jq_ "{k: [v['present'], v['total']] for k, v in sorted(d['components'].items())}")" <<'PY'
import json, sys, ast
print(json.dumps({"after_install_component_digests": ast.literal_eval(sys.argv[1]),
  "after_install_grants_md5": sys.argv[2],
  "component_object_counts": ast.literal_eval(sys.argv[4]),
  "hosted_apply_payment_estimator_settings_md5_before_S2": sys.argv[3]}, indent=2, sort_keys=True))
PY
)"
SUMS="$(cd "$ROOT" && sha256sum supabase/proposed/20261030000000_rooftopos_spine.sql supabase/proposed/20261108000000_canonical_store_registry.sql \
  supabase/proposed/20261109000000_vehicle_history_foundation.sql supabase/proposed/rtgip_v2_delivery.proposed.sql \
  supabase/proposed/rtgip_source_readers.proposed.sql supabase/proposed/rtgip_labels_effects.proposed.sql \
  supabase/hosted/autolabels/al-hosted-fingerprint.sql supabase/hosted/autolabels/backup-prerequisites.sql supabase/hosted/autolabels/verify-security.sql \
  supabase/hosted/autolabels/checks/S1_pre.sql supabase/hosted/autolabels/checks/S1_post.sql supabase/hosted/autolabels/checks/S2_pre.sql supabase/hosted/autolabels/checks/S2_post.sql \
  supabase/hosted/autolabels/checks/S3_pre.sql supabase/hosted/autolabels/checks/S3_post.sql supabase/hosted/autolabels/checks/D_pre.sql supabase/hosted/autolabels/checks/D_post.sql \
  supabase/hosted/autolabels/checks/R_pre.sql supabase/hosted/autolabels/checks/R_post.sql supabase/hosted/autolabels/checks/E_pre.sql supabase/hosted/autolabels/checks/E_post.sql \
  supabase/hosted/autolabels/disable/S1_disable.sql supabase/hosted/autolabels/disable/S2_disable.sql supabase/hosted/autolabels/disable/S3_disable.sql \
  supabase/hosted/autolabels/disable/D_disable.sql supabase/hosted/autolabels/disable/R_disable.sql supabase/hosted/autolabels/disable/E_disable.sql \
  supabase/hosted/autolabels/apply-plan.sh supabase/tests/rtgip/al-hosted-seed.sql supabase/tests/rtgip/al-hosted-default-privileges.sql)"
if [ "$WRITE" = 1 ]; then
  printf '%s\n' "$NEW" > "$EXP"; printf '%s\n' "$SUMS" > "$PKG/SHA256SUMS"; echo "wrote $EXP and $PKG/SHA256SUMS"
else
  check "expected-fingerprint.json matches this run" "$(cat "$EXP" 2>/dev/null)" "$NEW"
  check "SHA256SUMS matches the package files" "$(cat "$PKG/SHA256SUMS" 2>/dev/null)" "$SUMS"
  check "sha256sum -c accepts SHA256SUMS" "$(cd "$ROOT" && sha256sum -c "$PKG/SHA256SUMS" >/dev/null 2>&1 && echo ok || echo bad)" "ok"
fi

echo "AutoLabels hosted package PostgreSQL $(psqlq al_h -c 'SHOW server_version') results: $PASS passed, $FAIL failed"
[ "$FAIL" = 0 ]
