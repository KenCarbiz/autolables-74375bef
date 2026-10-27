# PROVIDER_COST_AND_CACHE_REPORT

What MarketCheck is being asked for, how often, what it costs at the list
prices in `mcCost.ts`, and what the registry defaults spend instead. Revised
2026-10-27 for the owner's change order, which moved Market Days Supply and
Inferred Sales Stats from 0.006 to 0.002, Past Inventory Search (recents)
from 0.006 to 0.0025, and priced MarketMatch (0.35), auction (0.008), FSBO
(0.01), VINData generate (0.49) and Available Options Packages (0.002). None
of these is a negotiated price, none is hardcoded in business logic: every
consumer resolves cost through `effectiveCost(key, overrides)` and every
envelope records which source the figure came from.

Live counts from production, 2026-10-27, before the cursor migration was
applied that evening.

## 1. Where the calls come from

| Caller | Cadence observed | Calls per visit (max) | Unit cost (2026-10-27 list) | Metered? |
|---|---|---|---|---|
| marketcheck-sync, nightly syndication | once a night at 03:07; refused every night since Oct 4 | 1 page per 1,500 rows + rooftop re-validation | $1.00 | yes (`callMeter`) |
| marketcheck-sync, hourly ticks | 23 skips a day; no provider call | 0 | - | - |
| vehicle-enrich via enrich-sweep | 2 full passes a day over 164 VINs (131 active + 33 archived) until the cursor fix; at most 1 pass per active vehicle per 20 h after it | search ladder 1-5, rank 2, trim 1, MDS 1-3, recents 2, sales 1, history 1, recall 1: 10-16 | search 0.002; MDS 0.002; sales 0.002; recents 0.0025; history 0.006; recall 0.07 | no |
| marketcheck-specs via enrich-sweep and specs-backfill | only when `shouldDecodeVin`; nothing to decode since Oct 3 | 1-4 | 0.08 / 0.0015 | no |
| marketcheck-comps (public route) | on a 12 h cache miss per slug | 1-2 | 0.002 | no |
| market-valuation-write | reservation under budget; disabled | 1 | 0.07 | yes (reservation ledger) |
| marketcheck-incentives | cron 03:30 into an env-gated refusal | 0 | - | - |
| marketcheck-recalls | no cron; operator | 1-4 | 0.07 | no |
| marketcheck-title-report | operator only; 0 pulls | 1 | 0.49 | yes (`title_report_pulls`) |

## 2. The sweep was the spend

Before the cursor fix: 328 visits a day. A typical visit is about 5 search
calls (0.010), 1-3 MDS (0.002-0.006), 2 recents (0.005), 1 sales (0.002) and
1 history (0.006): about $0.025-0.03 on the cheap endpoints, plus one recall
call at 0.07 if a refused call is billed.

- per day: 328 x $0.028 = about $9 on the cheap endpoints, up to $23 more if
  recalls bill; about $270-$960 a month at list
- 74 visits a day (22 percent) were archived vehicles
- every second visit repeated evidence that cannot have changed inside a day

After the cursor fix (applied 2026-10-27): at most 131 visits a day, none
archived, a 60 percent cut before any policy change.

Under the registry defaults (USED_VEHICLE_PROVIDER_POLICY.md,
NEW_VEHICLE_PROVIDER_POLICY.md) the recurring cost of a used vehicle is about
$0.09 a week and a new vehicle about $0.02 a week (daily price-integrity
search only). For the pilot lot (80 new, 51 used/CPO) that is roughly $6 a
week, against roughly $60-$220 a week that the twice-daily sweep spent.

## 3. Per-vehicle figures at the 2026-10-27 prices

| Figure | Before (2026-08-01 prices) | After (2026-10-27 prices) | Note |
|---|---|---|---|
| Used intake, NeoVIN + Base | $0.24-0.34 | $0.23-0.33 | MDS and Sales Stats cheaper; the decode and the two 0.07 calls dominate |
| Used intake, Premium Plus bundle | unknown | unknown | one authorized call decides tier price and entitlement |
| Used recurring, per week | $0.10 | $0.09 | Premium/Base refresh 0.07 dominates; MDS and Sales Stats are now noise |
| New recurring, per week | $0.02 | $0.02 | daily active-search integrity only |
| 100-vehicle rooftop, month, used mix 40 percent | about $25 recurring + intake | about $23 recurring + intake | intake is one-off per car |
| Pilot rooftop (131 active), month, policy defaults | about $30 | about $26 | plus one $1.00 syndication call a night ($30) |
| Pilot rooftop, month, as the sweep ran before Oct 27 | $270-$960 | $270-$960 | price changes do not touch the search-heavy sweep; the cursor fix does |

