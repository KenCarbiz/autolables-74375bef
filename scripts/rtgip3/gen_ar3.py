#!/usr/bin/env python3
# Generates the pinned per-app rtgip/3 SQL packets (supabase/proposed/rtgip3/) from the shared, unmodified
# supabase/proposed/rtgip_v3_attest.proposed.sql and its inverse, in the AR-1 ar1-<app>.sql / F4 wrapper style:
# an outer sha256-checked DO wrapper around one inner DO statement with server, user and PG 17 pins, preflight and
# readback STOPs. Also writes the K5-v3 public-key-row templates (placeholders only) and SHA256SUMS.
#   gen_ar3.py                          write the packets
#   gen_ar3.py --check                  fail if any written file is stale
#   gen_ar3.py --rehearsal DIR --server ADDR --major N --consumer-pin HEX8
#                                       write rehearsal copies (local server, local major, local consumer_effect)
#   gen_ar3.py --fill-k5 APP PARAMS.json OUT.wrap.sql [--k5-inverse] [--server ADDR --major N]
#                                       fill a K5-v3 template (APP al, ac, af or gw) and wrap it with its own sha256;
#                                       --server '' pins a unix-socket connection (inet_server_addr() is NULL)
import argparse
import hashlib
import json
import os
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
OUT = os.path.join(ROOT, "supabase", "proposed", "rtgip3")
V3 = os.path.join(ROOT, "supabase", "proposed", "rtgip_v3_attest.proposed.sql")
V3_INV = os.path.join(ROOT, "supabase", "proposed", "rtgip_v3_attest.inverse.proposed.sql")
PINS = os.path.join(OUT, "ar3-function-pins.json")

APPS = {
    "al": {"app": "autolabels", "ref": "uakiwvigsmrlyfpsalai", "lovable": "0bc16929", "server": "2a05:d018:1b65:3000:4237:64f1:ae00:c178", "consumer": "a951fa40"},
    "ac": {"app": "autocurb", "ref": "zzwuxpbxkfxgtrnfxgia", "lovable": "a49ec5fd", "server": "2a05:d014:700:dc01:d874:f840:fb79:606d", "consumer": "c3eda1d1"},
    "af": {"app": "autoframe", "ref": "mubzldoczujeoatzdwko", "lovable": "56352bba", "server": "2a05:d018:5b7:f201:193c:cd90:810:e4ea", "consumer": "45e0abce"},
}
GW = {"ref": "ldlmkelrxlfmrhdrtvqn", "lovable": "7b73eb61", "server": "2a05:d018:65a:e200:ded7:9f7f:3e55:d997"}
V2_PINS = dict(x.split(":") for x in (
    "audit_log_immutable:3fabef52 canonical_json:20e5fde6 claim_nonce:5a4fa884 clock:eaaf497c ct_equal:622fc07f "
    "deliverable_reason:79204041 delivery_identity:73fa8053 derive_event_id:9a1d8570 envelope_sha:bc43a666 "
    "inbox_admit:1d24b62f inbox_deliveries_guard:126dffc1 inbox_receive:cb09a870 inbox_record_receipts:9da725a6 "
    "local_app:b39703f7 outbox_advance:b6bcb415 outbox_claim:6a236d09 outbox_enqueue:f29c64e9 outbox_fail:29f3eeea "
    "outbox_guard:bf3fd5a0 outbox_redrive:16d67731 purge_expired_nonces:5783a9e6 receipt_canonical:47f3c713 "
    "receipt_check_signature:0b3305cf receipt_verify:35afb8e3 refusal_class:82839242 watermark_key:60edbf70").split())
AR1_MARKER = '{"version":"AR1-APP-r2","contract":"AR-1 strict option 1, A1-1..A1-6"}'
AR3_MARKER = '{"version":"AR3-APP-r1","contract":"rtgip/3-contract-freeze/1","attest":"rtgip/3-attest/1"}'
DUTY = {"rtgip.inbox_admit_v3(jsonb,text,text,text,jsonb,jsonb)": "rtgip_inbox_receiver",
        "rtgip.inbox_record_receipts_v3(text,text[],jsonb)": "rtgip_inbox_receiver",
        "rtgip.connection_gate(text,text)": "rtgip_inbox_receiver",
        "rtgip.outbox_advance_v3(uuid,text,integer,text[],jsonb)": "rtgip_dispatcher"}
SIG_V2 = "CHECK ((signature ~ '^[0-9a-f]{64}$'::text))"
SIG_V3 = ("CHECK ((((protocol = 'rtgip/2'::text) AND (signature ~ '^[0-9a-f]{64}$'::text)) OR "
          "((protocol = 'rtgip/3'::text) AND (signature ~ '^[0-9a-f]{128}$'::text))))")
V3_COLUMNS = {"connections": ["send_protocol", "accept_protocols", "v3_added_at", "v2_accept_until"], "outbox": ["protocol", "delivery_id_v3"],
              "receipts": ["protocol"], "admissions": ["protocol", "evidence_id"], "inbox": ["protocol"], "inbox_deliveries": ["protocol"]}
V3_TABLES = ["public_keys", "public_key_bindings", "evidence_v3"]
API_ROLES = "rolname IN ('anon','authenticated','service_role') OR rolname LIKE 'sandbox\\_exec%'"


def sha(t):
    return hashlib.sha256(t.encode("utf-8")).hexdigest()


def q(s):
    return "'" + s.replace("'", "''") + "'"


def common_pins(tag, server, major):
    return f"""  IF coalesce(host(inet_server_addr()), '') <> '{server}' THEN
    RAISE EXCEPTION '{tag}_stop: wrong server %', coalesce(host(inet_server_addr()), 'null');
  END IF;
  IF session_user <> 'postgres' OR current_user <> 'postgres' THEN
    RAISE EXCEPTION '{tag}_stop: must run as postgres (session %, current %)', session_user, current_user;
  END IF;
  IF current_setting('server_version_num')::int / 10000 <> {major} THEN
    RAISE EXCEPTION '{tag}_stop: server major % is not {major}', current_setting('server_version_num');
  END IF;
  PERFORM set_config('lock_timeout', '5s', true);
"""


def v2_check(tag, phase, v2):
    return f"""  FOR k IN SELECT jsonb_object_keys({q(json.dumps(v2, sort_keys=True))}::jsonb) LOOP
    SELECT count(*), min(left(md5(pg_get_functiondef(p.oid)), 8)) INTO v_n, v_s FROM pg_proc p
     WHERE p.pronamespace = 'rtgip'::regnamespace AND p.proname = k;
    IF v_n <> 1 OR v_s IS DISTINCT FROM ({q(json.dumps(v2, sort_keys=True))}::jsonb)->>k THEN
      RAISE EXCEPTION '{tag}_{phase}: rtgip function bodies differ from the AR-1 r2 pins (% count %, md5 %)', k, v_n, coalesce(v_s, 'missing');
    END IF;
  END LOOP;
"""


