#!/usr/bin/env bash
# Local proof of the AutoLabels production packets (supabase/proposed/production/) on a throwaway PostgreSQL cluster.
# Builds the hosted-today AutoLabels node (stubs, hosted seed, Supabase default privileges, no S2), then:
#   1. every production-pinned packet STOPs on the server pin and changes nothing;
#   2. the rehearsal packets (pinned to this socket and major) differ from the production ones only in those pins;
#   3. 01..10 apply in order, each post-check passes, and the read-only fingerprint matches the staging digests;
#   4. no step can be applied twice; templates refuse while PENDING;
#   5. rtgip_edge runs the runtime's own SQL: the dark-gate, loadV3, outbox and publish-authorizer reads as itself and
#      the SET LOCAL ROLE paths, and is refused everything else;
#   6. the connections template, filled, creates 4 rtgip/3-only dark rows rtgip_edge can read;
#   7. every inverse runs in reverse order, the disable and restore packets round-trip, and 07..10 re-apply to the same
#      fingerprint; a restore over a later step refuses atomically; SHA256SUMS verifies.
# Usage: supabase/tests/rtgip/al-production-packets-test.sh   (needs PostgreSQL 16+ binaries and root or the postgres user)
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/../../.." && pwd)
PKT=$ROOT/supabase/proposed/production
PGBIN=${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}
MAJOR=$("$PGBIN/postgres" --version | sed -E 's/.* ([0-9]+)\..*/\1/')
W=$(mktemp -d); chmod 755 "$W"
as_pg() { if [ "$(id -un)" = postgres ]; then "$@"; else chown -R postgres "$W"; runuser -u postgres -- "$@"; fi; }
cleanup() { as_pg "$PGBIN/pg_ctl" -D "$W/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$W"; }
trap cleanup EXIT
P=55531
as_pg "$PGBIN/initdb" -D "$W/data" -U postgres -A trust >/dev/null
as_pg "$PGBIN/pg_ctl" -D "$W/data" -o "-p $P -k $W -c listen_addresses=''" -l "$W/pg.log" -w start >/dev/null
q() { as_pg env PGOPTIONS="-c client_min_messages=notice" "$PGBIN/psql" "host=$W port=$P dbname=al user=postgres" -v ON_ERROR_STOP=1 -qAtX "$@"; }
# AL_CREATEDB_OPTS lets the same proof run on a non-C database, e.g. "--template=template0 --encoding=UTF8 --locale-provider=icu --icu-locale=en-US --locale=C.UTF-8".
as_pg "$PGBIN/createdb" -h "$W" -p $P -U postgres ${AL_CREATEDB_OPTS:-} al
pass=0; fail() { echo "FAIL: $*" >&2; exit 1; }; ok() { pass=$((pass + 1)); echo "ok $pass - $*"; }

for f in supabase/tests/rooftopos_stubs.sql supabase/tests/rtgip/al-hosted-seed.sql supabase/tests/rtgip/al-hosted-default-privileges.sql \
         supabase/proposed/20261108000000_canonical_store_registry.rollback.sql; do
  q --single-transaction -f "$ROOT/$f" >/dev/null 2>&1
done
ok "hosted-today node built (PostgreSQL $MAJOR, no rtgip schema)"
[ "$(q -c "SELECT count(*) FROM pg_namespace WHERE nspname LIKE 'rtgip%'")" = 0 ] || fail "rtgip schema present before step 01"

REH=$W/reh; mkdir -p "$REH"
python3 "$ROOT/scripts/rtgip3/gen_prod_al.py" --rehearsal "$REH" --server '' --major "$MAJOR"
python3 "$ROOT/scripts/rtgip3/gen_prod_al.py" --check >/dev/null || fail "committed packets are stale against gen_prod_al.py"
ok "committed packets are fresh"

python3 - "$PKT" "$REH" "$MAJOR" <<'PY' || fail "rehearsal and production packets differ beyond the pins"
import os, sys
pkt, reh, major = sys.argv[1], sys.argv[2], sys.argv[3]
srv = "2a05:d018:135e:166d:40ff:d4ff:1780:16c1"
def inner(t): return t.split("$p2wrapfile$")[1] if "$p2wrapfile$" in t else t
n = 0
for name in sorted(os.listdir(pkt)):
    if not name.endswith(".sql"): continue
    a, b = inner(open(os.path.join(pkt, name)).read()), inner(open(os.path.join(reh, name)).read())
    a = a.replace(f"<> '{srv}' THEN", "<> '' THEN").replace(" / 10000 <> 17 THEN", f" / 10000 <> {major} THEN").replace("is not 17'", f"is not {major}'").replace("(PostgreSQL 17)", f"(PostgreSQL {major})")
    if a != b: sys.exit(f"{name}: differs beyond the server and major pins")
    n += 1
