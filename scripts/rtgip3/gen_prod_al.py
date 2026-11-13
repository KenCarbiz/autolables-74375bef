#!/usr/bin/env python3
# Generates the AutoLabels PRODUCTION install-dark packets (supabase/proposed/production/) from the staging-proven
# SQL, unchanged: every component file is embedded byte for byte and EXECUTEd inside one guarded DO statement that pins
# the production server address, session_user and current_user postgres and PostgreSQL 17, checks the pre-state,
# applies, and checks the post-state against the staging digests. Each packet is wrapped in the same sha256-checked
# outer DO as the staging cards (gen_ar3.wrap). The ar3 packets come from gen_ar3.py itself with production identities.
#   gen_prod_al.py                         write the packets, the fingerprint and SHA256SUMS
#   gen_prod_al.py --check                 fail if any written file is stale
#   gen_prod_al.py --rehearsal DIR --server ADDR --major N
#                                          the same packets pinned to a local server and major (tests only)
#   gen_prod_al.py --fill-k5 PARAMS.json OUT.wrap.sql [--k5-inverse]
#                                          fill the production K5-v3 template after the key ceremony
import argparse
import hashlib
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import gen_ar3 as G  # noqa: E402

ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
PROP = os.path.join(ROOT, "supabase", "proposed")
OUT = os.path.join(PROP, "production")
SRC = os.path.join(OUT, "src")

PROD = {"app": "autolabels", "ref": "onnbmmdbrsgytfozfozn", "lovable": "1a2a5abf",
        "server": "2a05:d018:135e:166d:40ff:d4ff:1780:16c1", "consumer": "a951fa40"}
STAGING_AL_SERVER = "2a05:d018:1b65:3000:4237:64f1:ae00:c178"

# Staging-proven inputs and the sha256 the staging records pin for each (autolabels/b2-evidence, ar1 joint/apps/sql).
INPUTS = {
    "S1": ("20261030000000_rooftopos_spine.sql", "5aef1fd20b12358419c6f50ece8abce9a1793e72fc8814790449a64fbe81a9e5"),
    "S3": ("20261109000000_vehicle_history_foundation.sql", "e86d422bc9233a154299d9e4fb7547e8dc55e591913da646af072239a3ce2a98"),
    "D": ("rtgip_v2_delivery.proposed.sql", "5bdde92352e1b84d036be08ba8c66675afe5d818eca576cc4a02505213f106d8"),
    "R": ("rtgip_source_readers.proposed.sql", "5d83cfd7387211fb220f5bf7d6c226925c93cb5e7b8bcbab3d49a2c2c7b2f9d2"),
    "E": ("rtgip_labels_effects.proposed.sql", "385cba7fb5112f1119d0089b46880db2df07102514036c110d1db7826398a127"),
}
SRC_PINS = {
    "H_sandbox_exec.sql": "f0132f8bf6a5072feaa6e5223e013fdf67ab25ac4884189aea0836e8a3ca6c73",
    "H2_sandbox_exec_sequence.sql": "d61c785839dadf3eabf900512f0309833020def3f15db18e3687ed89774706a1",
    "staging-ar1-al.sql": "552fd9a4bf1e18e6207864dcc44503866b0ad9c9c77c01c28efd92a96a48eb74",
    "staging-ar1-al.inverse.sql": "ec154b68b3d1e0cad9e8ff26d6c69eb109b5a4393bf1a471e7611354568ec8fa",
    "al-hosted-fingerprint.sql": "c7e556ba959ce4a9b1712d964b22fac8be6074c4666aa3bd8d644f3a90c54810",
}
# Component digests after the staging B2 install (expected-fingerprint.json; hosted staging matched them under C collation).
STAGING_DIGEST = {"S1": "2e6e815d213242e4dc57fbc2635ff381", "S3": "cc7e6e9a10f4ace44c2d4246620e0c9c",
                  "D": "d2b38fdc666ffa406b034c2e8b5b9d02", "R": "8a8156a72bfc4259836e9084fdd80bab",
                  "E": "4794f427afc762d4ef5b40b5842e37ce"}
# Staging rtgip function digest after ar3 (CARD1-RECORD step 3 AL, 57 functions). Production has no C-S4 key import, so its
# set is the same minus the staging-only trigger function key_import_tickets_guard (pin 0c8a30c3): 56 functions, digest
# PROD_FN_DIGEST. md5 of the production list with that one entry added is exactly STAGING_FN_DIGEST (checked below).
STAGING_FN_DIGEST = "30dc3dd02521e28ade139dc27a7e548e"
STAGING_ONLY_FN = "key_import_tickets_guard:0c8a30c3"
PROD_FN_DIGEST = "0fcc549679f0ba6ad1555020dfc3adf9"
PROD_FN_COUNT = 56
ROLES = "rtgip_dispatcher,rtgip_inbox_receiver,rtgip_labels_consumer,rtgip_operator,rtgip_outbox_writer,rtgip_source_reader"
PKG_TABLES = ["acquisition_records", "inspection_evidence", "integration_connection_keys", "integration_connections",
              "integration_direction_flags", "integration_inbox", "integration_outbox", "integration_source_versions",
              "repair_item_status_history", "repair_items", "service_visits", "vehicle_access_grants",
              "vehicle_custody_milestones", "vehicle_external_refs", "vehicle_history_audit", "vehicle_history_setting_keys",
              "vehicle_history_settings", "vehicle_identity_corrections", "vehicle_identity_quarantine", "vehicle_instances",
              "vehicle_reappearance_reviews", "vehicles"]
LEDGERS = ["connections", "outbox", "receipts", "inbox", "inbox_deliveries", "inbox_conflicts", "admissions", "watermarks", "nonce_claims", "signing_keys"]
EDGE_TABLES = ["delivery_config", "connections", "public_keys", "public_key_bindings"]
EDGE_OUTBOX_COLS = ["event_id", "state", "protocol", "lease_generation", "connection_id", "delivery_id_v3"]
EDGE_COLS = {"public.tenant_members": ["user_id", "tenant_id", "role", "accepted_at"], "public.dealer_stores": ["id", "tenant_id"],
             "rtgip_src.rooftop_stores": ["tenant_id", "rooftop_id", "store_id", "status"]}
EDGE_SET = ["rtgip_dispatcher", "rtgip_inbox_receiver", "rtgip_outbox_writer", "rtgip_source_reader"]


def read(path, pin=None):
    t = open(path, encoding="utf-8").read()
    if pin and G.sha(t) != pin:
        raise SystemExit(f"{path}: sha256 {G.sha(t)} is not the staging pin {pin}")
    return t


def dq(tag, text):
    assert f"${tag}$" not in text, tag
    return f"${tag}${text}${tag}$"


def strip_sc(text):
    t = text.rstrip()
    return t[:-1] if t.endswith(";") else t


def lines(text, a, b):
    return "".join(text.splitlines(keepends=True)[a - 1:b])


