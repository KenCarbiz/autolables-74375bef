# CURRENT_STATE_AUDIT — MarketCheck API V3 / Vehicle Intelligence foundation

Audit date: 2026-10-27. Source: `main` at `621466b`. Production facts: read-only
SQL against the shared Supabase project at 20:00Z. No provider call, no flag
change, no migration, no deploy was made to produce this document.

Controlling prompt: handoff package v3.1 (2026-10-21),
`01_CLAUDE_MASTER_BUILD_PROMPT.md` §3. Classification vocabulary is the
prompt's: KEEP / MODIFY / RETIRE / REPLACE / ADD / ENTITLEMENT-BLOCKED /
AUTOCURB-RESERVED.

## 0. Executive summary

1. The integration is broad (14 MarketCheck paths across 9 functions) and
   mostly well-guarded, but three live defects are costing money or hiding
   failure right now, and all three are in code this repo owns:
   - **The syndication feed has not succeeded since 2026-10-03.** Every
     nightly 03:07 run since then has been refused by the provider (HTTP 429
     on `/v2/dealerships/inventory`) and `marketcheck-sync` reports the
     refusal as `pinned_scope_failed_validation` ("no longer matches
     <street>"), writes no `inventory_sync_runs` row, and the hourly runs
     skip. Prune protection held (inventory untouched), but the operator
     surface says the rooftop pin broke when the provider said no. 24 nights.
     Cause, confirmed on the evening of 2026-10-27 from the portal's usage
     alerts and the run history: the account's plan quota is 5,000 calls a
     month, account-wide, and it resets on the 1st. It was exhausted on
     Jul 29 (feed refused Jul 29-31, back Aug 1), Sep 11 (no run rows Sep
     12-30, back Oct 1) and Oct 4 (refused since). Search and MDS keep
     answering past 100%, so the cap is enforced per product. The key is
     not the problem; the enrich sweep's call volume is.
   - **VIN history and sold-stats stopped the same day.** `history_payload`
     and `market_meta.sold_stats` were last refreshed 2026-10-03; zero
     refreshes in the last 7 days. `/v2/search/car/active` still answers
     (165 listings refreshed today), so the account key is live and the
     refusals are product-scoped.
   - **The enrich sweep re-enriches the whole lot twice a day.** 328
     `vehicle_value_history` rows per day = 164 VINs x 2 passes, every day
     for the last 12 days, including 33 archived vehicles. Cause:
     `next_enrich_batch` treats `market_value IS NULL` as "incomplete", and
     `market_value` is now owned by `market-valuation-write` under a flag
     that is OFF, so every vehicle is incomplete forever; the cron (03:15)
     and the sync kick (08:00) each start a full chain. At public list
     prices this is roughly $30 a day of the cheap endpoints.
2. `mc_raw` has two meanings: 247 rows hold the syndication listing, 81 hold
   a retired market-pricing payload (`belowMarket`, `marketValue`, `low`,
   `high`, `rawProvider`). §6 of the prompt calls this out and it is
   confirmed.
3. NeoVIN is fully captured (393 snapshots, 63 top-level keys) and under-read:
   `warranty`, `installed_options_msrp`, five MSRP variants, dimensions and
   weight, `country`, the five `*_confidence` fields, `electric_range` are
   stored in `neovin_snapshots` and read by nothing.
4. The feed's own fee evidence (`fees` on 139 rows, `price_includes_fees` on
   115) is kept verbatim and read nowhere; the price basis still comes from
   one tenant-level setting.
5. Black Book has never been configured (env unset; `not_configured` on every
   call; 0/331 rows). It is a credential question, not a code defect.
6. Current-contract verification cannot be done from this environment: the
   sandbox egress policy returns 403 for `api.marketcheck.com` and every
   `*.marketcheck.com` docs host. The handoff's 2026-10-21 reference is the
   contract baseline until the policy is opened or the OpenAPI document is
   placed in the repo.
7. Lovable added a second migration system on 2026-10-24 (`drizzle/`,
   `drizzle-kit`, `drizzle-orm`, `postgres`) with one migration that redefines
   `recalc_tenant_doc_fee`. Supabase migrations remain the system of record;
   this needs an owner decision before a second truth path forms.
8. Test baseline on `main`: 6,179 passed, 2 failed (both pre-existing,
   compliance-module tests unrelated to this program: a 30-day NHTSA clock
   assertion and a red-team blocker flag), 1 skipped.

## 1. Callers and endpoints

