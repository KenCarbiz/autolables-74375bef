# Vehicle Intelligence Data Flow

Date: 2026-10-28. Scope: how a vehicle's facts travel from a provider call to
a Passport 2.0 read model, which module owns each step, which flag gates it,
and what each step must never do. The UI stage is described only as a
boundary: it is not started, and the customer Passport served today is locked.

## 1. One view

```
providers
  MarketCheck: syndication, NeoVIN, active search and comparables, MDS,
               recents and sales stats, VIN history, AutoRecalls
  NHTSA recalls by vehicle (model level, free)
  dealer website (direct fetch, then Firecrawl render)
  entitlement-blocked today: NMVTIS / VINData, Black Book, OEM incentives
      |
      v  edge writers, every paid call behind the provider call budget
  marketcheck-sync . marketcheck-specs . vehicle-enrich . marketcheck-comps
  crawl-advertised-prices . market-valuation-write (sole writer of market_*)
      |
      v  storage
  vehicle_listings columns (+ advertised_prices, vehicle_value_history,
  inventory_sync_runs, provider_call_events, provider_call_budgets)
      |
      v  pure modules (no I/O, versioned results)
  src/lib/market/*  .  src/lib/vehicleTruth/*  .  src/lib/intelligence/*
      |
      v  read models
  src/lib/intelligence/readModels/{listingFacts, usedPassport, newPassport}
      |
      v  UI (not started; passport_2_used / passport_2_new inert)
```

Direction is one way. A later stage never reaches back: the read model does
not call a provider, the UI does not read a column.

## 2. Stage A: provider calls

| Product | Registry key | Caller | Essential | Registry TTL | Writes | Gate |
| --- | --- | --- | --- | --- | --- | --- |
| Dealer inventory (syndication) | `syndication` | `marketcheck-sync` | yes | 24 h | `vehicle_listings` upsert keyed on tenant and VIN: `price`, `mc_raw`, feed fields in `mc_attributes`, `photos`, `hero_image_url`; a run row in `inventory_sync_runs` | plan quota (5,000 calls a month, account-wide); budget admits under the cap |
| Factory decode (NeoVIN) | `neovin` | `marketcheck-specs` | no | none, first seen | `mc_attributes.build_sheet` plus the lifted `base_msrp`, `delivery_charges`, `total_msrp`, `installed_options_msrp`, `factory_warranty`, `neovin_confidence`, `msrp_variants` | budget (cap minus reserve) |
| Active search, comparables | `active_search` | `vehicle-enrich` through `marketcheck-comps` | no | 24 h | `comparables`, `group_similar`, `market_meta` | budget |
| Market days supply | `mds` | `vehicle-enrich` | no | 7 d | `market_meta.market_days_supply`, `inventory_count`, `checked_at` (`mds_match_level` declared) | budget; `INCLUDE_MDS` |
| Recents, sales stats | `recents`, `sales_stats` | `vehicle-enrich` | no | 30 d | `market_meta.sold_stats` (`count`, medians, `scope`, `window_days`, `checked_at`, `source`) | budget |
| VIN history | `vin_history` | `vehicle-enrich` | no | 30 d | `history_payload`, `in_service_date` | budget |
| AutoRecalls (VIN scope) | `autorecalls` | `vehicle-enrich` through `recallState.ts` | no | 30 d | `recall_status`, `open_recall_count`, `closed_recall_count`, `recall_checked_at`, `recall_check` | budget |
| NHTSA recalls by vehicle (model scope) | none | `vehicle-enrich` | free | 30 d | `recall_payload` only | none |
| Dealer website price | none | `crawl-advertised-prices` | n/a | nightly | `website_sale_price`, `website_price_term`, `price_last_verified_at`, `advertised_price_before_doc`, `doc_fee`, `price_parse_status`, `price_parse_notes`, `scrape_source_url`; `advertised_prices` | pacer, run budget, mismatch backoff |
| Market valuation | none | `market-valuation-write` | n/a | | `market_value`, `market_position`, `market_checked_at`, `market_payload` | sole writer |
| OEM incentives | `incentives_oem`, `incentives_make_zip` | none yet | | 24 h | `incentive_programs` (declared) | `oem_incentives_v2` inert |
| Black Book | `blackbook_used_vin` | blocked | | 7 d | `vehicle_listings.blackbook` (declared) | `blackbook_live` inert |
| NMVTIS / VINData | `vindata_access`, `vindata_generate` | blocked by entitlement | | 90 d | session only, `title_report_pulls`; the report body is never persisted | `nmvtis_auto_verify` inert |

