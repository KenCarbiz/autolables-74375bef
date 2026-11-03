#!/usr/bin/env bash
# Rooftop identity registry (PROPOSED) on a throwaway local Postgres. Never connects to Supabase.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
PGBIN="${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
PORT="${RTGIP_PG_PORT:-55441}"
WORK="$(mktemp -d)"; chmod 755 "$WORK"
RUNAS=()
if [ "$(id -u)" = "0" ]; then chown postgres "$WORK"; RUNAS=(runuser -u postgres --); fi
export PGOPTIONS="-c client_min_messages=warning"
PSQL=("${RUNAS[@]}" "$PGBIN/psql" -h 127.0.0.1 -p "$PORT" -U postgres -d rr -qAtX -v ON_ERROR_STOP=1)
cleanup() { "${RUNAS[@]}" "$PGBIN/pg_ctl" -D "$WORK/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$WORK"; }
trap cleanup EXIT
"${RUNAS[@]}" "$PGBIN/initdb" -D "$WORK/data" -U postgres -A trust >/dev/null
"${RUNAS[@]}" "$PGBIN/pg_ctl" -D "$WORK/data" -o "-p $PORT -k $WORK -c listen_addresses=127.0.0.1" -l "$WORK/pg.log" -w start >/dev/null
"${RUNAS[@]}" "$PGBIN/createdb" -h 127.0.0.1 -p "$PORT" -U postgres rr
cp "$ROOT/supabase/proposed/rooftop_registry.proposed.sql" "$WORK/rr.sql"; chmod a+r "$WORK/rr.sql"
"${PSQL[@]}" -f "$WORK/rr.sql" >/dev/null
"${PSQL[@]}" -f "$WORK/rr.sql" >/dev/null && echo "PASS  applies twice (idempotent)"
PASS=1; FAIL=0
q() { "${PSQL[@]}" -c "$1"; }
check() { local name="$1" want="$2" got; got="$(q "$3" 2>&1 | grep -v "^psql:.*CONTEXT\|^CONTEXT" | tail -1)" || true
  if [ "$got" = "$want" ]; then echo "PASS  $name"; PASS=$((PASS+1)); else echo "FAIL  $name: want [$want] got [$got]"; FAIL=$((FAIL+1)); fi; }
raises() { local name="$1" pat="$2" out; if out="$(q "$3" 2>&1)"; then echo "FAIL  $name: no error"; FAIL=$((FAIL+1));
  elif grep -q -- "$pat" <<<"$out"; then echo "PASS  $name"; PASS=$((PASS+1)); else echo "FAIL  $name: $out"; FAIL=$((FAIL+1)); fi; }