DUTY_ACL = """  SELECT coalesce(string_agg(p.proname || ':' || CASE WHEN x.grantee = 0 THEN 'PUBLIC' ELSE x.grantee::regrole::text END, ','
                             ORDER BY p.proname || ':' || CASE WHEN x.grantee = 0 THEN 'PUBLIC' ELSE x.grantee::regrole::text END COLLATE "C"), '') INTO v_s
    FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
   WHERE p.pronamespace = 'rtgip'::regnamespace AND p.proname = ANY (@@V2NAMES@@) AND x.privilege_type = 'EXECUTE' AND x.grantee <> p.proowner
     AND (x.grantee = 0 OR NOT EXISTS (SELECT 1 FROM pg_roles r WHERE r.oid = x.grantee AND (@@API@@)));
"""


def duty_acl(v2):
    return DUTY_ACL.replace("@@V2NAMES@@", "ARRAY[" + ",".join(q(k) for k in sorted(v2)) + "]").replace("@@API@@", "r." + API_ROLES.replace(" OR rolname", " OR r.rolname"))


def apply_inner(key, server, major, consumer, v3_text, v3_pins):
    a = APPS[key]
    tag = f"ar3_{key}"
    assert "$ar3file$" not in v3_text and "$ar3$" not in v3_text
    v2 = dict(V2_PINS, consumer_effect=consumer)
    names = sorted({k.split("(")[0].split(".")[1] for k in v3_pins})
    head = f"""-- AR3 rtgip/3 app SQL (PROPOSAL, NOT APPROVED), {a['app']} Staging (Supabase {a['ref']}, Lovable {a['lovable']}). One DO statement, atomic.
-- Runs only as postgres on the pinned server (PostgreSQL {major}) and only on the AR-1 strict option 1 r2 state (marker on
-- rtgip.signing_keys.audience, the 26 shared rtgip function pins and this app's consumer_effect pin). Applies
-- supabase/proposed/rtgip_v3_attest.proposed.sql (sha256 {sha(v3_text)}) verbatim and reads the result back.
-- Inert: no key row, no binding, no connection protocol and no transport flag changes. Every connection keeps send
-- rtgip/2, accept {{rtgip/2}} and v3_added_at NULL until K5-v3 and a separately approved protocol step.
-- Generated by scripts/rtgip3/gen_ar3.py; do not hand-edit.
"""
    body = f"""DO $ar3$
DECLARE
  v_file constant text := $ar3file${v3_text}$ar3file$;
  v_v3 constant jsonb := {q(json.dumps(v3_pins, sort_keys=True))}::jsonb;
  v_duty constant jsonb := {q(json.dumps(DUTY, sort_keys=True))}::jsonb;
  v_n integer;
  v_n0 integer;
  v_s text;
  v_acl text;
  k text;
  t text;
BEGIN
{common_pins(tag, server, major)}  IF encode(sha256(convert_to(v_file, 'UTF8')), 'hex') <> '{sha(v3_text)}' THEN
    RAISE EXCEPTION '{tag}_stop: embedded rtgip_v3_attest text differs from the approved file';
  END IF;
  SELECT count(*) INTO v_n FROM rtgip.delivery_config;
  IF v_n <> 1 THEN RAISE EXCEPTION '{tag}_stop: delivery_config has % rows, expected 1', v_n; END IF;
  SELECT local_app INTO v_s FROM rtgip.delivery_config;
  IF v_s IS DISTINCT FROM '{a['app']}' THEN RAISE EXCEPTION '{tag}_stop: delivery_config.local_app is %, expected {a['app']}', coalesce(v_s, 'null'); END IF;
  SELECT col_description(a.attrelid, a.attnum) INTO v_s FROM pg_attribute a
   WHERE a.attrelid = 'rtgip.signing_keys'::regclass AND a.attname = 'audience' AND NOT a.attisdropped;
  IF v_s IS DISTINCT FROM {q(AR1_MARKER)} THEN RAISE EXCEPTION '{tag}_stop: the AR-1 r2 marker is missing (%); apply ar1-{key}.sql first', coalesce(v_s, 'none'); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'rtgip.signing_keys'::regclass AND conname = 'signing_keys_legacy_no_audience_check') THEN
    RAISE EXCEPTION '{tag}_stop: signing_keys_legacy_no_audience_check is missing (not the AR-1 r2 state)';
  END IF;
{v2_check(tag, 'stop', v2)}  IF to_regclass('rtgip.public_keys') IS NOT NULL OR to_regclass('rtgip.public_key_bindings') IS NOT NULL OR to_regclass('rtgip.evidence_v3') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'rtgip'::regnamespace AND p.proname = ANY ({"ARRAY[" + ",".join(q(n) for n in names) + "]"}))
     OR EXISTS (SELECT 1 FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
                 WHERE c.relnamespace = 'rtgip'::regnamespace AND NOT a.attisdropped AND (c.relname, a.attname) IN ({", ".join(f"({q(t)}, {q(c)})" for t, cs in V3_COLUMNS.items() for c in cs)})) THEN
    RAISE EXCEPTION '{tag}_stop: rtgip/3 objects already present (second apply or partial state)';
  END IF;
  SELECT count(*) INTO v_n FROM pg_roles WHERE rolname IN ('rtgip_inbox_receiver','rtgip_dispatcher','rtgip_operator') AND NOT rolcanlogin;
  IF v_n <> 3 THEN RAISE EXCEPTION '{tag}_stop: the NOLOGIN duty roles rtgip_inbox_receiver, rtgip_dispatcher, rtgip_operator are not all present'; END IF;
  SELECT pg_get_constraintdef(c.oid) INTO v_s FROM pg_constraint c WHERE c.conrelid = 'rtgip.receipts'::regclass AND c.conname = 'receipts_signature_check';
  IF v_s IS DISTINCT FROM {q(SIG_V2)} THEN RAISE EXCEPTION '{tag}_stop: receipts_signature_check is not the package definition (%)', coalesce(v_s, 'missing'); END IF;
  SELECT count(*) INTO v_n0 FROM pg_proc p WHERE p.pronamespace = 'rtgip'::regnamespace;
{duty_acl(v2)}  v_acl := v_s;

  EXECUTE v_file;

  FOR k IN SELECT jsonb_object_keys(v_v3) LOOP
    IF to_regprocedure(k) IS NULL THEN RAISE EXCEPTION '{tag}_check: % is missing', k; END IF;
    SELECT md5(pg_get_functiondef(p.oid)) INTO v_s FROM pg_proc p WHERE p.oid = to_regprocedure(k);
    IF v_s IS DISTINCT FROM v_v3->>k THEN RAISE EXCEPTION '{tag}_check: % body md5 % differs from the pin', k, v_s; END IF;
    SELECT count(*) INTO v_n FROM pg_proc p WHERE p.oid = to_regprocedure(k) AND p.prosecdef AND p.proconfig = ARRAY['search_path=""']
       AND pg_get_userbyid(p.proowner) = 'postgres';
    IF v_n <> 1 THEN RAISE EXCEPTION '{tag}_check: % is not SECURITY DEFINER, search_path empty, owned by postgres', k; END IF;
    SELECT coalesce(string_agg(DISTINCT CASE WHEN x.grantee = 0 THEN 'PUBLIC' ELSE x.grantee::regrole::text END, ','), '') INTO v_s
      FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
     WHERE p.oid = to_regprocedure(k) AND x.privilege_type = 'EXECUTE' AND x.grantee <> p.proowner;
    IF v_s IS DISTINCT FROM coalesce(v_duty->>k, '') THEN RAISE EXCEPTION '{tag}_check: % EXECUTE grantees are (%), expected (%)', k, v_s, coalesce(v_duty->>k, ''); END IF;
  END LOOP;
  SELECT count(*) INTO v_n FROM pg_proc p WHERE p.pronamespace = 'rtgip'::regnamespace;
  IF v_n - v_n0 <> {len(v3_pins)} THEN RAISE EXCEPTION '{tag}_check: % rtgip functions were added, expected {len(v3_pins)}', v_n - v_n0; END IF;
  FOREACH t IN ARRAY ARRAY[{", ".join(q(t) for t in V3_TABLES)}] LOOP
    SELECT count(*) INTO v_n FROM pg_class c WHERE c.oid = to_regclass('rtgip.' || t) AND c.relrowsecurity;
    IF v_n <> 1 THEN RAISE EXCEPTION '{tag}_check: rtgip.% is missing or has RLS off', t; END IF;
    SELECT coalesce(string_agg(DISTINCT CASE WHEN x.grantee = 0 THEN 'PUBLIC' ELSE x.grantee::regrole::text END || '=' || x.privilege_type, ','), '') INTO v_s
      FROM pg_class c, aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) x WHERE c.oid = to_regclass('rtgip.' || t) AND x.grantee <> c.relowner;
    IF v_s IS DISTINCT FROM 'rtgip_operator=SELECT' THEN RAISE EXCEPTION '{tag}_check: rtgip.% grants are (%), expected (rtgip_operator=SELECT)', t, v_s; END IF;
    EXECUTE format('SELECT count(*) FROM rtgip.%I', t) INTO v_n;
    IF v_n <> 0 THEN RAISE EXCEPTION '{tag}_check: rtgip.% has % rows, expected 0', t, v_n; END IF;
  END LOOP;
  SELECT coalesce(string_agg(DISTINCT x.grantee::regrole::text, ','), '') INTO v_s
    FROM pg_class c, aclexplode(coalesce(c.relacl, acldefault('S', c.relowner))) x WHERE c.oid = 'rtgip.evidence_v3_id_seq'::regclass AND x.grantee <> c.relowner;
  IF v_s <> '' THEN RAISE EXCEPTION '{tag}_check: evidence sequence granted to (%)', v_s; END IF;
  SELECT count(*) INTO v_n FROM rtgip.connections
   WHERE send_protocol <> 'rtgip/2' OR accept_protocols <> '{{rtgip/2}}' OR v3_added_at IS NOT NULL OR v2_accept_until IS NOT NULL;
  IF v_n <> 0 THEN RAISE EXCEPTION '{tag}_check: % connections carry rtgip/3 state, expected none', v_n; END IF;
  SELECT (SELECT count(*) FROM rtgip.outbox WHERE protocol = 'rtgip/3') + (SELECT count(*) FROM rtgip.receipts WHERE protocol <> 'rtgip/2')
       + (SELECT count(*) FROM rtgip.admissions WHERE protocol <> 'rtgip/2') + (SELECT count(*) FROM rtgip.inbox WHERE protocol <> 'rtgip/2')
       + (SELECT count(*) FROM rtgip.inbox_deliveries WHERE protocol <> 'rtgip/2') INTO v_n;
  IF v_n <> 0 THEN RAISE EXCEPTION '{tag}_check: % rows recorded as rtgip/3, expected none', v_n; END IF;
  SELECT pg_get_constraintdef(c.oid) INTO v_s FROM pg_constraint c WHERE c.conrelid = 'rtgip.receipts'::regclass AND c.conname = 'receipts_signature_check';
  IF v_s IS DISTINCT FROM {q(SIG_V3)} THEN RAISE EXCEPTION '{tag}_check: receipts_signature_check is not the rtgip/3 definition (%)', coalesce(v_s, 'missing'); END IF;
  IF obj_description('rtgip.evidence_v3'::regclass, 'pg_class') IS DISTINCT FROM {q(AR3_MARKER)} THEN RAISE EXCEPTION '{tag}_check: AR3 marker missing'; END IF;
{v2_check(tag, 'check', v2)}{duty_acl(v2)}  IF v_s IS DISTINCT FROM v_acl THEN RAISE EXCEPTION '{tag}_check: duty-role EXECUTE grants on the rtgip/2 functions changed (% -> %)', v_acl, v_s; END IF;
  SELECT count(*) INTO v_n FROM pg_roles r
   WHERE (r.{API_ROLES.replace(" OR rolname", " OR r.rolname")})
     AND (has_schema_privilege(r.oid, 'rtgip', 'USAGE')
          OR EXISTS (SELECT 1 FROM pg_class c WHERE c.relnamespace = 'rtgip'::regnamespace AND c.relkind IN ('r','S')
                     AND (has_table_privilege(r.oid, c.oid, 'SELECT') OR has_table_privilege(r.oid, c.oid, 'INSERT') OR has_table_privilege(r.oid, c.oid, 'UPDATE')
                          OR has_table_privilege(r.oid, c.oid, 'DELETE') OR has_table_privilege(r.oid, c.oid, 'TRUNCATE')))
          OR EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'rtgip'::regnamespace AND has_function_privilege(r.oid, p.oid, 'EXECUTE')));
  IF v_n <> 0 THEN RAISE EXCEPTION '{tag}_check: % API or sandbox_exec roles still hold a privilege in schema rtgip', v_n; END IF;
  RAISE NOTICE '{tag}_apply_ok local_app={a['app']} rtgip/3 installed inert: {len(v3_pins)} functions, 3 tables, 0 keys, every connection rtgip/2';
END
$ar3$;
"""
    return head + body


