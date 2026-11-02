#!/usr/bin/env bash
# Real-Postgres concurrency and crash tests for the PROPOSED rtgip/2 delivery ledger.
# Runs against a throwaway local cluster in a temp dir. Never connects to Supabase.
# Usage: supabase/tests/rtgip/pg_concurrency.sh [path/to/rtgip_v2_delivery.proposed.sql]
set -euo pipefail

SQL_FILE="$(realpath "${1:-$(dirname "$0")/../../proposed/rtgip_v2_delivery.proposed.sql}")"
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
"${PSQL[@]}" -c "CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN;"
"${PSQL[@]}" -f "$SQL_FILE" >/dev/null 2>&1
# Apply twice: the proposal must be idempotent.
"${PSQL[@]}" -f "$SQL_FILE" >/dev/null 2>&1

"${PSQL[@]}" <<'SQL'
CREATE SCHEMA rtgip_test;
CREATE TABLE rtgip_test.effects (seq bigserial PRIMARY KEY, event_id uuid NOT NULL, agg text NOT NULL, revision bigint NOT NULL);
CREATE FUNCTION rtgip_test.env(p_id uuid, p_agg text, p_rev bigint, p_prev bigint, p_sha text DEFAULT repeat('a', 64), p_target text DEFAULT 'autocurb')
RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object('event_id', p_id, 'tenant_id', 'tnt-syn-northwind', 'rooftop_id', 'rf-nw-01', 'target_app', p_target,
    'route', 'autolabels->' || p_target, 'payload_sha256', p_sha,
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
CREATE FUNCTION rtgip_test.uuid_for(p text) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$ SELECT md5(p)::uuid $$;
SQL

check() { # name, sql returning 't'
  local got; got="$("${PSQL[@]}" -c "$2" 2>&1 || true)"
  if [ "$got" = "t" ]; then PASS=$((PASS+1)); echo "PASS  $1"; else FAIL=$((FAIL+1)); echo "FAIL  $1 -> $got"; fi
}
expect_error() { # name, sql that must fail, expected fragment
  local got; got="$("${PSQL[@]}" -c "$2" 2>&1 || true)"
  if echo "$got" | grep -q "$3"; then PASS=$((PASS+1)); echo "PASS  $1"; else FAIL=$((FAIL+1)); echo "FAIL  $1 -> $got"; fi
}

echo "== concurrency: 20 sessions deliver the same event"
for i in $(seq 1 20); do "${PSQL[@]}" -c "SELECT rtgip_test.deliver(rtgip_test.env(rtgip_test.uuid_for('same'), 'agg-same', 1, NULL))" >/dev/null & done; wait
check "exactly one effect for one event under 20 concurrent sessions" \
  "SELECT count(*) = 1 FROM rtgip_test.effects WHERE event_id = rtgip_test.uuid_for('same')"
check "exactly one inbox row" "SELECT count(*) = 1 FROM rtgip.inbox WHERE event_id = rtgip_test.uuid_for('same')"

echo "== concurrency: 20 sessions claim the same nonce"
for i in $(seq 1 20); do "${PSQL[@]}" -c "SELECT rtgip.claim_nonce('k1', 'nonce_same_0123456789', repeat('b',64), now() + interval '15 min')" >> "$WORK/nonce.out" & done; wait
check "one claimed, 19 exact retries" \
  "SELECT $(grep -c '^claimed$' "$WORK/nonce.out") = 1 AND $(grep -c '^exact_retry$' "$WORK/nonce.out") = 19"
check "conflicting reuse of a claimed nonce is detected" \
  "SELECT rtgip.claim_nonce('k1', 'nonce_same_0123456789', repeat('c',64), now()) = 'conflict'"

echo "== concurrency: 10 revisions of one aggregate delivered concurrently in random order"
for r in $(seq 1 10 | shuf); do
  prev=$([ "$r" = 1 ] && echo NULL || echo $((r-1)))
  "${PSQL[@]}" -c "SELECT rtgip_test.deliver(rtgip_test.env(rtgip_test.uuid_for('ord$r'), 'agg-ord', $r, $prev))" >/dev/null &
done; wait
check "all 10 applied exactly once" "SELECT count(*) = 10 AND count(DISTINCT event_id) = 10 FROM rtgip_test.effects WHERE agg = 'agg-ord'"
check "effects committed in revision order" \
  "SELECT array_agg(revision ORDER BY seq) = ARRAY[1,2,3,4,5,6,7,8,9,10]::bigint[] FROM rtgip_test.effects WHERE agg = 'agg-ord'"
check "watermark at 10, nothing held" \
  "SELECT (SELECT revision FROM rtgip.watermarks WHERE wm_key LIKE '%|agg-ord') = 10 AND NOT EXISTS (SELECT 1 FROM rtgip.inbox WHERE wm_key LIKE '%|agg-ord' AND outcome = 'held')"

echo "== stale and conflicting duplicates"
check "stale revision is recorded and not applied" \
  "SELECT rtgip_test.deliver(rtgip_test.env(rtgip_test.uuid_for('stale'), 'agg-ord', 4, 3)) = 'stale_ignored' AND (SELECT count(*) FROM rtgip_test.effects WHERE agg='agg-ord') = 10"
OUT=$("${PSQL[@]}" -c "SELECT rtgip_test.deliver(rtgip_test.env(rtgip_test.uuid_for('same'), 'agg-same', 1, NULL, repeat('f',64)))")
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
OUT=$("${PSQL[@]}" -c "SELECT rtgip_test.deliver(rtgip_test.env(rtgip_test.uuid_for('crash'), 'agg-crash', 1, NULL))")
check "redelivery after the crash applies exactly once" \
  "SELECT '$OUT' = 'applied' AND (SELECT count(*) FROM rtgip_test.effects WHERE agg='agg-crash') = 1"
OUT=$("${PSQL[@]}" -c "SELECT rtgip_test.deliver(rtgip_test.env(rtgip_test.uuid_for('crash'), 'agg-crash', 1, NULL))")
check "acknowledgment loss: a second redelivery is a duplicate with no new effect" \
  "SELECT '$OUT' = 'duplicate' AND (SELECT count(*) FROM rtgip_test.effects WHERE agg='agg-crash') = 1"

echo "== outbox: 4 concurrent workers over 200 rows"
"${PSQL[@]}" -c "SELECT count(*) FROM (SELECT rtgip.outbox_enqueue(jsonb_build_object('event_id', rtgip_test.uuid_for('ob'||g), 'route','autolabels->autocurb','tenant_id','tnt-syn-northwind'), '{}', repeat('d',64)) FROM generate_series(1,200) g) s" >/dev/null
for w in 1 2 3 4; do
  ( for _ in $(seq 1 10); do "${PSQL[@]}" -c "SELECT event_id FROM rtgip.outbox_claim('w$w', 7, 300)" >> "$WORK/claims_w$w.out"; done ) &
done; wait
TOTAL=$(cat "$WORK"/claims_w*.out | grep -c . || true)
UNIQUE=$(cat "$WORK"/claims_w*.out | grep . | sort -u | wc -l)
check "every row leased exactly once across workers (total=$TOTAL unique=$UNIQUE)" "SELECT $TOTAL = 200 AND $UNIQUE = 200"
expect_error "conflicting outbox enqueue raises event_id_conflict" \
  "SELECT rtgip.outbox_enqueue(jsonb_build_object('event_id', rtgip_test.uuid_for('ob1'), 'route','x','tenant_id','t'), '{}', repeat('e',64))" "event_id_conflict"
check "identical outbox enqueue is a no-op duplicate" \
  "SELECT rtgip.outbox_enqueue(jsonb_build_object('event_id', rtgip_test.uuid_for('ob1'), 'route','x','tenant_id','t'), '{}', repeat('d',64)) = 'duplicate'"
expect_error "advance without a matching receipt kind is refused" \
  "SELECT rtgip.outbox_advance(rtgip_test.uuid_for('ob1'), 'w1', 'consumer_committed', '{\"kind\":\"gateway_admission\"}')" "illegal_transition"
check "only the lease holder can advance" \
  "SELECT NOT rtgip.outbox_advance(rtgip_test.uuid_for('ob1'), 'not-the-holder', 'gateway_admitted', jsonb_build_object('kind','gateway_admission','event_id', rtgip_test.uuid_for('ob1')::text,'issuer','gateway','outcome','admitted'))"
check "dead letter after the attempt limit, row retained" \
  "WITH f AS (SELECT rtgip.outbox_fail(event_id, lease_owner, 'http_503', 5, 1) s FROM rtgip.outbox WHERE event_id = rtgip_test.uuid_for('ob2')) SELECT (SELECT s FROM f) = 'dead_letter'"

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
