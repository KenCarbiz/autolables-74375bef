# Passport 2.0 Server Contracts

Date: 2026-10-28. Status: the server read models for the used and new
Vehicle Passport 2.0 are built and tested. No UI exists for them and none is
started: the customer Passport served at `/v/:slug` is locked and untouched,
and the rollout flags `passport_2_used` and `passport_2_new` are declared
inert in `src/lib/market/flags.ts`. Nothing reads these models yet.

Modules covered:

| Module | Role |
| --- | --- |
| `src/lib/intelligence/contracts.ts` | The types (version `vi-contracts-1.0.0`). This document changes none of them; section 9 lists the additions it needs. |
| `src/lib/intelligence/readModels/listingFacts.ts` | Pure mappers from a `vehicle_listings` row into the summary types (`listing-facts-1.0.0`). |
| `src/lib/intelligence/readModels/usedPassport.ts` | `buildUsedPassportReadModel` |
| `src/lib/intelligence/readModels/newPassport.ts` | `buildNewPassportReadModel`, `factoryVerifiedFact` |
| `src/lib/intelligence/readModels/shared.ts` | `ReadModelInputError`, the freshness table rule, the forbidden-key assertion (`passport-read-models-1.0.0`). |
| `src/lib/intelligence/readModels/__fixtures__/` | Synthetic rows and the two package examples (`EXAMPLEVIN0000001`, `EXAMPLEVIN0000002`). |

## 1. What a read model is

A read model is the complete, serializable document a Passport page renders
from. The server assembles it from two kinds of input:

1. Conclusions the intelligence modules already computed: Vehicle Score, Data
   Confidence, Market Value V3, Deal Rating, Buyer Recommendation, the title
   and odometer summary, the condition summary, the provenance summary.
2. Facts that sit on the listing row: identity and factory decode, MSRP,
   the dealer's offer and fee basis, price integrity across channels,
   availability, warranty terms, market context, media, the recall answer.

The builders place; they never recompute. Three properties hold for every
model that leaves a builder:

- Every block carries a `Freshness`, and the model carries a `freshness`
  table with one row per dated conclusion.
- Every unknown is a state (`unknown`, `unavailable`, `stale`,
  `NOT_VERIFIED`, `UNKNOWN`), never a zero, never an empty list standing in
  for "none found", never a clean claim.
- `containsForbiddenKey(model)` is null. The builder throws otherwise, so a
  model that exists is publishable by shape.

## 2. Builders

### 2.1 `buildUsedPassportReadModel(inputs): UsedPassportReadModel`

| Input | Type | Produced by |
| --- | --- | --- |
| `row` | `ListingRowLike` | The `vehicle_listings` row, or any superset of the columns it names. |
| `nowMs` | `number` | The caller's clock. Every freshness decision uses it; nothing reads `Date.now()`. |
| `vehicleScore` | `VehicleScoreResult` | Vehicle Score module (`VEHICLE_SCORE_AND_CONFIDENCE_SPEC.md`). |
| `dataConfidence` | `DataConfidenceResult` | Same module. |
| `marketValue` | `MarketValueV3` | `src/lib/intelligence/marketValueV3.ts` (`MARKET_VALUE_V3_SPEC.md`). |
| `dealRating` | `DealRatingResult` or `null` | `src/lib/intelligence/dealRating.ts`. Null when no rating was computed. |
| `buyerRecommendation` | `BuyerRecommendationResult` | `src/lib/intelligence/buyerRecommendation.ts`. |
| `titleOdometer` | `TitleOdometerSummary` | The title and odometer classifier (`TITLE_ODOMETER_NMVTIS_SPEC.md`). |
| `condition` | `ConditionSummary` | A condition reader (AutoFilm or dealer inspection). None exists yet; the caller supplies `state: "unknown"`, `source: "none"` until it does. |
| `provenance` | `ProvenanceSummary` | A DMS provenance reader. None exists yet; same rule. |
| `recall`, `marketContext`, `identity`, `media` | optional | Default from the row through `listingFacts`; pass one to override, for example from a fresher check. |

Behaviour:

- Refuses a row whose `condition` is `new` (any case, trimmed) with
  `ReadModelInputError` code `vehicle_type_mismatch`. Every other condition,
  including null, is a used vehicle.
- `vehicleScore.score` and `label` are nulled when the module says
  `applicable: false` or the score is null; the domains are kept as
  `{ key, score, weight }` so the page can show what was assessed.