T1=11111111-1111-4111-8111-111111111111; T2=22222222-2222-4222-8222-222222222222
OP=aaaaaaaa-0000-4000-8000-000000000001; RV=aaaaaaaa-0000-4000-8000-000000000002
S1=33333333-0000-4000-8000-000000000001; S2=33333333-0000-4000-8000-000000000002; S3=33333333-0000-4000-8000-000000000003
AFT=44444444-0000-4000-8000-000000000001; AF1=55555555-0000-4000-8000-000000000001; AF2=55555555-0000-4000-8000-000000000002; AF3=55555555-0000-4000-8000-000000000003
L1=66666666-0000-4000-8000-000000000001; L2=66666666-0000-4000-8000-000000000002; L3=66666666-0000-4000-8000-000000000003
LOC=77777777-0000-4000-8000-000000000001
prop() { q "SELECT rooftop_registry.propose_rooftop('$OP','initial synthetic proposal','$1','$2','$3','$1','$4','$5',${6},'$AFT','$7')"; }
R1=$(prop $T1 rf-nw-01 "dealer:northwind-main" $S1 ac-dlr-1 "'$LOC'" $AF1)
check "proposal starts pending" "pending" "SELECT status FROM rooftop_registry.rooftops WHERE id='$R1'"
check "pending rooftop exports nothing (AL/AC/AF)" "0|0|0" "SELECT (SELECT count(*) FROM rooftop_registry.export_al_rooftop_stores)||'|'||(SELECT count(*) FROM rooftop_registry.export_ac_rooftop_scope)||'|'||(SELECT count(*) FROM rooftop_registry.export_af_rooftop_scope)"
check "creator cannot activate own proposal" "reviewer_is_creator" "SELECT rooftop_registry.activate_rooftop('$R1','$OP','looks right to me')"
check "self-review refusal is audited" "1" "SELECT count(*) FROM rooftop_registry.audit WHERE ref='$R1' AND action='refused'"
check "activation needs a reason" "reason_required" "SELECT rooftop_registry.activate_rooftop('$R1','$RV','ok')"
check "still pending after refusals" "pending" "SELECT status FROM rooftop_registry.rooftops WHERE id='$R1'"
check "second person with reason activates" "activated" "SELECT rooftop_registry.activate_rooftop('$R1','$RV','verified against dealer agreement')"
check "AL export after activation" "$T1|rf-nw-01|$S1" "SELECT tenant_id||'|'||rooftop_id||'|'||store_id FROM rooftop_registry.export_al_rooftop_stores"
check "AC export after activation" "ac-dlr-1|$LOC|$T1|rf-nw-01" "SELECT dealership_id||'|'||store_location_id||'|'||tenant_id||'|'||rooftop_id FROM rooftop_registry.export_ac_rooftop_scope"
check "AF export after activation" "$AF1|$T1|rf-nw-01" "SELECT af_rooftop_id||'|'||tenant_id||'|'||rooftop_id FROM rooftop_registry.export_af_rooftop_scope"
check "no Gateway connection without an active grant" "0" "SELECT count(*) FROM rooftop_registry.export_gw_connections"
raises "same AL store cannot back a second rooftop" "rr_one_active_al_store" "SELECT rooftop_registry.propose_rooftop('$OP','duplicate store attempt','$T1','rf-nw-09','dealer:other','$T1','$S1','ac-dlr-9',NULL,'$AFT','$AF3')"
raises "same AutoFrame rooftop cannot back a second rooftop" "rr_one_active_af_rooftop" "SELECT rooftop_registry.propose_rooftop('$OP','duplicate frame attempt','$T1','rf-nw-09','dealer:other','$T1','$S3','ac-dlr-9',NULL,'$AFT','$AF1')"
raises "same AC dealership/location cannot back a second rooftop" "rr_one_active_ac_store" "SELECT rooftop_registry.propose_rooftop('$OP','duplicate curb attempt','$T1','rf-nw-09','dealer:other','$T1','$S3','ac-dlr-1','$LOC','$AFT','$AF3')"
raises "AL tenant must be the RooftopOS tenant" "rooftops_check" "SELECT rooftop_registry.propose_rooftop('$OP','tenant mismatch attempt','$T1','rf-nw-09','dealer:other','$T2','$S3','ac-dlr-9',NULL,'$AFT','$AF3')"
raises "identity columns are immutable" "rooftop_registry_identity_is_immutable" "UPDATE rooftop_registry.rooftops SET al_store_id='$S2' WHERE id='$R1'"
raises "registry rows are never deleted" "rooftop_registry_rows_are_never_deleted" "DELETE FROM rooftop_registry.rooftops WHERE id='$R1'"
raises "audit is append-only" "rooftop_registry_audit_immutable" "DELETE FROM rooftop_registry.audit"

G1=$(q "SELECT rooftop_registry.propose_grant('$OP','labels to curb inventory','$T1','autolabels','autocurb',ARRAY['vehicle.identity_registered','custody.episode_opened'],ARRAY['inventory_sync','custody_evidence'])")
check "pending grant exports no connection" "0" "SELECT count(*) FROM rooftop_registry.export_gw_connections"
check "creator cannot activate own grant" "reviewer_is_creator" "SELECT rooftop_registry.activate_grant('$G1','$OP','approved by me')"
check "grant activation by reviewer" "activated" "SELECT rooftop_registry.activate_grant('$G1','$RV','approved route for northwind')"
check "Gateway connection exported with transport flags off" "conn:autolabels>autocurb:$T1:rf-nw-01|active|false|false" "SELECT id||'|'||status||'|'||source_enabled||'|'||target_enabled FROM rooftop_registry.export_gw_connections"

R2=$(prop $T2 rf-sw-01 "dealer:southwind-main" $S2 ac-dlr-2 NULL $AF2)
q "SELECT rooftop_registry.activate_rooftop('$R2','$RV','verified southwind agreement')" >/dev/null
check "another tenant's rooftop gets no connection from this tenant's grant" "0" "SELECT count(*) FROM rooftop_registry.export_gw_connections WHERE tenant_id='$T2'"

E1=88888888-0000-4000-8000-000000000001; E2=88888888-0000-4000-8000-000000000002; E3=88888888-0000-4000-8000-000000000003
VIN=1HGCM82633A004352
check "bind an episode at an active rooftop" "bound" "SELECT rooftop_registry.bind_episode('$OP','$R1','inst-1','ep-1','$VIN','$E1')"
check "exact retry of the same binding" "exact_retry" "SELECT rooftop_registry.bind_episode('$OP','$R1','inst-1','ep-1','$VIN','$E1')"
check "reused custody event for another episode is refused" "labels_event_reused" "SELECT rooftop_registry.bind_episode('$OP','$R1','inst-1','ep-2','$VIN','$E1')"
check "same episode cannot be bound twice" "episode_already_bound" "SELECT rooftop_registry.bind_episode('$OP','$R2','inst-1','ep-1','$VIN','$E2')"
check "Gateway mapping uses the AL store as source_store_id" "conn:autolabels>autocurb:$T1:rf-nw-01|inst-1|ep-1|$S1|$VIN|active" "SELECT connection_id||'|'||instance_id||'|'||episode_id||'|'||source_store_id||'|'||vin||'|'||status FROM rooftop_registry.export_gw_mappings"
R3=$(prop $T1 rf-nw-02 "dealer:northwind-east" $S3 ac-dlr-3 NULL $AF3)
check "pending rooftop cannot take bindings" "rooftop_not_active" "SELECT rooftop_registry.bind_episode('$OP','$R3','inst-3','ep-3','$VIN','$E3')"
check "same VIN at another rooftop does not inherit a mapping" "0" "SELECT count(*) FROM rooftop_registry.export_gw_mappings WHERE episode_id='ep-3'"