def header(step, title, what, rollback):
    return (f"-- P2 AutoLabels PRODUCTION step {step}: {title} (PROPOSAL, NOT APPROVED, install dark).\n"
            f"-- AutoLabels production (Supabase {PROD['ref']}, Lovable {PROD['lovable']}, server {PROD['server']}). One DO statement,\n"
            f"-- atomic: any STOP or CHECK raises and nothing is applied. Runs only as postgres on PostgreSQL 17.\n"
            + "".join(f"-- {w}\n" for w in what)
            + f"-- Rollback: {rollback}\n"
            "-- Generated by scripts/rtgip3/gen_prod_al.py from the staging-proven files; do not hand-edit.\n")


def fp_comp_sql():
    """The staging fingerprint's component CTE (al-hosted-fingerprint.sql) with an explicit C collation on the digest order."""
    t = read(os.path.join(SRC, "al-hosted-fingerprint.sql"), SRC_PINS["al-hosted-fingerprint.sql"])
    start = t.index("WITH fn(component, name, marker)")
    end = t.index("), pre(name, present, detail)")
    cte = t[start:end] + ")"
    old = "string_agg(name || '=' || detail::text, ';' ORDER BY name)"
    assert cte.count(old) == 1
    cte = cte.replace(old, "string_agg(name || '=' || detail::text, ';' ORDER BY name COLLATE \"C\")")
    return cte + "\nSELECT state, digest FROM comp WHERE component = $1"


FN_DIGEST_SQL = ("SELECT md5(string_agg(p.proname || ':' || left(md5(pg_get_functiondef(p.oid)), 8), ',' ORDER BY p.proname COLLATE \"C\")), count(*)\n"
                 "    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'rtgip' AND p.prokind IN ('f','p')")


def dark(tag, phase, local_app="autolabels"):
    """delivery_config is the one dark row and every ledger is empty: nothing has been enrolled on production."""
    la = "IS NULL" if local_app is None else f"IS DISTINCT FROM '{local_app}'"
    la_ok = "local_app IS NOT NULL" if local_app is None else f"local_app IS DISTINCT FROM '{local_app}'"
    out = f"""  IF (SELECT count(*) FROM rtgip.delivery_config) <> 1 OR EXISTS (SELECT 1 FROM rtgip.delivery_config WHERE id IS NOT TRUE OR transport_enabled IS DISTINCT FROM false OR {la_ok}) THEN
    RAISE EXCEPTION '{tag}_{phase}: delivery_config is not the single dark row (transport_enabled false, local_app {local_app or 'NULL'})';
  END IF;
  IF (SELECT count(*) FROM pg_constraint WHERE conrelid = 'rtgip.delivery_config'::regclass AND contype = 'c'
        AND conname = 'delivery_config_transport_enabled_check' AND pg_get_constraintdef(oid) = 'CHECK ((transport_enabled = false))') <> 1 THEN
    RAISE EXCEPTION '{tag}_{phase}: the transport CHECK lock is not the pinned definition';
  END IF;
  FOREACH t IN ARRAY ARRAY[{", ".join(G.q(x) for x in LEDGERS)}] LOOP
    EXECUTE format('SELECT count(*) FROM rtgip.%I', t) INTO v_n;
    IF v_n <> 0 THEN RAISE EXCEPTION '{tag}_{phase}: rtgip.% has % rows, expected 0 on the dark production node', t, v_n; END IF;
  END LOOP;
"""
    del la
    return out


def component_inner(step, key, file_text, server, major, restore=False):
    tag = f"p2al_{key.lower()}" + ("_restore" if restore else "")
    want = "installed" if restore else "missing"
    pre = strip_sc(read(os.path.join(SRC, "checks", f"{key}_pre.sql")))
    post = strip_sc(read(os.path.join(SRC, "checks", f"{key}_post.sql")))
    fsha = G.sha(file_text)
    dark_pre = "" if key in ("S1", "S3", "D") else ("  IF to_regclass('rtgip.delivery_config') IS NULL THEN RAISE EXCEPTION '%s_stop: the delivery ledger D is not installed'; END IF;\n" % tag) + dark(tag, "stop", None)
    dark_post = "" if key in ("S1", "S3") else dark(tag, "check", None)
    body = f"""DO $p2al$
DECLARE
  v_file constant text := {dq('p2alfile', file_text)};
  v_pre constant text := {dq('p2alchk', pre)};
  v_post constant text := {dq('p2alchk', post)};
  v_comp constant text := {dq('p2alchk', fp_comp_sql())};
  v_line text;
  v_state text;
  v_digest text;
  v_n integer;
  t text;
BEGIN
{G.common_pins(tag, server, major)}  IF encode(sha256(convert_to(v_file, 'UTF8')), 'hex') <> '{fsha}' THEN
    RAISE EXCEPTION '{tag}_stop: embedded {INPUTS[key][0]} differs from the staging-proven file {fsha[:8]}';
  END IF;
  FOR v_line IN EXECUTE v_pre LOOP
    IF v_line LIKE '%|f' THEN RAISE EXCEPTION '{tag}_stop: prerequisite missing (%)', v_line; END IF;
    IF v_line LIKE 'component_state|%' AND v_line <> 'component_state|{want}'{" AND v_line <> 'component_state|partial'" if restore else ""} THEN
      RAISE EXCEPTION '{tag}_stop: {key} is not {want} (%){"" if restore else ": installed means this step already ran, partial means stop and inspect"}', v_line;
    END IF;
  END LOOP;
{dark_pre}
  EXECUTE v_file;

  FOR v_line IN EXECUTE v_post LOOP
    IF v_line NOT LIKE '%|t' THEN RAISE EXCEPTION '{tag}_check: postcondition failed (%)', v_line; END IF;
  END LOOP;
  EXECUTE v_comp INTO v_state, v_digest USING '{key}';
  IF v_state IS DISTINCT FROM 'installed' OR v_digest IS DISTINCT FROM '{STAGING_DIGEST[key]}' THEN
    RAISE EXCEPTION '{tag}_check: {key} is % with digest %, expected installed with the staging digest {STAGING_DIGEST[key]}', v_state, v_digest;
  END IF;
{dark_post}  RAISE NOTICE '{tag}_ok: {key} {"re-applied" if restore else "installed"}, digest equals staging {STAGING_DIGEST[key][:8]}{"; re-running S1 put back the spine bodies of integration_claim_inbox and integration_apply_event, run 02-S3.restore.sql next" if restore and key == "S1" else ""}';
END
$p2al$;
"""
    return body