- `dataConfidence` carries the level and the reasons; `coveragePct` is
  included, rounded, only when the module computed one.
- `askingPrice` is the deal rating's asking price when a rating exists, else
  the dealer offer's advertised price (feed price, else website price).
- Every conclusion is placed verbatim. The read model is not the place a
  shadow result becomes public: `marketValue.publishable` travels as given.
- Throws `ReadModelInputError` code `forbidden_key` when any input carries a
  key from `FORBIDDEN_READ_MODEL_KEYS` at any depth.

### 2.2 `buildNewPassportReadModel(inputs): NewPassportReadModel`

| Input | Type | Produced by |
| --- | --- | --- |
| `row`, `nowMs` | as above | |
| `recall` | optional `RecallSummary` | Default from the row. |
| `incentives` | optional `IncentiveSummary[]` | No incentive is stored on the row today; the `oem_incentives_v2` surface supplies them once it exists. Default `[]`. |
| `identity`, `media` | optional | Default from the row. |

Behaviour:

- Refuses any row whose `condition` is not `new` (`vehicle_type_mismatch`).
- Adds `factoryVerified: Fact<boolean>` from the identity (section 3.1).
- `configuration` is the same `IdentitySummary` object as `vehicle`.
- There is no score slot; `isNewPassport(model)` is true.
- Same forbidden-key rule.

### 2.3 Errors

`ReadModelInputError extends Error` with `code: "vehicle_type_mismatch" |
"forbidden_key"`. A builder never returns a partial model.

## 3. Row facts (`listingFacts.ts`)

`listingFacts(row, nowMs)` returns every row-sourced block at once; each
mapper is also exported on its own. TTLs come from
`src/lib/market/providerRegistry.ts` where the registry states a cadence
(`READ_MODEL_TTL_DAYS`):

| Key | Days | From |
| --- | --- | --- |
| `feed` | 2 | registry `syndication` 24 h, widened by one run so a late or refused nightly run does not flip every row to stale |
| `websitePrice` | 7 | crawl cadence |
| `factoryDecode` | none | registry `neovin` has no cadence; a decode does not expire |
| `marketDaysSupply` | 7 | registry `mds` |
| `salesStats` | 30 | registry `sales_stats` |
| `recall` | 30 | registry `autorecalls`, equal to `RECALL_STALE_DAYS` |
| `incentives` | 1 | registry `incentives_oem` |
| `warranty` | none | factory terms do not expire |

### 3.1 IdentitySummary and the factory-verified Fact

| Field | Source | Rule |
| --- | --- | --- |
| `matchLevel` | `mc_attributes.build_sheet` | Sheet present and `generic !== true`: `EXACT_VIN`. Sheet with `generic: true`: `GENERIC_CANDIDATE`. No sheet and `ymm` parses: `YMM`. Else `UNKNOWN`. |
| `factoryVerified` | derived | `isExactIdentity(matchLevel)`; true only at `EXACT_VIN` or `EXACT_BUILD`. |
| `decodeSource` | derived | `neovin` with a sheet, `feed` when `mc_attributes` has feed fields, else `none`. `basic_decode` is never produced today (section 9). |
| `year`, `make`, `model` | `ymm` | First token a four-digit year, second the make, the rest the model. |
| `trim` | `trim`, else `mc_attributes.trim` | The listing's own claim; never promoted by the sheet. |
| `version`, sheet colors | sheet | Only when `mayClaim("exact_trim_version_identity", level)`; a generic sheet contributes neither. |
| `drivetrain`, `engine`, `transmission`, feed colors | `mc_attributes` | |
| `mileage` | `mileage` | Numeric, commas tolerated. |
| `providerConfidence` | `mc_attributes.neovin_confidence` (`record_confidence`, then `listing_confidence`, then `trim_confidence`) | Null without a sheet. |
| `freshness` | `build_sheet.decoded_at`, no TTL | Unknown-fresh without the stamp; never stale. |

`factoryVerifiedFact(identity, nowMs)` (new passport only):

