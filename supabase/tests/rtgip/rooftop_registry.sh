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
cp "$ROOT/supabase/proposed/rooftop_registry.proposed.sql" "$WORK/rr.sql"; cp "$ROOT/supabase/tests/rtgip/supabase_auth_stub.sql" "$WORK/stub.sql"; chmod a+r "$WORK/rr.sql" "$WORK/stub.sql"
"${PSQL[@]}" -f "$WORK/stub.sql" >/dev/null
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
OUT=aaaaaaaa-0000-4000-8000-000000000009; GM2=aaaaaaaa-0000-4000-8000-000000000003; UNV=aaaaaaaa-0000-4000-8000-000000000008
q "INSERT INTO auth.users (id, email, email_confirmed_at) VALUES ('$OP','op@synthetic.test',now()),('$RV','rv@synthetic.test',now()),('$GM2','gm2@synthetic.test',now()),('$OUT','out@synthetic.test',now()),('$UNV','unv@synthetic.test',NULL)" >/dev/null
AS() { printf "SET request.jwt.claims = '{\"sub\":\"%s\",\"aal\":\"%s\"}'; SET ROLE authenticated; " "$1" "${2:-aal2}"; }
check "bootstrap refuses an unconfirmed account" "user_not_verified" "SELECT rooftop_registry.bootstrap_platform_admin('$UNV','owner bootstrap (synthetic)')"
check "the owner bootstraps the first platform admin" "enrolled" "SELECT rooftop_registry.bootstrap_platform_admin('$OP','owner bootstrap (synthetic)')"
raises "authenticated cannot run the bootstrap" "permission denied" "$(AS $OP)SELECT rooftop_registry.bootstrap_platform_admin('$OUT','self-made admin')"
raises "service_role cannot run the bootstrap" "permission denied" "SET ROLE service_role; SELECT rooftop_registry.bootstrap_platform_admin('$OUT','self-made admin')"
raises "no environment row: proposals fail closed" "registry_environment_unset" "$(AS $OP)SELECT rooftop_registry.propose_rooftop('initial synthetic proposal','$T1','rf-x','synthetic:x','$T1','$S3','ac-x',NULL,'$AFT','$AF3')"
q "INSERT INTO rooftop_registry.settings (environment) VALUES ('staging') ON CONFLICT DO NOTHING" >/dev/null
raises "a session without a signed-in user is refused" "actor_not_signed_in" "SET ROLE authenticated; SELECT rooftop_registry.propose_rooftop('no session at all','$T1','rf-x','synthetic:x','$T1','$S3','ac-x',NULL,'$AFT','$AF3')"
raises "an unconfirmed account is refused" "actor_not_verified" "$(AS $UNV)SELECT rooftop_registry.propose_rooftop('unconfirmed account','$T1','rf-x','synthetic:x','$T1','$S3','ac-x',NULL,'$AFT','$AF3')"
raises "a session without MFA is refused" "actor_mfa_required" "$(AS $OP aal1)SELECT rooftop_registry.propose_rooftop('no mfa session here','$T1','rf-x','synthetic:x','$T1','$S3','ac-x',NULL,'$AFT','$AF3')"
raises "anon cannot call registry functions" "permission denied" "SET ROLE anon; SELECT rooftop_registry.propose_rooftop('anon attempt here','$T1','rf-x','synthetic:x','$T1','$S3','ac-x',NULL,'$AFT','$AF3')"
check "a platform admin cannot enroll themselves" "self_enrollment" "SET request.jwt.claims = '{\"sub\":\"$OP\",\"aal\":\"aal2\"}'; SET ROLE authenticated; SELECT rooftop_registry.enroll_principal('$OP','dealership_gm','$T1','evidence:letter')"
check "enrollment needs evidence" "evidence_required" "SET request.jwt.claims = '{\"sub\":\"$OP\",\"aal\":\"aal2\"}'; SET ROLE authenticated; SELECT rooftop_registry.enroll_principal('$RV','dealership_gm','$T1','')"
check "a non-admin cannot enroll" "enroller_not_platform_admin" "SET request.jwt.claims = '{\"sub\":\"$OUT\",\"aal\":\"aal2\"}'; SET ROLE authenticated; SELECT rooftop_registry.enroll_principal('$RV','dealership_gm','$T1','evidence:letter')"
check "platform admins are not enrollable through the function" "capacity_not_enrollable" "SET request.jwt.claims = '{\"sub\":\"$OP\",\"aal\":\"aal2\"}'; SET ROLE authenticated; SELECT rooftop_registry.enroll_principal('$OUT','platform_admin','*','evidence:letter')"
check "the dealership GM is enrolled for tenant 1" "enrolled" "SET request.jwt.claims = '{\"sub\":\"$OP\",\"aal\":\"aal2\"}'; SET ROLE authenticated; SELECT rooftop_registry.enroll_principal('$RV','dealership_gm','$T1','evidence:northwind-gm-letter')"
q "SET request.jwt.claims = '{\"sub\":\"$OP\",\"aal\":\"aal2\"}'; SET ROLE authenticated; SELECT rooftop_registry.enroll_principal('$RV','dealer_owner','$T2','evidence:southwind-owner-letter')" >/dev/null
q "SET request.jwt.claims = '{\"sub\":\"$OP\",\"aal\":\"aal2\"}'; SET ROLE authenticated; SELECT rooftop_registry.enroll_principal('$GM2','dealership_gm','$T2','evidence:southwind-gm-letter')" >/dev/null
raises "a non-principal cannot propose a rooftop" "actor_not_platform_admin" "SET request.jwt.claims = '{\"sub\":\"$OUT\",\"aal\":\"aal2\"}'; SET ROLE authenticated; SELECT rooftop_registry.propose_rooftop('outsider proposal attempt','$T1','rf-x','synthetic:x','$T1','$S3','ac-x',NULL,'$AFT','$AF3')"
raises "staging refuses a real dealership ref" "dealership_ref_wrong_for_environment:staging" "SET request.jwt.claims = '{\"sub\":\"$OP\",\"aal\":\"aal2\"}'; SET ROLE authenticated; SELECT rooftop_registry.propose_rooftop('real dealer in staging','$T1','rf-x','dealer:harte-infiniti','$T1','$S3','ac-x',NULL,'$AFT','$AF3')"
prop() { q "SET request.jwt.claims = '{\"sub\":\"$OP\",\"aal\":\"aal2\"}'; SET ROLE authenticated; SELECT rooftop_registry.propose_rooftop('initial synthetic proposal','$1','$2','$3','$1','$4','$5',${6},'$AFT','$7')"; }
R1=$(prop $T1 rf-nw-01 "synthetic:northwind-main" $S1 ac-dlr-1 "'$LOC'" $AF1)
check "proposal starts pending" "pending" "SELECT status FROM rooftop_registry.rooftops WHERE id='$R1'"
check "pending rooftop exports nothing (AL/AC/AF)" "0|0|0" "SELECT (SELECT count(*) FROM rooftop_registry.export_al_rooftop_stores)||'|'||(SELECT count(*) FROM rooftop_registry.export_ac_rooftop_scope)||'|'||(SELECT count(*) FROM rooftop_registry.export_af_rooftop_scope)"
check "creator cannot activate own proposal" "reviewer_is_creator" "SET request.jwt.claims = '{\"sub\":\"$OP\",\"aal\":\"aal2\"}'; SET ROLE authenticated; SELECT rooftop_registry.activate_rooftop('$R1','looks right to me','evidence:synthetic-dealer-letter')"
check "self-review refusal is audited" "1" "SELECT count(*) FROM rooftop_registry.audit WHERE ref='$R1' AND action='refused'"
check "another tenant's GM cannot activate" "reviewer_not_dealership_authority" "SET request.jwt.claims = '{\"sub\":\"$GM2\",\"aal\":\"aal2\"}'; SET ROLE authenticated; SELECT rooftop_registry.activate_rooftop('$R1','verified against dealer agreement','evidence:letter')"
check "activation needs evidence" "evidence_required" "SET request.jwt.claims = '{\"sub\":\"$RV\",\"aal\":\"aal2\"}'; SET ROLE authenticated; SELECT rooftop_registry.activate_rooftop('$R1','verified against dealer agreement','')"
check "activation needs a reason" "reason_required" "SET request.jwt.claims = '{\"sub\":\"$RV\",\"aal\":\"aal2\"}'; SET ROLE authenticated; SELECT rooftop_registry.activate_rooftop('$R1','ok','evidence:synthetic-dealer-letter')"
check "still pending after refusals" "pending" "SELECT status FROM rooftop_registry.rooftops WHERE id='$R1'"
check "second person with reason activates" "activated" "SET request.jwt.claims = '{\"sub\":\"$RV\",\"aal\":\"aal2\"}'; SET ROLE authenticated; SELECT rooftop_registry.activate_rooftop('$R1','verified against dealer agreement','evidence:synthetic-dealer-letter')"
check "activation records evidence, reviewer and a new version" "evidence:synthetic-dealer-letter|2|true" "SELECT evidence_ref||'|'||version||'|'||(reviewed_by='$RV') FROM rooftop_registry.rooftops WHERE id='$R1'"
check "the activation audit carries the evidence and version" "evidence:synthetic-dealer-letter|2" "SELECT detail->>'evidence_ref'||'|'||(detail->>'version') FROM rooftop_registry.audit WHERE ref='$R1' AND action='activated'"
check "AL export after activation" "$T1|rf-nw-01|$S1" "SELECT tenant_id||'|'||rooftop_id||'|'||store_id FROM rooftop_registry.export_al_rooftop_stores"
check "AC export after activation" "ac-dlr-1|$LOC|$T1|rf-nw-01" "SELECT dealership_id||'|'||store_location_id||'|'||tenant_id||'|'||rooftop_id FROM rooftop_registry.export_ac_rooftop_scope"
check "AF export after activation" "$AF1|$T1|rf-nw-01" "SELECT af_rooftop_id||'|'||tenant_id||'|'||rooftop_id FROM rooftop_registry.export_af_rooftop_scope"
check "no Gateway connection without an active grant" "0" "SELECT count(*) FROM rooftop_registry.export_gw_connections"
raises "same AL store cannot back a second rooftop" "rr_one_active_al_store" "SET request.jwt.claims = '{\"sub\":\"$OP\",\"aal\":\"aal2\"}'; SET ROLE authenticated; SELECT rooftop_registry.propose_rooftop('duplicate store attempt','$T1','rf-nw-09','synthetic:other','$T1','$S1','ac-dlr-9',NULL,'$AFT','$AF3')"
raises "same AutoFrame rooftop cannot back a second rooftop" "rr_one_active_af_rooftop" "SET request.jwt.claims = '{\"sub\":\"$OP\",\"aal\":\"aal2\"}'; SET ROLE authenticated; SELECT rooftop_registry.propose_rooftop('duplicate frame attempt','$T1','rf-nw-09','synthetic:other','$T1','$S3','ac-dlr-9',NULL,'$AFT','$AF1')"
raises "same AC dealership/location cannot back a second rooftop" "rr_one_active_ac_store" "SET request.jwt.claims = '{\"sub\":\"$OP\",\"aal\":\"aal2\"}'; SET ROLE authenticated; SELECT rooftop_registry.propose_rooftop('duplicate curb attempt','$T1','rf-nw-09','synthetic:other','$T1','$S3','ac-dlr-1','$LOC','$AFT','$AF3')"
raises "AL tenant must be the RooftopOS tenant" "rooftops_check" "SET request.jwt.claims = '{\"sub\":\"$OP\",\"aal\":\"aal2\"}'; SET ROLE authenticated; SELECT rooftop_registry.propose_rooftop('tenant mismatch attempt','$T1','rf-nw-09','synthetic:other','$T2','$S3','ac-dlr-9',NULL,'$AFT','$AF3')"
raises "identity columns are immutable" "rooftop_registry_identity_is_immutable" "UPDATE rooftop_registry.rooftops SET al_store_id='$S2' WHERE id='$R1'"
raises "registry rows are never deleted" "rooftop_registry_rows_are_never_deleted" "DELETE FROM rooftop_registry.rooftops WHERE id='$R1'"
raises "audit is append-only" "rooftop_registry_audit_immutable" "DELETE FROM rooftop_registry.audit"