def disable_inner(step, key, server, major):
    tag = f"p2al_{key.lower()}_disable"
    text = read(os.path.join(SRC, "disable", f"{key}_disable.sql"))
    return f"""DO $p2al$
DECLARE
  v_file constant text := {dq('p2alfile', text)};
  v_comp constant text := {dq('p2alchk', fp_comp_sql())};
  v_state text;
  v_digest text;
BEGIN
{G.common_pins(tag, server, major)}  EXECUTE v_comp INTO v_state, v_digest USING '{key}';
  IF v_state IS DISTINCT FROM 'installed' THEN RAISE EXCEPTION '{tag}_stop: {key} is %, not installed', v_state; END IF;
  EXECUTE v_file;
  RAISE NOTICE '{tag}_ok: {key} grants revoked (forward recovery; no table, row or audit record dropped). {step}-{key}.restore.sql restores them.';
END
$p2al$;
"""


def h_inner(server, major):
    tag = "p2al_h"
    h = read(os.path.join(SRC, "H_sandbox_exec.sql"), SRC_PINS["H_sandbox_exec.sql"])
    h2 = read(os.path.join(SRC, "H2_sandbox_exec_sequence.sql"), SRC_PINS["H2_sandbox_exec_sequence.sql"])
    tables = "ARRAY[" + ",".join(G.q(x) for x in PKG_TABLES) + "]"
    return f"""DO $p2al$
DECLARE
  v_h constant text := {dq('p2alfile', h)};
  v_h2 constant text := {dq('p2alfile', h2)};
  v_role text;
  t text;
  v_n integer;
BEGIN
{G.common_pins(tag, server, major)}  IF encode(sha256(convert_to(v_h, 'UTF8')), 'hex') <> '{SRC_PINS['H_sandbox_exec.sql']}'
     OR encode(sha256(convert_to(v_h2, 'UTF8')), 'hex') <> '{SRC_PINS['H2_sandbox_exec_sequence.sql']}' THEN
    RAISE EXCEPTION '{tag}_stop: embedded H or H2 text differs from the staging-applied files';
  END IF;
  FOREACH t IN ARRAY {tables} LOOP
    IF to_regclass('public.' || t) IS NULL THEN RAISE EXCEPTION '{tag}_stop: package table public.% is missing (run S1 and S3 first)', t; END IF;
  END LOOP;
  IF to_regclass('public.vehicle_custody_milestones_seq_seq') IS NULL THEN RAISE EXCEPTION '{tag}_stop: S3 sequence missing'; END IF;

  EXECUTE v_h;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sandbox_exec') THEN EXECUTE v_h2; END IF;
  -- Production addition: the same revokes for any other Lovable sandbox role (sandbox_exec_<ref>) that holds them.
  FOR v_role IN SELECT rolname FROM pg_roles WHERE rolname LIKE 'sandbox\\_exec\\_%' ORDER BY 1 LOOP
    FOREACH t IN ARRAY {tables} LOOP
      EXECUTE format('REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.%I FROM %I', t, v_role);
    END LOOP;
    EXECUTE format('REVOKE USAGE, UPDATE ON SEQUENCE public.vehicle_custody_milestones_seq_seq FROM %I', v_role);
  END LOOP;

  SELECT count(*) INTO v_n FROM pg_roles r, unnest({tables}) t(name)
   WHERE r.rolname LIKE 'sandbox\\_exec%'
     AND (has_table_privilege(r.oid, ('public.' || t.name)::regclass, 'INSERT') OR has_table_privilege(r.oid, ('public.' || t.name)::regclass, 'UPDATE')
          OR has_table_privilege(r.oid, ('public.' || t.name)::regclass, 'DELETE') OR has_table_privilege(r.oid, ('public.' || t.name)::regclass, 'TRUNCATE')
          OR has_table_privilege(r.oid, ('public.' || t.name)::regclass, 'REFERENCES') OR has_table_privilege(r.oid, ('public.' || t.name)::regclass, 'TRIGGER'));
  IF v_n <> 0 THEN RAISE EXCEPTION '{tag}_check: % sandbox_exec write privileges remain on package tables', v_n; END IF;
  SELECT count(*) INTO v_n FROM pg_roles r WHERE r.rolname LIKE 'sandbox\\_exec%'
     AND (has_sequence_privilege(r.oid, 'public.vehicle_custody_milestones_seq_seq', 'USAGE') OR has_sequence_privilege(r.oid, 'public.vehicle_custody_milestones_seq_seq', 'UPDATE'));
  IF v_n <> 0 THEN RAISE EXCEPTION '{tag}_check: a sandbox_exec role can still advance the milestone sequence'; END IF;
  RAISE NOTICE '{tag}_ok: sandbox_exec roles hold no write privilege on the 22 package tables or the milestone sequence';
END
$p2al$;
"""


def l_inner(server, major, inverse=False):
    tag = "p2al_l" + ("_inverse" if inverse else "")
    if inverse:
        apply = "  UPDATE rtgip.delivery_config SET local_app = NULL WHERE id AND local_app = 'autolabels' AND transport_enabled = false;\n"
        pre, post = dark(tag, "stop"), dark(tag, "check", None)
        extra = f"""  IF to_regclass('rtgip.evidence_v3') IS NOT NULL THEN RAISE EXCEPTION '{tag}_stop: ar3 is applied; run its inverse first'; END IF;
"""
    else:
        apply = "  UPDATE rtgip.delivery_config SET local_app = 'autolabels' WHERE id AND local_app IS NULL AND transport_enabled = false;\n"
        pre, post = dark(tag, "stop", None), dark(tag, "check")
        extra = f"""  SELECT pg_get_constraintdef(k.oid) INTO v_s FROM pg_constraint k
   WHERE k.conrelid = 'rtgip.delivery_config'::regclass AND k.conname = 'delivery_config_local_app_check';
  IF v_s IS NULL OR v_s NOT LIKE '%autolabels%' OR v_s NOT LIKE '%autocurb%' OR v_s NOT LIKE '%autoframe%' OR v_s LIKE '%autofilm%' THEN
    RAISE EXCEPTION '{tag}_stop: local_app CHECK is not the pinned definition (%)', coalesce(v_s, 'missing');
  END IF;
"""
    return f"""DO $p2al$
DECLARE
  v_n integer;
  v_s text;
  t text;
BEGIN
{G.common_pins(tag, server, major)}  IF to_regclass('rtgip.delivery_config') IS NULL THEN RAISE EXCEPTION '{tag}_stop: the delivery ledger D is not installed'; END IF;
{pre}{extra}
{apply}  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN RAISE EXCEPTION '{tag}_check: % delivery_config rows changed, expected 1', v_n; END IF;
{post}  RAISE NOTICE '{tag}_ok';
END
$p2al$;
"""


def prod_pins(s):
    assert s.count("," + STAGING_ONLY_FN) == 1, "staging pin string must carry the key-import residual exactly once"
    return s.replace("," + STAGING_ONLY_FN, "")