| Identity | Fact |
| --- | --- |
| `EXACT_VIN` or `EXACT_BUILD` | `value: true`, `state: "verified"`, `authority: "manufacturer"`, `confidence: "VERIFIED"`, one public evidence ref (`factory_build_record`). |
| `GENERIC_CANDIDATE` | `value: false`, `state: "warning"`, `confidence: "LOW"`, reason `generic_candidate_decode_describes_vehicles_like_this_one`. |
| `YMM`, `YMMT` | `unknownFact("no_factory_decode_on_record")`. |
| `UNKNOWN` | `unknownFact("identity_unknown")`. |

### 3.2 MsrpBreakdown

| Case | Fields | `source` | `state` |
| --- | --- | --- | --- |
| Exact decode | `baseMsrp`, `destination`, `installedOptionsMsrp`, `configuredMsrp` from the lifted `mc_attributes.base_msrp`, `delivery_charges`, `installed_options_msrp`, `total_msrp`, falling back to `build_sheet.pricing`; `configuredMsrp` is the total, else base + options + destination. `packages` from `build_sheet.packages`, each `installed: true`. | `neovin` | `verified` (`stale` or `unknown` only by freshness; with no TTL that means `verified`). |
| Generic decode, or no decode, with a listed MSRP (`mc_attributes.msrp`, `mc_raw.msrp`) | Every factory field null; `configuredMsrp` is the listed figure; `packages` empty. | `feed` | `warning`: the dealer's figure, shown as a figure to review. |
| Nothing | all null | `none` | `unknown` |

A generic decode's own figures are dropped, not shown with a caveat:
`mayClaim("exact_msrp", "GENERIC_CANDIDATE")` is false.

### 3.3 DealerOfferSummary

| Field | Source |
| --- | --- |
| `advertisedPrice`, `channel` | `price` (feed) with channel `feed`; else `website_sale_price` with channel `website`; else null. |
| `feeBasis`, `fees` | `resolveListingFeeBasis({ price, fees: mc_attributes.fees ?? mc_raw.fees, price_includes_fees })`. `feeBasis` is `included`, `excluded` or `unknown`; `fees` is the identified sum or null. Never 0 by default. |
| `docFee` | `doc_fee` (crawl). |
| `websiteSalePrice`, `priceTerm` | `website_sale_price`, `website_price_term` (crawl). |
| `observedAt` | feed: `mc_raw.last_seen_at` (epoch seconds) else `updated_at`; website: `price_last_verified_at`. |
| `freshness`, `state` | TTL `feed` (2 d) or `websitePrice` (7 d). `verified`, `stale` or `unknown` by freshness; `unknown` with no channel. |

### 3.4 PriceIntegritySummary

Channels are the feed price and the website price with their observation
times. States in order of evaluation:

| State | When |
| --- | --- |
| `unknown` | no price on any channel |
| `single_channel` | one price |
| `stale_channel` | a channel has no observation time, or the two were observed more than `staleChannelDays` (3) apart; the reason names the older channel |
| `consistent` | difference within `max($100, 1% of the lower price)` |
| `channel_mismatch` | otherwise; the reason carries the dollar difference |

`PRICE_INTEGRITY_DEFAULTS` is configuration; `priceIntegrityFromRow(row, opts)` takes overrides.

### 3.5 AvailabilitySummary

| Field | Source |
| --- | --- |
| `vehicleStatus` | `archived` when `archived_at` is set; else `mc_attributes.vehicle_status`, else `mc_raw.vehicle_status`. |
| `inTransit` | `mc_attributes.in_transit`, else `mc_raw.in_transit`. |
| `lastSeenInFeedAt` | `mc_raw.last_seen_at` (else `scraped_at`). |
| `state` | archived: `unknown`; status containing `sold`: `sold`; `pending`, `hold` or `deposit`: `pending`; in transit: `in_transit`; seen inside the feed window: `available`; else `unknown`. |

Availability is never `available` on a stale feed sighting.

### 3.6 WarrantySummary

| Field | Source |
| --- | --- |
| `terms`, `source` | `mc_attributes.factory_warranty.terms[{ type, months, miles }]` with source `neovin` (basis `original_factory`); else `warranty_info.factory_*` and `powertrain_*` with source `warranty_info`; else none. |
| `inServiceDate` | `in_service_date`, else `history_payload.inServiceDate`, else `warranty_info.in_service_date`. |
| `remainingCoverage` | no terms: `unknown`; terms and no date: `not_calculated_without_in_service_date`; terms and a date: `unknown`, because the contract has no fields for a computed figure yet (section 9). |
| `freshness` | decode stamp, no TTL. |

### 3.7 MarketContextSummary