G1=$(q "SET request.jwt.claims = '{\"sub\":\"$OP\",\"aal\":\"aal2\"}'; SET ROLE authenticated; SELECT rooftop_registry.propose_grant('labels to curb inventory','$T1','autolabels','autocurb',ARRAY['vehicle.identity_registered','custody.episode_opened'],ARRAY['inventory_sync','custody_evidence'])")
check "pending grant exports no connection" "0" "SELECT count(*) FROM rooftop_registry.export_gw_connections"
check "creator cannot activate own grant" "reviewer_is_creator" "SET request.jwt.claims = '{\"sub\":\"$OP\",\"aal\":\"aal2\"}'; SET ROLE authenticated; SELECT rooftop_registry.activate_grant('$G1','approved by me','evidence:synthetic-dealer-letter')"
check "grant activation by reviewer" "activated" "SET request.jwt.claims = '{\"sub\":\"$RV\",\"aal\":\"aal2\"}'; SET ROLE authenticated; SELECT rooftop_registry.activate_grant('$G1','approved route for northwind','evidence:synthetic-dealer-letter')"
check "Gateway connection exported with transport flags off" "conn:autolabels>autocurb:$T1:rf-nw-01|active|false|false" "SELECT id||'|'||status||'|'||source_enabled||'|'||target_enabled FROM rooftop_registry.export_gw_connections"

