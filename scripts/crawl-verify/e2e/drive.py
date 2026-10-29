"""Drives the advertised-price crawler against the local stack started by
run.sh: one run with the injected failures (a screenshot that cannot be
stored, a listing write the database refuses), then the failures removed and
a second run. Prints what each vehicle's listing, observations and ledger show,
then the checks for STAGE:

  contract   the corrected behaviour (run against the pre-fix source as a
             deliberate reproduction, and against the fixed source)
  noschema   the fixed source before its migration: nothing may change any
             listing's pricing

Exits non-zero if any check fails."""

import json
import os
import subprocess
import sys
import urllib.error
import urllib.request

FN = os.environ["FN_URL"]
GW = os.environ["GATEWAY_URL"]
KEY = os.environ["SERVICE_KEY"]
STAGE = os.environ.get("STAGE", "contract")
PSQL = ["psql", "-X", "-qtA", "-U", os.environ.get("PGUSER", "postgres"), "-d", os.environ["DB"]]
T = "c0000000-0000-4000-8000-000000000001"
D = json.load(open(os.environ["PAGES_JSON"]))
V = D["vins"]
CASES = ["card", "redirect", "setting", "conflict", "evidence", "partial", "ambiguous", "title"]
FEED = {l["key"]: l["feed_price"] for l in D["listings"]}
INITIAL = {k: f"{FEED[k] - 900}|900|{FEED[k]}" for k in CASES}

results = []


def check(label, expected, actual):
    ok = expected == actual
    results.append(ok)
    print(f"{'PASS' if ok else 'FAIL'}  {label}\n      expected {expected!r}\n      actual   {actual!r}")


def sql(q):
    return subprocess.run(PSQL + ["-c", q], capture_output=True, text=True).stdout.strip()


def gw(path):
    with urllib.request.urlopen(GW + path, timeout=10) as r:
        b = r.read()
        return json.loads(b) if b[:1] in (b"[", b"{") else b.decode()


def crawl():
    req = urllib.request.Request(FN, data=json.dumps({"tenant_id": T, "discover": False, "limit": 20}).encode(), method="POST",
                                 headers={"Content-Type": "application/json", "Authorization": f"Bearer {KEY}"})
    try:
        with urllib.request.urlopen(req, timeout=300) as r:
            return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b"{}")


def pricing(k):
    return sql(f"SELECT concat_ws('|', advertised_price_before_doc::int, doc_fee::int, website_sale_price::int) FROM public.vehicle_listings WHERE vin = '{V[k]}'")


has_obs_cols = sql("SELECT count(*) FROM information_schema.columns WHERE table_name = 'advertised_prices' AND column_name = 'observation'") == "1"


def observations(k):
    cols = "advertised_price::int, coalesce(screenshot_sha256 IS NOT NULL, false)"
    if has_obs_cols:
        cols += ", coalesce(listing_promotion, '-'), coalesce(observation #>> '{fee_basis,status}', '-'), coalesce(observation #>> '{evidence,status}', '-')"
    return sql(f"SELECT string_agg(concat_ws('|', {cols}), ' ; ' ORDER BY captured_at) FROM public.advertised_prices WHERE vin = '{V[k]}'")


def ledger(k):
    return sql(f"SELECT concat_ws(' | ', outcome, left(detail, 160)) FROM public.advertised_price_crawl_attempts WHERE vin = '{V[k]}'")


def snapshot(title):
    print(f"\n== {title}")
    for k in CASES:
        print(f"  {k:10s} listing {pricing(k):18s} observations [{observations(k) or '-'}]\n             ledger {ledger(k) or '-'}")


print(f"== Stage {STAGE}; observation columns present: {has_obs_cols}")
print("\n== Before any run (before-fee|fee|sale, as the feed left them)")
for k in CASES:
    print(f"  {k:10s} {pricing(k)}   page: {D['pages'][V[k]]['what']}")

sql(f"INSERT INTO crawl_verify.fail_listing_update VALUES ('{V['partial']}')")
gw(f"/__fail_storage?vins={V['evidence']}")
status, body = crawl()
print(f"\n== Run 1: HTTP {status}; updated {body.get('updated')} unchanged {body.get('unchanged')} skipped {body.get('skipped')} failed {body.get('failed')} listing_outcomes {body.get('listing_outcomes')}")
renders = gw("/__renders")
stored = gw("/__stored")
print(f"   renders {len(renders)}; storage writes {[(s['path'].split('/')[-2], s['status']) for s in stored]}")
snapshot("After run 1 (failures injected)")
after1 = {k: pricing(k) for k in CASES}
obs1 = {k: observations(k) for k in CASES}
ledger1 = {k: ledger(k) for k in CASES}