def inverse_inner(key, server, major, consumer, inv_text, v3_pins):
    a = APPS[key]
    tag = f"ar3_{key}_inverse"
    v2 = dict(V2_PINS, consumer_effect=consumer)
    names = sorted({k.split("(")[0].split(".")[1] for k in v3_pins})
    head = f"""-- AR3 inverse (PROPOSAL, NOT APPROVED), {a['app']} Staging (Supabase {a['ref']}, Lovable {a['lovable']}). One DO statement, atomic.
-- Runs only as postgres on the pinned server (PostgreSQL {major}) and only on the exact ar3-{key}.sql applied state (marker and
-- the {len(v3_pins)} function pins). Applies supabase/proposed/rtgip_v3_attest.inverse.proposed.sql (sha256 {sha(inv_text)})
-- verbatim, which refuses while any key row, evidence row or rtgip/3 protocol state exists, then reads the AR-1 r2 state back.
-- Generated by scripts/rtgip3/gen_ar3.py; do not hand-edit.
"""
    body = f"""DO $ar3inv$
DECLARE
  v_file constant text := $ar3file${inv_text}$ar3file$;
  v_v3 constant jsonb := {q(json.dumps(v3_pins, sort_keys=True))}::jsonb;
  v_n integer;
  v_s text;
  v_acl text;
  k text;
BEGIN
{common_pins(tag, server, major)}  IF encode(sha256(convert_to(v_file, 'UTF8')), 'hex') <> '{sha(inv_text)}' THEN
    RAISE EXCEPTION '{tag}_stop: embedded inverse text differs from the approved file';
  END IF;
  SELECT local_app INTO v_s FROM rtgip.delivery_config;
  IF v_s IS DISTINCT FROM '{a['app']}' THEN RAISE EXCEPTION '{tag}_stop: delivery_config.local_app is %, expected {a['app']}', coalesce(v_s, 'null'); END IF;
  IF obj_description(to_regclass('rtgip.evidence_v3'), 'pg_class') IS DISTINCT FROM {q(AR3_MARKER)} THEN
    RAISE EXCEPTION '{tag}_stop: not the ar3-{key}.sql applied state (marker missing)';
  END IF;
  FOR k IN SELECT jsonb_object_keys(v_v3) LOOP
    IF to_regprocedure(k) IS NULL OR md5(pg_get_functiondef(to_regprocedure(k))) IS DISTINCT FROM v_v3->>k THEN
      RAISE EXCEPTION '{tag}_stop: % is missing or differs from the applied pin', k;
    END IF;
  END LOOP;
{v2_check(tag, 'stop', v2)}{duty_acl(v2)}  v_acl := v_s;

  EXECUTE v_file;

  IF to_regclass('rtgip.public_keys') IS NOT NULL OR to_regclass('rtgip.public_key_bindings') IS NOT NULL OR to_regclass('rtgip.evidence_v3') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'rtgip'::regnamespace AND p.proname = ANY ({"ARRAY[" + ",".join(q(n) for n in names) + "]"}))
     OR EXISTS (SELECT 1 FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
                 WHERE c.relnamespace = 'rtgip'::regnamespace AND NOT a.attisdropped AND (c.relname, a.attname) IN ({", ".join(f"({q(t)}, {q(c)})" for t, cs in V3_COLUMNS.items() for c in cs)})) THEN
    RAISE EXCEPTION '{tag}_check: rtgip/3 objects remain';
  END IF;
  SELECT pg_get_constraintdef(c.oid) INTO v_s FROM pg_constraint c WHERE c.conrelid = 'rtgip.receipts'::regclass AND c.conname = 'receipts_signature_check';
  IF v_s IS DISTINCT FROM {q(SIG_V2)} THEN RAISE EXCEPTION '{tag}_check: receipts_signature_check is not the package definition (%)', coalesce(v_s, 'missing'); END IF;
{v2_check(tag, 'check', v2)}{duty_acl(v2)}  IF v_s IS DISTINCT FROM v_acl THEN RAISE EXCEPTION '{tag}_check: duty-role EXECUTE grants on the rtgip/2 functions changed'; END IF;
  RAISE NOTICE '{tag}_ok local_app={a['app']} rtgip/3 removed; AR-1 r2 state restored';
END
$ar3inv$;
"""
    return head + body