R2=$(prop $T2 rf-sw-01 "synthetic:southwind-main" $S2 ac-dlr-2 NULL $AF2)
q "SET request.jwt.claims = '{\"sub\":\"$RV\",\"aal\":\"aal2\"}'; SET ROLE authenticated; SELECT rooftop_registry.activate_rooftop('$R2','verified southwind agreement','evidence:synthetic-dealer-letter')" >/dev/null
check "another tenant's rooftop gets no connection from this tenant's grant" "0" "SELECT count(*) FROM rooftop_registry.export_gw_connections WHERE tenant_id='$T2'"

E1=88888888-0000-4000-8000-000000000001; E2=88888888-0000-4000-8000-000000000002; E3=88888888-0000-4000-8000-000000000003
VIN=1HGCM82633A004352
check "bind an episode at an active rooftop" "bound" "SET ROLE service_role; SELECT rooftop_registry.bind_episode('$R1','inst-1','ep-1','$VIN','$E1')"
check "exact retry of the same binding" "exact_retry" "SET ROLE service_role; SELECT rooftop_registry.bind_episode('$R1','inst-1','ep-1','$VIN','$E1')"
check "reused custody event for another episode is refused" "labels_event_reused" "SET ROLE service_role; SELECT rooftop_registry.bind_episode('$R1','inst-1','ep-2','$VIN','$E1')"
check "same episode cannot be bound twice" "episode_already_bound" "SET ROLE service_role; SELECT rooftop_registry.bind_episode('$R2','inst-1','ep-1','$VIN','$E2')"
check "Gateway mapping uses the AL store as source_store_id" "conn:autolabels>autocurb:$T1:rf-nw-01|inst-1|ep-1|$S1|$VIN|active" "SELECT connection_id||'|'||instance_id||'|'||episode_id||'|'||source_store_id||'|'||vin||'|'||status FROM rooftop_registry.export_gw_mappings"
R3=$(prop $T1 rf-nw-02 "synthetic:northwind-east" $S3 ac-dlr-3 NULL $AF3)
check "pending rooftop cannot take bindings" "rooftop_not_active" "SET ROLE service_role; SELECT rooftop_registry.bind_episode('$R3','inst-3','ep-3','$VIN','$E3')"
check "same VIN at another rooftop does not inherit a mapping" "0" "SELECT count(*) FROM rooftop_registry.export_gw_mappings WHERE episode_id='ep-3'"