Budget: `provider_call_budgets` (MarketCheck cap 5,000, reserve 250),
`provider_call_admit` and `provider_call_record` RPCs, the
`provider_call_events` ledger, the client in
`supabase/functions/_shared/providerBudget.ts` and the pure decision in
`providerBudgetPolicy.ts`. The essential caller is admitted under the cap;
every other caller under the cap minus the reserve. A denied or refused call
returns null or an empty result to its caller and is recorded
(`budget_denied`, `refused_quota`, `refused_rate`, `refused_auth`,
`provider_error`, `transport_error`); the row keeps its previous value and
nothing clean is written.

## 3. Stage B: storage

Columns the read models read, and who writes them:

| Column | Writer | Read by |
| --- | --- | --- |
| `vin`, `ymm`, `trim`, `mileage`, `condition`, `price`, `photos`, `hero_image_url`, `photo_count` | `marketcheck-sync` | identity, media, dealer offer |
| `mc_raw` | `marketcheck-sync` | feed stamps, status, fees; read on the server, never copied out |
| `mc_attributes` | `marketcheck-sync` (feed fields), `marketcheck-specs` (decode, merged never rebuilt) | identity, MSRP, warranty, fee basis |
| `market_meta`, `comparables`, `group_similar` | `vehicle-enrich` | market context; Market Value V3 |
| `history_payload`, `in_service_date` | `vehicle-enrich` | warranty in-service date |
| `recall_status`, `open_recall_count`, `closed_recall_count`, `recall_checked_at`, `recall_check` | `vehicle-enrich` through `recallState.ts`, VIN scope only (CHECK constraints) | recall |
| `recall_payload` | `vehicle-enrich`, model scope only | recall (warning only) |
| `website_sale_price`, `website_price_term`, `price_last_verified_at`, `doc_fee`, `advertised_price_before_doc` | `crawl-advertised-prices` | dealer offer, price integrity |
| `market_value`, `market_position`, `market_checked_at`, `market_payload` | `market-valuation-write` only | the served Passport's price card; not the read models |
| `warranty_info`, `certification`, `service_records` | older writers | warranty fallback |
| `enriched_at`, `updated_at`, `archived_at` | their writers | freshness proxies, archived state |

Rules at this stage:

- Single writer for `market_*` (`src/lib/market/writerBoundary.test.ts`
  fails the suite if a second writer appears).
- `mc_raw` is provider raw and never leaves the server. It is one of
  `FORBIDDEN_READ_MODEL_KEYS`; a read model containing it is refused.
- The VIN-scope recall columns can only be written from a VIN-level answer;
  the model-level NHTSA answer lands in `recall_payload` alone.
- A VINData report body is never persisted (provider terms).
- `mc_attributes` is merged over what is stored; a pass that returns less
  never erases what a previous pass found.
- An `inventory_sync_runs` row records every sync attempt, including a
  refusal, so a quiet month is visible as a refusal and not as an empty
  dealer.

## 4. Stage C: pure modules