| Function | MarketCheck path(s) | Billing product (mcCost) | Trigger | Classification |
|---|---|---|---|---|
| marketcheck-sync | `/v2/dealerships/inventory` (pinned rooftop, owned=true); `/v2/dealerships/car`, `/v2/dealers/car`, `/v2/dealer/car` (rooftop resolve); `/v2/search/car/active` (diagnostic sample) | dealer_inventory_syndication 1.00; dealer_api 0.0025; inventory_search 0.002 | cron `7 * * * *` (hourly; nightly window at run_hour 03) | KEEP; MODIFY refusal classification and run-row write (§3 finding 1) |
| marketcheck-specs | `/v2/decode/car/neovin/{vin}/specs` strict then `include_generic=true`; `/v2/decode/car/{vin}/specs`; `/v2/decode/car/{vin}` | neovin 0.08; basic_vin_decode 0.0015 | enrich-sweep and specs-backfill when `shouldDecodeVin`; admin button | KEEP; MODIFY extraction to promote unread fields (§9) |
| vehicle-enrich | `/v2/search/car/active` (comps ladder, rank x2, trim count); `/v2/history/car/{vin}`; `/v2/mds/car`; `/v2/search/car/recents`; `/v2/sales/car`; `/v2/recall/car/{vin}` | inventory_search; vin_history 0.006; market_days_supply 0.006; recent_inventory 0.006; sales_stats 0.006; auto_recalls 0.07 | enrich-sweep cursor; marketcheck-sync inline (cap 10); admin re-pull | MODIFY: cursor, MDS cohort (`vin` + `exact=true`), Sales Stats cohorts, recall path; metering |
| enrich-sweep | orchestrator of vehicle-enrich and marketcheck-specs | sum of callees, unmetered | cron `15 3 * * *`; marketcheck-sync kick; admin | MODIFY (cursor TTL, archived filter) |
| specs-backfill | orchestrator of marketcheck-specs | neovin | cron `45 3 * * *` | KEEP |
| marketcheck-comps | `/v2/search/car/active` with `stats=price` | inventory_search | public comparables route, 12 h cache per slug (`marketcheck_comps_cache`) | KEEP (public browse hits cache; the miss path is a paid call from an anonymous page and is a §21 violation to close) |
| market-valuation-write | `/v2/predict/car/us/marketcheck_price` | price_prediction 0.07 | reservation under `market_provider_budgets`; policy currently disabled | KEEP; ADD Premium / Premium Plus paths behind entitlement test |
| marketcheck-market-pricing | none (forwards to market-valuation-write) | none | legacy callers | RETIRE (already a proxy; remove once no caller remains) |
| marketcheck-recalls | `/v2/recall/car/{vin}` and three path variants; NHTSA model context | auto_recalls | single VIN, batch, sweep | REPLACE path with `/v2/car/autorecalls/{vin}`; ENTITLEMENT-BLOCKED today |
| marketcheck-incentives | `/v2/search/car/incentive/oem` | oem_incentive 0.20 | cron `30 3 * * *` fires into an env-gated refusal | KEEP gate; ADD program/market cache before any re-enable (owner decision) |
| marketcheck-title-report | `/v2/vindata/{generate,access}-report/aamva/{vin}` | unpriced in mcCost (0.49 generate) | manual, Compliance Pro, 50 per dealer per month, session-only | KEEP terms boundary; ADD exception-based used workflow (§16), owner decision on spend |
| blackbook-values | not MarketCheck | unknown | vehicle-enrich | ENTITLEMENT-BLOCKED (never configured) |
| public-listing-view | reader only | none | every Passport load | KEEP (no paid call on this path) |
| `/v2/search/car/fsbo/active`, `/v2/search/car/auction/active`, `/v2/marketmatch/*` | not called | n/a | n/a | AUTOCURB-RESERVED |
| Sold Vehicles Summary, webhooks, `/v2/search/car/incentive/{make}/{zip}`, NeoVIN batch | not called | n/a | n/a | ADD (evaluate under entitlement) |

## 2. Crons and schedules (live `cron.job`, 22 active)

Provider-relevant: `marketcheck-sync` hourly at :07 (nightly work gated to
run_hour 03 by `syncSchedule`), `enrich-sweep` 03:15, `specs-backfill` 03:45,
`marketcheck-incentives` 03:30 (refused by env gate), `crawl-advertised-prices`
07:20 (Firecrawl), `carfax-link-sweep` 04:15, `epa-fuel-economy` 04:45,
`factory-sticker-orchestrate` 08:40-08:55 (writes `vehicle_facts`). The other
13 jobs do not touch MarketCheck. No cron runs `marketcheck-recalls`,
`market-valuation-write` or `marketcheck-title-report`.