# Concurrency: a bind holding its rooftop lock vs. a revoke. The revoke waits, then revokes the new binding too.
("${PSQL[@]}" -c "BEGIN; SELECT rooftop_registry.bind_episode('$OP','$R1','inst-2','ep-2','$VIN','$E2'); SELECT pg_sleep(1.5); COMMIT;" >/dev/null) &
BG=$!; sleep 0.4
check "revoke during an in-flight bind waits and wins" "revoked" "SELECT rooftop_registry.revoke_rooftop('$R1','$RV','dealer agreement terminated')"
wait $BG
check "no active episode remains under the revoked rooftop" "0" "SELECT count(*) FROM rooftop_registry.episodes WHERE rooftop='$R1' AND status='active'"
check "revocation empties every export for that rooftop" "0|0|0|0|0" "SELECT (SELECT count(*) FROM rooftop_registry.export_al_rooftop_stores WHERE registry_id='$R1')||'|'||(SELECT count(*) FROM rooftop_registry.export_ac_rooftop_scope WHERE registry_id='$R1')||'|'||(SELECT count(*) FROM rooftop_registry.export_af_rooftop_scope WHERE registry_id='$R1')||'|'||(SELECT count(*) FROM rooftop_registry.export_gw_connections WHERE registry_id='$R1')||'|'||(SELECT count(*) FROM rooftop_registry.export_gw_mappings)"
check "revocation is audited with the episode count" "2" "SELECT detail->>'episodes_revoked' FROM rooftop_registry.audit WHERE ref='$R1' AND action='revoked'"
# Reverse order: the revoke commits first; a bind that was waiting then sees the revoked rooftop.
q "SELECT rooftop_registry.activate_rooftop('$R3','$RV','verified east store agreement')" >/dev/null
("${PSQL[@]}" -c "BEGIN; SELECT rooftop_registry.revoke_rooftop('$R3','$RV','east store closed permanently'); SELECT pg_sleep(1.5); COMMIT;" >/dev/null) &
BG=$!; sleep 0.4
check "bind racing a committed revoke is refused" "rooftop_not_active" "SELECT rooftop_registry.bind_episode('$OP','$R3','inst-3','ep-3','$VIN','$E3')"
wait $BG
check "revoked rooftop cannot be re-activated" "not_pending" "SELECT rooftop_registry.activate_rooftop('$R1','$RV','trying to bring it back')"
raises "revoked is terminal" "rooftop_registry_revoked_is_terminal" "UPDATE rooftop_registry.rooftops SET status='active' WHERE id='$R1'"
R4=$(q "SELECT rooftop_registry.propose_rooftop('$OP','re-onboard after revocation','$T1','rf-nw-01','dealer:northwind-main','$T1','$S1','ac-dlr-1','$LOC','$AFT','$AF1')")
check "a new proposal may reuse the identifiers after revocation" "pending" "SELECT status FROM rooftop_registry.rooftops WHERE id='$R4'"

q "CREATE ROLE rr_reader_login LOGIN IN ROLE rooftop_registry_reader; CREATE ROLE rr_op_login LOGIN IN ROLE rooftop_registry_operator;" >/dev/null
raises "reader cannot read base tables" "permission denied" "SET ROLE rr_reader_login; SELECT count(*) FROM rooftop_registry.rooftops"
check "reader can read exports" "1" "SET ROLE rr_reader_login; SELECT count(*) FROM rooftop_registry.export_al_rooftop_stores"
raises "reader cannot propose" "permission denied" "SET ROLE rr_reader_login; SELECT rooftop_registry.propose_rooftop('$OP','reader attempt here','$T1','rf-x','dealer:x','$T1','$S3','ac-x',NULL,'$AFT','$AF3')"
raises "operator cannot activate" "permission denied" "SET ROLE rr_op_login; SELECT rooftop_registry.activate_rooftop('$R2','$OP','operator self approval')"
echo "rooftop_registry: $PASS passed, $FAIL failed"
[ "$FAIL" = 0 ]