# Concurrency: a bind holding its rooftop lock vs. a revoke. The revoke waits, then revokes the new binding too.
("${PSQL[@]}" -c "SET ROLE service_role; BEGIN; SELECT rooftop_registry.bind_episode('$R1','inst-2','ep-2','$VIN','$E2'); SELECT pg_sleep(1.5); COMMIT;" >/dev/null) &
BG=$!; sleep 0.4
check "revoke during an in-flight bind waits and wins" "revoked" "SET request.jwt.claims = '{\"sub\":\"$RV\",\"aal\":\"aal2\"}'; SET ROLE authenticated; SELECT rooftop_registry.revoke_rooftop('$R1','dealer agreement terminated')"
wait $BG
check "no active episode remains under the revoked rooftop" "0" "SELECT count(*) FROM rooftop_registry.episodes WHERE rooftop='$R1' AND status='active'"
check "revocation empties every export for that rooftop" "0|0|0|0|0" "SELECT (SELECT count(*) FROM rooftop_registry.export_al_rooftop_stores WHERE registry_id='$R1')||'|'||(SELECT count(*) FROM rooftop_registry.export_ac_rooftop_scope WHERE registry_id='$R1')||'|'||(SELECT count(*) FROM rooftop_registry.export_af_rooftop_scope WHERE registry_id='$R1')||'|'||(SELECT count(*) FROM rooftop_registry.export_gw_connections WHERE registry_id='$R1')||'|'||(SELECT count(*) FROM rooftop_registry.export_gw_mappings)"
check "revocation is audited with the episode count" "2" "SELECT detail->>'episodes_revoked' FROM rooftop_registry.audit WHERE ref='$R1' AND action='revoked'"
# Reverse order: the revoke commits first; a bind that was waiting then sees the revoked rooftop.
q "SET request.jwt.claims = '{\"sub\":\"$RV\",\"aal\":\"aal2\"}'; SET ROLE authenticated; SELECT rooftop_registry.activate_rooftop('$R3','verified east store agreement','evidence:synthetic-dealer-letter')" >/dev/null
("${PSQL[@]}" -c "SET request.jwt.claims = '{\"sub\":\"$RV\",\"aal\":\"aal2\"}'; SET ROLE authenticated; BEGIN; SELECT rooftop_registry.revoke_rooftop('$R3','east store closed permanently'); SELECT pg_sleep(1.5); COMMIT;" >/dev/null) &
BG=$!; sleep 0.4
check "bind racing a committed revoke is refused" "rooftop_not_active" "SET ROLE service_role; SELECT rooftop_registry.bind_episode('$R3','inst-3','ep-3','$VIN','$E3')"
wait $BG
check "revoked rooftop cannot be re-activated" "not_pending" "SET request.jwt.claims = '{\"sub\":\"$RV\",\"aal\":\"aal2\"}'; SET ROLE authenticated; SELECT rooftop_registry.activate_rooftop('$R1','trying to bring it back','evidence:synthetic-dealer-letter')"
raises "revoked is terminal" "rooftop_registry_revoked_is_terminal" "UPDATE rooftop_registry.rooftops SET status='active' WHERE id='$R1'"
R4=$(q "SET request.jwt.claims = '{\"sub\":\"$OP\",\"aal\":\"aal2\"}'; SET ROLE authenticated; SELECT rooftop_registry.propose_rooftop('re-onboard after revocation','$T1','rf-nw-01','synthetic:northwind-main','$T1','$S1','ac-dlr-1','$LOC','$AFT','$AF1')")
check "a new proposal may reuse the identifiers after revocation" "pending" "SELECT status FROM rooftop_registry.rooftops WHERE id='$R4'"