sql("DELETE FROM crawl_verify.fail_listing_update")
gw("/__fail_storage?vins=")
status2, body2 = crawl()
print(f"\n== Run 2: HTTP {status2}; updated {body2.get('updated')} unchanged {body2.get('unchanged')} skipped {body2.get('skipped')} failed {body2.get('failed')} listing_outcomes {body2.get('listing_outcomes')}")
gw("/__renders"); gw("/__stored")
snapshot("After run 2 (failures removed)")
after2 = {k: pricing(k) for k in CASES}
print()

if STAGE == "noschema":
    check("run 1: no listing's pricing changed before the migration", INITIAL, after1)
    check("run 2: no listing's pricing changed before the migration", INITIAL, after2)
    check("observations are still stored the old way (one per read vehicle in run 1)",
          {k: obs1[k] != "" for k in CASES},
          {k: k not in ("redirect", "ambiguous") for k in CASES})
    check("each stored observation is reported as held for the schema",
          sorted(k for k in CASES if k not in ("redirect", "ambiguous")),
          sorted(k for k in CASES if "held_schema" in ledger1[k]))
else:
    check("card: the vehicle's own price is applied, not the similar-vehicle card's",
          "29100|900|30000", after1["card"])
    check("redirect: another car's page reached through a redirect writes nothing", INITIAL["redirect"], after1["redirect"])
    check("redirect: no observation is stored from another car's page", "", obs1["redirect"])
    check("setting only: a dealer setting without page evidence never changes the listing", INITIAL["setting"], after1["setting"])
    check("setting only: the raw observation is still stored", True, obs1["setting"].startswith("25572"))
    check("conflict: page and dealer setting disagree; the listing is left alone", INITIAL["conflict"], after1["conflict"])
    check("evidence failure: the listing is unchanged while its screenshot could not be stored", INITIAL["evidence"], after1["evidence"])
    check("evidence failure: the outcome is named in the ledger", True, ledger1["evidence"].startswith("held_evidence"))
    check("partial failure: the listing is unchanged when its write is refused", INITIAL["partial"], after1["partial"])
    check("partial failure: the outcome is named in the ledger", True, ledger1["partial"].startswith("promotion_failed"))
    check("ambiguous prices: nothing is written or stored", [INITIAL["ambiguous"], ""], [after1["ambiguous"], obs1["ambiguous"]])
    check("embedded title: the page price is applied", "25100|900|26000", after1["title"])
    check("embedded title: the panel's SVG title is not recorded as the page title", False, 'title="PanelCo"' in ledger1["title"])
    check("fee basis record stored with each observation (four parts kept apart)",
          "observed,dealer,page,derived",
          sql(f"SELECT string_agg(k, ',' ORDER BY o) FROM unnest(ARRAY['observed','dealer','page','derived']) WITH ORDINALITY AS t(k, o) "
              f"WHERE EXISTS (SELECT 1 FROM public.advertised_prices WHERE vin = '{V['setting']}' AND observation->'fee_basis' ? k)") if has_obs_cols else "")
    check("every promoted price carries accepted evidence (a stored screenshot hash)",
          {"card": True, "title": True}, {k: obs1[k].split(" ; ")[0].split("|")[1] == "t" for k in ("card", "title")})
    check("run 2: the refused write is retried and applied once the database accepts it", "27100|900|28000", after2["partial"])
    check("run 2: the vehicle whose screenshot failed is applied once evidence is stored", "32100|900|33000", after2["evidence"])
    check("run 2: the dealer-setting-only vehicle is still unchanged", INITIAL["setting"], after2["setting"])
    check("no vehicle has more than one observation per run",
          True, all(int(sql(f"SELECT count(*) FROM public.advertised_prices WHERE vin = '{V[k]}'") or 0) <= 2 for k in CASES))

failed = results.count(False)
print(f"\n{len(results)} checks, {failed} failed")
sys.exit(1 if failed else 0)