| Module | Consumes | Produces | Version | Status |
| --- | --- | --- | --- | --- |
| `src/lib/market/*` (price basis, comparables, stats, confidence, verdict, composite, `identityMatch`, `cohortLadder`, `listingFeeBasis`, `providerRegistry`, `flags`) | columns | the market view, identity levels and claims, fee basis, registry TTLs and influences | per module | live; mirrored to the edge by `scripts/sync-edge-sticker-lib.mjs` |
| `src/lib/vehicleTruth/recallView.ts` | recall columns | `RecallView` (VIN and model scopes, clear claim permission) | | live in the served Passport |
| `src/lib/intelligence/contracts.ts` | nothing | the shared types | `vi-contracts-1.0.0` | done |
| `src/lib/intelligence/marketValueV3.ts` | comparables, market meta, identity, fee basis | `MarketValueV3`, `publishable: false` | per module | built, shadow (`MARKET_VALUE_V3_SPEC.md`) |
| Vehicle Score and Data Confidence (`VEHICLE_SCORE_AND_CONFIDENCE_SPEC.md`) | title, condition, provenance, recall, identity ceiling | `VehicleScoreResult`, `DataConfidenceResult` | per module | built, shadow |
| `src/lib/intelligence/dealRating.ts`, `buyerRecommendation.ts` | Market Value V3, asking price, hard-gate inputs | `DealRatingResult`, `BuyerRecommendationResult` | per module | built (`DEAL_RATING_AND_RECOMMENDATION_SPEC.md`) |
| Title and odometer classifier (`TITLE_ODOMETER_NMVTIS_SPEC.md`) | a report when entitled, else nothing | `TitleOdometerSummary` | per module | built; the provider is blocked, so the state is `NOT_VERIFIED` with `entitlementBlocked` |
| `src/lib/intelligence/readModels/listingFacts.ts` | the row | identity, MSRP, offer, integrity, availability, warranty, market context, media, incentives, recall summaries | `listing-facts-1.0.0` | built |
| `src/lib/intelligence/readModels/usedPassport.ts`, `newPassport.ts` | the conclusions above and the row | `UsedPassportReadModel`, `NewPassportReadModel` | `passport-read-models-1.0.0` | built |

Order of evaluation for a used vehicle: identity and row facts, then title
and recall, then condition and provenance, then the Vehicle Score and Data
Confidence (which read none of the market inputs), then Market Value V3,
then Deal Rating and Buyer Recommendation, then the read model. The score is
computed before, and without sight of, the price and the market.

## 5. Stage D: read models

`buildUsedPassportReadModel` and `buildNewPassportReadModel`
(`PASSPORT_2_SERVER_CONTRACTS.md`) place conclusions and row facts into one
serializable document per vehicle. They are pure: the same row, the same
conclusions and the same clock produce the same model. Nothing is stored;
the model is computed at request time by whichever server surface is wired
later (an edge function or a loader), behind `passport_2_used` or
`passport_2_new`. Each builder refuses the wrong vehicle type and any input
that carries raw provider material.

## 6. Stage E: UI (not started)

The master build's completion gate (section 41) stands between this document
and any UI work. When it opens:

- The served Passport at `/v/:slug` stays locked; a Passport 2.0 page is a
  new surface behind its flag.
- The page renders the read model and nothing else: no provider call, no
  column read, no recomputation, no inference from absence.
- The six public states are rendered as states; the must-nevers in
  `PASSPORT_2_SERVER_CONTRACTS.md` section 7 apply.

## 7. Flags per step

All fifteen are declared inert in `src/lib/market/flags.ts`; nothing reads
them yet. Each is listed with the step it will gate.

| Flag | Gates |
| --- | --- |
| `market_intelligence_v3_shadow` | the V3 pipeline running in shadow beside the served market view |
| `premium_plus_new_intake` | the Premium or Plus price product on new-vehicle intake (provider blocked) |
| `fee_normalized_comps` | fee-normalized comparison prices in the comparables set |
| `nmvtis_auto_verify` | automatic NMVTIS pulls (entitlement blocked) |
| `oem_incentives_v2` | the incentives surface that fills `NewPassportReadModel.incentives` |
| `provider_webhooks` | provider webhooks replacing the nightly sweep |
| `blackbook_live` | Black Book as a valuation signal (blocked) |
| `market_value_v3_shadow` | computing Market Value V3 and recording it |
| `market_value_v3_public` | `publishable: true` on a Market Value V3 result |
| `vehicle_score_shadow` | computing the Vehicle Score and recording it |
| `vehicle_score_public` | showing the score on a public surface |
| `data_confidence` | computing and showing Data Confidence |
| `buyer_recommendation` | computing and showing the recommendation |
| `passport_2_new` | serving the new read model |
| `passport_2_used` | serving the used read model |