def ar1_inner(server, major):
    tag = "ar1"
    st = read(os.path.join(SRC, "staging-ar1-al.sql"), SRC_PINS["staging-ar1-al.sql"])
    fn_pre = prod_pins(lines(st, 80, 84))
    gen_pre = lines(st, 85, 112)
    apply = lines(st, 113, 432)
    gen_post = prod_pins(lines(st, 488, 525))
    assert apply.startswith("  -- apply\n") and gen_post.startswith("  SELECT count(*) INTO v_n FROM rtgip.signing_keys WHERE audience IS NOT NULL;")
    assert "stg-" not in fn_pre + gen_pre + apply + gen_post and "c5100000" not in fn_pre + gen_pre + apply + gen_post
    return f"""DO $ar1$
DECLARE
  d rtgip.delivery_config;
  v_n integer;
  v_s text;
  t text;
  v_acl text;
BEGIN
{G.common_pins('ar1', server, major)}{dark('ar1', 'stop')}  SELECT count(*) INTO v_n FROM rtgip.event_catalog;
  IF v_n <> 21 THEN RAISE EXCEPTION 'ar1_stop: rtgip.event_catalog has % rows, expected 21', v_n; END IF;
  SELECT count(*) INTO v_n FROM rtgip.forbidden_keys;
  IF v_n <> 67 THEN RAISE EXCEPTION 'ar1_stop: rtgip.forbidden_keys has % rows, expected 67', v_n; END IF;
{fn_pre}{gen_pre}{apply}
  -- postcheck
{dark('ar1', 'check')}{gen_post}  RAISE NOTICE 'ar1_apply_ok al local_app=autolabels audience column, gateway_confirmation, 4 functions replaced; no key row';
END
$ar1$;
"""


def ar1_inverse_inner(server, major):
    tag = "ar1_inverse"
    st = read(os.path.join(SRC, "staging-ar1-al.inverse.sql"), SRC_PINS["staging-ar1-al.inverse.sql"])
    fw = read(os.path.join(SRC, "staging-ar1-al.sql"), SRC_PINS["staging-ar1-al.sql"])
    gen_pre1 = lines(st, 22, 35)
    gen_pre2 = prod_pins(lines(st, 90, 114))
    apply = lines(st, 115, 435)
    assert apply.startswith("  -- inverse\n")
    b4 = prod_pins(lines(fw, 80, 84)).replace("ar1_stop:", "ar1_inverse_check:")
    blob = gen_pre1 + gen_pre2 + apply + b4
    assert "stg-" not in blob and "c5100000" not in blob
    return f"""DO $ar1i$
DECLARE
  d rtgip.delivery_config;
  v_n integer;
  v_s text;
  t text;
  v_acl text;
BEGIN
{G.common_pins(tag, server, major)}{gen_pre1}  IF to_regclass('rtgip.evidence_v3') IS NOT NULL THEN RAISE EXCEPTION 'ar1_inverse_stop: ar3 is applied; run ar3-al.inverse first'; END IF;
{dark(tag, 'stop')}{gen_pre2}{apply}
  -- postcheck
{dark(tag, 'check')}{b4}  IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'rtgip.signing_keys'::regclass AND attname = 'audience' AND NOT attisdropped) THEN
    RAISE EXCEPTION 'ar1_inverse_check: signing_keys.audience remains';
  END IF;
  SELECT pg_get_constraintdef(k.oid) INTO v_s FROM pg_constraint k WHERE k.conrelid = 'rtgip.receipts'::regclass AND k.conname = 'receipts_kind_check';
  IF v_s IS DISTINCT FROM 'CHECK ((kind = ANY (ARRAY[''gateway_admission''::text, ''target_inbox''::text, ''consumer_commit''::text])))' THEN
    RAISE EXCEPTION 'ar1_inverse_check: receipts_kind_check is not the package definition (%)', coalesce(v_s, 'missing');
  END IF;
  RAISE NOTICE 'ar1_inverse_ok al: the D delivery ledger bodies are restored';
END
$ar1i$;
"""


def ar3_files(server, major):
    saved = dict(G.APPS["al"])
    G.APPS["al"] = dict(PROD, server=server)
    try:
        v3 = open(G.V3, encoding="utf-8").read()
        inv = open(G.V3_INV, encoding="utf-8").read()
        pins = json.load(open(G.PINS))
        fw = G.apply_inner("al", server, major, PROD["consumer"], v3, pins).replace("autolabels Staging (Supabase", "autolabels PRODUCTION (Supabase")
        iv = G.inverse_inner("al", server, major, PROD["consumer"], inv, pins).replace("autolabels Staging (Supabase", "autolabels PRODUCTION (Supabase")
    finally:
        G.APPS["al"] = saved
    return fw, iv


