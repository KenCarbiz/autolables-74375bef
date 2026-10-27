# PROVIDER_COST_AND_CACHE_REPORT

What MarketCheck is being asked for today, how often, what it costs at the
2026-08-01 public list (`mcCost.ts`; an operator estimate, never a bill), and
what the registry defaults would spend instead. Live counts from production,
2026-10-27. No figure below is a negotiated price.

## 1. Where the calls come from today

| Caller | Cadence observed | Calls per visit (max) | Unit cost | Metered? |
|---|---|---|---|---|
| marketcheck-sync, nightly syndication | once a night at 03:07; refused every night since Oct 4 | 1 page per 1,500 rows + rooftop re-validation | $1.00 | yes (`callMeter`) |
| marketcheck-sync, hourly ticks | 23 skips a day; no provider call | 0 | - | - |
| vehicle-enrich via enrich-sweep | 2 full passes a day over 164 VINs (131 active + 33 archived); 328 visits a day for 12 straight days | search ladder 1-5, rank 2, trim 1, MDS 1-3, recents 2, sales 1, history 1, recall 1: 10-16 | search 0.002; history, MDS, recents, sales 0.006; recall 0.07 | no |
| marketcheck-specs via enrich-sweep and specs-backfill | only when `shouldDecodeVin`; nothing to decode since Oct 3 | 1-4 | 0.08 / 0.0015 | no |
| marketcheck-comps (public route) | on a 12 h cache miss per slug | 1-2 | 0.002 | no |
| market-valuation-write | reservation under budget; disabled | 1 | 0.07 | yes (reservation ledger) |
| marketcheck-incentives | cron 03:30 into an env-gated refusal | 0 | - | - |
| marketcheck-recalls | no cron; operator | 1-4 | 0.07 | no |
| marketcheck-title-report | operator only; 0 pulls | 1 | 0.49 | yes (`title_report_pulls`) |

## 2. The sweep is the spend

328 visits a day. Taking the typical visit as about 8 cheap calls (search
ladder settling on tier 1 or 2, two rank calls, one trim count, one MDS, two
sold-stats calls, one history) plus one recall call:

- cheap endpoints: about 8 x $0.003 average = $0.025 a visit
- recall: $0.07 a visit if the refused call is billed; unknown
- per day: 328 x $0.025 = about $8 on the cheap endpoints, up to $23 more if
  recalls bill; about $250-$950 a month at list

Of that, 74 visits a day are archived vehicles (about 22 percent), and every
visit after the first each day repeats evidence that cannot have changed
(history and sold statistics are refused; MDS and comparables move daily at
most).

The authored cursor (`20261027200000_enrich_batch_once_per_day_active_only.sql`)
makes it at most one visit per active vehicle per 20 hours: 131 visits a day,
a 60 percent cut before any policy change, and no spend on archived cars.

Under the registry defaults (USED_VEHICLE_PROVIDER_POLICY.md) the recurring
cost of a used vehicle is about $0.10 a week; a new vehicle about $0.02 a
week (daily price-integrity search only). For the pilot lot (80 new, 51
used/CPO) that is roughly $7 a week, against roughly $60-$220 a week today.

## 3. What is cached, and how well

| Evidence | Cache today | Hit behaviour | Target |
|---|---|---|---|
| NeoVIN | `neovin_snapshots` + `mc_attributes.build_sheet`; `shouldDecodeVin` never rebuys a real sheet | perfect once decoded | keep |
| Syndication | nightly overwrite; `vehicle_value_history` snapshot only on price change | n/a | keep |
| Comparables | `comparables` overwritten per visit; `market_cohort_snapshots` exists (0 rows) but is not written by vehicle-enrich | none across siblings | write cohort snapshots; one search informs every car in the cohort |
| Public comps route | `marketcheck_comps_cache` 12 h per slug | miss = paid call from an anonymous page | serve from the cohort snapshot; never call the provider from this route |
| Prediction | `market_payload.provider_valuation` reused while the request fingerprint is unchanged and under 7 d | correct | keep; extend to Premium |
| VIN history | overwritten per visit when it answers | none | 30 d TTL + material event |
| MDS / sold stats | overwritten per visit | none | 7 d / 30 d |
| Recall | 24 h skip in marketcheck-recalls; none in vehicle-enrich | partial | 30 d once entitled |
| Incentives | 24 h by design; table empty | n/a | program x market cache before re-enable |

## 4. Controls that exist, and the gaps this tranche leaves

- Reservation + monthly budget: prediction only. Gap: the sweep and the comps
  route spend without a reservation. The registry now states the policy; the
  callers do not consult it yet.
- Metering: syndication only. Gap: vehicle-enrich does not call `recordCall`;
  80 percent of calls are unmetered. Cheapest fix: wrap `mcFetch` in
  vehicle-enrich with the meter and write the run's `estimateCost` to
  `audit_log` as the sync already does.
- Observability (§23): no per-call row anywhere. The `provider_request_reservations`
  table is the right shape for one; extending it to every paid call is the
  next tranche's first item.
- Cost configuration: `mcCost.ts` literals are now read through
  `effectiveCost(key, overrides)`; the overrides have no storage yet
  (proposed `dealer_profiles.settings.provider_policy.*.cost_overrides_usd`).

## 5. What is not known

- Whether a refused (429) syndication call is billed.
- Whether a 404 on the legacy recall path is billed.
- Premium and Premium Plus unit prices on this account.
- The provider's monthly quota per product, which is the most likely
  explanation for the Oct 3 refusal cluster.
