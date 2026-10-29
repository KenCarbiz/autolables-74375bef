"""Drives the marketcheck-sync function against the local stack started by
run.sh, one recorded provider scenario at a time, and checks what it wrote.
Prints one line per check and exits non-zero if any fails."""

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
T1 = "f0000000-0000-4000-8000-000000000001"
T2 = "f0000000-0000-4000-8000-000000000002"

results = []


def check(label, expected, actual):
    ok = expected == actual
    results.append(ok)
    print(f"{'PASS' if ok else 'FAIL'}  {label}\n      expected {expected!r}\n      actual   {actual!r}")


def note(label, value):
    print(f"NOTE  {label}\n      {value}")


def sql(q):
    return subprocess.run(PSQL + ["-c", q], capture_output=True, text=True, check=True).stdout.strip()


def gw(path):
    with urllib.request.urlopen(GW + path, timeout=10) as r:
        body = r.read()
        return json.loads(body) if body[:1] in (b"[", b"{") else body.decode()


def call(body, headers=None):
    h = {"Content-Type": "application/json", "Authorization": f"Bearer {KEY}"} if headers is None else headers
    req = urllib.request.Request(FN, data=json.dumps(body).encode(), method="POST", headers={"Content-Type": "application/json", **h})
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b"{}")


def listings(tenant):
    return sql(f"SELECT string_agg(right(vin, 1) || '=' || coalesce(price::int::text, '-') || ':' || status, ' ' ORDER BY vin) "
               f"FROM public.vehicle_listings WHERE tenant_id = '{tenant}'")


def checksum(tenant):
    return sql(f"SELECT md5(coalesce(string_agg(t::text, ',' ORDER BY id), '')) FROM public.vehicle_listings t WHERE tenant_id = '{tenant}'")


def counts():
    return sql("SELECT concat_ws(' ', 'runs=' || (SELECT count(*) FROM public.inventory_sync_runs), "
               "'history=' || (SELECT count(*) FROM public.vehicle_change_history), "
               "'exceptions=' || (SELECT count(*) FROM public.vehicle_exceptions), "
               "'prices=' || (SELECT count(*) FROM public.advertised_prices), "
               "'provider_events=' || (SELECT count(*) FROM public.provider_call_events))")


def last_run():
    return sql(f"SELECT concat_ws('|', status, seen, new_vehicles, updated_vehicles, prices_recorded, removed, coalesce(left(error_summary, 160), '')) "
               f"FROM public.inventory_sync_runs WHERE tenant_id = '{T1}' ORDER BY created_at DESC LIMIT 1")


bystander = checksum(T2)
gw("/__provider"); gw("/__functions")

# 0. Credentials.
status, _ = call({"tenant_id": T1, "force": True}, headers={})
check("no credential: refused", 401, status)
status, _ = call({"tenant_id": T1, "force": True}, headers={"Authorization": "Bearer not-a-real-token"})
check("unknown bearer: refused", 401, status)
check("refused calls reached no provider endpoint", [], gw("/__provider"))
before = listings(T1)
check("inventory before the first run", "1=20000:published 2=40000:published 3=15000:published", before)

# 1. Clean recorded feed: one price change, one unchanged, one missing, one new.
gw("/__scenario?name=clean")
status, body = call({"tenant_id": T1, "force": True})
check("clean feed: status", 200, status)
note("clean feed: response", json.dumps(body)[:600])
reqs = gw("/__provider")
check("clean feed: provider requests by path", ["/dealerships/car", "/dealerships/inventory"], sorted({r["path"] for r in reqs}))
check("clean feed: inventory pulled through the pinned rooftop scope",
      True, any(r["path"] == "/dealerships/inventory" and r["params"].get("mc_rooftop_id") == "rt-example-1" for r in reqs))
note("clean feed: provider requests", [(r["path"], {k: v for k, v in r["params"].items() if k in ("mc_rooftop_id", "inventory_url", "rows", "start", "owned", "car_type")}) for r in reqs])
note("clean feed: provider ledger (outcome|product|caller|essential)",
     sql("SELECT string_agg(outcome || '|' || product || '|' || caller || '|' || essential, ' ; ' ORDER BY id) FROM public.provider_call_events"))
check("clean feed: every provider request is in the call ledger, the dealership lookup included",
      len(reqs), int(sql("SELECT count(*) FROM public.provider_call_events WHERE outcome <> 'budget_denied'")))
check("clean feed: the dealership lookup is ledgered as a non-essential dealer_api call",
      "1|false", sql("SELECT count(*) || '|' || bool_or(essential) FROM public.provider_call_events WHERE product = 'dealer_api'"))