def edge_inner(server, major, inverse=False):
    tag = "p2al_edge" + ("_inverse" if inverse else "")
    pol = "rtgip_edge_runtime_read"
    rls_tables = [f"rtgip.{t}" for t in EDGE_TABLES + ["outbox"]] + ["public.tenant_members", "public.dealer_stores"]
    rls_arr = "ARRAY[" + ",".join(G.q(x) for x in rls_tables) + "]"
    if inverse:
        return f"""DO $p2al$
DECLARE
  t text;
  v_n integer;
BEGIN
{G.common_pins(tag, server, major)}  IF to_regrole('rtgip_edge') IS NULL THEN RAISE NOTICE '{tag}_ok: rtgip_edge does not exist, nothing changed'; RETURN; END IF;
  IF EXISTS (SELECT 1 FROM pg_stat_activity WHERE usename = 'rtgip_edge') THEN
    RAISE EXCEPTION '{tag}_stop: rtgip_edge has open sessions; delete the RTGIP_EDGE_DB_URL secret and retry';
  END IF;
  IF (SELECT count(*) FROM pg_class c JOIN pg_roles r ON r.oid = c.relowner WHERE r.rolname = 'rtgip_edge')
     + (SELECT count(*) FROM pg_proc p JOIN pg_roles r ON r.oid = p.proowner WHERE r.rolname = 'rtgip_edge') <> 0 THEN
    RAISE EXCEPTION '{tag}_stop: rtgip_edge owns objects';
  END IF;
  ALTER ROLE rtgip_edge NOLOGIN;
  FOREACH t IN ARRAY {rls_arr} LOOP
    IF to_regclass(t) IS NOT NULL THEN EXECUTE format('DROP POLICY IF EXISTS {pol} ON %s', t); END IF;
  END LOOP;
  IF to_regclass('rtgip_src.rooftop_stores') IS NOT NULL THEN EXECUTE 'DROP POLICY IF EXISTS {pol} ON rtgip_src.rooftop_stores'; END IF;
  REVOKE ALL ON ALL TABLES IN SCHEMA rtgip FROM rtgip_edge;
  REVOKE ALL ON ALL TABLES IN SCHEMA rtgip_src FROM rtgip_edge;
  REVOKE ALL (user_id, tenant_id, role, accepted_at) ON public.tenant_members FROM rtgip_edge;
  REVOKE ALL (id, tenant_id) ON public.dealer_stores FROM rtgip_edge;
  REVOKE USAGE ON SCHEMA rtgip, rtgip_src FROM rtgip_edge;
  REVOKE {", ".join(EDGE_SET)} FROM rtgip_edge;
  DROP ROLE rtgip_edge;
  IF to_regrole('rtgip_edge') IS NOT NULL THEN RAISE EXCEPTION '{tag}_check: rtgip_edge remains'; END IF;
  SELECT count(*) INTO v_n FROM pg_policy WHERE polname = '{pol}';
  IF v_n <> 0 THEN RAISE EXCEPTION '{tag}_check: % {pol} policies remain', v_n; END IF;
  RAISE NOTICE '{tag}_ok: rtgip_edge, its memberships, grants and read policies removed';
END
$p2al$;
"""
    grants_cols = "".join(f"  GRANT SELECT ({', '.join(cols)}) ON {rel} TO rtgip_edge;\n" for rel, cols in EDGE_COLS.items())
    want_tbl = ",".join(sorted([f"rtgip.{t}=SELECT" for t in EDGE_TABLES]))
    return f"""DO $p2al$
DECLARE
  t text;
  v_n integer;
  v_s text;
BEGIN
{G.common_pins(tag, server, major)}  IF obj_description(to_regclass('rtgip.evidence_v3'), 'pg_class') IS DISTINCT FROM {G.q(G.AR3_MARKER)} THEN
    RAISE EXCEPTION '{tag}_stop: ar3 (rtgip/3) is not applied';
  END IF;
{dark(tag, 'stop')}  SELECT string_agg(rolname, ',' ORDER BY rolname COLLATE "C") INTO v_s FROM pg_roles WHERE rolname LIKE 'rtgip%';
  IF v_s IS DISTINCT FROM '{ROLES}' THEN
    RAISE EXCEPTION '{tag}_stop: rtgip roles are (%), expected ({ROLES}); rtgip_edge exists already or the role set drifted', coalesce(v_s, 'none');
  END IF;
  IF NOT pg_has_role('rtgip_inbox_receiver', 'rtgip_labels_consumer', 'SET') THEN
    RAISE EXCEPTION '{tag}_stop: the E chain rtgip_inbox_receiver -> rtgip_labels_consumer is missing';
  END IF;
  IF (SELECT count(*) FROM pg_attribute a WHERE a.attrelid = to_regclass('public.tenant_members') AND NOT a.attisdropped AND a.attname IN ('user_id','tenant_id','role','accepted_at')) <> 4
     OR (SELECT count(*) FROM pg_attribute a WHERE a.attrelid = to_regclass('public.dealer_stores') AND NOT a.attisdropped AND a.attname IN ('id','tenant_id')) <> 2 THEN
    RAISE EXCEPTION '{tag}_stop: public.tenant_members or public.dealer_stores lacks a column the publish authorizer reads';
  END IF;

  -- The edge runtime login (design Q9). No password here: the owner sets it as a SCRAM verifier (APPLY-ORDER.md).
  CREATE ROLE rtgip_edge LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 20;
  -- Duty roles by SET only (no inheritance, no ADMIN), exactly the four the staging A-app-1 r2 grants gave postgres; the
  -- consumer is reached through the E chain rtgip_inbox_receiver -> rtgip_labels_consumer.
  GRANT {", ".join(EDGE_SET)} TO rtgip_edge WITH INHERIT FALSE, SET TRUE;
  -- The reads the runtime makes as its own login (runtime.ts dbGate, loadV3, dispatch, publish authorizer).
  GRANT USAGE ON SCHEMA rtgip, rtgip_src TO rtgip_edge;
  GRANT SELECT ON {", ".join(f"rtgip.{t}" for t in EDGE_TABLES)} TO rtgip_edge;
  GRANT SELECT ({", ".join(EDGE_OUTBOX_COLS)}) ON rtgip.outbox TO rtgip_edge;
{grants_cols}  FOREACH t IN ARRAY {rls_arr} LOOP
    EXECUTE format('CREATE POLICY {pol} ON %s FOR SELECT TO rtgip_edge USING (true)', t);
  END LOOP;
  IF (SELECT relrowsecurity FROM pg_class WHERE oid = 'rtgip_src.rooftop_stores'::regclass) THEN
    CREATE POLICY {pol} ON rtgip_src.rooftop_stores FOR SELECT TO rtgip_edge USING (true);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rtgip_edge' AND rolcanlogin AND NOT rolinherit AND NOT rolsuper AND NOT rolbypassrls
                 AND NOT rolcreaterole AND NOT rolcreatedb AND NOT rolreplication AND rolconnlimit = 20) THEN
    RAISE EXCEPTION '{tag}_check: rtgip_edge attributes are not LOGIN NOINHERIT, no privilege attribute, connection limit 20';
  END IF;
  SELECT string_agg(r.rolname || ':set=' || am.set_option || ':inherit=' || am.inherit_option || ':admin=' || am.admin_option, ',' ORDER BY r.rolname COLLATE "C") INTO v_s
    FROM pg_auth_members am JOIN pg_roles r ON r.oid = am.roleid JOIN pg_roles m ON m.oid = am.member WHERE m.rolname = 'rtgip_edge';
  IF v_s IS DISTINCT FROM '{",".join(f"{r}:set=true:inherit=false:admin=false" for r in sorted(EDGE_SET))}' THEN
    RAISE EXCEPTION '{tag}_check: rtgip_edge memberships are (%)', v_s;
  END IF;
  IF NOT pg_has_role('rtgip_edge', 'rtgip_labels_consumer', 'SET') OR pg_has_role('rtgip_edge', 'rtgip_operator', 'SET')
     OR pg_has_role('rtgip_edge', 'rtgip_operator', 'USAGE') OR pg_has_role('rtgip_edge', 'rtgip_dispatcher', 'USAGE') THEN
    RAISE EXCEPTION '{tag}_check: rtgip_edge SET paths are not exactly the duty roles plus the consumer chain';
  END IF;
  SELECT string_agg(n.nspname || '.' || c.relname || '=' || x.privilege_type, ',' ORDER BY n.nspname || '.' || c.relname || '=' || x.privilege_type COLLATE "C") INTO v_s
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace, aclexplode(c.relacl) x
   WHERE x.grantee = 'rtgip_edge'::regrole;
  IF v_s IS DISTINCT FROM '{want_tbl}' THEN RAISE EXCEPTION '{tag}_check: rtgip_edge table grants are (%)', v_s; END IF;
  SELECT count(*) INTO v_n FROM pg_proc p WHERE p.pronamespace IN ('rtgip'::regnamespace, 'rtgip_src'::regnamespace, 'rtgip_fx'::regnamespace)
     AND has_function_privilege('rtgip_edge', p.oid, 'EXECUTE') AND p.prorettype <> 'trigger'::regtype;
  IF v_n <> 0 THEN RAISE EXCEPTION '{tag}_check: rtgip_edge can execute % package functions as itself (only through SET ROLE)', v_n; END IF;
  IF has_schema_privilege('rtgip_edge', 'rtgip_fx', 'USAGE') OR has_table_privilege('rtgip_edge', 'rtgip.outbox', 'INSERT')
     OR has_table_privilege('rtgip_edge', 'rtgip.delivery_config', 'UPDATE') OR has_column_privilege('rtgip_edge', 'rtgip.outbox', 'body', 'SELECT') THEN
    RAISE EXCEPTION '{tag}_check: rtgip_edge holds more than its reads';
  END IF;
{dark(tag, 'check')}  RAISE NOTICE '{tag}_ok: rtgip_edge LOGIN NOINHERIT, SET-only on 4 duty roles, read grants and policies for the runtime';
END
$p2al$;
"""