print(f"{n} files equal modulo pins")
PY
ok "rehearsal packets equal the production packets except the server and major pins"

before=$(q -c "SELECT md5(string_agg(nspname, ',' ORDER BY nspname)) FROM pg_namespace")
for f in "$PKT"/*.sql; do
  case $f in *fingerprint*) continue;; esac
  out=$(q -f "$f" 2>&1) && fail "$(basename "$f") ran on the wrong server"
  grep -q "_stop: wrong server" <<<"$out" || fail "$(basename "$f") did not stop on the server pin: $out"
done
[ "$before" = "$(q -c "SELECT md5(string_agg(nspname, ',' ORDER BY nspname)) FROM pg_namespace")" ] || fail "a pinned packet changed the node"
ok "every production-pinned packet stops on the server pin and changes nothing"

STEPS="01-S1 02-S3 03-D 04-R 05-E 06-H 07-L 08-AR1 09-AR3 10-EDGE"
apply_all() {
  for s in $STEPS; do
    out=$(q -f "$REH/$s.sql" 2>&1) || fail "$s: $out"
    grep -q "_ok" <<<"$out" || fail "$s printed no _ok notice: $out"
  done
}
fp() {
  sed "s/'2a05:d018:135e:166d:40ff:d4ff:1780:16c1'/''/; s/ \/ 10000 = 17 AS/ \/ 10000 = $MAJOR AS/" "$PKT/al-production-fingerprint.readonly.sql" > "$W/fp.sql"
  q -F '|' -P footer=off -c "\\pset tuples_only off" -f "$W/fp.sql" | python3 -c '
import sys
rows=[l.rstrip("\n").split("|") for l in sys.stdin if l.strip()]
h,v=rows[0],rows[1]; d=dict(zip(h,v))
bad=[k for k in h if k.endswith("_ok") and d[k]!="t"]
want={"connections":"0","flags_on":"0","v2_capable_connections":"0","rtgip2_keys":"0","rtgip3_keys":"0","non_prd_keys":"0","ledger_rows":"0"}
bad+=[k for k,x in want.items() if d[k]!=x]
print(d["rtgip_fn_digest"], d["rtgip_roles"])
sys.exit(("fingerprint mismatch: "+",".join(bad)) if bad else 0)' 2>&1
}
apply_all
ok "01..10 applied in order, every post-check passed"
fp1=$(fp) || fail "$fp1"
grep -q "^0fcc549679f0ba6ad1555020dfc3adf9 " <<<"$fp1" || fail "rtgip function digest is not the production expectation: $fp1"
ok "read-only fingerprint: S1 S3 R E digests equal staging, rtgip_fn_digest 0fcc5496 (56 functions), dark, no keys, API closed ($fp1)"

q -c "SELECT string_agg(e, ',' ORDER BY e COLLATE \"C\") FROM (SELECT p.proname || ':' || left(md5(pg_get_functiondef(p.oid)), 8) AS e FROM pg_proc p WHERE p.pronamespace = 'rtgip'::regnamespace AND p.prokind IN ('f','p') UNION ALL SELECT 'key_import_tickets_guard:0c8a30c3') x" > "$W/fnlist"
[ "$(q -c "SELECT md5('$(cat "$W/fnlist")')")" = 30dc3dd02521e28ade139dc27a7e548e ] || fail "production function set plus the staging-only residual is not the staging digest"
ok "production function set plus the staging-only key_import_tickets_guard equals the staging post-ar3 digest 30dc3dd0"

out=$(q -f "$REH/06-H.sql" 2>&1) || fail "06-H re-run: $out"
for s in ${STEPS/06-H /}; do
  out=$(q -f "$REH/$s.sql" 2>&1) && fail "$s applied twice"
  grep -qE "_stop|STOP" <<<"$out" || fail "$s second run did not STOP: $out"
done
ok "no step applies twice (each STOPs on its pre-state); 06-H is revoke-only and re-runs as a no-op"
for t in T1-connections.template T2-K5-v3-al.template T2-K5-v3-al.inverse.template; do
  out=$(q -f "$REH/$t.sql" 2>&1) && fail "$t ran while PENDING"
  grep -qi "pending" <<<"$out" || fail "$t did not refuse as PENDING: $out"
done
ok "templates refuse while PENDING"

TEN=11111111-2222-4333-8444-555555555555; STORE=66666666-7777-4888-8999-aaaaaaaaaaaa; USR=bbbbbbbb-cccc-4ddd-8eee-ffffffffffff
q >/dev/null <<SQL
INSERT INTO public.tenants (id) VALUES ('$TEN') ON CONFLICT DO NOTHING;
INSERT INTO public.tenant_members (user_id, tenant_id, role, accepted_at) VALUES ('$USR', '$TEN', 'owner', now());
INSERT INTO public.dealer_stores (id, tenant_id, display_name) VALUES ('$STORE', '$TEN', 'P2 local store');
INSERT INTO rtgip_src.rooftop_stores (tenant_id, rooftop_id, store_id, status, mapped_by, reason) VALUES ('$TEN', 'rt-1', '$STORE', 'active', '$USR', 'P2 local rehearsal mapping');
SQL
edge() { q -c "SET SESSION AUTHORIZATION rtgip_edge" "$@"; }
r=$(edge -c "BEGIN READ ONLY; SELECT transport_enabled, local_app FROM rtgip.delivery_config WHERE id; COMMIT;")
[ "$r" = "f|autolabels" ] || fail "dark gate read as rtgip_edge: $r"
edge -c "BEGIN READ ONLY; SELECT to_regclass('rtgip.evidence_v3') IS NOT NULL AND to_regclass('rtgip.public_key_bindings') IS NOT NULL AS installed;
  SELECT k.key_id, k.owner, k.protocol, k.alg, k.public_key, k.fingerprint, k.status, k.not_before::text, k.not_after::text, k.revoked_at::text, k.revoked_reason,
         ARRAY(SELECT b.connection_id FROM rtgip.public_key_bindings b WHERE b.key_id = k.key_id ORDER BY b.connection_id) FROM rtgip.public_keys k ORDER BY k.key_id;
  SELECT connection_id, source_app, target_app, tenant_id, rooftop_ids, event_types, purposes, producer_enabled, reader_enabled, status,
         send_protocol, accept_protocols, v3_added_at::text, v2_accept_until::text FROM rtgip.connections; COMMIT;" >/dev/null || fail "loadV3 reads as rtgip_edge"
edge -c "SELECT DISTINCT coalesce(o.protocol, CASE WHEN o.lease_generation = 0 THEN coalesce(c.send_protocol, 'rtgip/2') ELSE 'rtgip/2' END) AS protocol
           FROM rtgip.outbox o LEFT JOIN rtgip.connections c ON c.connection_id = o.connection_id WHERE o.state IN ('pending', 'retry_wait', 'in_flight', 'gateway_admitted');
         SELECT event_id::text, protocol, delivery_id_v3, connection_id FROM rtgip.outbox WHERE event_id = ANY('{}'::uuid[]);
         SELECT state FROM rtgip.outbox WHERE event_id = '$TEN'" >/dev/null || fail "dispatch outbox reads as rtgip_edge"
r=$(edge -c "BEGIN READ ONLY; SELECT role FROM public.tenant_members WHERE user_id = '$USR'::uuid AND tenant_id = '$TEN'::uuid AND accepted_at IS NOT NULL;
  SELECT r.store_id FROM rtgip_src.rooftop_stores r JOIN public.dealer_stores d ON d.id = r.store_id AND d.tenant_id = r.tenant_id
   WHERE r.tenant_id = '$TEN'::uuid AND r.rooftop_id = 'rt-1' AND r.status = 'active'; COMMIT;")
[ "$r" = "$(printf 'owner\n%s' "$STORE")" ] || fail "publish authorizer reads as rtgip_edge returned: $r"
ok "rtgip_edge runs the dark gate, loadV3, dispatch and publish-authorizer reads as itself (seeded rows visible through RLS)"
for role in rtgip_dispatcher rtgip_inbox_receiver rtgip_outbox_writer rtgip_source_reader; do
  [ "$(edge -c "BEGIN; SET LOCAL ROLE $role; SELECT current_user; COMMIT;")" = "$role" ] || fail "SET LOCAL ROLE $role"
done
[ "$(edge -c "BEGIN; SET LOCAL ROLE rtgip_inbox_receiver; SET LOCAL ROLE rtgip_labels_consumer; SELECT current_user; COMMIT;")" = rtgip_labels_consumer ] || fail "consumer chain"
[ "$(edge -c "BEGIN; SET LOCAL ROLE rtgip_source_reader; SET LOCAL transaction_read_only = on; SELECT current_user; COMMIT;")" = rtgip_source_reader ] || fail "source reader"
ok "rtgip_edge reaches the four duty roles and the consumer chain by SET LOCAL ROLE"
for stmt in "SET ROLE rtgip_operator" "SET ROLE postgres" "SELECT body FROM rtgip.outbox" "UPDATE rtgip.delivery_config SET transport_enabled = false" \
            "SELECT * FROM rtgip.signing_keys" "SELECT * FROM rtgip.receipts" "INSERT INTO rtgip.outbox (event_id) VALUES (gen_random_uuid())" \
            "SELECT rtgip.outbox_enqueue('{}'::jsonb)" "SELECT * FROM public.tenants" "SELECT display_name FROM public.dealer_stores" "SELECT * FROM public.vehicle_listings"; do
  edge -c "$stmt" >/dev/null 2>&1 && fail "rtgip_edge was allowed: $stmt"
done
ok "rtgip_edge is refused operator, postgres, the outbox body, writes, rtgip/2 keys, receipts, direct duty functions and every other public column"

echo "{\"tenant_id\": \"$TEN\", \"rooftop_id\": \"rt-1\"}" > "$W/conn.json"
python3 "$ROOT/scripts/rtgip3/gen_prod_al.py" --server '' --major "$MAJOR" --fill-conn "$W/conn.json" "$W/T1.wrap.sql" >/dev/null
out=$(q -f "$W/T1.wrap.sql" 2>&1) || fail "connections template: $out"
[ "$(edge -c "SELECT count(*) FROM rtgip.connections WHERE send_protocol = 'rtgip/3' AND accept_protocols = '{rtgip/3}' AND NOT producer_enabled AND NOT reader_enabled")" = 4 ] || fail "edge sees the 4 connections"
q -c "DELETE FROM rtgip.connections WHERE tenant_id = '$TEN'" >/dev/null || fail "connection rollback"
ok "filled connections template: 4 rtgip/3-only dark rows, visible to rtgip_edge, rolled back while ledgers are empty"
q -c "DELETE FROM rtgip_src.rooftop_stores WHERE tenant_id = '$TEN'; DELETE FROM public.dealer_stores WHERE id = '$STORE'; DELETE FROM public.tenant_members WHERE tenant_id = '$TEN'" >/dev/null

for s in 10-EDGE 09-AR3 08-AR1 07-L; do
  out=$(q -f "$REH/$s.inverse.sql" 2>&1) || fail "$s inverse: $out"
done
[ "$(q -c "SELECT to_regrole('rtgip_edge') IS NULL AND to_regclass('rtgip.evidence_v3') IS NULL AND (SELECT local_app IS NULL FROM rtgip.delivery_config)")" = t ] || fail "inverses left state"
ok "inverses 10, 09, 08, 07 ran in reverse order"
for k in 05-E 04-R 03-D 02-S3 01-S1; do out=$(q -f "$REH/$k.disable.sql" 2>&1) || fail "$k disable: $out"; done
for k in 01-S1 02-S3 03-D 04-R 05-E; do out=$(q -f "$REH/$k.restore.sql" 2>&1) || fail "$k restore: $out"; done
ok "disable packets 05..01 and restore packets 01..05 round-trip with staging digests"
for s in 07-L 08-AR1 09-AR3 10-EDGE; do out=$(q -f "$REH/$s.sql" 2>&1) || fail "$s re-apply: $out"; done
fp2=$(fp) || fail "$fp2"
[ "$fp1" = "$fp2" ] || fail "re-applied fingerprint differs: $fp1 vs $fp2"
ok "07..10 re-applied; fingerprint identical to the first install"

out=$(q -f "$REH/03-D.restore.sql" 2>&1) && fail "03-D.restore ran over AR-1 and ar3"
grep -q "p2al_d_restore_check" <<<"$out" || fail "03-D.restore over ar3 did not refuse on its digest: $out"
[ "$fp1" = "$(fp)" ] || fail "a refused restore changed the node"
ok "a restore over a later step refuses atomically (03-D.restore over AR-1 and ar3)"

(cd "$PKT" && grep -v '(inner text' SHA256SUMS | sha256sum -c --quiet -) || fail "SHA256SUMS"
ok "SHA256SUMS verifies"
echo "PASS $pass checks"