def wrap(name, inner):
    s = sha(inner)
    assert "$p2wrapfile$" not in inner
    return (f"DO $p2wrap$\nDECLARE t text := $p2wrapfile${inner}$p2wrapfile$;\nBEGIN\n"
            f"  IF encode(sha256(convert_to(t, 'UTF8')), 'hex') <> '{s}' THEN\n"
            f"    RAISE EXCEPTION '{name} wrapper STOP: file text sha256 % differs from the approved {s[:8]}', encode(sha256(convert_to(t, 'UTF8')), 'hex');\n"
            f"  END IF;\n  EXECUTE t;\nEND\n$p2wrap$;\n")


def unwrap(text):
    return text.split("$p2wrapfile$")[1]


K5_PENDING = {"status": "PENDING", "keyset_sha256": "<64 hex: keyset sha256 printed on the owner card>",
              "keyset": "<the canonical rtgip/3-keyset/1 document text, byte for byte>",
              "card_fingerprints": {"<key_id>": "<64 hex fingerprint printed on the owner card>"}}

K5_KEYS_CHECK = """  v_text := p->>'keyset';
  IF p->>'keyset_sha256' !~ '^[0-9a-f]{64}$' OR encode(sha256(convert_to(v_text, 'UTF8')), 'hex') <> p->>'keyset_sha256' THEN
    RAISE EXCEPTION '@@TAG@@_stop: keyset text sha256 % differs from the card value %', encode(sha256(convert_to(coalesce(v_text, ''), 'UTF8')), 'hex'), p->>'keyset_sha256';
  END IF;
  BEGIN v_doc := v_text::jsonb; EXCEPTION WHEN others THEN RAISE EXCEPTION '@@TAG@@_stop: keyset is not JSON'; END;
  IF @@CANON@@ IS DISTINCT FROM v_text THEN RAISE EXCEPTION '@@TAG@@_stop: keyset is not canonical JSON'; END IF;
  IF (SELECT array_agg(x ORDER BY x COLLATE "C") FROM jsonb_object_keys(v_doc) x) IS DISTINCT FROM ARRAY['env','issued_at','keys','keyset','serial']
     OR v_doc->>'keyset' IS DISTINCT FROM 'rtgip/3-keyset/1' OR v_doc->>'env' IS DISTINCT FROM 'stg'
     OR jsonb_typeof(v_doc->'serial') IS DISTINCT FROM 'number' OR jsonb_typeof(v_doc->'issued_at') IS DISTINCT FROM 'number'
     OR jsonb_typeof(v_doc->'keys') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION '@@TAG@@_stop: keyset is not an rtgip/3-keyset/1 document for env stg';
  END IF;
  FOR k IN SELECT x FROM jsonb_array_elements(v_doc->'keys') x LOOP
    IF (SELECT array_agg(x ORDER BY x COLLATE "C") FROM jsonb_object_keys(k) x) IS DISTINCT FROM
         ARRAY['alg','connection_ids','fingerprint','key_id','not_after','not_before','owner','protocol','public_key','revoked_at','revoked_reason','status']
       OR k->>'key_id' !~ '^stg-(gateway|autolabels|autocurb|autoframe)-ed[1-9][0-9]{0,3}$'
       OR k->>'owner' IS DISTINCT FROM substring(k->>'key_id' FROM '^stg-([a-z]+)-ed')
       OR k->>'protocol' IS DISTINCT FROM 'rtgip/3' OR k->>'alg' IS DISTINCT FROM 'ed25519' OR k->>'status' IS DISTINCT FROM 'current'
       OR jsonb_typeof(k->'revoked_at') IS DISTINCT FROM 'null' OR jsonb_typeof(k->'revoked_reason') IS DISTINCT FROM 'null'
       OR k->>'public_key' !~ '^[0-9a-f]{64}$' OR k->>'fingerprint' IS DISTINCT FROM encode(sha256(decode(k->>'public_key', 'hex')), 'hex')
       OR k->>'fingerprint' IS DISTINCT FROM p->'card_fingerprints'->>(k->>'key_id')
       OR jsonb_typeof(k->'not_before') IS DISTINCT FROM 'number' OR jsonb_typeof(k->'not_after') IS DISTINCT FROM 'number'
       OR (k->>'not_after')::numeric <= (k->>'not_before')::numeric OR jsonb_typeof(k->'connection_ids') IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION '@@TAG@@_stop: key record % fails the keyset or card check', coalesce(k->>'key_id', '?');
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_doc->'keys') WITH ORDINALITY a(x, i) JOIN jsonb_array_elements(v_doc->'keys') WITH ORDINALITY b(y, j)
             ON j = i + 1 WHERE NOT ((a.x->>'key_id') COLLATE "C" < (b.y->>'key_id') COLLATE "C")) THEN
    RAISE EXCEPTION '@@TAG@@_stop: keyset keys are not sorted by key_id';
  END IF;
  SELECT count(*), count(DISTINCT x->>'owner') INTO v_n, v_m FROM jsonb_array_elements(v_doc->'keys') x;
  IF v_n <> 4 OR v_m <> 4 THEN RAISE EXCEPTION '@@TAG@@_stop: keyset has % keys for % owners, expected exactly four current keys, one per owner', v_n, v_m; END IF;
  IF (SELECT array_agg(x ORDER BY x COLLATE "C") FROM jsonb_object_keys(p->'card_fingerprints') x)
     IS DISTINCT FROM (SELECT array_agg(x->>'key_id' ORDER BY x->>'key_id' COLLATE "C") FROM jsonb_array_elements(v_doc->'keys') x) THEN
    RAISE EXCEPTION '@@TAG@@_stop: card fingerprints do not name exactly the keyset key ids';
  END IF;
"""