def k5_prd(text):
    reps = [("v_doc->>'env' IS DISTINCT FROM 'stg'", "v_doc->>'env' IS DISTINCT FROM 'prd'"),
            ("for env stg'", "for env prd'"),
            ("'^stg-(gateway|autolabels|autocurb|autoframe)-ed[1-9][0-9]{0,3}$'", "'^prd-(gateway|autolabels|autocurb|autoframe)-ed[1-9][0-9]{0,3}$'"),
            ("substring(k->>'key_id' FROM '^stg-([a-z]+)-ed')", "substring(k->>'key_id' FROM '^prd-([a-z]+)-ed')"),
            ("is env stg with exactly", "is env prd with exactly"),
            ("autolabels Staging (Supabase uakiwvigsmrlyfpsalai, Lovable 0bc16929)", f"autolabels PRODUCTION (Supabase {PROD['ref']}, Lovable {PROD['lovable']})"),
            ("scripts/rtgip3/gen_ar3.py --fill-k5", "scripts/rtgip3/gen_prod_al.py --fill-k5")]
    for a, b in reps:
        if a not in text:
            raise SystemExit(f"k5 template no longer contains {a!r}")
        text = text.replace(a, b)
    assert "'stg'" not in text and "^stg-" not in text
    return text


def k5_file(server, major, params=G.K5_PENDING, inverse=False):
    saved = dict(G.APPS["al"])
    G.APPS["al"] = dict(saved, server=server)
    try:
        return k5_prd(G.k5_app("al", server, major, params, inverse=inverse))
    finally:
        G.APPS["al"] = saved


CONN_PENDING = {"status": "PENDING", "tenant_id": "<production tenant uuid>", "rooftop_id": "<production rooftop id>"}


def conn_template(server, major, params=CONN_PENDING):
    tag = "p2al_conn"
    st = read(os.path.join(SRC, "staging-ar1-al.sql"), SRC_PINS["staging-ar1-al.sql"])
    rows = json.loads(st.split("v_rows jsonb := $j$")[1].split("$j$::jsonb")[0])
    shapes = [{k: r[k] for k in ("source_app", "target_app", "event_types", "purposes")} for r in rows]
    return f"""-- P2 AutoLabels PRODUCTION connections TEMPLATE (PROPOSAL, NOT APPROVED; enrollment card, not part of the dark install).
-- AutoLabels production (Supabase {PROD['ref']}, Lovable {PROD['lovable']}, server {PROD['server']}). One DO statement, atomic.
-- Creates the four AutoLabels connection rows for ONE production tenant and rooftop with the same route shapes as the
-- staging B4 rows, rtgip/3 from creation (send_protocol rtgip/3, accept {{rtgip/3}}, v3_added_at stamped by the ar3 trigger,
-- v2_accept_until NULL), producer_enabled and reader_enabled false. Run before K5-v3 so the key bindings find the rows.
-- Fill p (tenant uuid and rooftop id from the enrollment card), set status FILLED, wrap with gen_ar3.wrap via
-- gen_prod_al.py --fill-conn. Rollback while every ledger is still empty: DELETE FROM rtgip.connections WHERE tenant_id = '<tenant>'.
DO $p2al$
DECLARE
  p constant jsonb := {G.q(json.dumps(params, sort_keys=True))}::jsonb;
  v_shapes constant jsonb := {G.q(json.dumps(shapes, sort_keys=True))}::jsonb;
  v_n integer;
  t text;
BEGIN
{G.common_pins(tag, server, major)}  IF p->>'status' IS DISTINCT FROM 'FILLED' THEN RAISE EXCEPTION '{tag}_stop: parameters are PENDING; fill them from the enrollment card'; END IF;
  IF p->>'tenant_id' !~ '^[0-9a-f]{{8}}-[0-9a-f]{{4}}-[0-9a-f]{{4}}-[0-9a-f]{{4}}-[0-9a-f]{{12}}$' OR p->>'rooftop_id' !~ '^[A-Za-z0-9._-]{{1,64}}$' THEN
    RAISE EXCEPTION '{tag}_stop: tenant_id or rooftop_id is malformed';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.tenants WHERE id = (p->>'tenant_id')::uuid) THEN RAISE EXCEPTION '{tag}_stop: tenant does not exist'; END IF;
  IF obj_description(to_regclass('rtgip.evidence_v3'), 'pg_class') IS DISTINCT FROM {G.q(G.AR3_MARKER)} THEN RAISE EXCEPTION '{tag}_stop: ar3 is not applied'; END IF;
{dark(tag, 'stop')}
  INSERT INTO rtgip.connections (connection_id, source_app, target_app, tenant_id, rooftop_ids, event_types, purposes, producer_enabled, reader_enabled, status,
                                 send_protocol, accept_protocols, v2_accept_until)
  SELECT 'conn:' || (s->>'source_app') || '>' || (s->>'target_app') || ':' || (p->>'tenant_id') || ':' || (p->>'rooftop_id'),
         s->>'source_app', s->>'target_app', p->>'tenant_id', ARRAY[p->>'rooftop_id'],
         ARRAY(SELECT jsonb_array_elements_text(s->'event_types')), ARRAY(SELECT jsonb_array_elements_text(s->'purposes')),
         false, false, 'active', 'rtgip/3', '{{rtgip/3}}', NULL
    FROM jsonb_array_elements(v_shapes) s;
  SELECT count(*) INTO v_n FROM rtgip.connections
   WHERE send_protocol = 'rtgip/3' AND accept_protocols = '{{rtgip/3}}' AND v3_added_at IS NOT NULL AND v2_accept_until IS NULL
     AND NOT producer_enabled AND NOT reader_enabled AND status = 'active' AND tenant_id = p->>'tenant_id';
  IF v_n <> 4 OR (SELECT count(*) FROM rtgip.connections) <> 4 THEN RAISE EXCEPTION '{tag}_check: expected exactly 4 rtgip/3-only dark rows, found %', v_n; END IF;
  IF EXISTS (SELECT 1 FROM rtgip.connections c WHERE rtgip.gate_verdict(c.accept_protocols, c.v3_added_at, c.v2_accept_until, 'rtgip/2', floor(extract(epoch FROM rtgip.clock()))::bigint) IS NULL) THEN
    RAISE EXCEPTION '{tag}_check: a connection would accept rtgip/2';
  END IF;
  IF (SELECT transport_enabled FROM rtgip.delivery_config) IS DISTINCT FROM false THEN RAISE EXCEPTION '{tag}_check: transport is not false'; END IF;
  RAISE NOTICE '{tag}_ok: 4 connections, rtgip/3 only, flags off, transport off';
END
$p2al$;
"""


