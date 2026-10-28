# PRODUCTION_DATA_HEALTH_REPORT

Master build section 40. Read-only SQL against the production project on
2026-10-27 (evening, UTC). Counts and dates only; no VIN, slug, tenant,
rooftop or domain appears here by rule. The single live dealer tenant is the
population for every figure below.

Context for reading the numbers: the MarketCheck monthly quota has been
exhausted since 2026-10-04 (second month running), so the syndication feed,
enrichment and every paid capability have been refused for 23 days. The
nightly enrich sweep was paused by cron on 2026-10-27; the feed sync cron is
still active and records its refusals honestly. The dealer website has
blocked direct fetches since 2026-10-11 and challenges the renderer, so the
website sale price is captured only when a render slot is granted.

## 1. Coverage per listing

Population: active listings.

| Measure | Count | Note |
|---|---|---|
| Active listings | 131 | 80 new, 51 used or CPO |
| NeoVIN build sheet present | 131 | 0 generic (non-VIN-specific) sheets |
| Fee basis recorded (`fee_basis`) | 0 | the fee normaliser is written; no writer has run under quota |
| MDS present | 38 | all from the pre-quota cohort runs |
| Sales statistics present | 104 | last checked 2026-10-03 08:10 UTC |
| VIN history present | 130 | last checked 2026-10-03 08:10 UTC |
| Comparables present | 130 | pre-quota |
| Recall status: open recalls | 37 | VIN-level |
| Recall status: clear | 3 | VIN-level |
| Recall status: not yet answered | 91 | recall check attempted on 100 listings; 91 carry no stored state |
| Title verification present | 0 | NMVTIS is not purchased; no pull has ever run |
| Market Value present | 94 | `market_checked_at` newest 2026-09-11 |
| Price verified within 7 days | 128 | see open question 2 |
| Price verified older or never | 3 | |
| Enriched within 24 hours | 93 | see open question 1 |
| Enriched older than 30 days or never | 36 | |
| Black Book value present | 0 | no subscription |
| EPA economy present | 128 | |
| In-service date present | 130 | |
| Website price term captured | 117 | |
| Advertised price before doc fee | 129 | |

## 2. Provider and pipeline state

| Measure | Value |
|---|---|
| Last successful feed sync | 2026-10-03 03:07:05 UTC |
| Units the last successful run recorded | 50 found, 50 seen (an earlier report cites 128 units; see open question 3) |
| Feed runs failed this month | 1 (`provider_refused_429`, the manual run on 2026-10-27 22:06 UTC) |
| Feed runs recorded as skipped today | 5 |
| Cron `enrich-sweep-nightly` | inactive (paused 2026-10-27) |
| Cron `marketcheck-sync` | active |
| Provider call events this month | 40 (39 `refused_quota`, 1 `no_result`) |
| Events by product | inventory_search 18, market_days_supply 9, recent_inventory 6, sales_stats 3, vin_history 3, auto_recalls 1 |
| Call budget row (`marketcheck`) | cap 5000, reserve 250, enabled |
| USD prediction budget rows | 1 row, 0 enabled |
| Valuation reservations this month | none |
| NeoVIN snapshots stored (all time) | 393 |
| Title report pulls (all time) | 0 |
| Market cohort snapshots | 0 |
| Legacy pricing payloads preserved by the `mc_raw` repair | 81 |
| Website advertised prices captured, last 7 days | 24 |
| Feed advertised price, newest | 2026-10-03 03:07:59 UTC |

Crawl attempts, last 7 days:

| Outcome | Count |
|---|---|
| captured | 24 |
| blocked_no_render_budget | 14 |
| vin_mismatch | 13 |
| price_rejected | 3 |

## 3. Payload-shape drift

Table `provider_payload_shapes` (columns: provider, endpoint, shape hash,
key names, dependency types, findings, parse_failed, observations, first and
last seen).

| Measure | Value |
|---|---|
| Shape rows (all time) | 235 |
| Shape rows seen in the last 30 days | 45 |
| Distinct endpoints seen in the last 30 days | 43 |
| Rows with `parse_failed` | 1 |
| Rows with findings | 0 |
| Newest observation | 2026-10-03 03:15 UTC |

There is no boolean "drift" column; drift is read as a new shape hash on a
known endpoint. No new hash has been recorded since the quota closed, which
is expected: nothing has answered.

## 4. Exceptions queue

Open or in-progress `vehicle_exceptions`: 1019.

| Type | Count |
|---|---|
| removed_from_feed | 296 |
| new_vehicle | 257 |
| artifact_autogen_failed | 236 |
| price_change | 194 |
| relisted | 16 |
| missing_required_field | 12 |
| certification_change | 4 |
| mileage_change | 2 |
| stock_number_change | 2 |

The 296 removed-from-feed and 257 new-vehicle rows are the two sides of the
same event: a feed answer that returned a 50-unit page where the store has
131 units, followed by refusals. They should be reviewed together once the
feed answers again, not actioned one by one.

## 5. What the numbers say

- Build-sheet coverage is complete and VIN-specific, so identity and
  equipment are not blockers for Vehicle Intelligence.
- Every market figure in the store is at least 24 days old (MDS, sales
  stats, history, comparables) and Market Value is at least 46 days old.
  Under the contracts' freshness rules all of it reads as stale, and the
  shadow pipelines will say so rather than publish it.
- Fee basis, title verification, Black Book and cohort snapshots are at
  zero because their writers have never run, not because they failed.
- Recall state is unknown for 91 of 131 listings. The retry-cursor
  migration applied on 2026-10-27 lets those re-check when the quota
  reopens; the cost is bounded by the budget reserve.
- The website crawl captures a price on roughly half of its attempts when
  a render slot is available; the rest are the host's challenge page.

## 6. Open questions for the owner or the next read

1. 93 listings carry an `enriched_at` inside the last 24 hours while every
   provider call that day was refused. Either the stamp is written on the
   attempt rather than on an answer, or it is written by the skip path. The
   writer must be read before "enriched within 24 h" is trusted as a
   freshness signal.
2. 128 listings carry a price verification inside 7 days while the feed has
   been refused since 2026-10-04 and the website produced 24 captures. The
   same question: which writer stamps it, and on what evidence.
3. The last successful sync row records 50 units found and 50 seen; an
   earlier report cites 128 units. Either the row records the page size or
   the store had shrunk on that pull. Compare with the next successful run.
4. No provider answers will arrive before 2026-11-01 or a plan change; the
   figures above cannot improve by code alone before then.

## 7. Section 41 completion gate, as of this read

| Gate item | State |
|---|---|
| Honest refusal classification and run rows | done |
| Budget gate in front of every paid call | done, enabled |
| Raw provider payload boundary (`mc_raw`) | done, 81 payloads preserved |
| Fee basis written per listing | writer ready, 0 rows until quota |
| Recall state known for every listing | 40 of 131 |
| Title verification | not purchased |
| Market figures within TTL | 0 of 131 |
| Website sale price captured within 7 days | 24 captures |

Nothing in sections 2 to 7 goes public while the stale rows above are the
only market evidence; the shadow and canary steps in ROLLOUT_AND_ROLLBACK.md
start when the feed answers again.