GW_VAL = ("CASE WHEN jsonb_typeof(@V) = 'array' THEN (SELECT '[' || coalesce(string_agg(@E::text, ',' ORDER BY @O), '') || ']'"
          " FROM jsonb_array_elements(@V) WITH ORDINALITY @Z(@E, @O)) ELSE @V::text END")
GW_CANON = ("(SELECT '{' || string_agg(to_jsonb(e.key)::text || ':' || CASE WHEN e.key = 'keys' THEN (SELECT '[' || coalesce(string_agg((SELECT '{' || "
            "string_agg(to_jsonb(f.key)::text || ':' || " + GW_VAL.replace("@V", "f.value").replace("@E", "el").replace("@O", "o").replace("@Z", "z") +
            ", ',' ORDER BY f.key COLLATE \"C\") || '}' FROM jsonb_each(kk.v) f), ',' ORDER BY kk.n), '') || ']' FROM jsonb_array_elements(e.value) WITH ORDINALITY kk(v, n))"
            " ELSE e.value::text END, ',' ORDER BY e.key COLLATE \"C\") || '}' FROM jsonb_each(v_doc) e)")


def k5_params(params):
    return q(json.dumps(params, sort_keys=True))


def k5_app(key, server, major, params=K5_PENDING, inverse=False):
    a = APPS[key]
    tag = f"k5v3_{key}" + ("_inverse" if inverse else "")
    what = "remove" if inverse else "install"
    head = f"""-- K5-v3 {a['app']}{' inverse' if inverse else ''}: {what} the rtgip/3 public key rows (TEMPLATE, PROPOSAL, NOT APPROVED).
-- {a['app']} Staging (Supabase {a['ref']}, Lovable {a['lovable']}). One DO statement, atomic. Public keys only: no private key, seed or
-- secret is ever placed here. Fill p from the owner card (keyset sha256 and per-key fingerprints) and the canonical keyset
-- document, then wrap the filled text with scripts/rtgip3/gen_ar3.py --fill-k5, which prints its own sha256 for approval.
-- STOPs unless the keyset text hashes to the card value, is canonical, is env stg with exactly four current keys (one per
-- owner) and every fingerprint is sha256(public_key) and equals the card. {'Removes the four rows and their binding rows; refuses once any evidence names a key.' if inverse else 'Inserts the four rows and a binding row per keyset connection that exists on this node; a rerun on identical rows is a no-op, any differing row STOPs.'}
-- Generated by scripts/rtgip3/gen_ar3.py; do not hand-edit beyond p.
"""
    pre = f"""DO $k5v3$
DECLARE
  p constant jsonb := {k5_params(params)}::jsonb;
  v_text text;
  v_doc jsonb;
  k jsonb;
  v_n integer;
  v_m integer;
  v_s text;
BEGIN
{common_pins(tag, server, major)}  IF p->>'status' IS DISTINCT FROM 'FILLED' THEN RAISE EXCEPTION '{tag}_stop: parameters are PENDING; fill them from the owner card'; END IF;
  SELECT local_app INTO v_s FROM rtgip.delivery_config;
  IF v_s IS DISTINCT FROM '{a['app']}' THEN RAISE EXCEPTION '{tag}_stop: delivery_config.local_app is %, expected {a['app']}', coalesce(v_s, 'null'); END IF;
  IF obj_description(to_regclass('rtgip.evidence_v3'), 'pg_class') IS DISTINCT FROM {q(AR3_MARKER)} THEN
    RAISE EXCEPTION '{tag}_stop: rtgip/3 (ar3-{key}.sql) is not applied';
  END IF;
{K5_KEYS_CHECK.replace('@@TAG@@', tag).replace('@@CANON@@', 'rtgip.canonical_json(v_doc)')}"""
    if inverse:
        body = f"""  IF EXISTS (SELECT 1 FROM rtgip.evidence_v3 e JOIN jsonb_array_elements(v_doc->'keys') x ON e.key_id = x->>'key_id') THEN
    RAISE EXCEPTION '{tag}_stop: evidence names a keyset key; key rows are retained';
  END IF;
  SELECT count(*) INTO v_n FROM rtgip.public_keys pk WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_doc->'keys') x WHERE x->>'key_id' = pk.key_id);
  IF v_n <> 0 THEN RAISE EXCEPTION '{tag}_stop: % key rows outside this keyset exist', v_n; END IF;
  DELETE FROM rtgip.public_key_bindings b USING jsonb_array_elements(v_doc->'keys') x WHERE b.key_id = x->>'key_id';
  DELETE FROM rtgip.public_keys pk USING jsonb_array_elements(v_doc->'keys') x WHERE pk.key_id = x->>'key_id';
  SELECT (SELECT count(*) FROM rtgip.public_keys) + (SELECT count(*) FROM rtgip.public_key_bindings) INTO v_n;
  IF v_n <> 0 THEN RAISE EXCEPTION '{tag}_check: % key or binding rows remain', v_n; END IF;
  RAISE NOTICE '{tag}_ok: 4 rtgip/3 key rows and their bindings removed';
END
$k5v3$;
"""
    else:
        body = f"""  SELECT count(*) INTO v_n FROM rtgip.public_keys pk WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_doc->'keys') x WHERE x->>'key_id' = pk.key_id);
  IF v_n <> 0 THEN RAISE EXCEPTION '{tag}_stop: % key rows outside this keyset exist', v_n; END IF;
  SELECT count(*) INTO v_n FROM rtgip.public_keys pk JOIN jsonb_array_elements(v_doc->'keys') x ON x->>'key_id' = pk.key_id
   WHERE (pk.owner, pk.protocol, pk.alg, pk.public_key, pk.fingerprint, pk.status, pk.not_before, pk.not_after, pk.keyset_sha256)
         IS DISTINCT FROM (x->>'owner', x->>'protocol', x->>'alg', x->>'public_key', x->>'fingerprint', x->>'status', (x->>'not_before')::bigint,
                           (x->>'not_after')::bigint, p->>'keyset_sha256') OR pk.revoked_at IS NOT NULL;
  IF v_n <> 0 THEN RAISE EXCEPTION '{tag}_stop: % installed key rows differ from the keyset', v_n; END IF;
  INSERT INTO rtgip.public_keys (key_id, owner, protocol, alg, public_key, fingerprint, status, not_before, not_after, revoked_at, revoked_reason, keyset_sha256)
  SELECT x->>'key_id', x->>'owner', x->>'protocol', x->>'alg', x->>'public_key', x->>'fingerprint', x->>'status', (x->>'not_before')::bigint,
         (x->>'not_after')::bigint, NULL, NULL, p->>'keyset_sha256'
    FROM jsonb_array_elements(v_doc->'keys') x ORDER BY x->>'key_id'
  ON CONFLICT (key_id) DO NOTHING;
  INSERT INTO rtgip.public_key_bindings (key_id, connection_id)
  SELECT x->>'key_id', c.connection_id FROM jsonb_array_elements(v_doc->'keys') x, jsonb_array_elements_text(x->'connection_ids') cid
    JOIN rtgip.connections c ON c.connection_id = cid
  ON CONFLICT DO NOTHING;
  SELECT count(*) INTO v_n FROM rtgip.public_keys pk JOIN jsonb_array_elements(v_doc->'keys') x ON x->>'key_id' = pk.key_id
   WHERE (pk.owner, pk.public_key, pk.fingerprint, pk.status, pk.not_before, pk.not_after) = (x->>'owner', x->>'public_key', x->>'fingerprint', x->>'status',
         (x->>'not_before')::bigint, (x->>'not_after')::bigint);
  IF v_n <> 4 THEN RAISE EXCEPTION '{tag}_check: % of 4 key rows read back equal to the keyset', v_n; END IF;
  SELECT count(*) INTO v_n FROM rtgip.public_keys;
  IF v_n <> 4 THEN RAISE EXCEPTION '{tag}_check: rtgip.public_keys has % rows, expected 4', v_n; END IF;
  SELECT count(*) INTO v_n FROM (
    (SELECT b.key_id, b.connection_id FROM rtgip.public_key_bindings b)
    EXCEPT
    (SELECT x->>'key_id', c.connection_id FROM jsonb_array_elements(v_doc->'keys') x, jsonb_array_elements_text(x->'connection_ids') cid
       JOIN rtgip.connections c ON c.connection_id = cid)) d;
  SELECT count(*) INTO v_m FROM (
    (SELECT x->>'key_id', c.connection_id FROM jsonb_array_elements(v_doc->'keys') x, jsonb_array_elements_text(x->'connection_ids') cid
       JOIN rtgip.connections c ON c.connection_id = cid)
    EXCEPT
    (SELECT b.key_id, b.connection_id FROM rtgip.public_key_bindings b)) d;
  IF v_n <> 0 OR v_m <> 0 THEN RAISE EXCEPTION '{tag}_check: binding rows differ from the keyset connections on this node (% extra, % missing)', v_n, v_m; END IF;
  SELECT count(*) INTO v_n FROM rtgip.public_key_bindings;
  RAISE NOTICE '{tag}_ok: 4 rtgip/3 key rows (fingerprints equal the card), % binding rows', v_n;
END
$k5v3$;
"""
    return head + pre + body