The lower MDS and Sales Stats prices change the economics of asking more
precisely (the exact ladder costs the same as the broad one), not of asking
more often: both TTLs stay on the provider's regeneration cadence.

## 4. What is cached, and how well

| Evidence | Cache today | Hit behaviour | Target |
|---|---|---|---|
| NeoVIN | `neovin_snapshots` + `mc_attributes.build_sheet`; `shouldDecodeVin` never rebuys a real sheet | perfect once decoded | keep; Premium Plus must reuse it, never repurchase |
| Syndication | nightly overwrite; `vehicle_value_history` snapshot only on price change | n/a | keep |
| Comparables | `comparables` overwritten per visit; `market_cohort_snapshots` exists (0 rows) but is not written by vehicle-enrich | none across siblings | write cohort snapshots; one search informs every car in the cohort |
| Public comps route | `marketcheck_comps_cache` 12 h per slug | miss = paid call from an anonymous page | serve from the cohort snapshot; never call the provider from this route |
| Prediction | `market_payload.provider_valuation` reused while the request fingerprint is unchanged and under 7 d | correct | keep; extend to Premium; generic fallback is its own fingerprint |
| VIN history | overwritten per visit when it answers | none | 30 d TTL + material event |
| MDS / Sales Stats | overwritten per visit | none | 7 d / 30 d with match_level recorded (`cohortLadder.ts`) |
| Sold Vehicles Summary | not called | n/a | monthly, with applied filters and warnings stored (`providerEnvelope.ts`) |
| Recall | 24 h skip in marketcheck-recalls; none in vehicle-enrich | partial | 30 d once entitled |
| Incentives | 24 h by design; table empty | n/a | program x market cache before re-enable |
| Available Options Packages | not called | n/a | 90 d by year/make/model/trim; never per VIN |

## 5. Observability and economics design (change order §17)

Every paid call produces a `ProviderResultEnvelope` (`src/lib/market/providerEnvelope.ts`):
provider, product, endpoint, contract version, request fingerprint, subject
VIN, market, match tier, geography, requested and applied filters, warnings,
notices, provider_generated_at, fetched_at, expires_at, cost and its source,
entitlement state, response-shape version, outcome and its economic class
(success / no_result / entitlement_failure / rate_limited / provider_failure /
request_rejected), HTTP status, sample size, and whether the provider's
applied filters diverged from the request.

The proposed store is an append-only `provider_call_events` table keyed by
tenant, VIN, capability, vehicle type and intake-vs-refresh, from which the
dashboard answers: calls, spend, useful-result rate, cache-hit rate,
duplicate-call suppression, freshness, latency, provider disagreements,
fallback and generic-fallback usage, cost per used Passport, cost per new
Passport, monthly cost per rooftop — and, per VIN, what was spent, what useful
intelligence came back, and whether it changed the Passport. Authoring that
table and wiring the writers into the edge functions is the next tranche; it
needs a migration and deploys.

## 6. Controls that exist, and the gaps that remain

- Reservation + monthly budget: prediction only. The sweep and the comps
  route spend without a reservation; the registry now states the policy and
  the callers do not consult it yet.
- Metering: syndication only. `vehicle-enrich` does not call `recordCall`;
  most calls are unmetered until the envelope writer lands.
- Cost configuration: `effectiveCost` reads overrides first; the override
  store (`dealer_profiles.settings.provider_policy.*.cost_overrides_usd`) has
  no reader yet.

## 7. What is not known

- Whether a refused (429) syndication call is billed.
- Whether a 404 on the legacy recall path is billed.
- Premium, Premium Plus and Sold Vehicles Summary unit prices on this account.
- The provider's monthly quota per product, the most likely explanation for
  the Oct 3 refusal cluster.
- The Available Options Packages and dealership-groups endpoint paths.
