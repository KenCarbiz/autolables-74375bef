"""Drives the unmodified passport-lead-escalation function against the local
stack started by run.sh and checks what it did. Prints one line per check and
exits non-zero if any fails."""

import json
import os
import subprocess
import sys
import urllib.error
import urllib.request

FN = os.environ["FN_URL"]
GW = os.environ["GATEWAY_URL"]
KEY = os.environ["SERVICE_KEY"]
CRON = os.environ["CRON_SECRET"]
PSQL = ["psql", "-X", "-qtA", "-U", os.environ.get("PGUSER", "postgres"), "-d", os.environ["DB"]]

results = []


def check(label, expected, actual):
    ok = expected == actual
    results.append(ok)
    print(f"{'PASS' if ok else 'FAIL'}  {label}\n      expected {expected!r}\n      actual   {actual!r}")


def call(headers):
    req = urllib.request.Request(FN, data=b"{}", method="POST", headers={"Content-Type": "application/json", **headers})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b"{}")


def sent():
    with urllib.request.urlopen(GW + "/__sent", timeout=10) as r:
        return json.loads(r.read())


def sql(q):
    return subprocess.run(PSQL + ["-c", q], check=True, capture_output=True, text=True).stdout.strip()


def levels():
    return sql("SELECT string_agg(name || '=' || escalation_level || CASE WHEN escalated_at IS NULL THEN '' ELSE '*' END, ' ' ORDER BY name) FROM public.leads")


SUMMARY_KEYS = ("ok", "tenants", "escalated", "failed", "skipped_no_method", "skipped_no_tier")
pick = lambda body: {k: body.get(k) for k in SUMMARY_KEYS}
START = levels()

# 1. Only the service role or the cron secret may start a sweep.
status, _ = call({})
check("no credential: refused with 401", 401, status)
status, _ = call({"x-cron-secret": "wrong-secret"})
check("wrong cron secret: refused with 401", 401, status)
status, _ = call({"Authorization": "Bearer not-the-service-key"})
check("wrong bearer: refused with 401", 401, status)
check("refused calls sent nothing", 0, len(sent()))
check("refused calls changed no lead", START, levels())

# 2. First sweep.
status, body = call({"Authorization": f"Bearer {KEY}"})
check("first sweep: status", 200, status)
check("first sweep: summary (4 dealerships enabled; 4 escalations accepted; 1 refused; 1 skipped for no email method; 1 for no valid destination)",
      {"ok": True, "tenants": 4, "escalated": 4, "failed": 1, "skipped_no_method": 1, "skipped_no_tier": 1}, pick(body))
mail = sent()
check("first sweep: five send requests, all with the service bearer", (5, True), (len(mail), all(m["authorized"] for m in mail)))
check("first sweep: recipients (BDC for la and lb, manager for lb and lc, refused BDC for lr)",
      sorted(["bdc@escalating.example.test", "bdc@escalating.example.test", "manager@escalating.example.test",
              "manager@escalating.example.test", "refuse-bdc@refused.example.test"]),
      sorted(m["to"] for m in mail))
check("first sweep: lead levels (accepted advance and stamp escalated_at; refused, answered, contacted, unrouted, too recent, and other dealerships do not)",
      "la=1* lb=2* lc=2* ld=2 le=0 lf=0 lg=0 lh=0 ln=0 lo=0 lr=0 lt=0 lu=0", levels())
check("first sweep: audit rows by action and dealership",
      "customer_passport_escalated|e0000000-0000-4000-8000-000000000001|4 customer_passport_escalation_failed|e0000000-0000-4000-8000-000000000002|1",
      sql("SELECT string_agg(action || '|' || store_id || '|' || n, ' ' ORDER BY action) FROM (SELECT action, store_id, count(*) n FROM public.audit_log GROUP BY 1, 2) q"))
check("first sweep: audit details carry tier, timing and outcome, never an address, phone, name or VIN",
      "0", sql("SELECT count(*) FROM public.audit_log WHERE details::text ~ '@|555-0100|EXAMPLEVIN|\"l[a-z]\"'"))
check("first sweep: failed audit row records the sender's refusal",
      "BDC desk|failed|500|email", sql("SELECT concat_ws('|', details->>'to', details->>'outcome', details->>'http_status', details->>'method') FROM public.audit_log WHERE action = 'customer_passport_escalation_failed'"))
check("first sweep: audit hash chain is intact per dealership",
      "0", sql("SELECT count(*) FROM (SELECT row_hash, prev_hash, lag(row_hash) OVER (PARTITION BY store_id ORDER BY created_at, id) AS expected_prev FROM public.audit_log) q WHERE prev_hash IS DISTINCT FROM expected_prev OR row_hash IS NULL"))
check("first sweep: no lead outside the escalation columns changed (status, answer, routing, tenant)",
      "13", sql("SELECT count(*) FROM public.leads WHERE (status = 'contacted') = (name = 'lf') AND (first_response_at IS NOT NULL) = (name = 'le') AND (routing IS NULL) = (name = 'lg') AND tenant_id IS NOT NULL"))

# 3. An immediate second sweep retries only the refused lead.
status, body = call({"Authorization": f"Bearer {KEY}"})
check("second sweep: only the refused lead is tried again",
      {"ok": True, "tenants": 4, "escalated": 0, "failed": 1, "skipped_no_method": 1, "skipped_no_tier": 1}, pick(body))
check("second sweep: one more send request, to the refused address", ["refuse-bdc@refused.example.test"], [m["to"] for m in sent()[5:]])
check("second sweep: levels unchanged", "la=1* lb=2* lc=2* ld=2 le=0 lf=0 lg=0 lh=0 ln=0 lo=0 lr=0 lt=0 lu=0", levels())

# 4. Once the sender accepts, the refused lead advances; the cron secret also starts a sweep.
urllib.request.urlopen(GW + "/__accept_all", timeout=10).read()
status, body = call({"x-cron-secret": CRON})
check("third sweep (cron secret): the previously refused lead is accepted",
      {"ok": True, "tenants": 4, "escalated": 1, "failed": 0, "skipped_no_method": 1, "skipped_no_tier": 1}, pick(body))
check("third sweep: levels", "la=1* lb=2* lc=2* ld=2 le=0 lf=0 lg=0 lh=0 ln=0 lo=0 lr=1* lt=0 lu=0", levels())
check("totals: 7 send requests, 7 audit rows (5 + 1 retry failure + 1 retry success)", (7, "7"), (len(sent()), sql("SELECT count(*) FROM public.audit_log")))
check("the email body names the tier and the unanswered time and escapes lead text",
      True, all("Unanswered lead" in m["html"] and ("BDC desk" in m["html"] or "Sales manager" in m["html"]) for m in sent()))

failed = results.count(False)
print(f"\n{len(results)} checks, {failed} failed")
sys.exit(1 if failed else 0)