def k5_gw_inverse(server, major, params=K5_PENDING):
    tag = "k5v3_gw_inverse"
    head = f"""-- K5-v3 gateway inverse: remove the rtgip/3 public key rows K5-v3-gw installed in gw_r2_keys (TEMPLATE, PROPOSAL, NOT APPROVED).
-- Gateway Staging (Supabase {GW['ref']}, Lovable {GW['lovable']}). One DO statement, atomic. Public keys only: no private key, seed or
-- secret is ever placed here. Fill p with the same card values and keyset document as the K5-v3-gw run it reverses, then wrap
-- the filled text with scripts/rtgip3/gen_ar3.py --fill-k5 gw PARAMS OUT --k5-inverse, which prints its own sha256 for approval.
-- Same keyset and card checks as K5-v3-gw. Removes exactly the four keyset rows, and only while each is still as K5-v3-gw
-- installed it; STOPs while any evidence, delivery or nonce names one (GW-R3's key guard refuses that delete as well), while
-- any other rtgip/3 key row exists, and on any readback mismatch. rtgip/2 rows are never touched. A rerun after the rows are
-- gone is a no-op, and it says so only after checking that no other rtgip/3 key row exists. Step 0, as in GW-SEC-2.r2, GW-SEC-3
-- and GW-R3: it runs only with the Gateway kill ON (gw_settings is one row with global_kill true, external_delivery_enabled
-- false, environment DEV), and the readback checks the kill again. Generated by scripts/rtgip3/gen_ar3.py; do not hand-edit beyond p.
"""
    body = f"""DO $k5v3$
DECLARE
  p constant jsonb := {k5_params(params)}::jsonb;
  v_text text;
  v_doc jsonb;
  k jsonb;
  v_n integer;
  v_m integer;
  v_s text;
BEGIN
{common_pins(tag, server, major)}  IF p->>'status' IS DISTINCT FROM 'FILLED' THEN RAISE EXCEPTION '{tag}_stop: parameters are PENDING; fill them from the owner card'; END IF;
  IF to_regclass('public.gw_settings') IS NULL THEN RAISE EXCEPTION '{tag}_stop: step 0: gw_settings is missing; not the Gateway database'; END IF;
  IF (SELECT count(*) FROM public.gw_settings) <> 1
     OR NOT EXISTS (SELECT 1 FROM public.gw_settings WHERE id = 1 AND global_kill IS TRUE AND external_delivery_enabled IS FALSE AND environment = 'DEV') THEN
    RAISE EXCEPTION '{tag}_stop: step 0: gw_settings is not exactly one row with global_kill true, external_delivery_enabled false, environment DEV';
  END IF;
  SELECT count(*) INTO v_n FROM pg_attribute a WHERE a.attrelid = to_regclass('public.gw_r2_keys') AND NOT a.attisdropped
     AND a.attname IN ('protocol','alg','public_key','revoked_at','revoked_reason');
  IF v_n <> 5 OR to_regclass('public.gw_r3_evidence') IS NULL OR to_regclass('public.gw_r3_admissions') IS NULL OR to_regclass('public.gw_r3_query_nonces') IS NULL THEN
    RAISE EXCEPTION '{tag}_stop: GW-R3 is not installed';
  END IF;
  LOCK TABLE public.gw_r2_keys, public.gw_r3_evidence, public.gw_r2_admissions, public.gw_r3_admissions, public.gw_r2_nonces, public.gw_r3_query_nonces
    IN SHARE ROW EXCLUSIVE MODE;
{K5_KEYS_CHECK.replace('@@TAG@@', tag).replace('@@CANON@@', GW_CANON)}  EXECUTE $i$SELECT count(*) FROM public.gw_r2_keys g WHERE g.protocol = 'rtgip/3'
    AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements($1->'keys') x WHERE x->>'key_id' = g.id)$i$ INTO v_n USING v_doc;
  IF v_n <> 0 THEN RAISE EXCEPTION '{tag}_stop: % rtgip/3 key rows outside this keyset exist', v_n; END IF;
  SELECT count(*) INTO v_n FROM public.gw_r2_keys g JOIN jsonb_array_elements(v_doc->'keys') x ON x->>'key_id' = g.id;
  IF v_n = 0 THEN
    RAISE NOTICE '{tag}_ok: no keyset key row and no other rtgip/3 key row in gw_r2_keys, nothing changed';
    RETURN;
  END IF;
  EXECUTE $i$SELECT count(*) FROM public.gw_r2_keys g JOIN jsonb_array_elements($1->'keys') x ON x->>'key_id' = g.id
    WHERE g.owner = x->>'owner' AND g.protocol = 'rtgip/3' AND g.alg = x->>'alg' AND g.public_key = x->>'public_key' AND g.fingerprint = x->>'fingerprint'
      AND g.audience IS NULL AND g.status = x->>'status' AND g.revoked_at IS NULL AND g.revoked_reason IS NULL
      AND g.not_before = to_timestamp((x->>'not_before')::bigint) AND g.not_after = to_timestamp((x->>'not_after')::bigint)
      AND g.connections = ARRAY(SELECT jsonb_array_elements_text(x->'connection_ids'))$i$ INTO v_n USING v_doc;
  IF v_n <> 4 THEN RAISE EXCEPTION '{tag}_stop: % of 4 keyset rows in gw_r2_keys are as K5-v3-gw installed them; repair by hand', v_n; END IF;
  IF EXISTS (SELECT 1 FROM public.gw_r3_evidence e JOIN jsonb_array_elements(v_doc->'keys') x ON e.key_id = x->>'key_id') THEN
    RAISE EXCEPTION '{tag}_stop: evidence names a keyset key; key rows are retained';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_doc->'keys') x WHERE
       EXISTS (SELECT 1 FROM public.gw_r2_admissions a WHERE a.source_key_id = x->>'key_id' OR a.gateway_key_id = x->>'key_id')
       OR EXISTS (SELECT 1 FROM public.gw_r3_admissions a WHERE a.source_key_id = x->>'key_id')
       OR EXISTS (SELECT 1 FROM public.gw_r2_nonces n WHERE n.key_id = x->>'key_id')
       OR EXISTS (SELECT 1 FROM public.gw_r3_query_nonces n WHERE n.key_id = x->>'key_id')) THEN
    RAISE EXCEPTION '{tag}_stop: a delivery or nonce names a keyset key; key rows are retained';
  END IF;
  SELECT count(*), md5(coalesce(string_agg(g::text, '|' ORDER BY g.id), '')) INTO v_m, v_s FROM public.gw_r2_keys g
   WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_doc->'keys') x WHERE x->>'key_id' = g.id);
  DELETE FROM public.gw_r2_keys g USING jsonb_array_elements(v_doc->'keys') x WHERE g.id = x->>'key_id';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 4 THEN RAISE EXCEPTION '{tag}_check: % of 4 keyset rows deleted', v_n; END IF;
  SELECT count(*) INTO v_n FROM public.gw_r2_keys g JOIN jsonb_array_elements(v_doc->'keys') x ON x->>'key_id' = g.id;
  IF v_n <> 0 THEN RAISE EXCEPTION '{tag}_check: % keyset rows remain', v_n; END IF;
  IF (SELECT count(*) FROM public.gw_r2_keys) <> v_m OR (SELECT md5(coalesce(string_agg(g::text, '|' ORDER BY g.id), '')) FROM public.gw_r2_keys g) IS DISTINCT FROM v_s THEN
    RAISE EXCEPTION '{tag}_check: a gw_r2_keys row outside the keyset changed';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.gw_settings WHERE id = 1 AND global_kill IS TRUE) THEN RAISE EXCEPTION '{tag}_check: global_kill is not ON'; END IF;
  RAISE NOTICE '{tag}_ok: 4 rtgip/3 key rows removed from gw_r2_keys, % other rows unchanged', v_m;
END
$k5v3$;
"""
    return head + body


