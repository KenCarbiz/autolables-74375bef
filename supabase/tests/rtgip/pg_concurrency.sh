#!/usr/bin/env bash
# Real-Postgres tests for the PROPOSED rtgip/2 delivery ledger: receipt verification (C2),
# least-privilege roles (H8), C1 duplicate semantics, business-write/outbox atomicity,
# concurrency and crash recovery. Runs against a throwaway local cluster in a temp dir.
# Never connects to Supabase. Vault is a local stub table holding public DEV test vectors.
# Usage: supabase/tests/rtgip/pg_concurrency.sh [path/to/proposed.sql] [path/to/receipt-fixtures.json]
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
SQL_FILE="$(realpath "${1:-$HERE/../../proposed/rtgip_v2_delivery.proposed.sql}")"
FIXTURES="$(realpath "${2:-$HERE/receipt-fixtures.json}")"
PGBIN="${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
PORT="${RTGIP_PG_PORT:-55432}"
WORK="$(mktemp -d)"
RUNAS=()
if [ "$(id -u)" = "0" ]; then chown postgres "$WORK"; RUNAS=(runuser -u postgres --); fi
PSQL=("${RUNAS[@]}" "$PGBIN/psql" -h "$WORK" -p "$PORT" -U postgres -d rtgip_test -v ON_ERROR_STOP=1 -qAtX)
PASS=0; FAIL=0
cleanup() { "${RUNAS[@]}" "$PGBIN/pg_ctl" -D "$WORK/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$WORK"; }
trap cleanup EXIT

"${RUNAS[@]}" "$PGBIN/initdb" -D "$WORK/data" -U postgres -A trust >/dev/null
"${RUNAS[@]}" "$PGBIN/pg_ctl" -D "$WORK/data" -o "-p $PORT -k $WORK -c listen_addresses='' -c max_connections=100" -l "$WORK/pg.log" -w start >/dev/null
"${RUNAS[@]}" "$PGBIN/createdb" -h "$WORK" -p "$PORT" -U postgres rtgip_test
# Supabase-shaped stand-ins: browser roles, service role and a Vault secrets table.
"${PSQL[@]}" -c "CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
  CREATE SCHEMA vault; CREATE TABLE vault.decrypted_secrets (name text PRIMARY KEY, decrypted_secret text NOT NULL);
  REVOKE ALL ON SCHEMA vault FROM PUBLIC;"
# Hosted Supabase grants new tables, sequences and functions to the API roles by default; the
# proposal must revoke them itself rather than rely on a clean cluster.
"${PSQL[@]}" -c "ALTER DEFAULT PRIVILEGES GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
  ALTER DEFAULT PRIVILEGES GRANT ALL ON TABLES TO anon, authenticated, service_role;
  ALTER DEFAULT PRIVILEGES GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;"
"${PSQL[@]}" -f "$SQL_FILE" >/dev/null 2>&1 || { "${PSQL[@]}" -f "$SQL_FILE"; exit 1; }
# Apply twice: the proposal must be idempotent.
"${PSQL[@]}" -f "$SQL_FILE" >/dev/null 2>&1 || { echo "FAIL  second apply is not idempotent"; exit 1; }

"${PSQL[@]}" -v fix="$(cat "$FIXTURES")" <<'SQL'
CREATE SCHEMA rtgip_test;
CREATE TABLE rtgip_test.fix (doc jsonb NOT NULL);
INSERT INTO rtgip_test.fix VALUES (:'fix'::jsonb);
INSERT INTO rtgip.connections (connection_id, source_app, target_app, tenant_id, rooftop_ids, event_types, purposes, producer_enabled, reader_enabled, status)
SELECT c->>'connection_id', c->>'source_app', c->>'target_app', c->>'tenant_id',
       ARRAY(SELECT jsonb_array_elements_text(c->'rooftop_ids')), ARRAY(SELECT jsonb_array_elements_text(c->'event_types')),
       ARRAY(SELECT jsonb_array_elements_text(c->'purposes')), true, true, 'active'
FROM rtgip_test.fix, jsonb_array_elements(doc->'connections') c;
INSERT INTO rtgip.signing_keys (key_id, owner, dialect, connection_ids, status, not_before, not_after, secret_ref)
SELECT k->>'key_id', k->>'owner', k->>'dialect', ARRAY(SELECT jsonb_array_elements_text(k->'connection_ids')), k->>'status',
       to_timestamp((k->>'not_before')::bigint), to_timestamp((k->>'not_after')::bigint), k->>'secret_ref'
FROM rtgip_test.fix, jsonb_array_elements(doc->'keys') k;
INSERT INTO vault.decrypted_secrets SELECT k->>'secret_ref', k->>'dev_secret' FROM rtgip_test.fix, jsonb_array_elements(doc->'keys') k;
UPDATE rtgip.delivery_config SET local_app = 'autolabels';