after = listings(T1)
note("clean feed: inventory after", after)
check("clean feed: price change written to vehicle 1, vehicle 2 kept, vehicle 4 added as draft",
      ["1=19000:published", "2=40000:published", "4=25000:draft"],
      sorted(p for p in after.split() if p[0] in "124"))
note("clean feed: vehicle 3 (absent from the feed)", [p for p in after.split() if p[0] == "3"])
note("clean feed: run row (status|seen|new|updated|prices|removed|error)", last_run())
check("clean feed: new dealership listings and new vehicle files are reported separately (response new|files)",
      "1|3", f"{body.get('new_listings')}|{body.get('new_vehicle_files')}")
check("clean feed: the run row counts listings: 1 new, 2 updated (seen|new|updated)",
      "3|1|2", "|".join(last_run().split("|")[1:4]))
note("clean feed: change history (vin suffix|field|previous>new|origin)",
     sql("SELECT string_agg(right(vin, 1) || '|' || field_key || '|' || coalesce(previous_value, '-') || '>' || coalesce(new_value, '-') || '|' || change_origin, ' ; ' ORDER BY changed_at, field_key) FROM public.vehicle_change_history"))
note("clean feed: vehicle 1 price fields (price|before_doc|doc_fee|website_sale|parse_status)",
     sql("SELECT concat_ws('|', price, advertised_price_before_doc, doc_fee, website_sale_price, price_parse_status) FROM public.vehicle_listings WHERE vin = '1EXMP0005S9000001'"))
note("clean feed: downstream functions the sync invoked (stubbed, nothing ran)", sorted({f["fn"] for f in gw("/__functions")}))
check("clean feed: the other dealership's inventory is unchanged", bystander, checksum(T2))
after_clean = checksum(T1)
c1 = counts()
note("clean feed: row counts", c1)

# 2. Contaminated feed: another rooftop's car inside the pinned scope.
gw("/__scenario?name=contaminated")
status, body = call({"tenant_id": T1, "force": True})
check("contaminated feed: status", 200, status)
note("contaminated feed: response", json.dumps(body)[:600])
gw("/__provider"); gw("/__functions")
check("contaminated feed: inventory unchanged (nothing written from a feed that fails the rooftop check)", after_clean, checksum(T1))
check("contaminated feed: the foreign vehicle was not created", "0", sql("SELECT count(*) FROM public.vehicle_listings WHERE vin = '1EXMP0002S9000005'"))
check("contaminated feed: run recorded as failed", "failed", last_run().split("|")[0])
note("contaminated feed: run row", last_run())

# 3. Provider refuses (HTTP 429 on every request).
gw("/__scenario?name=refused")
status, body = call({"tenant_id": T1, "force": True})
check("refused feed: status", 200, status)
note("refused feed: response", json.dumps(body)[:400])
reqs = gw("/__provider"); gw("/__functions")
note("refused feed: provider requests (the client retries a refused request twice)", [(r["path"], r["status"]) for r in reqs])
check("refused feed: inventory unchanged", after_clean, checksum(T1))
check("refused feed: run recorded as failed", "failed", last_run().split("|")[0])
note("refused feed: run row", last_run())

# 4. Monthly budget exhausted before the run.
sql("UPDATE public.provider_call_budgets SET monthly_call_cap = 0 WHERE provider = 'marketcheck'")
gw("/__scenario?name=clean")
status, body = call({"tenant_id": T1, "force": True})
check("budget exhausted: status", 200, status)
note("budget exhausted: response", json.dumps(body)[:400])
reqs = gw("/__provider"); gw("/__functions")
check("budget exhausted: no inventory request reached the provider", [], [r["path"] for r in reqs if r["path"] == "/dealerships/inventory"])
check("budget exhausted: no request of any kind reached the provider (the dealership lookup included)", [], [r["path"] for r in reqs])
check("budget exhausted: inventory unchanged", after_clean, checksum(T1))
note("budget exhausted: ledger refusals", sql("SELECT count(*) FROM public.provider_call_events WHERE outcome = 'budget_denied'"))
note("budget exhausted: run row", last_run())
check("budget exhausted: reported as our own budget refusal, not the provider's 429",
      ["budget_refused", False], [body.get("diagnostics", [{}])[0].get("kind"), "429" in last_run()])
check("throughout: the other dealership's inventory is unchanged", bystander, checksum(T2))

failed = results.count(False)
print(f"\n{len(results)} checks, {failed} failed")
sys.exit(1 if failed else 0)