def k5_gw(server, major, params=K5_PENDING):
    tag = "k5v3_gw"
    head = f"""-- K5-v3 gateway: install the rtgip/3 public key rows into gw_r2_keys (TEMPLATE, PROPOSAL, NOT APPROVED).
-- Gateway Staging (Supabase {GW['ref']}, Lovable {GW['lovable']}). One DO statement, atomic. Public keys only.
-- Targets the GW-R3 extension of gw_r2_keys (design 3.4: protocol, alg, public_key, revoked_at, revoked_reason; audience NULL for
-- rtgip/3). GW-R3 is owned by the Gateway team and does not exist yet: this template STOPs until those columns are present.
-- Same keyset and card checks as the app templates. Step 0, as in GW-SEC-2.r2, GW-SEC-3 and GW-R3: it runs only with the Gateway
-- kill ON (gw_settings is one row with global_kill true, external_delivery_enabled false, environment DEV), and the readback
-- checks the kill again. Generated by scripts/rtgip3/gen_ar3.py; do not hand-edit beyond p.
"""
    body = f"""DO $k5v3$
DECLARE
  p constant jsonb := {k5_params(params)}::jsonb;
  v_text text;
  v_doc jsonb;
  k jsonb;
  v_n integer;
  v_m integer;
  v_s text;
BEGIN
{common_pins(tag, server, major)}  IF p->>'status' IS DISTINCT FROM 'FILLED' THEN RAISE EXCEPTION '{tag}_stop: parameters are PENDING; fill them from the owner card'; END IF;
  IF to_regclass('public.gw_settings') IS NULL THEN RAISE EXCEPTION '{tag}_stop: step 0: gw_settings is missing; not the Gateway database'; END IF;
  IF (SELECT count(*) FROM public.gw_settings) <> 1
     OR NOT EXISTS (SELECT 1 FROM public.gw_settings WHERE id = 1 AND global_kill IS TRUE AND external_delivery_enabled IS FALSE AND environment = 'DEV') THEN
    RAISE EXCEPTION '{tag}_stop: step 0: gw_settings is not exactly one row with global_kill true, external_delivery_enabled false, environment DEV';
  END IF;
  SELECT count(*) INTO v_n FROM pg_attribute a WHERE a.attrelid = to_regclass('public.gw_r2_keys') AND NOT a.attisdropped
     AND a.attname IN ('protocol','alg','public_key','revoked_at','revoked_reason');
  IF v_n <> 5 THEN RAISE EXCEPTION '{tag}_stop: GW-R3 is not installed (gw_r2_keys lacks the rtgip/3 columns)'; END IF;
{K5_KEYS_CHECK.replace('@@TAG@@', tag).replace('@@CANON@@', GW_CANON)}  SELECT count(*) INTO v_n FROM public.gw_r2_keys g JOIN jsonb_array_elements(v_doc->'keys') x ON x->>'key_id' = g.id;
  IF v_n <> 0 THEN RAISE EXCEPTION '{tag}_stop: % keyset key ids already exist in gw_r2_keys', v_n; END IF;
  EXECUTE $i$INSERT INTO public.gw_r2_keys (id, owner, connections, status, not_before, not_after, fingerprint, audience, protocol, alg, public_key, revoked_at, revoked_reason)
    SELECT x->>'key_id', x->>'owner', ARRAY(SELECT jsonb_array_elements_text(x->'connection_ids')), x->>'status', to_timestamp((x->>'not_before')::bigint),
           to_timestamp((x->>'not_after')::bigint), x->>'fingerprint', NULL, x->>'protocol', x->>'alg', x->>'public_key', NULL, NULL
      FROM jsonb_array_elements($1->'keys') x$i$ USING v_doc;
  EXECUTE $i$SELECT count(*) FROM public.gw_r2_keys g JOIN jsonb_array_elements($1->'keys') x ON x->>'key_id' = g.id
    WHERE g.public_key = x->>'public_key' AND g.fingerprint = x->>'fingerprint' AND g.protocol = 'rtgip/3' AND g.audience IS NULL$i$ INTO v_n USING v_doc;
  IF v_n <> 4 THEN RAISE EXCEPTION '{tag}_check: % of 4 key rows read back equal to the keyset', v_n; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.gw_settings WHERE id = 1 AND global_kill IS TRUE) THEN RAISE EXCEPTION '{tag}_check: global_kill is not ON'; END IF;
  RAISE NOTICE '{tag}_ok: 4 rtgip/3 key rows in gw_r2_keys (fingerprints equal the card)';
END
$k5v3$;
"""
    return head + body