## 3. Raw and normalized destinations

| Product | Raw store | Normalized store | Readers |
|---|---|---|---|
| Syndication row | `vehicle_listings.mc_raw` (verbatim; 247 rows) and `vehicle_value_history.payload` | `vehicle_listings` columns (price, doc fee split, mileage, trim, ymm, photos, hero, source_url); `mc_attributes` (63 keys live); `vehicle_files`; `advertised_prices` (channel feed) | sticker, Passport, Vehicle File market panel (`src/lib/vehicleFile/market.ts` reads dom, dom_active, price_change_percent, ref_price, ref_price_dt, first/last/scraped stamps from `mc_raw`) |
| NeoVIN | `neovin_snapshots` (393; dedup on tenant+vin+payload_hash) | `mc_attributes.build_sheet`, lifted `base_msrp` / `delivery_charges` / `total_msrp`, `options`, `features`, spec fills; `vehicle_facts` (neovin: 1,763 rows, 306 vehicles) | sticker normalizer, truth ingest, Passport equipment |
| Active search (comps) | none (the 50-row page is discarded after mapping) | `comparables` (9 fields), `group_similar`, `market_meta` (22 keys) | Passport market modules, V2 engine via `legacyAdapter` |
| VIN history | none | `history_payload`, `in_service_date` | Passport history/warranty start date |
| MDS, recents, sales | none | `market_meta.market_days_supply`, `inventory_count`, `sold_stats`, `sold_45d_estimate` | Passport market context |
| Price prediction | `vehicle_market_valuations` (12) + `vehicle_market_comparables` (147) + `market_payload.provider_valuation` | `market_value`, `market_position`, `market_checked_at` (compat columns, flag-gated) | V2 shadow; Passport via compat columns |
| Recall (MC) | `recall_check` envelope (190) | `recall_status`, `open_recall_count`, `closed_recall_count` | compliance, Passport; all UNKNOWN at VIN scope |
| Recall (NHTSA model) | `recall_payload` (331) | none (context only, by type) | compliance context |
| Incentives | `marketcheck_vehicle_cache` (0 rows) | none | none (off) |
| VINData | none by terms; `title_report_pulls` meter (0 rows) | `vehicle_listings.title_verification` is the dealer's own attestation | admin panel, session only |
| Payload shapes | `provider_payload_shapes` (235; syndication + NeoVIN only) | `vehicle_exceptions.provider_payload_drift` | admin |

The raw-boundary defect: 81 `mc_raw` rows carry
`{belowMarket, checkedAt, high, low, listingPrice, marketValue, position, raw, rawProvider}`
written by the retired `marketcheck-market-pricing` before the single-writer
boundary. Those cars have no stored feed row.

## 4. Read paths

- Vehicle Truth: `src/lib/vehicleTruth/*` (precedence, snapshot, ingest,
  refreshPolicy, recallView). Facts written by `factory-sticker-orchestrate`
  (`truth.ts`) and `autofilm-feed`; 5,947 fact rows (dealer_confirmed 840,
  marketcheck 3,344, neovin 1,763) over 306 vehicles; latest `observed_at`
  2026-10-03. 25 snapshot fields; no market, history, title, recall or
  warranty fact keys reach a snapshot today.
- Vehicle File read model: `src/lib/vehicleFile/readModel.ts` (shadow, Gate 2)
  with sections Identity, DealerState, Pricing, PublicAdvertisement,
  MarketIntelligence, ListingLifecycle, GetReady, Documents, Compliance,
  Media, Customer, Publishing; served by `vehicle-file-read-model` (service
  role only; nothing in the product reads it yet).
- Passport: `public-listing-view` returns a governed `vehicle_listings` row;
  `usePublicListing` -> `governPublicListing` -> `publicClaim` (the one public
  market-claim decision; `no_subject_price` suppression live).
- Valuation writers: exactly one (`market-valuation-write`), enforced by
  `writerBoundary.test.ts`. `vehicle-enrich` no longer writes `market_value`.

## 5. Governance in place

- Flags: 7 in `src/lib/market/flags.ts`; literal `true` only; live on Harte:
  `market_invalid_claim_suppression` true, `market_value_v2_shadow` true, five
  false. Shadow cohort 39 VINs (cap 50).