raises "service_role cannot read base tables" "permission denied" "SET ROLE service_role; SELECT count(*) FROM rooftop_registry.rooftops"
check "service_role (the Gateway server) reads exports" "1" "SET ROLE service_role; SELECT count(*) FROM rooftop_registry.export_al_rooftop_stores"
raises "service_role cannot write registry tables" "permission denied" "SET ROLE service_role; UPDATE rooftop_registry.principals SET status = 'active'"
raises "service_role cannot propose" "permission denied" "SET ROLE service_role; SELECT rooftop_registry.propose_rooftop('server attempt here','$T1','rf-x','synthetic:x','$T1','$S3','ac-x',NULL,'$AFT','$AF3')"
raises "authenticated cannot read base tables" "permission denied" "$(AS $OP)SELECT count(*) FROM rooftop_registry.principals"
raises "authenticated cannot read exports" "permission denied" "$(AS $OP)SELECT count(*) FROM rooftop_registry.export_gw_connections"
raises "authenticated cannot bind episodes" "permission denied" "$(AS $OP)SELECT rooftop_registry.bind_episode('$R2','inst-9','ep-9','$VIN','$E3')"
raises "anon cannot read exports" "permission denied" "SET ROLE anon; SELECT count(*) FROM rooftop_registry.export_al_rooftop_stores"
check "no API role holds any table privilege" "0" "SELECT count(*) FROM information_schema.role_table_grants WHERE table_schema = 'rooftop_registry' AND grantee IN ('PUBLIC','anon','authenticated') "
check "service_role holds only SELECT on the five exports" "5|SELECT" "SELECT count(*)||'|'||string_agg(DISTINCT privilege_type, ',') FROM information_schema.role_table_grants WHERE table_schema = 'rooftop_registry' AND grantee = 'service_role'"
raises "a claimed role in the token grants nothing" "actor_not_platform_admin" "$(printf "SET request.jwt.claims = '{\"sub\":\"%s\",\"aal\":\"aal2\",\"role\":\"service_role\",\"app_metadata\":{\"capacity\":\"platform_admin\"}}'; SET ROLE authenticated; " $OUT)SELECT rooftop_registry.propose_grant('claims say admin','$T1','autolabels','autoframe',ARRAY['x'],ARRAY['y'])"
check "the platform admin revokes the GM" "revoked" "$(AS $OP)SELECT rooftop_registry.revoke_principal('$GM2','dealership_gm','$T2','gm left the dealership')" 
G9=$(q "$(AS $OP)SELECT rooftop_registry.propose_grant('southwind route proposal','$T2','autolabels','autoframe',ARRAY['vehicle.identity_registered'],ARRAY['inventory_sync'])")
check "a revoked GM can no longer activate" "reviewer_not_dealership_authority" "$(AS $GM2)SELECT rooftop_registry.activate_grant('$G9','approving after leaving','evidence:x')"
raises "principal rows cannot be deleted" "rooftop_registry_rows_are_never_deleted" "DELETE FROM rooftop_registry.principals"
echo "rooftop_registry: $PASS passed, $FAIL failed"
[ "$FAIL" = 0 ]