def build(server_of=None, major=17, consumer_of=None):
    v3 = open(V3, encoding="utf-8").read()
    inv = open(V3_INV, encoding="utf-8").read()
    pins = json.load(open(PINS))
    files = {}
    for key, a in APPS.items():
        srv = a["server"] if server_of is None else server_of
        cons = consumer_of or a["consumer"]
        files[f"ar3-{key}.sql"] = wrap(f"ar3-{key}", apply_inner(key, srv, major, cons, v3, pins))
        files[f"ar3-{key}.inverse.sql"] = wrap(f"ar3-{key}.inverse", inverse_inner(key, srv, major, cons, inv, pins))
        files[f"K5-v3-{key}.template.sql"] = k5_app(key, srv, major)
        files[f"K5-v3-{key}.inverse.template.sql"] = k5_app(key, srv, major, inverse=True)
    files["K5-v3-gw.template.sql"] = k5_gw(GW["server"] if server_of is None else server_of, major)
    files["K5-v3-gw.inverse.template.sql"] = k5_gw_inverse(GW["server"] if server_of is None else server_of, major)
    lines = []
    for name in sorted(files):
        lines.append(f"{sha(files[name])}  {name}")
        if name.startswith("ar3-"):
            lines.append(f"{sha(unwrap(files[name]))}  {name} (inner text, checked by the wrapper)")
    files["SHA256SUMS"] = "\n".join(lines) + "\n"
    return files


def write(outdir, files):
    os.makedirs(outdir, exist_ok=True)
    for name, text in files.items():
        with open(os.path.join(outdir, name), "w", encoding="utf-8", newline="\n") as fh:
            fh.write(text)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    ap.add_argument("--rehearsal")
    ap.add_argument("--server")
    ap.add_argument("--major", type=int, default=17)
    ap.add_argument("--consumer-pin")
    ap.add_argument("--fill-k5", nargs=3, metavar=("APP", "PARAMS", "OUT"))
    ap.add_argument("--k5-inverse", action="store_true")
    args = ap.parse_args()
    if args.fill_k5:
        key, params_path, out = args.fill_k5
        params = json.load(open(params_path))
        params["status"] = "FILLED"
        if key == "gw":
            server = GW["server"] if args.server is None else args.server
            inner = (k5_gw_inverse if args.k5_inverse else k5_gw)(server, args.major, params)
        else:
            inner = k5_app(key, APPS[key]["server"] if args.server is None else args.server, args.major, params, inverse=args.k5_inverse)
        name = os.path.basename(out).replace(".wrap.sql", "")
        with open(out, "w", encoding="utf-8", newline="\n") as fh:
            fh.write(wrap(name, inner))
        print(sha(inner))
        return 0
    if args.rehearsal:
        write(args.rehearsal, build(args.server, args.major, args.consumer_pin))
        return 0
    files = build()
    if args.check:
        stale = [n for n, t in files.items() if not os.path.exists(os.path.join(OUT, n)) or open(os.path.join(OUT, n), encoding="utf-8").read() != t]
        if stale:
            print("stale: " + " ".join(stale))
            return 1
        print("fresh")
        return 0
    write(OUT, files)
    print(files["SHA256SUMS"], end="")
    return 0


if __name__ == "__main__":
    sys.exit(main())