STEPS = [
    ("01", "S1", "spine (20261030000000_rooftopos_spine.sql)"),
    ("02", "S3", "vehicle history foundation (PR #46 SQL content; R reads its columns and tables)"),
    ("03", "D", "delivery ledger (rtgip_v2_delivery.proposed.sql, frozen, transport CHECK lock)"),
    ("04", "R", "source readers (rtgip_source_readers.proposed.sql)"),
    ("05", "E", "consumer effects (rtgip_labels_effects.proposed.sql)"),
]


def build(server=PROD["server"], major=17):
    files = {}
    for num, key, title in STEPS:
        name, pin = INPUTS[key]
        text = read(os.path.join(PROP, name), pin)
        inner = header(num, f"{key} {title}", [f"Embeds supabase/proposed/{name} (sha256 {pin}) byte for byte; staging applied it in B2 (2026-11-03).",
                                                f"Pre: the staging package check {key}_pre (every prerequisite t, component missing). Post: {key}_post all t and",
                                                f"the {key} component digest equal to staging {STAGING_DIGEST[key]}."],
                       f"{num}-{key}.disable.sql revokes the grants (forward recovery, restored by {num}-{key}.restore.sql); the schema objects themselves are IRREVERSIBLE without PITR.") + component_inner(num, key, text, server, major)
        files[f"{num}-{key}.sql"] = G.wrap(f"p2al-{num}-{key}", inner)
        dinner = header(num, f"{key} forward recovery", [f"Embeds the staging package disable/{key}_disable.sql: revokes the component's grants, never drops a table, row or audit record."],
                        f"{num}-{key}.restore.sql") + disable_inner(num, key, server, major)
        files[f"{num}-{key}.disable.sql"] = G.wrap(f"p2al-{num}-{key}.disable", dinner)
        rinner = header(num, f"{key} restore after disable", [f"Re-executes the same embedded {name} over an installed {key} (the file is re-runnable) to restore the grants",
                                                              f"{num}-{key}.disable.sql revoked. Pre: component installed or partial (re-running an earlier component replaces bodies a later one owns).",
                                                              f"Post: as step {num}, the staging digest, which also refuses (atomically) a restore over a later step still applied.",
                                                              "Order: invert 10 to 07 first, then restore 01, 02, 03, 04, 05, then re-apply 07 to 10."],
                        f"{num}-{key}.disable.sql") + component_inner(num, key, text, server, major, restore=True)
        files[f"{num}-{key}.restore.sql"] = G.wrap(f"p2al-{num}-{key}.restore", rinner)
    files["06-H.sql"] = G.wrap("p2al-06-H", header("06", "H sandbox_exec write revoke", [
        "Embeds the staging H_sandbox_exec.sql (f0132f8b) and H2_sandbox_exec_sequence.sql (d61c7858) byte for byte, plus the same revokes",
        "for any other sandbox_exec_<ref> role. Revokes only."], "IRREVERSIBLE by design: re-granting sandbox_exec writes is never wanted.") + h_inner(server, major))
    files["07-L.sql"] = G.wrap("p2al-07-L", header("07", "local_app autolabels", [
        "The local_app UPDATE of staging B4 (al-B4.sql 5da678e7 line 84) without its staging connection rows."], "07-L.inverse.sql") + l_inner(server, major))
    files["07-L.inverse.sql"] = G.wrap("p2al-07-L.inverse", header("07", "local_app inverse", ["Sets local_app back to NULL while every ledger is empty and ar3 is not applied."], "re-run 07-L.sql") + l_inner(server, major, True))
    files["08-AR1.sql"] = G.wrap("p2al-08-AR1", header("08", "AR-1 strict option 1 r2", [
        "Apply section byte for byte from the staging wrapper ar1-al.sql 552fd9a4 lines 113-432; pre and post checks are its generic ones",
        "with the production dark state in place of the staging key, Vault and connection rows."], "08-AR1.inverse.sql") + ar1_inner(server, major))
    files["08-AR1.inverse.sql"] = G.wrap("p2al-08-AR1.inverse", header("08", "AR-1 inverse", [
        "Inverse section byte for byte from the staging ar1-al.inverse.sql ec154b68 lines 115-435."], "re-run 08-AR1.sql") + ar1_inverse_inner(server, major))
    fw, iv = ar3_files(server, major)
    files["09-AR3.sql"] = G.wrap("ar3-al", fw)
    files["09-AR3.inverse.sql"] = G.wrap("ar3-al.inverse", iv)
    files["10-EDGE.sql"] = G.wrap("p2al-10-EDGE", header("10", "rtgip_edge login for the edge runtime (design Q9)", [
        "New on production (staging ran the runtime as postgres through SUPABASE_DB_URL): LOGIN NOINHERIT, no password, SET-only",
        "membership in the four duty roles, SELECT on the rows the runtime reads as itself, and a SELECT policy TO rtgip_edge on each."],
        "10-EDGE.inverse.sql") + edge_inner(server, major))
    files["10-EDGE.inverse.sql"] = G.wrap("p2al-10-EDGE.inverse", header("10", "rtgip_edge inverse", ["Removes the login, its memberships, grants and policies."], "re-run 10-EDGE.sql") + edge_inner(server, major, True))
    files["T1-connections.template.sql"] = conn_template(server, major)
    files["T2-K5-v3-al.template.sql"] = k5_file(server, major)
    files["T2-K5-v3-al.inverse.template.sql"] = k5_file(server, major, inverse=True)
    return files


