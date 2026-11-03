#!/usr/bin/env bash
# Real-Postgres tests for the PROPOSED rtgip/2 delivery ledger: receipt verification (C2),
# least-privilege roles (H8), C1 duplicate semantics, business-write/outbox atomicity,
# concurrency and crash recovery. Runs against a throwaway local cluster in a temp dir.
# Never connects to Supabase. Vault is a local stub table holding public DEV test vectors.
# Usage: supabase/tests/rtgip/pg_concurrency.sh [path/to/proposed.sql] [path/to/rtgip2-receipt-v2.v1.json]
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
SQL_FILE="$(realpath "${1:-$HERE/../../proposed/rtgip_v2_delivery.proposed.sql}")"
FIXTURES="$(realpath "${2:-$HERE/../../../src/lib/rooftopos-parked/rtgip2/rtgip2-receipt-v2.v1.json}")"
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

cp "$FIXTURES" "$WORK/vectors.json"; chmod 644 "$WORK/vectors.json"
{ printf '\\set fix `cat %s`\n' "$WORK/vectors.json"; cat <<'SQL'
CREATE SCHEMA rtgip_test;
CREATE TABLE rtgip_test.fix (doc jsonb NOT NULL);
INSERT INTO rtgip_test.fix VALUES (:'fix'::jsonb);

-- The receipt vectors are dated 2027-01-15, past this cluster's clock: the receipt checks read
-- rtgip.clock(), which only the function owner can replace, and this throwaway cluster pins it.
CREATE FUNCTION rtgip_test.pin_clock(p_epoch bigint) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE format('CREATE OR REPLACE FUNCTION rtgip.clock() RETURNS timestamptz LANGUAGE sql STABLE SET search_path = %L AS $f$ SELECT to_timestamp(%s) $f$', '', p_epoch);
END $$;
-- Load (or restore) the vector registry: its connections, its keys and the DEV secrets in the Vault stub.
CREATE FUNCTION rtgip_test.reset_world() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM rtgip.connections WHERE connection_id NOT IN (SELECT connection_id FROM rtgip.outbox)
    AND connection_id NOT IN (SELECT c->>'connection_id' FROM rtgip_test.fix, jsonb_array_elements(doc#>'{registry,connections}') c);
  DELETE FROM rtgip.signing_keys;
  DELETE FROM vault.decrypted_secrets WHERE name LIKE 'rtgip:%';
  INSERT INTO rtgip.connections (connection_id, source_app, target_app, tenant_id, rooftop_ids, event_types, purposes, producer_enabled, reader_enabled, status)
  SELECT c->>'connection_id', c->>'source_app', c->>'target_app', c->>'tenant_id',
         ARRAY(SELECT jsonb_array_elements_text(c->'rooftop_ids')), ARRAY(SELECT jsonb_array_elements_text(c->'event_types')),
         ARRAY(SELECT jsonb_array_elements_text(c->'purposes')), (c->>'producer_enabled')::boolean, (c->>'reader_enabled')::boolean, c->>'status'
  FROM rtgip_test.fix, jsonb_array_elements(doc#>'{registry,connections}') c
  ON CONFLICT (connection_id) DO UPDATE SET source_app = EXCLUDED.source_app, target_app = EXCLUDED.target_app, tenant_id = EXCLUDED.tenant_id,
    rooftop_ids = EXCLUDED.rooftop_ids, event_types = EXCLUDED.event_types, purposes = EXCLUDED.purposes,
    producer_enabled = EXCLUDED.producer_enabled, reader_enabled = EXCLUDED.reader_enabled, status = EXCLUDED.status;
  INSERT INTO rtgip.signing_keys (key_id, owner, dialect, connection_ids, status, not_before, not_after, secret_ref)
  SELECT k->>'key_id', k->>'owner', k->>'dialect', ARRAY(SELECT jsonb_array_elements_text(k->'connection_ids')), k->>'status',
         to_timestamp((k->>'not_before')::bigint), to_timestamp((k->>'not_after')::bigint), 'rtgip:' || (k->>'key_id')
  FROM rtgip_test.fix, jsonb_array_elements(doc#>'{registry,keys}') k WHERE k->>'dialect' = 'rtgip/2';
  INSERT INTO vault.decrypted_secrets SELECT 'rtgip:' || (k->>'key_id'), k->>'secret' FROM rtgip_test.fix, jsonb_array_elements(doc#>'{registry,keys}') k WHERE k->>'dialect' = 'rtgip/2';
  PERFORM rtgip_test.pin_clock((doc->>'now')::bigint) FROM rtgip_test.fix;
END $$;
SELECT rtgip_test.reset_world();
UPDATE rtgip.delivery_config SET local_app = 'autolabels';

CREATE FUNCTION rtgip_test.chain_body(i integer) RETURNS text LANGUAGE sql AS $$ SELECT doc->'chains'->i->>'body' FROM rtgip_test.fix $$;
CREATE FUNCTION rtgip_test.body(p_label text) RETURNS text LANGUAGE sql AS $$
  SELECT jsonb_set(rtgip_test.chain_body(0)::jsonb, '{event_id}', to_jsonb(md5(p_label)::uuid::text))::text
$$;
-- The canonical text of receipt j of chain i, exactly what a worker passes to outbox_advance.
CREATE FUNCTION rtgip_test.rc(i integer, j integer) RETURNS text LANGUAGE sql SECURITY DEFINER AS $$
  SELECT rtgip.receipt_canonical(doc->'chains'->i->'receipts'->j) FROM rtgip_test.fix
$$;
CREATE FUNCTION rtgip_test.rcx(i integer, j integer, p_over jsonb) RETURNS text LANGUAGE sql SECURITY DEFINER AS $$
  SELECT rtgip.receipt_canonical((doc->'chains'->i->'receipts'->j) || p_over) FROM rtgip_test.fix
$$;
CREATE FUNCTION rtgip_test.uuid_for(p text) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$ SELECT md5(p)::uuid $$;

-- One full delivery of a receipt chain through enqueue, claim, deliver and confirm, inside a
-- subtransaction that is always rolled back. p_negative may carry {"now", "registry"}.
-- Returns the last outbox_advance answer (plus the outbox_fail state after a pending answer).
CREATE FUNCTION rtgip_test.flow(p_body text, p_receipts jsonb, p_negative jsonb DEFAULT '{}') RETURNS text LANGUAGE plpgsql AS $$
DECLARE e jsonb := p_body::jsonb; v_id uuid := (e->>'event_id')::uuid; g integer; res text; ts text[];
BEGIN
  BEGIN
    UPDATE rtgip.delivery_config SET local_app = e->>'source_app';
    IF p_negative ? 'now' THEN PERFORM rtgip_test.pin_clock((p_negative->>'now')::bigint); END IF;
    IF p_negative ? 'registry' THEN
      UPDATE rtgip.signing_keys sk SET status = k->>'status', not_before = to_timestamp((k->>'not_before')::bigint),
        not_after = to_timestamp((k->>'not_after')::bigint), connection_ids = ARRAY(SELECT jsonb_array_elements_text(k->'connection_ids'))
      FROM jsonb_array_elements(p_negative#>'{registry,keys}') k WHERE sk.key_id = k->>'key_id';
    END IF;
    PERFORM rtgip.outbox_enqueue(p_body);
    PERFORM count(*) FROM rtgip.outbox_claim('fw', 1000, 300);
    SELECT lease_generation INTO g FROM rtgip.outbox WHERE event_id = v_id;
    res := rtgip.outbox_advance(v_id, 'fw', g, ARRAY[rtgip.receipt_canonical(p_receipts->0)]);
    IF res = 'gateway_admitted' THEN
      UPDATE rtgip.outbox SET next_attempt_at = now() - interval '1 second' WHERE event_id = v_id;
      PERFORM count(*) FROM rtgip.outbox_claim('fw', 1000, 300);
      SELECT lease_generation INTO g FROM rtgip.outbox WHERE event_id = v_id;
      SELECT array_agg(rtgip.receipt_canonical(x) ORDER BY o) INTO ts FROM jsonb_array_elements(p_receipts) WITH ORDINALITY t(x, o);
      res := rtgip.outbox_advance(v_id, 'fw', g, ts);
      IF res LIKE 'pending:%' THEN res := res || '>' || rtgip.outbox_fail(v_id, 'fw', g, left(substr(res, 9), 200), 1, 10); END IF;
    END IF;
    RAISE EXCEPTION USING ERRCODE = 'P0099', MESSAGE = res;
  EXCEPTION WHEN SQLSTATE 'P0099' THEN
    RETURN SQLERRM;
  END;
END $$;

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
} | "${PSQL[@]}"

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
FIXID="(SELECT ((doc->'chains'->0->>'body')::jsonb->>'event_id')::uuid FROM rtgip_test.fix)"

echo "== H8 least privilege: the exact EXECUTE grant matrix"
check "no rtgip function is executable by PUBLIC, anon, authenticated or service_role" \
  "SELECT bool_and(NOT has_function_privilege(r, p.oid, 'EXECUTE')) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace,
     unnest(ARRAY['anon','authenticated','service_role']) r WHERE n.nspname = 'rtgip'
   AND NOT EXISTS (SELECT 1 FROM pg_proc q, aclexplode(q.proacl) a WHERE q.pronamespace = n.oid AND a.grantee = 0)"
check "each duty role can execute exactly its own functions and nothing else" \
  "WITH want(role, fn) AS (VALUES ('rtgip_outbox_writer','outbox_enqueue'),('rtgip_dispatcher','outbox_claim'),('rtgip_dispatcher','outbox_advance'),
     ('rtgip_dispatcher','outbox_fail'),('rtgip_inbox_receiver','inbox_admit'),('rtgip_inbox_receiver','inbox_record_receipts'),('rtgip_operator','purge_expired_nonces'),('rtgip_operator','outbox_redrive')),
   got AS (SELECT r AS role, p.proname AS fn FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace,
     unnest(ARRAY['rtgip_outbox_writer','rtgip_dispatcher','rtgip_inbox_receiver','rtgip_operator']) r
     WHERE n.nspname = 'rtgip' AND has_function_privilege(r, p.oid, 'EXECUTE'))
   SELECT NOT EXISTS (SELECT * FROM want EXCEPT SELECT * FROM got) AND NOT EXISTS (SELECT * FROM got EXCEPT SELECT * FROM want)"
check "every rtgip function pins an empty search_path; every callable one is SECURITY DEFINER" \
  "SELECT bool_and(p.proconfig @> ARRAY['search_path=\"\"']) AND bool_and(p.prosecdef OR p.prorettype = 'trigger'::regtype OR p.proname IN ('local_app','watermark_key','canonical_json','derive_event_id','ct_equal','deliverable_reason','receipt_canonical','envelope_sha','delivery_identity','clock','consumer_effect'))
   FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'rtgip'"
check "no duty role can write any rtgip table directly" \
  "SELECT bool_and(NOT has_table_privilege(r, c.oid, 'INSERT') AND NOT has_table_privilege(r, c.oid, 'UPDATE') AND NOT has_table_privilege(r, c.oid, 'DELETE'))
   FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace,
     unnest(ARRAY['anon','authenticated','service_role','rtgip_outbox_writer','rtgip_dispatcher','rtgip_inbox_receiver','rtgip_operator']) r
   WHERE n.nspname = 'rtgip' AND c.relkind = 'r'"
expect_error "the dispatcher cannot read the outbox table directly" "$(as rtgip_dispatcher "SELECT count(*) FROM rtgip.outbox")" "permission denied"
expect_error "the dispatcher cannot enqueue" "$(as rtgip_dispatcher "SELECT rtgip.outbox_enqueue('{}')")" "permission denied"
expect_error "the outbox writer cannot advance" "$(as rtgip_outbox_writer "$ADV(gen_random_uuid(), 'w', 1, ARRAY[]::text[])")" "permission denied"
expect_error "the outbox writer cannot admit inbound deliveries" "$(as rtgip_outbox_writer "SELECT * FROM rtgip.inbox_admit('{}', '{}', '{}')")" "permission denied"
expect_error "the inbox receiver cannot call the inbox engine directly (no admission bypass)" "$(as rtgip_inbox_receiver "SELECT * FROM rtgip.inbox_receive('{}', 'autocurb')")" "permission denied"
expect_error "the inbox receiver cannot claim nonces directly" "$(as rtgip_inbox_receiver "SELECT rtgip.claim_nonce('k', 'nonce_direct_0123456789', repeat('a',64), now())")" "permission denied"
expect_error "the inbox receiver cannot write inbox rows directly" "$(as rtgip_inbox_receiver "INSERT INTO rtgip.inbox (tenant_id, origin_app, event_id, wm_key, revision, payload_sha256, outcome, envelope) VALUES ('t','autolabels',gen_random_uuid(),'k',1,repeat('a',64),'applied','{}')")" "permission denied"
expect_error "the inbox receiver cannot write admissions directly" "$(as rtgip_inbox_receiver "INSERT INTO rtgip.admissions (key_id, nonce, body_sha256, event_id, connection_id, signer, outcome) VALUES ('k','n',repeat('a',64),gen_random_uuid(),'c','gateway','applied')")" "permission denied"
expect_error "service_role cannot call inbox_admit" "$(as service_role "SELECT * FROM rtgip.inbox_admit('{}', '{}', '{}')")" "permission denied"
expect_error "authenticated cannot call inbox_admit" "$(as authenticated "SELECT * FROM rtgip.inbox_admit('{}', '{}', '{}')")" "permission denied"
check "the route catalog is loaded for the six three-app routes only" \
  "SELECT count(DISTINCT route) = 6 AND NOT bool_or(route LIKE '%autofilm%') FROM rtgip.event_catalog"
expect_error "the inbox receiver cannot advance outbox rows" "$(as rtgip_inbox_receiver "$ADV(gen_random_uuid(), 'w', 1, ARRAY[]::text[])")" "permission denied"
expect_error "the operator cannot change outbox rows" "$(as rtgip_operator "UPDATE rtgip.outbox SET state = 'pending'")" "permission denied"
expect_error "the operator cannot read Vault" "$(as rtgip_operator "SELECT * FROM vault.decrypted_secrets")" "permission denied"
expect_error "service_role cannot use the rtgip schema" "$(as service_role "SELECT count(*) FROM rtgip.outbox")" "permission denied"
check "the operator role reads the ledger through RLS" "$(as rtgip_operator "SELECT count(*) >= 0 FROM rtgip.audit_log")"

echo "== enqueue binds source, route and connection"
expect_value "enqueue an envelope for the vector connection (as the app role)" "$(as rtgip_test_app "SELECT rtgip.outbox_enqueue(rtgip_test.body('enq'))")" "enqueued"
check "connection pinned, delivery_id and body hash computed by SQL match the vector" \
  "SELECT o.connection_id = f.doc#>>'{chains,0,connection_id}' AND o.delivery_id = rtgip.delivery_identity(o.connection_id, o.envelope)
     AND o.body_sha256 = encode(extensions.digest(convert_to(o.body, 'UTF8'), 'sha256'), 'hex')
     FROM rtgip.outbox o, rtgip_test.fix f WHERE o.event_id = rtgip_test.uuid_for('enq')"
check "SQL envelope_sha and delivery_identity equal the TypeScript values for all 19 vector chains" \
  "SELECT bool_and(rtgip.envelope_sha((c->>'body')::jsonb) = c->>'envelope_sha256'
     AND rtgip.delivery_identity(c->>'connection_id', (c->>'body')::jsonb) = c->>'delivery_id'
     AND encode(extensions.digest(convert_to(rtgip.canonical_json((c->>'body')::jsonb), 'UTF8'), 'sha256'), 'hex') = c->>'envelope_sha256')
   FROM rtgip_test.fix, jsonb_array_elements(doc->'chains') c"
expect_error "an envelope from another source app is refused" \
  "$(as rtgip_test_app "SELECT rtgip.outbox_enqueue(jsonb_set(jsonb_set((SELECT rtgip_test.body('src'))::jsonb, '{source_app}', '\"autocurb\"'), '{route}', '\"autocurb->autolabels\"')::text)")" "source_not_local_app"
expect_error "an event type the connection does not grant is refused" \
  "$(as rtgip_test_app "SELECT rtgip.outbox_enqueue(jsonb_set((SELECT rtgip_test.body('evt'))::jsonb, '{event_type}', '\"media.approved\"')::text)")" "no_connection_for_event"
expect_error "a mismatched route is refused" \
  "$(as rtgip_test_app "SELECT rtgip.outbox_enqueue(jsonb_set((SELECT rtgip_test.body('rt'))::jsonb, '{route}', '\"autolabels->autoframe\"')::text)")" "route_mismatch"

echo "== receipt canonicalizer and vectors (rtgip2-receipt-v2.v1.json)"
check "receipt_canonical reproduces the vector signed_bytes for every receipt of every chain (domain line + canonical unsigned)" \
  "SELECT count(*) > 40 AND bool_and('rtgip/2-receipt/2' || chr(10) || rtgip.receipt_canonical(r.v - 'signature') = (c->'signed_bytes'->>(r.o::int - 1)))
   FROM rtgip_test.fix, jsonb_array_elements(doc->'chains') c, jsonb_array_elements(c->'receipts') WITH ORDINALITY r(v, o)"
check "receipt_canonical output parses back to the same object and matches the TypeScript canonical text" \
  "SELECT bool_and(rtgip.receipt_canonical(r.v)::jsonb = r.v) FROM rtgip_test.fix, jsonb_array_elements(doc->'chains') c, jsonb_array_elements(c->'receipts') r(v)"
expect_error "receipt_canonical refuses a float" "SELECT rtgip.receipt_canonical('{\"a\":1.5}'::jsonb)" "receipt_not_flat"
expect_error "receipt_canonical refuses a nested object" "SELECT rtgip.receipt_canonical('{\"a\":{\"b\":1}}'::jsonb)" "receipt_not_flat"
expect_value "receipt_canonical escapes as JSON.stringify does and sorts keys by code point" \
  "SELECT rtgip.receipt_canonical(jsonb_build_object('b', E'q\"\\\\ \\n', 'B', 'x', 'a', NULL, 'n', 7))" '{"B":"x","a":null,"b":"q\"\\ \n","n":7}'

echo "== C2: every vector chain passes outbox_advance (deliver, then confirm), as a fresh row each time"
check_rows() { # name, SQL returning one row per case as 't|label' or 'f|label|detail'
  local out line n_ok=0 n_bad=0
  out="$("${PSQL[@]}" -c "$2" 2>&1 || true)"
  while IFS= read -r line; do
    [ -z "$line" ] && continue
    if [ "${line%%|*}" = "t" ]; then n_ok=$((n_ok+1)); else n_bad=$((n_bad+1)); echo "FAIL  $1 -> ${line#*|}"; fi
  done <<< "$out"
  if [ "$n_bad" = 0 ] && [ "$n_ok" -gt 0 ]; then PASS=$((PASS+1)); echo "PASS  $1 ($n_ok cases)"; else FAIL=$((FAIL+1)); [ "$n_bad" = 0 ] && echo "FAIL  $1 -> no cases ran: $out"; fi
}
check_rows "each of the 19 chains reaches the expected state (committed, quarantined, held stays gateway_admitted after a failed confirmation)" \
  "SELECT CASE WHEN got = want THEN 't|' || name ELSE 'f|' || name || ' got ' || got || ' want ' || want END FROM (
     SELECT c->>'name' AS name,
       rtgip_test.flow(c->>'body', c->'receipts') AS got,
       CASE WHEN jsonb_array_length(c->'receipts') = 3 THEN 'consumer_committed'
            WHEN c#>>'{receipts,1,outcome}' = 'quarantined' THEN 'target_quarantined'
            WHEN c#>>'{receipts,1,outcome}' = 'held' THEN 'pending:target_held_awaiting_predecessor>gateway_admitted' END AS want
     FROM rtgip_test.fix, jsonb_array_elements(doc->'chains') c) t"
check_rows "every negative vector is refused for its reason class (the vector's reason, as an outbox_advance rejection)" \
  "SELECT CASE WHEN got = 'rejected:' || err THEN 't|' || nm ELSE 'f|' || nm || ' got ' || got || ' want ' || err END FROM (
     SELECT x->>'name' AS nm, x->>'error' AS err,
       rtgip_test.flow(coalesce(x->>'body', c->>'body'), x->'receipts',
         jsonb_strip_nulls(jsonb_build_object('now', x->'now', 'registry', x->'registry'))) AS got
     FROM rtgip_test.fix, jsonb_array_elements(doc->'negative') x
     JOIN LATERAL jsonb_array_elements(doc->'chains') c ON c->>'name' = x->>'chain') t"
check "a negative leaves no state behind (flows are rolled back)" \
  "SELECT NOT EXISTS (SELECT 1 FROM rtgip.outbox WHERE event_id = (SELECT ((doc#>>'{chains,0,body}')::jsonb->>'event_id')::uuid FROM rtgip_test.fix))"
check "the clock is pinned back to the vector time after rolled-back flows" \
  "SELECT extract(epoch FROM rtgip.clock())::bigint = (doc->>'now')::bigint FROM rtgip_test.fix"

echo "== C2: lease fencing and one persistent lifecycle (vector chain 1, as the dispatcher role)"
expect_value "enqueue vector chain 1 (as the app role)" "$(as rtgip_test_app "SELECT rtgip.outbox_enqueue(rtgip_test.chain_body(0))")" "enqueued"
"${PSQL[@]}" -c "$(as rtgip_dispatcher "SELECT count(*) FROM rtgip.outbox_claim('w1', 1000, 300)")" >/dev/null
GEN() { "${PSQL[@]}" -c "SELECT lease_generation FROM rtgip.outbox WHERE event_id = $FIXID"; }
A() { echo "$ADV($FIXID, 'w1', $(GEN), ARRAY[$1])"; }
check "claim returned a generation and leased the row for delivery" \
  "SELECT lease_generation = 1 AND lease_action = 'deliver' AND state = 'in_flight' AND lease_owner = 'w1' FROM rtgip.outbox WHERE event_id = $FIXID"
expect_value "target_inbox before gateway admission is refused (missing previous stage)" "$(as rtgip_dispatcher "$(A "rtgip_test.rc(0,1)")")" "rejected:ack_missing_previous_stage"
expect_value "consumer_commit before gateway admission is refused" "$(as rtgip_dispatcher "$(A "rtgip_test.rc(0,2)")")" "rejected:ack_missing_previous_stage"
expect_value "a delivery lease takes exactly one receipt" "$(as rtgip_dispatcher "$(A "rtgip_test.rc(0,0), rtgip_test.rc(0,1)")")" "rejected:illegal_transition:in_flight:chain"
expect_error "a caller that does not hold the lease cannot advance (lost_lease)" "$(as rtgip_dispatcher "$ADV($FIXID, 'intruder', $(GEN), ARRAY[rtgip_test.rc(0,0)])")" "lost_lease"
expect_error "a stale generation cannot advance (lost_lease)" "$(as rtgip_dispatcher "$ADV($FIXID, 'w1', $(GEN) - 1, ARRAY[rtgip_test.rc(0,0)])")" "lost_lease"
expect_error "a stale generation cannot fail the row either (lost_lease)" "$(as rtgip_dispatcher "SELECT rtgip.outbox_fail($FIXID, 'w1', $(GEN) + 1, 'x', 5, 10)")" "lost_lease"
expect_value "unsigned receipt is refused" "$(as rtgip_dispatcher "$(A "rtgip_test.rcx(0,0,'{\"signature\":\"\"}')")")" "rejected:ack_unsupported_version_or_shape"
expect_value "forged signature is refused" "$(as rtgip_dispatcher "$(A "rtgip_test.rcx(0,0,jsonb_build_object('signature', repeat('0',64)))")")" "rejected:ack_bad_signature"
expect_value "a genuine signature over altered bytes is refused" \
  "$(as rtgip_dispatcher "$(A "rtgip_test.rcx(0,0,jsonb_build_object('issued_at', (SELECT (doc#>>'{chains,0,receipts,0,issued_at}')::bigint + 1 FROM rtgip_test.fix)))")")" "rejected:ack_bad_signature"
expect_value "non-canonical bytes (trailing space) are refused" "$(as rtgip_dispatcher "$(A "rtgip_test.rc(0,0) || ' '")")" "rejected:ack_not_canonical"
for f in event_id route source_app target_app tenant_id rooftop_id connection_id payload_sha256 envelope_sha256 delivery_id issuer recipient; do
  val="'x-other'"; case "$f" in payload_sha256|envelope_sha256|delivery_id) val="repeat('0',64)";; esac
  expect_value "a correctly shaped receipt with the wrong $f is refused" \
    "$(as rtgip_dispatcher "$(A "rtgip_test.rcx(0,0,jsonb_build_object('$f', $val))")")" "rejected:ack_wrong_$f"
done
expect_value "a receipt signed by the target key while claiming to be the Gateway is refused" \
  "$(as rtgip_dispatcher "$(A "rtgip_test.rcx(0,0,'{\"key_id\":\"ac-dev-1\"}')")")" "rejected:ack_key_not_authorized"
expect_value "a receipt dated beyond the clock skew is refused" \
  "$(as rtgip_dispatcher "$(A "rtgip_test.rcx(0,0,jsonb_build_object('issued_at', (SELECT (doc->>'now')::bigint + 1000 FROM rtgip_test.fix)))")")" "rejected:ack_future_receipt"
expect_value "an extra field in the receipt is refused" \
  "$(as rtgip_dispatcher "$(A "rtgip_test.rcx(0,0,'{\"note\":\"x\"}')")")" "rejected:ack_unsupported_version_or_shape"
WORLD="SELECT rtgip_test.reset_world()"
"${PSQL[@]}" -c "UPDATE rtgip.signing_keys SET status = 'revoked' WHERE key_id = 'gw-dev-1'"
expect_value "a receipt signed with a revoked key is refused" "$(as rtgip_dispatcher "$(A "rtgip_test.rc(0,0)")")" "rejected:ack_key_not_authorized"
"${PSQL[@]}" -c "$WORLD" >/dev/null
"${PSQL[@]}" -c "UPDATE rtgip.signing_keys SET not_after = to_timestamp(1799990000) WHERE key_id = 'gw-dev-1'"
expect_value "a receipt outside the key validity window is refused" "$(as rtgip_dispatcher "$(A "rtgip_test.rc(0,0)")")" "rejected:ack_key_not_authorized"
"${PSQL[@]}" -c "$WORLD" >/dev/null
"${PSQL[@]}" -c "UPDATE rtgip.signing_keys SET connection_ids = '{}' WHERE key_id = 'gw-dev-1'"
expect_value "a key not bound to the pinned connection is refused" "$(as rtgip_dispatcher "$(A "rtgip_test.rc(0,0)")")" "rejected:ack_key_not_authorized"
"${PSQL[@]}" -c "$WORLD" >/dev/null
CONNPIN="connection_id = (SELECT doc#>>'{chains,0,connection_id}' FROM rtgip_test.fix)"
for patch in "status = 'suspended'" "producer_enabled = false" "reader_enabled = false" "rooftop_ids = '{rf-nw-02}'" "purposes = '{media_reference}'" "event_types = array_remove(event_types, 'vehicle.identity_registered')"; do
  "${PSQL[@]}" -c "UPDATE rtgip.connections SET $patch WHERE $CONNPIN"
  expect_value "a receipt after the connection changed ($patch) is refused" "$(as rtgip_dispatcher "$(A "rtgip_test.rc(0,0)")")" "rejected:ack_connection_not_authorized"
  "${PSQL[@]}" -c "$WORLD" >/dev/null
done
"${PSQL[@]}" -c "UPDATE rtgip.connections SET status = 'suspended' WHERE $CONNPIN;
  INSERT INTO rtgip.connections SELECT 'conn:sibling', source_app, target_app, tenant_id, rooftop_ids, event_types, purposes, true, true, 'active' FROM rtgip.connections WHERE $CONNPIN"
expect_value "a sibling connection granting the same rooftop cannot rescue a suspended one" "$(as rtgip_dispatcher "$(A "rtgip_test.rc(0,0)")")" "rejected:ack_connection_not_authorized"
"${PSQL[@]}" -c "UPDATE rtgip.connections SET status = 'active' WHERE $CONNPIN"
expect_value "two active connections granting one rooftop are ambiguous and refused" "$(as rtgip_dispatcher "$(A "rtgip_test.rc(0,0)")")" "rejected:ack_connection_not_authorized"
"${PSQL[@]}" -c "$WORLD" >/dev/null
"${PSQL[@]}" -c "DELETE FROM vault.decrypted_secrets WHERE name = 'rtgip:gw-dev-1'"
expect_value "a key whose Vault secret is missing fails closed" "$(as rtgip_dispatcher "$(A "rtgip_test.rc(0,0)")")" "rejected:ack_key_secret_unavailable"
"${PSQL[@]}" -c "$WORLD" >/dev/null
check "no rejected receipt changed state or was stored; each rejection is audited" \
  "SELECT (SELECT state FROM rtgip.outbox WHERE event_id = $FIXID) = 'in_flight' AND NOT EXISTS (SELECT 1 FROM rtgip.receipts)
     AND (SELECT count(*) FROM rtgip.audit_log WHERE action = 'receipt_rejected') >= 30"
expect_value "the TypeScript-signed Gateway admission verifies in SQL and the row is gateway_admitted" "$(as rtgip_dispatcher "$(A "rtgip_test.rc(0,0)")")" "gateway_admitted"
check "the lease was released and the next attempt is due after the base backoff" \
  "SELECT lease_owner IS NULL AND lease_action IS NULL AND next_attempt_at > now() AND next_attempt_at <= now() + interval '6 seconds' FROM rtgip.outbox WHERE event_id = $FIXID"
expect_error "replaying the admission after the lease was released is lost_lease" "$(as rtgip_dispatcher "$ADV($FIXID, 'w1', 1, ARRAY[rtgip_test.rc(0,0)])")" "lost_lease"
check "a gateway_admitted row is not leased before its next attempt is due" "$(as rtgip_dispatcher "SELECT NOT EXISTS (SELECT 1 FROM rtgip.outbox_claim('w1', 1000, 300) WHERE event_id = $FIXID)")"
"${PSQL[@]}" -c "UPDATE rtgip.outbox SET next_attempt_at = now() - interval '1 second' WHERE event_id = $FIXID"
"${PSQL[@]}" -c "$(as rtgip_dispatcher "SELECT count(*) FROM rtgip.outbox_claim('w1', 1000, 300)")" >/dev/null
check "the due gateway_admitted row was leased for confirmation under a new generation" \
  "SELECT lease_generation = 2 AND lease_action = 'confirm' AND state = 'gateway_admitted' FROM rtgip.outbox WHERE event_id = $FIXID"
expect_value "a chain whose first element is not the stored admission is refused" "$(as rtgip_dispatcher "$(A "rtgip_test.rc(0,1), rtgip_test.rc(0,2)")")" "rejected:ack_admission_mismatch"
expect_value "the admission alone is pending, not committed" "$(as rtgip_dispatcher "$(A "rtgip_test.rc(0,0)")")" "pending:target_inbox_pending"
expect_value "admission and inbox without the commit is pending" "$(as rtgip_dispatcher "$(A "rtgip_test.rc(0,0), rtgip_test.rc(0,1)")")" "pending:consumer_commit_pending"
expect_value "a commit that skips the inbox receipt is refused" "$(as rtgip_dispatcher "$(A "rtgip_test.rc(0,0), rtgip_test.rc(0,2)")")" "rejected:ack_missing_previous_stage"
expect_value "the full TypeScript-signed chain verifies in SQL" "$(as rtgip_dispatcher "$(A "rtgip_test.rc(0,0), rtgip_test.rc(0,1), rtgip_test.rc(0,2)")")" "consumer_committed"
expect_error "a committed row is terminal: even the right generation is lost_lease" "$(as rtgip_dispatcher "$ADV($FIXID, 'w1', 2, ARRAY[rtgip_test.rc(0,0)])")" "lost_lease"
expect_error "even the table owner cannot move a terminal row (trigger)" "UPDATE rtgip.outbox SET state = 'pending' WHERE event_id = $FIXID" "illegal_outbox_transition"
expect_error "outbox bytes are immutable (trigger)" "UPDATE rtgip.outbox SET body = '{}' WHERE event_id = $FIXID" "outbox_row_immutable"
expect_error "outbox rows cannot be deleted (trigger)" "DELETE FROM rtgip.outbox WHERE event_id = $FIXID" "retained"
check "the full chain is kept on the row and the three receipts are stored with their exact signed bytes" \
  "SELECT jsonb_array_length(o.receipts) = 3 AND o.receipts = (f.doc#>'{chains,0,receipts}')
     AND (SELECT count(*) = 3 AND bool_and('rtgip/2-receipt/2' || chr(10) || r.signing_text = (f.doc#>'{chains,0,signed_bytes}'->>(ord.n::int)) AND r.signature = f.doc#>>('{chains,0,receipts,' || ord.n || ',signature}')::text[])
         FROM rtgip.receipts r JOIN LATERAL (SELECT CASE r.kind WHEN 'gateway_admission' THEN 0 WHEN 'target_inbox' THEN 1 ELSE 2 END AS n) ord ON true WHERE r.event_id = o.event_id)
   FROM rtgip.outbox o, rtgip_test.fix f WHERE o.event_id = $FIXID"

echo "== lease expiry: worker A's late result is refused and worker B's stands"
"${PSQL[@]}" -c "$(as rtgip_test_app "SELECT rtgip.outbox_enqueue(rtgip_test.body('lease'))")" >/dev/null
LID="rtgip_test.uuid_for('lease')"
"${PSQL[@]}" -c "$(as rtgip_dispatcher "SELECT count(*) FROM rtgip.outbox_claim('wa', 1000, 300) WHERE event_id = $LID")" >/dev/null
"${PSQL[@]}" -c "UPDATE rtgip.outbox SET lease_until = now() - interval '1 second' WHERE event_id = $LID"
"${PSQL[@]}" -c "$(as rtgip_dispatcher "SELECT count(*) FROM rtgip.outbox_claim('wb', 1000, 300)")" >/dev/null
check "B re-claimed the expired lease as a new attempt under a higher generation" \
  "SELECT lease_owner = 'wb' AND lease_generation = 2 AND attempts = 2 FROM rtgip.outbox WHERE event_id = $LID"
expect_error "A's late fail is lost_lease" "$(as rtgip_dispatcher "SELECT rtgip.outbox_fail($LID, 'wa', 1, 'late', 5, 10)")" "lost_lease"
expect_error "A's late advance is lost_lease" "$(as rtgip_dispatcher "$ADV($LID, 'wa', 1, ARRAY['{}'])")" "lost_lease"
check "nothing changed for B's lease and no state-change audit row was written for A" \
  "SELECT o.lease_owner = 'wb' AND o.state = 'in_flight' AND NOT EXISTS (SELECT 1 FROM rtgip.audit_log a WHERE a.event_id = o.event_id AND a.actor = 'wa' AND a.action <> 'receipt_rejected') FROM rtgip.outbox o WHERE o.event_id = $LID"
expect_value "B's fail stands" "$(as rtgip_dispatcher "SELECT rtgip.outbox_fail($LID, 'wb', 2, 'http_503', 5, 10)")" "retry_wait"

echo "== consumer effect hook: default refuses, an app replaces it"
"${PSQL[@]}" -c "UPDATE rtgip.delivery_config SET local_app = 'autocurb'"
expect_value "with no consumer installed every event is quarantined with no_consumer" "SELECT rtgip_test.receive1(rtgip_test.env(rtgip_test.uuid_for('nc'), 'agg-nc', 1, NULL))" "quarantined|no_consumer|false"
check "a refused effect leaves no watermark" "SELECT NOT EXISTS (SELECT 1 FROM rtgip.watermarks WHERE wm_key LIKE '%|agg-nc|%')"
"${PSQL[@]}" -c "CREATE OR REPLACE FUNCTION rtgip.consumer_effect(e jsonb) RETURNS jsonb LANGUAGE plpgsql SET search_path = '' AS \$f\$
BEGIN
  IF e#>>'{aggregate,id}' = 'agg-fx-boom' THEN RAISE EXCEPTION 'effect_boom'; END IF;
  IF e#>>'{aggregate,id}' = 'agg-fx-refuse' AND (e#>>'{aggregate,revision}')::int = 2 THEN RETURN '{\"ok\":false,\"reason\":\"fx_refused\"}'::jsonb; END IF;
  IF e#>>'{aggregate,id}' = 'agg-fx-dup' THEN RETURN '{\"ok\":true,\"duplicate\":true}'::jsonb; END IF;
  RETURN '{\"ok\":true}'::jsonb;
END \$f\$"
expect_value "the replaced hook is used: ok:true is applied" "SELECT rtgip_test.receive1(rtgip_test.env(rtgip_test.uuid_for('fx1'), 'agg-fx-ok', 1, NULL))" "applied||true"
expect_value "the effect's duplicate flag is recorded in the reason" "SELECT rtgip_test.receive1(rtgip_test.env(rtgip_test.uuid_for('fxd'), 'agg-fx-dup', 1, NULL))" "applied||true"
check "the duplicate flag is kept on the inbox row" "SELECT reason = 'effect_duplicate' FROM rtgip.inbox WHERE event_id = rtgip_test.uuid_for('fxd')"
expect_error "an error inside the effect aborts the whole call (nothing is recorded)" "SELECT rtgip_test.receive1(rtgip_test.env(rtgip_test.uuid_for('fxb'), 'agg-fx-boom', 1, NULL))" "effect_boom"
check "the aborted effect left no inbox row" "SELECT NOT EXISTS (SELECT 1 FROM rtgip.inbox WHERE event_id = rtgip_test.uuid_for('fxb'))"
"${PSQL[@]}" -c "SELECT rtgip_test.receive1(rtgip_test.env(rtgip_test.uuid_for('fr2'), 'agg-fx-refuse', 2, 1))" >/dev/null
expect_value "a held successor whose effect is refused is quarantined when released and stops the chain" \
  "SELECT string_agg(outcome || ':' || coalesce(reason, ''), ',' ORDER BY outcome) FROM rtgip.inbox_receive(rtgip_test.env(rtgip_test.uuid_for('fr1'), 'agg-fx-refuse', 1, NULL), 'autocurb')" "applied:,quarantined:fx_refused"
check "the watermark stays at the last applied revision" "SELECT (SELECT revision FROM rtgip.watermarks WHERE wm_key LIKE '%|agg-fx-refuse|%') = 1"

echo "== C1 in the inbox: duplicates of held or quarantined events are never committed"
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
OGEN=$("${PSQL[@]}" -c "SELECT lease_generation FROM rtgip.outbox WHERE event_id = rtgip_test.uuid_for('ob2')")
expect_value "dead letter after the attempt limit" "$(as rtgip_dispatcher "SELECT rtgip.outbox_fail(rtgip_test.uuid_for('ob2'), '$OWNER', $OGEN, 'http_503', 5, 1)")" "dead_letter"
check "the dead-lettered row is retained" "SELECT state = 'dead_letter' FROM rtgip.outbox WHERE event_id = rtgip_test.uuid_for('ob2')"
OB2="$("${PSQL[@]}" -c "SELECT rtgip_test.uuid_for('ob2')")"
expect_error "a redrive needs a written reason" "$(as rtgip_operator "SELECT rtgip.outbox_redrive('$OB2', 'op-1', 'x')")" "reason_required"
expect_value "an operator redrive returns the dead letter to the queue" "$(as rtgip_operator "SELECT rtgip.outbox_redrive('$OB2', 'op-1', 'target recovered after the incident')")" "retry_wait"
check "the redrive is audited with the operator and reason and the retry counters reset" \
  "SELECT o.attempts = 0 AND EXISTS (SELECT 1 FROM rtgip.audit_log a WHERE a.event_id = o.event_id AND a.action = 'redrive' AND a.actor = 'op-1' AND a.detail->>'reason' = 'target recovered after the incident') FROM rtgip.outbox o WHERE o.event_id = rtgip_test.uuid_for('ob2')"

echo "== pause: a connection that is not deliverable is never leased and never dead-letters"
"${PSQL[@]}" -c "SET ROLE rtgip_test_app; SELECT rtgip.outbox_enqueue(rtgip_test.body('pause-1'))" >/dev/null
"${PSQL[@]}" -c "UPDATE rtgip.connections SET status = 'suspended' WHERE connection_id = (SELECT connection_id FROM rtgip.outbox WHERE event_id = rtgip_test.uuid_for('pause-1'))"
check "a suspended connection's rows are not leased" "$(as rtgip_dispatcher "SELECT NOT EXISTS (SELECT 1 FROM rtgip.outbox_claim('pw', 1000, 300) WHERE event_id = rtgip_test.uuid_for('pause-1'))")"
check "the paused row spent no attempt" "SELECT attempts = 0 AND state = 'pending' FROM rtgip.outbox WHERE event_id = rtgip_test.uuid_for('pause-1')"
"${PSQL[@]}" -c "UPDATE rtgip.connections SET status = 'active' WHERE connection_id = (SELECT connection_id FROM rtgip.outbox WHERE event_id = rtgip_test.uuid_for('pause-1'))"
"${PSQL[@]}" -c "$(as rtgip_dispatcher "SELECT count(*) FROM rtgip.outbox_claim('pw', 1000, 300)")" >/dev/null
"${PSQL[@]}" -c "UPDATE rtgip.connections SET reader_enabled = false WHERE connection_id = (SELECT connection_id FROM rtgip.outbox WHERE event_id = rtgip_test.uuid_for('pause-1'))"
expect_value "a failure after the grant was lost mid-attempt pauses instead of dead-lettering (max_attempts 1)" \
  "$(as rtgip_dispatcher "SELECT rtgip.outbox_fail(rtgip_test.uuid_for('pause-1'), 'pw', $("${PSQL[@]}" -c "SELECT lease_generation FROM rtgip.outbox WHERE event_id = rtgip_test.uuid_for('pause-1')"), 'ack_reader_disabled', 5, 1)")" "retry_wait"
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