| Field | Source |
| --- | --- |
| `mdsDays`, `mdsCheckedAt` | `market_meta.market_days_supply` and `checked_at`; or a recorded cohort answer at `market_meta.mds_cohort` (`value`, `checked_at`). |
| `mdsScope` | `market_meta.mds_match_level` (the registry's declared destination) or `mds_cohort.match_level`, only when it is a `CohortMatchLevel`. |
| `salesVelocity`, `velocityBasis` | `sold_stats` with `count >= 5`, a `dom_median`, and `scope` other than `make_state`: days on market at most 30 `strong`, at most 60 `steady`, else `slow` (`inferred_sales_stats`). Otherwise days supply at most 45 `strong`, at most 90 `steady`, else `slow` (`mds_estimate`). Otherwise `unknown` / `none`. Bands: `VELOCITY_BANDS`. |
| `trend`, `trendBasis` | `market_meta.trend` when it is `rising`, `stable` or `softening` (`sold_summary`); else `unknown` / `none`. Nothing writes `market_meta.trend` today. |
| `inferredSoldWording` | always `true`: every sold figure is inferred from listings leaving the market and the copy must say so. |
| `freshness` | days supply present: its stamp with TTL 7; sales only: `sold_stats.checked_at` with TTL 30; else unknown. |

### 3.8 VehicleMedia and incentives

`hero_image_url` (else the first photo), `photos` as strings or `{ url }`
objects, `photo_count` (else the list length). `incentivesFromRow` always
returns `[]`.

### 3.9 RecallSummary

Derived through `deriveRecallView` (`src/lib/vehicleTruth/recallView.ts`)
with `staleDays` equal to the recall TTL, so the view and the freshness never
disagree. The mapping to the contract's VIN states:

| Truth state (view) | Contract `vinState` | `publicState` |
| --- | --- | --- |
| `OPEN` | `OPEN` | `adverse` |
| `VERIFIED_CLEAR` with `clearClaimAllowed` and `closed_recall_count` 0 or null | `NO_OPEN` | `verified`, `stale` by freshness |
| `VERIFIED_CLEAR` with `clearClaimAllowed` and closed campaigns on record | `CLOSED_CAMPAIGN_ONLY` | same |
| `VERIFIED_CLEAR` without `clearClaimAllowed` (a conflicting store) | `UNKNOWN` | `warning` |
| `UNKNOWN` with a `recall_check.note` matching `http_401`, `http_403`, `forbidden`, `unauthorized`, `not_entitled`, `entitlement` | `ENTITLEMENT_BLOCKED` | `unavailable` |
| `UNKNOWN` with a note matching `rate_limit`, `http_429`, `http_5xx`, `transport_error`, `timeout`, `shape_unrecognised`, `budget_denied`, `quota`, `not_configured`, `unavailable` | `PROVIDER_UNAVAILABLE` | `unavailable` |
| `STALE` | `UNKNOWN` | `stale` |
| `UNKNOWN` otherwise (no attempt, VIN not on file, a legacy row without a declared scope) | `UNKNOWN` | `warning` when the view signals risk or conflict, else `unknown` |

`doNotDrive` makes `publicState` `adverse` whatever the state.
`OEM_SERVICE_CAMPAIGN` is never produced: no stored evidence distinguishes an
OEM service campaign from a recall.

`publicStatement` is evidence-exact, for example "No open recall campaigns
reported on this VIN as of 2026-10-21." or "The VIN-level recall check did
not return an answer, so recall status is not verified." `openCount` is a
number only for `OPEN` (the count) and a permitted clearance (0); it is null
in every other state. `checkedAt` is the date of an answer; a failed attempt
has none.

## 4. UsedPassportReadModel field by field

| Field | From | Authority | TTL | State rule | The UI must never |
| --- | --- | --- | --- | --- | --- |
| `vehicle` | row identity | `manufacturer` at exact identity, else `provider_listing` | none | `factoryVerified` only at `EXACT_VIN` / `EXACT_BUILD` | say factory verified, exact configuration or exact MSRP below exact identity |
| `media` | row | `provider_listing` | none | | |
| `vehicleScore` | Vehicle Score module | derived | module | null score and label when not applicable | show a score for a new vehicle; present market, price, deal rating, days supply, velocity or incentives as score drivers |
| `dataConfidence` | Data Confidence module | derived | module | level is the public value | show `coveragePct` as precision on the public page |
| `titleOdometer` | classifier | `government_record` | module | `NOT_VERIFIED` when no report; `entitlementBlocked` and `providerFailed` say why | say "clean"; infer no brands from a missing report |
| `dealerProvenance` | DMS reader | `dealer_system` or `dealer_claim` | module | `source: "none"` when nothing is known | promote a dealer claim to a DMS fact |
| `condition` | inspection reader | `verified_inspection` | module | `unknown` when no inspection | treat `self_reported` as verified |
| `marketValue` | Market Value V3 | `market_evidence` | module | `confidence: "unavailable"` with null figures when it could not be computed | show the estimate while `publishable` is false unless `market_value_v3_public` is read on the server; show a disagreement as an average |
| `askingPrice` | deal rating, else dealer offer | `provider_listing` | 2 d feed / 7 d website | null when no price | invent a price |
| `dealRating` | Deal Rating | derived | module | null when no rating; `label: "unavailable"` when the valuation is | rate against an unavailable valuation |
| `buyerRecommendation` | Buyer Recommendation | derived | module | hard gates listed | hide a hard gate |
| `marketContext` | row | `market_evidence` | 7 d / 30 d | `inferredSoldWording` | drop the word inferred from a sold figure |
| `recall` | row | `public_safety` (model), `manufacturer` (VIN) | 30 d | section 3.9 | render a model-level answer as a VIN clearance |
| `freshness` | section 6 | | | | hide a stale row |

## 5. NewPassportReadModel field by field

| Field | From | Authority | TTL | State rule | The UI must never |
| --- | --- | --- | --- | --- | --- |
| `vehicle`, `configuration` | row identity | `manufacturer` / `provider_listing` | none | as above | |
| `media` | row | `provider_listing` | none | | |
| `factoryVerified` | `factoryVerifiedFact` | `manufacturer` | none | section 3.1 | show a generic decode as this vehicle |
| `msrp` | row | `manufacturer` (decode) or `provider_listing` (feed) | none / 2 d | section 3.2 | present the feed MSRP as the configuration; list packages from a generic decode |
| `dealerOffer` | row | `provider_listing` | 2 d / 7 d | section 3.3 | show $0 fees when unstated; show a stale price as current |
| `incentives` | caller | `manufacturer` | 1 d | `[]` until the incentives surface exists | invent an offer; show incentives while `oem_incentives_v2` is inert |
| `priceIntegrity` | row | `provider_listing` | 3 d spread | section 3.4 | compare channels observed days apart |
| `availability` | row | `provider_listing` | 2 d | section 3.5 | say available on a stale feed |
| `warranty` | row | `manufacturer` | none | section 3.6 | show remaining coverage without an in-service date |
| `recall` | row | as above | 30 d | section 3.9 | as above |
| `freshness` | section 6 | | | | |

## 6. The freshness table

One `FreshnessSummary` per dated block, in a fixed order.

| Model | Keys |
| --- | --- |
| used | `factory_identity`, `title_odometer`, `condition`, `dealer_provenance`, `market_value`, `asking_price`, `market_context`, `recall` |
| new | `factory_identity`, `msrp`, `dealer_offer`, `availability`, `warranty`, `incentives`, `recall` |

Row state rule (`freshnessEntry`): a stale freshness is `stale` whatever the
fact said; an unknown freshness is `unknown` unless the fact is `adverse`,
`warning` or `unavailable`, which it keeps; a current freshness carries the
fact's own public state, or `verified` when the fact has none. `source` names
the decode source, channel, module version or reader; `ttlDays` is the TTL
applied, null when none.

## 7. Public-state rules the UI must honor

- A state is rendered as the state. `unknown` is "not verified", not blank,
  not green, not zero.
- `unavailable` means the provider or entitlement failed. It is never
  rendered as a clean result and never hidden.
- `stale` keeps the figure and says when it was last checked.
- `warning` is a reason to look, never a verdict.
- `adverse` is shown with its statement, never softened.
- Exact-only claims (factory verified, exact configuration, exact installed
  equipment, exact trim and version, exact MSRP, score evidence) appear only
  when `vehicle.factoryVerified` is true.
- Market and price never appear beside the Vehicle Score as inputs to it.
- Sold figures carry the word inferred.
- Title wording is the summary's `publicStatement`, verbatim.
- A `RecallSummary` is rendered from `vinState` and `publicStatement`; the
  stored `truthState` is for surfaces that still read the older vocabulary.
- The model is the whole input. The page does not fetch a provider, read
  `mc_raw`, or call a market function.

## 8. Mapping to the package examples

`data_examples/used_passport_example.json` and `new_passport_example.json`
are illustrative; the tests load them and assert the mapping below.

| Example key | Model path | Note |
| --- | --- | --- |
| `vehicle.*` | `vehicle.*` | same names in camelCase |
| `vehicle.vehicle_status`, `vehicle.in_transit` (new) | `availability.state`, `availability.inTransit` | |
| `vehicle_score.score`, `label`, `domains[]` | `vehicleScore` | domains carry `weight` too |
| `vehicle_score.data_confidence` | `dataConfidence` | `coverage_pct` is `coveragePct`, rounded |
| `title_odometer.status` | `titleOdometer.state` | the contract's state is upper case |
| `dealer_provenance` | `dealerProvenance` | |
| `condition.tires`, `brakes` | `condition.tires32nds`, `brakesMm` | numbers, not "8/32" strings |
| `market_value.amount` | `marketValue.estimatedValue` | plus range, confidence, comps |
| `asking_price` | `askingPrice` | |
| `deal_rating` | `dealRating` | |
| `buyer_recommendation.state` | `buyerRecommendation.state` | upper case |
| `market_context.mds_scope` | `marketContext.mdsScope` | the example's `exact_build_local` is a `CohortMatchLevel` plus a geography; the contract carries the level |
| `factory_verified.status`, `decode_source` | `factoryVerified.state`, `vehicle.decodeSource` | lower case source |
| `configuration.*` | `msrp.*` | packages carry `installed` |
| `dealer_offer.price_includes_fees` | `dealerOffer.feeBasis` | `included` / `excluded` / `unknown` |
| `dealer_offer.price_integrity` | `priceIntegrity.state` | |
| `incentives.offers[]` | `incentives[]` | empty until the incentives surface exists; the example's offer is not reproduced |
| `warranty.remaining_coverage` | `warranty.remainingCoverage` | |
| `recall.vin_state` | `recall.vinState` | the example's `verified_no_open` is `NO_OPEN` |

## 9. Contract additions needed (`contracts.ts` untouched by this stream)

1. `WarrantySummary`: fields for a computed remainder (`remainingMonths`,
   `remainingMiles`, `remainingThrough`) so `remainingCoverage: "calculated"`
   can carry a figure. Until then a vehicle with an in-service date reports
   `unknown`.
2. `RecallSummary.attemptedAt`: the view knows when a failed check was
   attempted; the contract has no field for it, so an unavailable answer
   shows no date.
3. `MsrpBreakdown.reasons` and `DealerOfferSummary.reasons`: the fee-basis
   reasons from `resolveListingFeeBasis` and the "generic decode dropped"
   reason are lost today.
4. `DecodeSource "basic_decode"` is never produced; a stored marker is needed
   to tell a basic decode from feed fields.
5. `MarketContextSummary.trend` has no writer: the registry declares
   `market_meta.trend` as the sold-summary destination, so the writer and its
   TTL are the gap, not the contract.
6. `IncentiveSummary` has no storage; `incentive_programs` is declared. The
   new builder accepts an override so the surface can land without a change
   here.
7. `DataConfidence.coveragePct` visibility: the read model exposes it
   rounded; the public page should show the level only. Consider a
   `visibility` on the read model's confidence block.
8. Condition and provenance readers do not exist; callers supply `unknown`
   summaries. The read model does not need to change for them to land.
9. `ListingRowLike` should become a `Pick` of the generated
   `vehicle_listings` row type once that file is stable; it is hand-declared
   so the module stays pure and regeneration-proof.

## 10. Open questions

- Feed window: 2 days against a 24 h registry cadence. Confirm or move to the
  registry value once the nightly run is reliable again.
- A stale clearance maps to `UNKNOWN` with `publicState: "stale"` rather than
  `NO_OPEN` marked stale. Confirm against `RECALL_SPEC.md`.
- A generic decode's MSRP figures are dropped. Confirm that a caveated figure
  is not wanted.
- Price integrity tolerance (`$100` or 1%) and the 3-day channel spread are
  starting values.
- The used builder accepts a null condition as a used vehicle. Confirm that
  rows with no condition should not be refused instead.
