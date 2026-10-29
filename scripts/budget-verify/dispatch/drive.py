"""Drives provider-budget-alerts against the local stack started by run.sh.
Alerts are queued the real way, by calling provider_call_admit for synthetic
dealerships with budgets, then delivered under each switch setting: both off,
email only, text only, both, a failing channel and its retry, the retry limit,
who may call, and the test message. Exits non-zero if any check fails."""

import json
import os
import subprocess
import sys
import urllib.error
import urllib.request

FN = os.environ["FN_URL"]
GW = os.environ["GATEWAY_URL"]
KEY = os.environ["SERVICE_KEY"]
PSQL = ["psql", "-X", "-qtA", "-U", os.environ.get("PGUSER", "postgres"), "-d", os.environ["DB"]]
results = []


def check(label, expected, actual):
    ok = expected == actual
    results.append(ok)
    print(f"{'PASS' if ok else 'FAIL'}  {label}\n      expected {expected!r}\n      actual   {actual!r}")


def sql(q):
    r = subprocess.run(PSQL + ["-c", q], capture_output=True, text=True)
    if r.returncode:
        raise SystemExit(r.stderr)
    return r.stdout.strip()


def gw(path):
    with urllib.request.urlopen(GW + path, timeout=10) as r:
        b = r.read()
        return json.loads(b) if b[:1] in (b"[", b"{") else b.decode()


def call(body=None, token=KEY):
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(FN, data=json.dumps(body or {}).encode(), method="POST", headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b"{}")


def settings(email, sms, emails, phones):
    arr = lambda xs: "'{" + ",".join(xs) + "}'"
    sql(f"UPDATE public.platform_alert_settings SET email_enabled = {email}, sms_enabled = {sms}, email_recipients = {arr(emails)}, sms_recipients = {arr(phones)}")


def tenant(letter, name):
    tid = f"b0000000-0000-4000-8000-00000000001{letter}"
    sql(f"INSERT INTO public.tenants (id, name, slug) VALUES ('{tid}', '{name}', 'bvd-{letter}')")
    sql(f"INSERT INTO public.provider_tenant_budgets (tenant_id, provider, mode, monthly_call_cap, alert_thresholds) VALUES ('{tid}', 'firecrawl', 'enforce', 2, '{{50,100}}')")
    for _ in range(3):
        sql(f"SELECT admitted FROM public.provider_call_admit('firecrawl', 'scrape', 'crawl-advertised-prices', false, '{tid}', NULL, NULL)")
    return tid


def alerts(tid):
    return sql(f"SELECT string_agg(concat_ws('|', kind, threshold, coalesce(email_status, '-'), coalesce(sms_status, '-'), attempts, delivered_at IS NOT NULL), ' ; ' ORDER BY kind, threshold) FROM public.provider_budget_alerts WHERE tenant_id = '{tid}'")


def count(sent, channel):
    return len([s for s in sent if s["channel"] == channel])


EMAIL = ["ops@example.test"]
PHONES = ["+15550100001", "+15550100002"]

print("== Both channels off")
settings("false", "false", [], [])
a = tenant("a", "Synthetic Quiet Motors")
st, body = call()
sent = gw("/__sent")
check("off: alerts are queued at 50%, 100% and on the first refusal", "call_denied|0|threshold|50|threshold|100",
      sql(f"SELECT string_agg(kind || '|' || threshold, '|' ORDER BY kind, threshold) FROM public.provider_budget_alerts WHERE tenant_id = '{a}'"))
check("off: nothing is sent", 0, len(sent))
check("off: each alert is settled as off on both channels", "call_denied|0|disabled|disabled|0|t ; threshold|50|disabled|disabled|0|t ; threshold|100|disabled|disabled|0|t", alerts(a))

print("\n== Email only")
settings("true", "false", EMAIL, PHONES)
b = tenant("b", "Synthetic Email Motors")
st, body = call()
sent = gw("/__sent")
check("email only: one email per alert, no text messages", (3, 0), (count(sent, "email"), count(sent, "sms")))
check("email only: sent to the saved address", [EMAIL] * 3, [s["to"] for s in sent])
check("email only: text recorded as off", "call_denied|0|sent|disabled|1|t ; threshold|50|sent|disabled|1|t ; threshold|100|sent|disabled|1|t", alerts(b))
subjects = sorted(s["subject"] for s in sent)
check("email only: subjects name the dealership, provider and level", [
    "AutoLabels budget alert - Synthetic Email Motors: firecrawl budget at 100%",
    "AutoLabels budget alert - Synthetic Email Motors: firecrawl budget at 50%",
    "AutoLabels budget alert - Synthetic Email Motors: firecrawl budget reached, calls are being refused",
], subjects)
check("email only: the message carries no dealership id", False, any(b in (s.get("html") or "") for s in sent))