CREATE FUNCTION rtgip_test.body(p_label text) RETURNS text LANGUAGE sql AS $$
  SELECT jsonb_set((doc#>>'{event,body}')::jsonb, '{event_id}', to_jsonb(md5(p_label)::uuid::text))::text FROM rtgip_test.fix
$$;
CREATE FUNCTION rtgip_test.vec(p_name text, OUT signing_text text, OUT signature text) LANGUAGE sql AS $$
  SELECT r->>'signing_text', r->>'signature' FROM rtgip_test.fix, jsonb_array_elements(doc->'receipts') r WHERE r->>'name' = p_name
$$;
CREATE FUNCTION rtgip_test.mac(p_text text, p_key text) RETURNS text LANGUAGE sql SECURITY DEFINER AS $$
  SELECT encode(extensions.hmac(convert_to('rtgip/2-receipt' || chr(10) || p_text, 'UTF8'), convert_to(s.decrypted_secret, 'UTF8'), 'sha256'), 'hex')
  FROM vault.decrypted_secrets s WHERE s.name = 'rtgip:' || p_key
$$;
-- A receipt for any outbox row, built from the row, optionally overridden, signed with p_key.
CREATE FUNCTION rtgip_test.receipt(p_id uuid, p_kind text, p_outcome text, p_over jsonb DEFAULT '{}', p_key text DEFAULT NULL,
  OUT signing_text text, OUT signature text) LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE o rtgip.outbox%ROWTYPE; r jsonb; k text;
BEGIN
  SELECT * INTO o FROM rtgip.outbox WHERE event_id = p_id;
  k := coalesce(p_key, CASE WHEN p_kind = 'gateway_admission' THEN 'gw-dev-1' ELSE 'ac-dev-1' END);
  r := jsonb_build_object('protocol','rtgip/2','kind',p_kind,'event_id',o.event_id::text,'route',o.route,
    'source_app',o.envelope->>'source_app','target_app',o.envelope->>'target_app','tenant_id',o.tenant_id,
    'rooftop_id',o.envelope->>'rooftop_id','connection_id',o.connection_id,'payload_sha256',o.envelope->>'payload_sha256',
    'issuer',CASE WHEN p_kind='gateway_admission' THEN 'gateway' ELSE o.envelope->>'target_app' END,
    'outcome',p_outcome,'issued_at',extract(epoch FROM now())::bigint - 5,'key_id',k) || p_over;
  signing_text := r::text;
  signature := rtgip_test.mac(signing_text, k);
END $$;
CREATE FUNCTION rtgip_test.uuid_for(p text) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$ SELECT md5(p)::uuid $$;

-- Inbox-side helpers for the concurrency tests (synthetic envelopes, receiver = autocurb).
CREATE TABLE rtgip_test.effects (seq bigserial PRIMARY KEY, event_id uuid NOT NULL, agg text NOT NULL, revision bigint NOT NULL);
CREATE FUNCTION rtgip_test.env(p_id uuid, p_agg text, p_rev bigint, p_prev bigint, p_sha text DEFAULT repeat('a', 64), p_target text DEFAULT 'autocurb')
RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object('event_id', p_id, 'tenant_id', 'tnt-syn-northwind', 'rooftop_id', 'rf-nw-01', 'target_app', p_target,
    'source_app', 'autolabels', 'route', 'autolabels->' || p_target, 'payload_sha256', p_sha,
    'vehicle', jsonb_build_object('vin', '1HGCM82633A004352', 'instance_id', 'inst-syn-0001', 'episode_id', 'ep-syn-0001-1'),
    'origin', jsonb_build_object('app', 'autolabels', 'event_id', p_id::text, 'revision', p_rev),
    'aggregate', jsonb_build_object('domain', 'inventory', 'type', 'episode', 'id', p_agg, 'revision', p_rev, 'prev_revision', p_prev));
$$;
-- One consumer transaction: inbox decision + effects for every applied event, atomically.
CREATE FUNCTION rtgip_test.deliver(p_env jsonb) RETURNS text LANGUAGE plpgsql AS $$
DECLARE r record; first text;
BEGIN
  FOR r IN SELECT * FROM rtgip.inbox_receive(p_env, 'autocurb') LOOP
    first := coalesce(first, r.outcome);
    IF r.outcome = 'applied' THEN
      INSERT INTO rtgip_test.effects (event_id, agg, revision)
      VALUES (r.event_id, r.envelope#>>'{aggregate,id}', (r.envelope#>>'{aggregate,revision}')::bigint);
    END IF;
  END LOOP;
  RETURN first;
END $$;
CREATE FUNCTION rtgip_test.receive1(p_env jsonb) RETURNS text LANGUAGE sql AS $$
  SELECT outcome || '|' || coalesce(reason, '') || '|' || committed FROM rtgip.inbox_receive(p_env, 'autocurb') LIMIT 1
$$;
-- Business table for the atomicity tests, writable by an app role that also holds the writer duty.
CREATE TABLE rtgip_test.listings (id text PRIMARY KEY, price_cents integer NOT NULL CHECK (price_cents > 0));
CREATE ROLE rtgip_test_app NOLOGIN;
GRANT rtgip_outbox_writer TO rtgip_test_app;
GRANT USAGE ON SCHEMA rtgip_test TO rtgip_test_app, rtgip_inbox_receiver, rtgip_dispatcher;
GRANT SELECT, INSERT ON rtgip_test.listings TO rtgip_test_app;
GRANT SELECT, INSERT ON rtgip_test.effects TO rtgip_inbox_receiver;
GRANT USAGE ON SEQUENCE rtgip_test.effects_seq_seq TO rtgip_inbox_receiver;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA rtgip_test TO rtgip_inbox_receiver, rtgip_test_app, rtgip_dispatcher;
GRANT SELECT ON rtgip_test.fix TO rtgip_test_app, rtgip_dispatcher;
SQL

check() { # name, sql returning 't'
  local got; got="$("${PSQL[@]}" -c "$2" 2>&1 || true)"
  if [ "$got" = "t" ]; then PASS=$((PASS+1)); echo "PASS  $1"; else FAIL=$((FAIL+1)); echo "FAIL  $1 -> $got"; fi
}
expect_error() { # name, sql that must fail, expected fragment
  local got; got="$("${PSQL[@]}" -c "$2" 2>&1 || true)"
  if echo "$got" | grep -q -- "$3"; then PASS=$((PASS+1)); echo "PASS  $1"; else FAIL=$((FAIL+1)); echo "FAIL  $1 -> $got"; fi
}
expect_value() { # name, sql, exact expected output
  local got; got="$("${PSQL[@]}" -c "$2" 2>&1 || true)"
  if [ "$got" = "$3" ]; then PASS=$((PASS+1)); echo "PASS  $1"; else FAIL=$((FAIL+1)); echo "FAIL  $1 -> got '$got' want '$3'"; fi
}
as() { echo "SET ROLE $1; $2"; }
ADV="SELECT rtgip.outbox_advance"
FIXID="(SELECT ((doc#>>'{event,body}')::jsonb->>'event_id')::uuid FROM rtgip_test.fix)"

echo "== H8 least privilege: the exact EXECUTE grant matrix"
check "no rtgip function is executable by PUBLIC, anon, authenticated or service_role" \
  "SELECT bool_and(NOT has_function_privilege(r, p.oid, 'EXECUTE')) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace,
     unnest(ARRAY['anon','authenticated','service_role']) r WHERE n.nspname = 'rtgip'
   AND NOT EXISTS (SELECT 1 FROM pg_proc q, aclexplode(q.proacl) a WHERE q.pronamespace = n.oid AND a.grantee = 0)"
check "each duty role can execute exactly its own functions and nothing else" \
  "WITH want(role, fn) AS (VALUES ('rtgip_outbox_writer','outbox_enqueue'),('rtgip_dispatcher','outbox_claim'),('rtgip_dispatcher','outbox_advance'),
     ('rtgip_dispatcher','outbox_fail'),('rtgip_inbox_receiver','inbox_admit'),('rtgip_operator','purge_expired_nonces')),
   got AS (SELECT r AS role, p.proname AS fn FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace,
     unnest(ARRAY['rtgip_outbox_writer','rtgip_dispatcher','rtgip_inbox_receiver','rtgip_operator']) r
     WHERE n.nspname = 'rtgip' AND has_function_privilege(r, p.oid, 'EXECUTE'))
   SELECT NOT EXISTS (SELECT * FROM want EXCEPT SELECT * FROM got) AND NOT EXISTS (SELECT * FROM got EXCEPT SELECT * FROM want)"
check "every rtgip function pins an empty search_path; every callable one is SECURITY DEFINER" \
  "SELECT bool_and(p.proconfig @> ARRAY['search_path=\"\"']) AND bool_and(p.prosecdef OR p.prorettype = 'trigger'::regtype OR p.proname IN ('local_app','watermark_key','canonical_json','derive_event_id','ct_equal','deliverable_reason'))
   FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'rtgip'"
check "no duty role can write any rtgip table directly" \
  "SELECT bool_and(NOT has_table_privilege(r, c.oid, 'INSERT') AND NOT has_table_privilege(r, c.oid, 'UPDATE') AND NOT has_table_privilege(r, c.oid, 'DELETE'))
   FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace,
     unnest(ARRAY['anon','authenticated','service_role','rtgip_outbox_writer','rtgip_dispatcher','rtgip_inbox_receiver','rtgip_operator']) r
   WHERE n.nspname = 'rtgip' AND c.relkind = 'r'"
expect_error "the dispatcher cannot read the outbox table directly" "$(as rtgip_dispatcher "SELECT count(*) FROM rtgip.outbox")" "permission denied"
expect_error "the dispatcher cannot enqueue" "$(as rtgip_dispatcher "SELECT rtgip.outbox_enqueue('{}')")" "permission denied"
expect_error "the outbox writer cannot advance" "$(as rtgip_outbox_writer "$ADV(gen_random_uuid(), 'w', '{}', '')")" "permission denied"
expect_error "the outbox writer cannot admit inbound deliveries" "$(as rtgip_outbox_writer "SELECT * FROM rtgip.inbox_admit('{}', '{}')")" "permission denied"
expect_error "the inbox receiver cannot call the inbox engine directly (no admission bypass)" "$(as rtgip_inbox_receiver "SELECT * FROM rtgip.inbox_receive('{}', 'autocurb')")" "permission denied"
expect_error "the inbox receiver cannot claim nonces directly" "$(as rtgip_inbox_receiver "SELECT rtgip.claim_nonce('k', 'nonce_direct_0123456789', repeat('a',64), now())")" "permission denied"
expect_error "the inbox receiver cannot write inbox rows directly" "$(as rtgip_inbox_receiver "INSERT INTO rtgip.inbox (tenant_id, origin_app, event_id, wm_key, revision, payload_sha256, outcome, envelope) VALUES ('t','autolabels',gen_random_uuid(),'k',1,repeat('a',64),'applied','{}')")" "permission denied"
expect_error "the inbox receiver cannot write admissions directly" "$(as rtgip_inbox_receiver "INSERT INTO rtgip.admissions (key_id, nonce, body_sha256, event_id, connection_id, signer, outcome) VALUES ('k','n',repeat('a',64),gen_random_uuid(),'c','gateway','applied')")" "permission denied"
expect_error "service_role cannot call inbox_admit" "$(as service_role "SELECT * FROM rtgip.inbox_admit('{}', '{}')")" "permission denied"
expect_error "authenticated cannot call inbox_admit" "$(as authenticated "SELECT * FROM rtgip.inbox_admit('{}', '{}')")" "permission denied"
check "the route catalog is loaded for the six three-app routes only" \
  "SELECT count(DISTINCT route) = 6 AND NOT bool_or(route LIKE '%autofilm%') FROM rtgip.event_catalog"
expect_error "the inbox receiver cannot advance outbox rows" "$(as rtgip_inbox_receiver "$ADV(gen_random_uuid(), 'w', '{}', '')")" "permission denied"
expect_error "the operator cannot change outbox rows" "$(as rtgip_operator "UPDATE rtgip.outbox SET state = 'pending'")" "permission denied"
expect_error "the operator cannot read Vault" "$(as rtgip_operator "SELECT * FROM vault.decrypted_secrets")" "permission denied"
expect_error "service_role cannot use the rtgip schema" "$(as service_role "SELECT count(*) FROM rtgip.outbox")" "permission denied"
check "the operator role reads the ledger through RLS" "$(as rtgip_operator "SELECT count(*) >= 0 FROM rtgip.audit_log")"

echo "== enqueue binds source, route and connection"
expect_value "enqueue the cross-language vector event (as the app role)" "$(as rtgip_test_app "SELECT rtgip.outbox_enqueue((SELECT doc#>>'{event,body}' FROM rtgip_test.fix))")" "enqueued"
check "connection pinned and body hash computed from the exact bytes match the TypeScript values" \
  "SELECT o.connection_id = f.doc#>>'{event,connection_id}' AND o.body_sha256 = f.doc#>>'{event,body_sha256}' FROM rtgip.outbox o, rtgip_test.fix f WHERE o.event_id = $FIXID"
check "SQL watermark key equals the TypeScript watermarkKey() for the same envelope" \
  "SELECT rtgip.watermark_key((doc#>>'{event,body}')::jsonb) = doc#>>'{event,watermark_key}' FROM rtgip_test.fix"
expect_error "an envelope from another source app is refused" \
  "$(as rtgip_test_app "SELECT rtgip.outbox_enqueue(jsonb_set(jsonb_set((SELECT rtgip_test.body('src'))::jsonb, '{source_app}', '\"autocurb\"'), '{route}', '\"autocurb->autolabels\"')::text)")" "source_not_local_app"
expect_error "an event type the connection does not grant is refused" \
  "$(as rtgip_test_app "SELECT rtgip.outbox_enqueue(jsonb_set((SELECT rtgip_test.body('evt'))::jsonb, '{event_type}', '\"media.approved\"')::text)")" "no_connection_for_event"
expect_error "a mismatched route is refused" \
  "$(as rtgip_test_app "SELECT rtgip.outbox_enqueue(jsonb_set((SELECT rtgip_test.body('rt'))::jsonb, '{route}', '\"autolabels->autoframe\"')::text)")" "route_mismatch"

echo "== C2: receipt verification and the transition table (cross-language vectors)"
"${PSQL[@]}" -c "$(as rtgip_dispatcher "SELECT count(*) FROM rtgip.outbox_claim('w1', 10, 300)")" >/dev/null
# The committed vectors were signed at 2026-01-01; this attempt is recorded as starting then.
"${PSQL[@]}" -c "UPDATE rtgip.outbox SET attempt_started_at = to_timestamp(1767225600) WHERE event_id = $FIXID"
V() { echo "(SELECT signing_text FROM rtgip_test.vec('$1')), (SELECT signature FROM rtgip_test.vec('$1'))"; }
R() { echo "(SELECT signing_text FROM rtgip_test.receipt($1)), (SELECT signature FROM rtgip_test.receipt($1))"; }
D() { "${PSQL[@]}" -c "$(as rtgip_dispatcher "$1")" 2>&1; }
expect_value "target_inbox before gateway admission is an illegal transition" "$(as rtgip_dispatcher "$ADV($FIXID, 'w1', $(V target_inbox:applied))")" "rejected:illegal_transition:in_flight:target_inbox"
expect_value "consumer_commit before gateway admission is an illegal transition" "$(as rtgip_dispatcher "$ADV($FIXID, 'w1', $(V consumer_commit:applied))")" "rejected:illegal_transition:in_flight:consumer_commit"
expect_value "a caller that does not hold the lease cannot advance" "$(as rtgip_dispatcher "$ADV($FIXID, 'intruder', $(V gateway_admission:admitted))")" "rejected:not_lease_holder"
expect_value "unsigned receipt is refused" "$(as rtgip_dispatcher "$ADV($FIXID, 'w1', (SELECT signing_text FROM rtgip_test.vec('gateway_admission:admitted')), '')")" "rejected:ack_bad_signature"
expect_value "forged signature is refused" "$(as rtgip_dispatcher "$ADV($FIXID, 'w1', (SELECT signing_text FROM rtgip_test.vec('gateway_admission:admitted')), repeat('0', 64))")" "rejected:ack_bad_signature"
expect_value "a genuine signature over altered bytes is refused" \
  "$(as rtgip_dispatcher "$ADV($FIXID, 'w1', replace((SELECT signing_text FROM rtgip_test.vec('gateway_admission:admitted')), '1767225600', '1767225601'), (SELECT signature FROM rtgip_test.vec('gateway_admission:admitted')))")" "rejected:ack_bad_signature"
for f in event_id route source_app target_app tenant_id rooftop_id connection_id payload_sha256; do
  expect_value "a correctly signed receipt with the wrong $f is refused" \
    "$(as rtgip_dispatcher "$ADV($FIXID, 'w1', $(R "$FIXID, 'gateway_admission', 'admitted', jsonb_build_object('$f', 'x-other')"))")" "rejected:ack_wrong_$f"
done
expect_value "a receipt signed by the target key while claiming to be the Gateway is refused" \
  "$(as rtgip_dispatcher "$ADV($FIXID, 'w1', $(R "$FIXID, 'gateway_admission', 'admitted', '{}', 'ac-dev-1'"))")" "rejected:ack_bad_key"
expect_value "a receipt dated in the future is refused" \
  "$(as rtgip_dispatcher "$ADV($FIXID, 'w1', $(R "$FIXID, 'gateway_admission', 'admitted', '{\"issued_at\": 4102444800}'"))")" "rejected:ack_issued_in_future"
expect_value "an extra field in the receipt is refused" \
  "$(as rtgip_dispatcher "$ADV($FIXID, 'w1', $(R "$FIXID, 'gateway_admission', 'admitted', '{\"note\": \"x\"}'"))")" "rejected:ack_malformed"
"${PSQL[@]}" -c "UPDATE rtgip.signing_keys SET status = 'revoked' WHERE key_id = 'gw-dev-1'"
expect_value "a receipt signed with a revoked key is refused" "$(as rtgip_dispatcher "$ADV($FIXID, 'w1', $(V gateway_admission:admitted))")" "rejected:ack_key_revoked"
"${PSQL[@]}" -c "UPDATE rtgip.signing_keys SET status = 'current', not_after = '2025-12-15' WHERE key_id = 'gw-dev-1'"
expect_value "a receipt outside the key validity window is refused" "$(as rtgip_dispatcher "$ADV($FIXID, 'w1', $(V gateway_admission:admitted))")" "rejected:ack_key_outside_validity"
"${PSQL[@]}" -c "UPDATE rtgip.signing_keys SET not_after = '2030-01-01', connection_ids = '{}' WHERE key_id = 'gw-dev-1'"
expect_value "a key not bound to the pinned connection is refused" "$(as rtgip_dispatcher "$ADV($FIXID, 'w1', $(V gateway_admission:admitted))")" "rejected:ack_key_not_bound_to_connection"
"${PSQL[@]}" -c "UPDATE rtgip.signing_keys SET connection_ids = (SELECT ARRAY(SELECT jsonb_array_elements_text(k->'connection_ids')) FROM rtgip_test.fix, jsonb_array_elements(doc->'keys') k WHERE k->>'key_id' = 'gw-dev-1') WHERE key_id = 'gw-dev-1';
  UPDATE rtgip.connections SET status = 'suspended'"
expect_value "a receipt on a suspended connection is refused" "$(as rtgip_dispatcher "$ADV($FIXID, 'w1', $(V gateway_admission:admitted))")" "rejected:ack_connection_inactive"
"${PSQL[@]}" -c "UPDATE rtgip.connections SET status = 'active', producer_enabled = false"
expect_value "a receipt after the producer side was disabled is refused" "$(as rtgip_dispatcher "$ADV($FIXID, 'w1', $(V gateway_admission:admitted))")" "rejected:ack_producer_disabled"
"${PSQL[@]}" -c "UPDATE rtgip.connections SET producer_enabled = true, reader_enabled = false"
expect_value "a receipt after the reader side was disabled is refused" "$(as rtgip_dispatcher "$ADV($FIXID, 'w1', $(V gateway_admission:admitted))")" "rejected:ack_reader_disabled"
"${PSQL[@]}" -c "UPDATE rtgip.connections SET reader_enabled = true, event_types = array_remove(event_types, (SELECT (doc#>>'{event,body}')::jsonb->>'event_type' FROM rtgip_test.fix))"
expect_value "a receipt after the event type grant was removed is refused" "$(as rtgip_dispatcher "$ADV($FIXID, 'w1', $(V gateway_admission:admitted))")" "rejected:ack_event_not_granted"
"${PSQL[@]}" -c "UPDATE rtgip.connections SET event_types = event_types || (SELECT (doc#>>'{event,body}')::jsonb->>'event_type' FROM rtgip_test.fix), purposes = '{media_reference}'"
expect_value "a receipt after the purpose grant was removed is refused" "$(as rtgip_dispatcher "$ADV($FIXID, 'w1', $(V gateway_admission:admitted))")" "rejected:ack_purpose_not_granted"
"${PSQL[@]}" -c "UPDATE rtgip.connections c SET purposes = ARRAY(SELECT jsonb_array_elements_text(x->'purposes')) FROM rtgip_test.fix, jsonb_array_elements(doc->'connections') x WHERE x->>'connection_id' = c.connection_id;
  UPDATE rtgip.outbox SET attempt_started_at = now() WHERE event_id = $FIXID"
expect_value "a receipt issued before the current attempt started (old receipt replay) is refused" "$(as rtgip_dispatcher "$ADV($FIXID, 'w1', $(V gateway_admission:admitted))")" "rejected:ack_predates_attempt"
"${PSQL[@]}" -c "UPDATE rtgip.outbox SET attempt_started_at = to_timestamp(1767225600) WHERE event_id = $FIXID; UPDATE rtgip.connections SET status = 'suspended'"
"${PSQL[@]}" -c "UPDATE rtgip.connections SET status = 'active', rooftop_ids = '{rf-nw-02}'"
expect_value "a connection that no longer grants the rooftop is refused" "$(as rtgip_dispatcher "$ADV($FIXID, 'w1', $(V gateway_admission:admitted))")" "rejected:ack_connection_mismatch"
"${PSQL[@]}" -c "UPDATE rtgip.connections SET rooftop_ids = '{rf-nw-01}'; DELETE FROM vault.decrypted_secrets WHERE name = 'rtgip:gw-dev-1'"
expect_value "a key whose Vault secret is missing fails closed" "$(as rtgip_dispatcher "$ADV($FIXID, 'w1', $(V gateway_admission:admitted))")" "rejected:ack_key_secret_unavailable"
"${PSQL[@]}" -c "INSERT INTO vault.decrypted_secrets SELECT k->>'secret_ref', k->>'dev_secret' FROM rtgip_test.fix, jsonb_array_elements(doc->'keys') k WHERE k->>'key_id' = 'gw-dev-1'"
check "no rejected receipt changed state or was stored; each rejection is audited" \
  "SELECT (SELECT state FROM rtgip.outbox WHERE event_id = $FIXID) = 'in_flight' AND NOT EXISTS (SELECT 1 FROM rtgip.receipts)
     AND (SELECT count(*) FROM rtgip.audit_log WHERE action = 'receipt_rejected') >= 25"
expect_value "the TypeScript-signed Gateway admission verifies in SQL" "$(as rtgip_dispatcher "$ADV($FIXID, 'w1', $(V gateway_admission:admitted))")" "gateway_admitted"
expect_value "replaying the admission is an illegal transition" "$(as rtgip_dispatcher "$ADV($FIXID, 'w1', $(V gateway_admission:admitted))")" "rejected:illegal_transition:gateway_admitted:gateway_admission"
expect_value "consumer_commit cannot skip target_inbox" "$(as rtgip_dispatcher "$ADV($FIXID, 'w1', $(V consumer_commit:applied))")" "rejected:illegal_transition:gateway_admitted:consumer_commit"
expect_value "the TypeScript-signed target_inbox receipt verifies in SQL" "$(as rtgip_dispatcher "$ADV($FIXID, 'w1', $(V target_inbox:applied))")" "target_persisted"
expect_value "a commit outcome that contradicts the inbox outcome is refused" \
  "$(as rtgip_dispatcher "$ADV($FIXID, 'w1', $(R "$FIXID, 'consumer_commit', 'stale_ignored'"))")" "rejected:ack_commit_contradicts_inbox"
expect_value "the TypeScript-signed consumer_commit verifies in SQL" "$(as rtgip_dispatcher "$ADV($FIXID, 'w1', $(V consumer_commit:applied))")" "consumer_committed"
expect_value "a committed row is terminal" "$(as rtgip_dispatcher "$ADV($FIXID, 'w1', $(V target_inbox:quarantined))")" "rejected:illegal_transition:terminal:consumer_committed"
expect_error "even the table owner cannot move a terminal row (trigger)" "UPDATE rtgip.outbox SET state = 'pending' WHERE event_id = $FIXID" "illegal_outbox_transition"
expect_error "outbox bytes are immutable (trigger)" "UPDATE rtgip.outbox SET body = '{}' WHERE event_id = $FIXID" "outbox_row_immutable"
expect_error "outbox rows cannot be deleted (trigger)" "DELETE FROM rtgip.outbox WHERE event_id = $FIXID" "retained"
check "exactly three receipts stored, with the exact signed bytes" \
  "SELECT count(*) = 3 AND bool_and(r.signing_text = v.signing_text AND r.signature = v.signature) FROM rtgip.receipts r
   JOIN LATERAL rtgip_test.vec(r.kind || ':' || r.outcome) v ON true WHERE r.event_id = $FIXID"

echo "== C1 in the outbox: quarantine and held never reach consumer_committed"
for x in q h d; do "${PSQL[@]}" -c "$(as rtgip_test_app "SELECT rtgip.outbox_enqueue(rtgip_test.body('c1-$x'))")" >/dev/null; done
"${PSQL[@]}" -c "$(as rtgip_dispatcher "SELECT count(*) FROM rtgip.outbox_claim('w2', 10, 300)")" >/dev/null
for x in q h d; do "${PSQL[@]}" -c "$(as rtgip_dispatcher "$ADV(rtgip_test.uuid_for('c1-$x'), 'w2', $(R "rtgip_test.uuid_for('c1-$x'), 'gateway_admission', 'admitted'"))")" >/dev/null; done
expect_value "a forged consumer_commit carrying 'quarantined' is refused" \
  "$(as rtgip_dispatcher "$ADV(rtgip_test.uuid_for('c1-q'), 'w2', $(R "rtgip_test.uuid_for('c1-q'), 'consumer_commit', 'quarantined'"))")" "rejected:ack_outcome_not_allowed"
expect_value "target quarantine is terminal" "$(as rtgip_dispatcher "$ADV(rtgip_test.uuid_for('c1-q'), 'w2', $(R "rtgip_test.uuid_for('c1-q'), 'target_inbox', 'quarantined'"))")" "target_quarantined"
expect_value "a commit after quarantine is refused" "$(as rtgip_dispatcher "$ADV(rtgip_test.uuid_for('c1-q'), 'w2', $(R "rtgip_test.uuid_for('c1-q'), 'consumer_commit', 'applied'"))")" "rejected:illegal_transition:terminal:target_quarantined"
expect_value "a held inbox receipt is recorded without advancing" "$(as rtgip_dispatcher "$ADV(rtgip_test.uuid_for('c1-h'), 'w2', $(R "rtgip_test.uuid_for('c1-h'), 'target_inbox', 'held'"))")" "held"
expect_value "a commit for a held event is refused" "$(as rtgip_dispatcher "$ADV(rtgip_test.uuid_for('c1-h'), 'w2', $(R "rtgip_test.uuid_for('c1-h'), 'consumer_commit', 'applied'"))")" "rejected:illegal_transition:gateway_admitted:consumer_commit"
expect_value "the held event goes back to retry, not to committed" "$(as rtgip_dispatcher "SELECT rtgip.outbox_fail(rtgip_test.uuid_for('c1-h'), 'w2', 'target_held_awaiting_predecessor', 5, 10)")" "retry_wait"
"${PSQL[@]}" -c "$(as rtgip_dispatcher "$ADV(rtgip_test.uuid_for('c1-d'), 'w2', $(R "rtgip_test.uuid_for('c1-d'), 'target_inbox', 'duplicate'"))")" >/dev/null
expect_value "a duplicate of a committed event may be committed with its original outcome" \
  "$(as rtgip_dispatcher "$ADV(rtgip_test.uuid_for('c1-d'), 'w2', $(R "rtgip_test.uuid_for('c1-d'), 'consumer_commit', 'applied'"))")" "consumer_committed"

echo "== C1 in the inbox: duplicates of held or quarantined events are never committed"
"${PSQL[@]}" -c "UPDATE rtgip.delivery_config SET local_app = 'autocurb'"
# Inbox engine (internal; reached only through inbox_admit, here called as its owner).
expect_value "a consumer rejection records the event as quarantined" "SELECT outcome || '|' || reason || '|' || committed FROM rtgip.inbox_receive(rtgip_test.env(rtgip_test.uuid_for('iq'), 'agg-iq', 1, NULL), 'autocurb', rtgip_test.uuid_for('iq'), 'consumer_reject:unknown_episode')" "quarantined|consumer_reject:unknown_episode|false"
expect_value "redelivery of a quarantined event repeats quarantined, committed=false" "SELECT rtgip_test.receive1(rtgip_test.env(rtgip_test.uuid_for('iq'), 'agg-iq', 1, NULL))" "quarantined|duplicate_of:quarantined|false"
check "a consumer rejection does not move the watermark" "SELECT NOT EXISTS (SELECT 1 FROM rtgip.watermarks WHERE wm_key LIKE '%|agg-iq|%')"
"${PSQL[@]}" -c "SELECT rtgip_test.receive1(rtgip_test.env(rtgip_test.uuid_for('ih'), 'agg-ih', 2, 1))" >/dev/null
expect_value "redelivery of a held event repeats held, committed=false" "SELECT rtgip_test.receive1(rtgip_test.env(rtgip_test.uuid_for('ih'), 'agg-ih', 2, 1))" "held|duplicate_of:held|false"
"${PSQL[@]}" -c "SELECT rtgip_test.receive1(rtgip_test.env(rtgip_test.uuid_for('ia'), 'agg-ia', 1, NULL))" >/dev/null
expect_value "redelivery of an applied event is a committed duplicate carrying its original outcome" "SELECT outcome || '|' || committed || '|' || committed_outcome FROM rtgip.inbox_receive(rtgip_test.env(rtgip_test.uuid_for('ia'), 'agg-ia', 1, NULL), 'autocurb')" "duplicate|true|applied"
expect_error "an inbox for another app refuses delivery" "SELECT rtgip_test.receive1(rtgip_test.env(gen_random_uuid(), 'agg-x', 1, NULL, repeat('a',64), 'autoframe'))" "wrong_destination"
"${PSQL[@]}" -c "SELECT rtgip_test.receive1(rtgip_test.env(rtgip_test.uuid_for('rj1'), 'agg-rj', 1, NULL))" >/dev/null
"${PSQL[@]}" -c "SELECT rtgip_test.receive1(rtgip_test.env(rtgip_test.uuid_for('rj3'), 'agg-rj', 3, 2))" >/dev/null
expect_value "a released successor whose effect failed is quarantined and stops the release chain" \
  "SELECT string_agg(outcome, ',' ORDER BY outcome) FROM rtgip.inbox_receive(rtgip_test.env(rtgip_test.uuid_for('rj2'), 'agg-rj', 2, 1), 'autocurb', rtgip_test.uuid_for('rj2'), 'consumer_reject:x')" "quarantined"
check "after the rejected revision the watermark stays put and its successor stays held" \
  "SELECT (SELECT revision FROM rtgip.watermarks WHERE wm_key LIKE '%|agg-rj|%') = 1 AND (SELECT outcome FROM rtgip.inbox WHERE event_id = rtgip_test.uuid_for('rj3')) = 'held'"
check "watermarks are scoped by route, instance and episode" \
  "SELECT bool_and(wm_key LIKE 'tnt-syn-northwind|rf-nw-01|autolabels->autocurb|autolabels|inventory|episode|%|inst-syn-0001|ep-syn-0001-1') FROM rtgip.watermarks"

echo "== atomicity: business write and outbox enqueue commit or roll back together"
"${PSQL[@]}" -c "UPDATE rtgip.delivery_config SET local_app = 'autolabels'"
"${PSQL[@]}" -c "$(as rtgip_test_app "BEGIN; INSERT INTO rtgip_test.listings VALUES ('lst-1', 2499900); SELECT rtgip.outbox_enqueue(rtgip_test.body('atom-1')); COMMIT;")" >/dev/null
check "a business write and its outbox row commit together" \
  "SELECT EXISTS (SELECT 1 FROM rtgip_test.listings WHERE id = 'lst-1') AND EXISTS (SELECT 1 FROM rtgip.outbox WHERE event_id = rtgip_test.uuid_for('atom-1'))"
"${PSQL[@]}" -c "$(as rtgip_test_app "BEGIN; INSERT INTO rtgip_test.listings VALUES ('lst-2', 2499900); SELECT rtgip.outbox_enqueue(replace(rtgip_test.body('atom-1'), 'SYN1001', 'SYN1002')); COMMIT;")" >/dev/null 2>&1 || true
check "an enqueue failure (event_id conflict) rolls back the business write" "SELECT NOT EXISTS (SELECT 1 FROM rtgip_test.listings WHERE id = 'lst-2')"
"${PSQL[@]}" -c "$(as rtgip_test_app "BEGIN; SELECT rtgip.outbox_enqueue(rtgip_test.body('atom-3')); INSERT INTO rtgip_test.listings VALUES ('lst-3', -1); COMMIT;")" >/dev/null 2>&1 || true
check "a business-write failure rolls back the outbox row" "SELECT NOT EXISTS (SELECT 1 FROM rtgip.outbox WHERE event_id = rtgip_test.uuid_for('atom-3'))"
("${PSQL[@]}" -c "SET application_name = 'crash_b'; SET ROLE rtgip_test_app; BEGIN; INSERT INTO rtgip_test.listings VALUES ('lst-4', 1); SELECT rtgip.outbox_enqueue(rtgip_test.body('atom-4')); SELECT pg_sleep(10); COMMIT;" >/dev/null 2>&1 || true) &
CRASH_PID=$!
for _ in $(seq 1 50); do
  [ "$("${PSQL[@]}" -c "SELECT count(*) FROM pg_stat_activity WHERE application_name = 'crash_b' AND wait_event = 'PgSleep'")" = "1" ] && break; sleep 0.1
done
"${PSQL[@]}" -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE application_name = 'crash_b'" >/dev/null
wait "$CRASH_PID" || true
check "a crash after both writes persists neither" \
  "SELECT NOT EXISTS (SELECT 1 FROM rtgip_test.listings WHERE id = 'lst-4') AND NOT EXISTS (SELECT 1 FROM rtgip.outbox WHERE event_id = rtgip_test.uuid_for('atom-4'))"

echo "== inbox engine concurrency (engine called as its owner; admission-level concurrency runs in pg_integration.sh): 20 sessions deliver the same event"
"${PSQL[@]}" -c "UPDATE rtgip.delivery_config SET local_app = 'autocurb'"
RX() { "${PSQL[@]}" -c "$1"; }
for i in $(seq 1 20); do RX "SELECT rtgip_test.deliver(rtgip_test.env(rtgip_test.uuid_for('same'), 'agg-same', 1, NULL))" >/dev/null & done; wait
check "exactly one effect for one event under 20 concurrent sessions" \
  "SELECT count(*) = 1 FROM rtgip_test.effects WHERE event_id = rtgip_test.uuid_for('same')"
check "exactly one inbox row" "SELECT count(*) = 1 FROM rtgip.inbox WHERE event_id = rtgip_test.uuid_for('same')"

echo "== concurrency: 20 sessions claim the same nonce"
for i in $(seq 1 20); do RX "SELECT rtgip.claim_nonce('k1', 'nonce_same_0123456789', repeat('b',64), now() + interval '15 min')" >> "$WORK/nonce.out" & done; wait
check "one claimed, 19 exact retries" \
  "SELECT $(grep -c '^claimed$' "$WORK/nonce.out") = 1 AND $(grep -c '^exact_retry$' "$WORK/nonce.out") = 19"
check "conflicting reuse of a claimed nonce is detected" \
  "SELECT rtgip.claim_nonce('k1', 'nonce_same_0123456789', repeat('c',64), now()) = 'conflict'"

echo "== concurrency: 10 revisions of one aggregate delivered concurrently in random order"
for r in $(seq 1 10 | shuf); do
  prev=$([ "$r" = 1 ] && echo NULL || echo $((r-1)))
  RX "SELECT rtgip_test.deliver(rtgip_test.env(rtgip_test.uuid_for('ord$r'), 'agg-ord', $r, $prev))" >/dev/null &
done; wait
check "all 10 applied exactly once" "SELECT count(*) = 10 AND count(DISTINCT event_id) = 10 FROM rtgip_test.effects WHERE agg = 'agg-ord'"
check "effects committed in revision order" \
  "SELECT array_agg(revision ORDER BY seq) = ARRAY[1,2,3,4,5,6,7,8,9,10]::bigint[] FROM rtgip_test.effects WHERE agg = 'agg-ord'"
check "watermark at 10, nothing held" \
  "SELECT (SELECT revision FROM rtgip.watermarks WHERE wm_key LIKE '%|agg-ord|%') = 10 AND NOT EXISTS (SELECT 1 FROM rtgip.inbox WHERE wm_key LIKE '%|agg-ord|%' AND outcome = 'held')"

echo "== stale and conflicting duplicates"
check "stale revision is recorded and not applied" \
  "SELECT rtgip_test.deliver(rtgip_test.env(rtgip_test.uuid_for('stale'), 'agg-ord', 4, 3)) = 'stale_ignored' AND (SELECT count(*) FROM rtgip_test.effects WHERE agg='agg-ord') = 10"
OUT=$(RX "SELECT rtgip_test.deliver(rtgip_test.env(rtgip_test.uuid_for('same'), 'agg-same', 1, NULL, repeat('f',64)))")
check "conflicting duplicate is quarantined, original kept" \
  "SELECT '$OUT' = 'quarantined' AND (SELECT count(*) FROM rtgip.inbox_conflicts) = 1 AND (SELECT count(*) FROM rtgip_test.effects WHERE agg='agg-same') = 1"

echo "== crash before commit (backend terminated mid-transaction)"
("${PSQL[@]}" -c "SET application_name = 'crash_a'; BEGIN; SELECT rtgip_test.deliver(rtgip_test.env(rtgip_test.uuid_for('crash'), 'agg-crash', 1, NULL)); SELECT pg_sleep(10); COMMIT;" >/dev/null 2>&1 || true) &
CRASH_PID=$!
for _ in $(seq 1 50); do
  [ "$("${PSQL[@]}" -c "SELECT count(*) FROM pg_stat_activity WHERE application_name = 'crash_a' AND wait_event = 'PgSleep'")" = "1" ] && break; sleep 0.1
done
"${PSQL[@]}" -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE application_name = 'crash_a'" >/dev/null
wait "$CRASH_PID" || true
check "nothing persisted from the killed transaction" \
  "SELECT NOT EXISTS (SELECT 1 FROM rtgip.inbox WHERE event_id = rtgip_test.uuid_for('crash')) AND NOT EXISTS (SELECT 1 FROM rtgip_test.effects WHERE agg='agg-crash')"
OUT=$(RX "SELECT rtgip_test.deliver(rtgip_test.env(rtgip_test.uuid_for('crash'), 'agg-crash', 1, NULL))")
check "redelivery after the crash applies exactly once" \
  "SELECT '$OUT' = 'applied' AND (SELECT count(*) FROM rtgip_test.effects WHERE agg='agg-crash') = 1"
OUT=$(RX "SELECT rtgip_test.deliver(rtgip_test.env(rtgip_test.uuid_for('crash'), 'agg-crash', 1, NULL))")
check "acknowledgment loss: a second redelivery is a duplicate with no new effect" \
  "SELECT '$OUT' = 'duplicate' AND (SELECT count(*) FROM rtgip_test.effects WHERE agg='agg-crash') = 1"

echo "== outbox: 4 concurrent dispatchers over 200 rows"
"${PSQL[@]}" -c "UPDATE rtgip.delivery_config SET local_app = 'autolabels'"
"${PSQL[@]}" -c "SET ROLE rtgip_test_app; SELECT count(*) FROM (SELECT rtgip.outbox_enqueue(rtgip_test.body('ob'||g)) FROM generate_series(1,200) g) s" >/dev/null
for w in 1 2 3 4; do
  ( for _ in $(seq 1 10); do "${PSQL[@]}" -c "SET ROLE rtgip_dispatcher; SELECT event_id FROM rtgip.outbox_claim('cw$w', 7, 300) WHERE route = 'autolabels->autocurb'" >> "$WORK/claims_w$w.out"; done ) &
done; wait
"${PSQL[@]}" -c "SELECT md5('ob' || g)::uuid FROM generate_series(1,200) g" > "$WORK/ob_ids"
TOTAL=$(cat "$WORK"/claims_w*.out | grep -Fxf "$WORK/ob_ids" | wc -l)
UNIQUE=$(cat "$WORK"/claims_w*.out | grep -Fxf "$WORK/ob_ids" | sort -u | wc -l)
check "every row leased exactly once across workers (total=$TOTAL unique=$UNIQUE)" "SELECT $TOTAL = 200 AND $UNIQUE = 200"
check "identical outbox enqueue is a no-op duplicate" \
  "$(as rtgip_test_app "SELECT rtgip.outbox_enqueue(rtgip_test.body('ob1')) = 'duplicate'")"
OWNER=$("${PSQL[@]}" -c "SELECT lease_owner FROM rtgip.outbox WHERE event_id = rtgip_test.uuid_for('ob2')")
expect_value "dead letter after the attempt limit" "$(as rtgip_dispatcher "SELECT rtgip.outbox_fail(rtgip_test.uuid_for('ob2'), '$OWNER', 'http_503', 5, 1)")" "dead_letter"
check "the dead-lettered row is retained" "SELECT state = 'dead_letter' FROM rtgip.outbox WHERE event_id = rtgip_test.uuid_for('ob2')"

echo "== pause: a connection that is not deliverable is never leased and never dead-letters"
"${PSQL[@]}" -c "SET ROLE rtgip_test_app; SELECT rtgip.outbox_enqueue(rtgip_test.body('pause-1'))" >/dev/null
"${PSQL[@]}" -c "UPDATE rtgip.connections SET status = 'suspended' WHERE connection_id = (SELECT connection_id FROM rtgip.outbox WHERE event_id = rtgip_test.uuid_for('pause-1'))"
check "a suspended connection's rows are not leased" "$(as rtgip_dispatcher "SELECT NOT EXISTS (SELECT 1 FROM rtgip.outbox_claim('pw', 1000, 300) WHERE event_id = rtgip_test.uuid_for('pause-1'))")"
check "the paused row spent no attempt" "SELECT attempts = 0 AND state = 'pending' FROM rtgip.outbox WHERE event_id = rtgip_test.uuid_for('pause-1')"
"${PSQL[@]}" -c "UPDATE rtgip.connections SET status = 'active' WHERE connection_id = (SELECT connection_id FROM rtgip.outbox WHERE event_id = rtgip_test.uuid_for('pause-1'))"
"${PSQL[@]}" -c "$(as rtgip_dispatcher "SELECT count(*) FROM rtgip.outbox_claim('pw', 1000, 300)")" >/dev/null
"${PSQL[@]}" -c "UPDATE rtgip.connections SET reader_enabled = false WHERE connection_id = (SELECT connection_id FROM rtgip.outbox WHERE event_id = rtgip_test.uuid_for('pause-1'))"
expect_value "a failure after the grant was lost mid-attempt pauses instead of dead-lettering (max_attempts 1)" \
  "$(as rtgip_dispatcher "SELECT rtgip.outbox_fail(rtgip_test.uuid_for('pause-1'), 'pw', 'ack_reader_disabled', 5, 1)")" "retry_wait"
check "the attempt was given back and the pause is audited" \
  "SELECT o.attempts = 0 AND EXISTS (SELECT 1 FROM rtgip.audit_log a WHERE a.event_id = o.event_id AND a.action = 'pause:retry_wait' AND a.detail->>'paused_by' = 'reader_disabled') FROM rtgip.outbox o WHERE o.event_id = rtgip_test.uuid_for('pause-1')"
"${PSQL[@]}" -c "UPDATE rtgip.connections SET reader_enabled = true"

echo "== immutability, transport pin, browser roles"
expect_error "audit log rejects UPDATE" "UPDATE rtgip.audit_log SET actor = 'x'" "append-only"
expect_error "audit log rejects DELETE" "DELETE FROM rtgip.audit_log" "append-only"
expect_error "transport cannot be enabled" "UPDATE rtgip.delivery_config SET transport_enabled = true" "check constraint"
expect_error "anon cannot read the inbox" "SET ROLE anon; SELECT count(*) FROM rtgip.inbox" "permission denied"
expect_error "authenticated cannot call inbox_receive" "SET ROLE authenticated; SELECT * FROM rtgip.inbox_receive('{}'::jsonb, 'autocurb')" "permission denied"
check "RLS is enabled on every rtgip table" \
  "SELECT bool_and(relrowsecurity) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'rtgip' AND c.relkind = 'r'"

echo
echo "rtgip/2 Postgres $("${PSQL[@]}" -c 'SHOW server_version') results: $PASS passed, $FAIL failed"
[ "$FAIL" = 0 ]