## 8. Invariants and where they are enforced

| Invariant | Enforced in | Test |
| --- | --- | --- |
| Market, price, deal rating, MarketMatch, auction, FSBO, cheapness and incentives never raise the Vehicle Score | `SCORE_NEVER_INFLUENCED_BY` in `contracts.ts`; `mayInfluenceVehicleScore` and the influence columns in `providerRegistry.ts`; the score module's inputs | `contracts.test.ts`, registry tests, the score module's tests |
| Missing evidence lowers Data Confidence, not the score | the score and confidence module | its tests |
| Identity exactness through `mayClaim` and `identityConfidenceCeiling` | `identityMatch.ts`; `listingFacts` identity and MSRP; `factoryVerifiedFact` | `listingFacts.test.ts`, `newPassport.test.ts` |
| A provider or entitlement failure is never clean, zero or $0 | the budget gate returns null; `recallView` and `recallSummaryFromRow` (`UNKNOWN`, `PROVIDER_UNAVAILABLE`, `ENTITLEMENT_BLOCKED`); `resolveListingFeeBasis` (`fees: null`); the title classifier | `listingFacts.test.ts`, `usedPassport.test.ts`, budget tests |
| Sold figures are inferred and say so | `MarketContextSummary.inferredSoldWording: true`; `soldLanguage.ts` | `listingFacts.test.ts` |
| Title wording is evidence-exact | the title classifier's `publicStatement`; the read model passes it verbatim | the classifier's tests |
| MarketMatch, auction and FSBO stay AutoCurb-reserved | registry ownership | registry tests |
| Shadow outputs carry `publishable: false` | `MarketValueV3.publishable`; the read model passes it through | `marketValueV3.test.ts` |
| Single writer for `market_*` | `writerBoundary.test.ts` | itself |
| No raw provider material in a read model | `containsForbiddenKey`; both builders throw | `usedPassport.test.ts`, `newPassport.test.ts` |
| Availability is never claimed from a stale feed | `availabilityFromRow` | `listingFacts.test.ts` |
| A model-level recall answer never clears a VIN | `recallView.ts` (declared scope required) | `recallView` tests, `listingFacts.test.ts` |

## 9. Behaviour under the current operating state

- The syndication feed is refused by the plan quota until the month resets
  or the plan changes. After two days without a sighting, `availability`
  reads `unknown` and the dealer offer reads `stale`; price integrity reads
  `stale_channel` or `single_channel` as the website channel keeps
  refreshing. Nothing is written clean.
- The nightly enrich sweep is paused. Market context ages into `stale` after
  7 days (days supply) or 30 days (sales); a no-open recall answer older than
  30 days reads `UNKNOWN` with `publicState: "stale"`.
- The website crawl is recovered and runs nightly, so `website_sale_price`
  and its stamp stay fresh.
- The provider call budget is live: denied attempts are recorded and rows are
  untouched, so a read model built during a refusal shows the last answer
  with its real age rather than a fresh-looking blank.

## 10. Not in the flow yet

- Condition and provenance readers (AutoFilm, dealer inspection, DMS).
- The incentives surface and its storage.
- A writer for `market_meta.trend` (sold summary) and its TTL.
- Remaining-warranty computation and the contract fields to carry it.
- NMVTIS pulls, Black Book and provider webhooks (blocked or unbuilt).
- The server surface that calls the builders, and the UI behind the flags.