- Budget and reservation: `market_provider_budgets` (marketcheck, enabled
  false, monthly 0.07), `provider_request_reservations` (1 succeeded); one live
  reservation per request fingerprint; `providerTransport` classifies 401 /
  403 / 429 / 5xx separately and never retries below the reservation.
- Metering: `mcCost.ts` lists 2026-08-01 public prices; only marketcheck-sync
  meters; vehicle-enrich and the comps route are unmetered.
- Decode cap: `shouldDecodeVin` (3 attempts, strict-once, refusals uncounted).
- Shape drift: `provider_payload_shapes` + `detectDrift`, two endpoints.
- Prune safety: provider refusal (`refused`) blocks the prune; held during the
  24-night refusal.
- Tenant isolation: RLS on all V2 tables; append-only snapshot privileges.
- Dealer identity: `dealer_identity` configured on Harte (rooftop, dealer,
  website ids, domains, group); second tenant unconfigured.

## 6. Gap matrix

| # | Item (§3 list) | Finding | Class | Blocked by |
|---|---|---|---|---|
| 1 | Syndication refusal handling | 429 reported as scope mismatch; no run row | MODIFY | none (code) |
| 2 | Enrich cursor | re-selects every vehicle forever; enriches archived cars; two chains a day | MODIFY | none (SQL migration + code) |
| 3 | `mc_raw` meaning | mixed (247 feed / 81 legacy pricing) | MODIFY | data migration authorization |
| 4 | Fee-aware comparables | `fees`, `price_includes_fees` unread | ADD | none (code) |
| 5 | NeoVIN utilization | warranty, options MSRP, MSRP variants, confidence, dimensions, country, EV range unread | ADD | none (code) |
| 6 | Current endpoint contracts | cannot be verified from sandbox (403 on all marketcheck.com hosts) | ENTITLEMENT-BLOCKED (network) | egress policy or vendored OpenAPI |
| 7 | Premium / Premium Plus | not called; `MARKETCHECK_COMPARABLES_PATH` constant exists, flag OFF | ADD | entitlement + cost test needs live call authorization |
| 8 | Exact MDS | YMM-first ladder, no `vin`/`exact` | MODIFY | contract verification |
| 9 | Sales Stats | `/sales/car` used only as make+state fallback; code comment asserts a capability the 2026 contract contradicts | MODIFY | contract verification |
| 10 | Sold Vehicles Summary | not called | ADD | entitlement |
| 11 | VIN history | normalized to 9 fields per episode; no listing-episode model; refreshing has been refused since Oct 3 | MODIFY | provider refusal |
| 12 | VINData / NMVTIS | manual, session-only, 0 pulls | ADD workflow (exception-based) | owner spend policy; terms unchanged |
| 13 | AutoRecalls | obsolete `/v2/recall/car/{vin}` path family; product unanswered | REPLACE path; ENTITLEMENT-BLOCKED | entitlement + contract |
| 14 | OEM incentives | env-gated off; cron still fires; no program cache | KEEP gate; ADD cache | owner policy |
| 15 | Black Book | never configured | ENTITLEMENT-BLOCKED | credentials |
| 16 | Price basis / doc fee | tenant-level `advertised_includes_doc_fee`; listing-level evidence ignored | MODIFY | none (code) |
| 17 | Dealer / rooftop identity | ids captured in `mc_dealership.*`; `dealer_identity` configured on Harte only | KEEP; MODIFY second tenant | config |
| 18 | Cost and budget controls | reservation + budget on prediction only; sweep unmetered; incentives cron wasted | MODIFY | none (code) |
| 19 | Feature flags | 7 present; §38 asks for ~21 | ADD | none (code) |
| 20 | Payload-shape monitoring | 2 endpoints | MODIFY (all paid endpoints) | none (code) |
| 21 | Tenant isolation / prune safety | sound | KEEP | none |
| 22 | Webhooks | none | ADD | portal configuration by owner |
| 23 | MarketMatch / FSBO / auction | not called | AUTOCURB-RESERVED | none |
| 24 | Second migration system (drizzle) | added 2026-10-24 by Lovable | owner decision | none |

## 7. What this audit changes nothing about

The Passport served at `/v/:slug` (locked), the price arithmetic, the
single-writer boundary, the `no_subject_price` suppression and the shadow
cohort are untouched and remain as recorded at the Gate 14G.6A close.