def fingerprint():
    comp = fp_comp_sql().replace("\nSELECT state, digest FROM comp WHERE component = $1", "")
    exp = {**STAGING_DIGEST}
    exp.pop("D")
    return f"""-- AutoLabels PRODUCTION RooftopOS fingerprint. READ ONLY: one SELECT over the catalogs and the dark rows; no write, no secret,
-- no Vault value, no pg_net or auth table. Each *_ok column compares a live value with the expected one; all must be true
-- after step 10 (and stay true until an enrollment card changes connections, keys or flags).
-- Code and schema digests equal staging: S1, S3, R and E component digests are the staging B2 digests (staging fingerprint
-- expression, C collation); the rtgip function digest is the staging post-ar3 set {STAGING_FN_DIGEST} without the staging-only
-- C-S4 key-import trigger function ({STAGING_ONLY_FN}), i.e. {PROD_FN_DIGEST} over {PROD_FN_COUNT} functions.
-- Identities differ from staging by design: server address, project ref, no keys, no connections, no tenants enrolled.
{comp}
SELECT host(inet_server_addr()) AS addr,
       coalesce(host(inet_server_addr()), '') = '{PROD['server']}' AS addr_ok,
       current_setting('server_version_num')::int / 10000 = 17 AS pg17_ok,
{",\n".join(f"       (SELECT state = 'installed' AND digest = '{d}' FROM comp WHERE component = '{k}') AS {k.lower()}_ok" for k, d in sorted(exp.items()))},
       (SELECT md5(string_agg(p.proname || ':' || left(md5(pg_get_functiondef(p.oid)), 8), ',' ORDER BY p.proname COLLATE "C"))
          FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'rtgip' AND p.prokind IN ('f','p')) AS rtgip_fn_digest,
       (SELECT md5(string_agg(p.proname || ':' || left(md5(pg_get_functiondef(p.oid)), 8), ',' ORDER BY p.proname COLLATE "C")) = '{PROD_FN_DIGEST}' AND count(*) = {PROD_FN_COUNT}
          FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'rtgip' AND p.prokind IN ('f','p')) AS rtgip_fn_ok,
       obj_description(to_regclass('rtgip.evidence_v3'), 'pg_class') IS NOT DISTINCT FROM {G.q(G.AR3_MARKER)} AS ar3_ok,
       (SELECT local_app = 'autolabels' AND transport_enabled = false FROM rtgip.delivery_config) AS dark_config_ok,
       (SELECT count(*) = 1 FROM pg_constraint WHERE conrelid = to_regclass('rtgip.delivery_config') AND contype = 'c'
           AND pg_get_constraintdef(oid) = 'CHECK ((transport_enabled = false))') AS transport_check_ok,
       (SELECT count(*) FROM rtgip.connections) AS connections,
       (SELECT count(*) FILTER (WHERE producer_enabled OR reader_enabled) FROM rtgip.connections) AS flags_on,
       (SELECT count(*) FROM rtgip.connections WHERE send_protocol <> 'rtgip/3' OR accept_protocols <> '{{rtgip/3}}') AS v2_capable_connections,
       (SELECT count(*) FROM rtgip.signing_keys) AS rtgip2_keys,
       (SELECT count(*) FROM rtgip.public_keys) AS rtgip3_keys,
       (SELECT count(*) FROM rtgip.public_keys WHERE key_id !~ '^prd-') AS non_prd_keys,
       to_regclass('rtgip.key_import_tickets') IS NULL AND NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname ~ 'key_import') AS no_key_import_ok,
       (SELECT (SELECT count(*) FROM rtgip.outbox) + (SELECT count(*) FROM rtgip.inbox) + (SELECT count(*) FROM rtgip.receipts) + (SELECT count(*) FROM rtgip.admissions)
             + (SELECT count(*) FROM rtgip.evidence_v3)) AS ledger_rows,
       (SELECT string_agg(rolname, ',' ORDER BY rolname COLLATE "C") FROM pg_roles WHERE rolname LIKE 'rtgip%') AS rtgip_roles,
       EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rtgip_edge' AND rolcanlogin AND NOT rolinherit AND NOT rolsuper AND NOT rolbypassrls) AS edge_role_ok,
       (SELECT string_agg(r.rolname, ',' ORDER BY r.rolname COLLATE "C") FROM pg_auth_members am JOIN pg_roles r ON r.oid = am.roleid
         WHERE am.member = to_regrole('rtgip_edge') AND am.set_option AND NOT am.inherit_option AND NOT am.admin_option) = '{",".join(sorted(EDGE_SET))}' AS edge_memberships_ok,
       NOT EXISTS (SELECT 1 FROM pg_roles r WHERE (r.rolname IN ('anon','authenticated','service_role') OR r.rolname LIKE 'sandbox\\_exec%')
                     AND (has_schema_privilege(r.oid, 'rtgip', 'USAGE') OR has_schema_privilege(r.oid, 'rtgip_fx', 'USAGE')
                          OR EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace IN ('rtgip'::regnamespace, 'rtgip_fx'::regnamespace) AND has_function_privilege(r.oid, p.oid, 'EXECUTE')))) AS api_closed_ok,
       NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'rtgip' AND c.relkind = 'r' AND NOT c.relrowsecurity) AS rtgip_rls_ok;
"""


def write_all(outdir, files):
    os.makedirs(outdir, exist_ok=True)
    for name, text in files.items():
        with open(os.path.join(outdir, name), "w", encoding="utf-8", newline="\n") as fh:
            fh.write(text)


def sums(files):
    out = []
    for name in sorted(files):
        out.append(f"{G.sha(files[name])}  {name}")
        if "$p2wrapfile$" in files[name]:
            out.append(f"{G.sha(G.unwrap(files[name]))}  {name} (inner text, checked by the wrapper)")
    return "\n".join(out) + "\n"


def all_files(server=PROD["server"], major=17):
    files = build(server, major)
    files["al-production-fingerprint.readonly.sql"] = fingerprint()
    return files


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    ap.add_argument("--rehearsal")
    ap.add_argument("--server")
    ap.add_argument("--major", type=int, default=17)
    ap.add_argument("--fill-k5", nargs=2, metavar=("PARAMS", "OUT"))
    ap.add_argument("--fill-conn", nargs=2, metavar=("PARAMS", "OUT"))
    ap.add_argument("--k5-inverse", action="store_true")
    a = ap.parse_args()
    server = PROD["server"] if a.server is None else a.server
    if a.fill_k5 or a.fill_conn:
        params_path, out = a.fill_k5 or a.fill_conn
        params = json.load(open(params_path))
        params["status"] = "FILLED"
        inner = k5_file(server, a.major, params, inverse=a.k5_inverse) if a.fill_k5 else conn_template(server, a.major, params)
        name = os.path.basename(out).replace(".wrap.sql", "")
        with open(out, "w", encoding="utf-8", newline="\n") as fh:
            fh.write(G.wrap(name, inner))
        print(G.sha(inner))
        return 0
    s = open(os.path.join(SRC, "al-hosted-fingerprint.sql"), encoding="utf-8").read()
    assert G.sha(s) == SRC_PINS["al-hosted-fingerprint.sql"]
    files = all_files(server, a.major)
    files["SHA256SUMS"] = sums(files)
    if a.rehearsal:
        write_all(a.rehearsal, files)
        return 0
    if a.check:
        stale = [n for n, t in files.items() if not os.path.exists(os.path.join(OUT, n)) or open(os.path.join(OUT, n), encoding="utf-8").read() != t]
        print("stale: " + " ".join(stale) if stale else "fresh")
        return 1 if stale else 0
    write_all(OUT, files)
    print(files["SHA256SUMS"], end="")
    return 0


if __name__ == "__main__":
    sys.exit(main())