print("\n== Text message only")
settings("false", "true", EMAIL, PHONES)
c = tenant("c", "Synthetic Text Motors")
st, body = call()
sent = gw("/__sent")
check("text only: one text per alert to each saved number, no email", (0, 6), (count(sent, "email"), count(sent, "sms")))
check("text only: both numbers receive every alert", {p: 3 for p in PHONES}, {p: len([s for s in sent if s["to"] == p]) for p in PHONES})
check("text only: the text links to the budgets screen", True, all("/platform-admin?tab=budgets" in s["body"] for s in sent))
check("text only: email recorded as off", "call_denied|0|disabled|sent|1|t ; threshold|50|disabled|sent|1|t ; threshold|100|disabled|sent|1|t", alerts(c))

print("\n== Both at the same time, with the text channel failing once")
settings("true", "true", EMAIL, PHONES)
gw("/__fail?ch=sms")
d = tenant("d", "Synthetic Both Motors")
st, body = call()
sent = gw("/__sent")
check("both: email and text attempted together", (3, 6), (count(sent, "email"), count(sent, "sms")))
check("both: email sent, text failed, alert kept for a retry", "call_denied|0|sent|failed|1|f ; threshold|50|sent|failed|1|f ; threshold|100|sent|failed|1|f", alerts(d))
gw("/__fail?ch=")
st, body = call()
sent = gw("/__sent")
check("retry: only the failed text is sent again; the email is not repeated", (0, 6), (count(sent, "email"), count(sent, "sms")))
check("retry: delivered", "call_denied|0|sent|sent|2|t ; threshold|50|sent|sent|2|t ; threshold|100|sent|sent|2|t", alerts(d))

print("\n== A channel that keeps failing")
settings("true", "false", EMAIL, [])
gw("/__fail?ch=email")
e = tenant("e", "Synthetic Failing Motors")
for _ in range(6):
    call()
sent = gw("/__sent")
gw("/__fail?ch=")
check("retry limit: five attempts per alert, then it stops", 15, count(sent, "email"))
check("retry limit: settled as failed after five attempts", "call_denied|0|failed|disabled|5|t ; threshold|50|failed|disabled|5|t ; threshold|100|failed|disabled|5|t", alerts(e))

print("\n== Who may call it")
check("auth: no session is refused", 401, call(token=None)[0])
check("auth: a dealer user is refused", 403, call(token="session-dealer-user")[0])
check("auth: a dealer user cannot send a test", 403, call({"action": "test"}, token="session-dealer-user")[0])
check("auth: a platform admin may run delivery", 200, call(token="session-platform-admin")[0])
check("auth: the cron (service role) cannot send a test", 403, call({"action": "test"})[0])

print("\n== Test message")
settings("true", "true", EMAIL, PHONES)
gw("/__sent")
st, body = call({"action": "test", "email": True, "sms": True}, token="session-platform-admin")
sent = gw("/__sent")
check("test: sent on both channels to the saved recipients", (200, {"email": "sent", "sms": "sent"}, 1, 2), (st, body.get("result"), count(sent, "email"), count(sent, "sms")))
st, body = call({"action": "test", "email": False, "sms": True}, token="session-platform-admin")
sent = gw("/__sent")
check("test: text only when email is switched off for the test", (0, 2), (count(sent, "email"), count(sent, "sms")))
check("test: each test is audited with the admin who sent it", "2|b1000000-0000-4000-8000-000000000001",
      sql("SELECT count(*) || '|' || min(user_id::text) FROM public.audit_log WHERE action = 'platform_alert_test_sent'"))
check("test: a test writes no alert rows", "15", sql("SELECT count(*) FROM public.provider_budget_alerts"))

failed = results.count(False)
print(f"\n{len(results)} checks, {failed} failed")
sys.exit(1 if failed else 0)
