# DEAL_RATING_AND_RECOMMENDATION_SPEC

Master build prompt sections 32 and 33, implemented 2026-10-27 as two pure
modules under `src/lib/intelligence/`: `dealRating.ts` and
`buyerRecommendation.ts`. Both are shadow outputs: nothing renders them to a
customer until a server surface reads `buyer_recommendation` and
`market_value_v3_public`, and `market_value_v3_shadow` governs whether the
value they depend on is computed at all. Every result carries a version
string.

## 1. Deal Rating (section 32)

The dealer's asking price measured against the AutoLabels Market Value V3.
A separate conclusion from the Vehicle Score by construction: the function
takes no score input and the score takes no price input.

### Inputs

| Input | Source | Note |
|---|---|---|
| `askingPrice` | the vehicle comparison price from `market/priceBasis.ts` | doc fee excluded, conditional discounts added back |
| `basisStatus` | `resolvePriceBasis` | `invalid` cannot be rated; `ambiguous` is rated with a reason |
| `marketValue` | `MarketValueV3` | estimate, range, valuation confidence, disagreement flag, freshness |
| `vehicleType` | listing | new vehicles are rated only when `rateNewVehicles` is set |

### Thresholds are configuration

`DealRatingThresholds` (signed percent of market value; asking below value
is negative) with the exported starting calibration
`DEFAULT_DEAL_RATING_THRESHOLDS`:

| Label | Delta from market value |
|---|---|
| `great_value` | at or below -5% |
| `good_value` | above -5% to -1.5% |
| `fair_price` | above -1.5% to +2% |
| `above_market` | above +2% to +7% |
| `well_above_market` | above +7% |

An override is merged per call; a non-monotonic override falls back to the
defaults and says so (`thresholds_not_monotonic_defaults_used`). The UI never
holds a percentage.

### Unavailable, with the reason

| Condition | Reason |
|---|---|
| no market value | `market_value_unavailable` |
| valuation confidence below the minimum (default `medium`, configurable) | `valuation_confidence_<level>_below_minimum_<minimum>` |
| asking price missing or not positive | `asking_price_missing` |
| asking price outside the plausible band (default 1,000 to 500,000) | `asking_price_implausible` |
| invalid price basis | `price_basis_invalid` |
| new vehicle without `rateNewVehicles` | `new_vehicle_rating_not_enabled`, `applicable: false` |

An unavailable rating carries null deltas. It never guesses.

### Output

`DealRatingResult`: version, label, asking price, market value, delta in
dollars (rounded) and percent (two decimals), the valuation confidence it
relied on, the thresholds it applied, `applicable`, and reasons, which
always include the signed delta (`asking_below_market_value_by_2.16_percent`)
and note an ambiguous basis, a flagged valuation disagreement, or a stale
value without hiding the rating.

## 2. Buyer Recommendation (section 33)

Used vehicles only. New vehicles return `applicable: false` and the state
`NOT_ENOUGH_VERIFIED_INFORMATION` with a reason; they receive verified
states, not a recommendation.

### Order of evaluation

1. **Hard gates.** Any gate yields `REVIEW_BEFORE_PURCHASE` with the gates
   listed and their reasons; no favorable state is possible.
2. **Insufficient evidence.** A null or non-applicable Vehicle Score, a
   missing Data Confidence, or `limited` Data Confidence yields
   `NOT_ENOUGH_VERIFIED_INFORMATION`, carrying the confidence reasons.
3. **Synthesis.** The Vehicle Score band sets a ceiling; every other input
   can lower the state and nothing can raise it.

### Hard gates (`HARD_GATES`)

| Gate | Trigger |
|---|---|
| `unresolved_title_brand` | title state `ADVERSE` or `REVIEW_REQUIRED` |
| `odometer_conflict` | odometer status `conflict` or `rollback_indicated` |
| `identity_not_exact` | identity level other than `EXACT_VIN` or `EXACT_BUILD` |
| `open_safety_recall` | VIN recall state `OPEN` or an open count above zero |
| `do_not_drive` | do-not-drive or stop-sale language on a campaign |
| `major_condition_issue` | an unresolved major condition finding |
| `material_conflict` | a conflict listed by the caller or by Data Confidence |

A `NOT_VERIFIED` title is not a gate: it is missing evidence, handled by the
caps below. A resolved major finding is not a gate.

### Score bands (`DEFAULT_RECOMMENDATION_BANDS`, configuration)

| Vehicle Score | Ceiling |
|---|---|
| 85 and above | `HIGHLY_RECOMMENDED` |
| 70 to 84 | `RECOMMENDED` |
| 55 to 69 | `CONSIDER` |
| below 55 | `REVIEW_BEFORE_PURCHASE` |

### Caps that lower the state

| Input | Effect (default, configurable where noted) |
|---|---|
| Data Confidence `moderate` | `HIGHLY_RECOMMENDED` becomes `RECOMMENDED` (`requireHighConfidenceForHighly`) |
| title `NOT_VERIFIED` or absent | at most `CONSIDER` (`titleNotVerifiedCap`) |
| condition `unknown`, `self_reported` or absent | at most `CONSIDER` (`conditionNotVerifiedCap`) |
| an unresolved moderate condition finding | at most `CONSIDER` |
| Deal Rating `well_above_market` | at most `CONSIDER`, with the price reason |
| Deal Rating `above_market` | at most `RECOMMENDED` |
| Deal Rating unavailable or absent | at most `RECOMMENDED` |

A `great_value` or `good_value` rating adds a reason and raises nothing: a
weak vehicle with a great deal stays where its score put it, and a good
vehicle with a bad deal lands on `CONSIDER` with the price reason.
Provenance adds reasons only. Recall `NO_OPEN` adds a reason; any other
non-gating recall state adds "VIN recall status is not verified".

### Reasons vocabulary

Reasons are short public sentences, evidence-exact: "Vehicle Score 94,
Outstanding", "Data Confidence high", the title summary's own public
statement (never "clean title"), "Condition verified by inspection on
<date>", "Dealer has known this vehicle since new", "Price is below
estimated market value by 2.16%", "No open VIN recall reported". Gate
reasons come from `HARD_GATE_REASONS`, one per gate.

`inputsUsed` lists what was consulted, always starting with `identity`.

## 3. Flags

| Flag | Role |
|---|---|
| `market_value_v3_shadow` | computes the value the Deal Rating depends on; shadow only |
| `market_value_v3_public` | the only route by which a rating reaches a customer |
| `buyer_recommendation` | enables the recommendation on a server surface |

All three are declared OFF and inert in `src/lib/market/flags.ts` until a
server surface reads them.

## 4. Section 39 coverage

| Case | Test |
|---|---|
| hard gates, each one | `buyerRecommendation.test.ts`: every gate has a trigger and a reason; any gate forbids a favorable state; generic, YMM and unknown identity gate by themselves |
| insufficient evidence | null score, non-applicable score, missing or limited confidence |
| good vehicle, bad deal | `well_above_market` lands on `CONSIDER` with the price reason; `above_market` on `RECOMMENDED` |
| weak vehicle, great deal | score 48 stays `REVIEW_BEFORE_PURCHASE`; score 60 stays `CONSIDER` |
| price cannot change the score | the rating has no score input; the recommendation's first reason is the score whatever the price |
| unavailable value | `unavailable` rating with null deltas, never a favorable recommendation (`RECOMMENDED` at most) |
| thresholds and bands are configuration | overrides honoured; non-monotonic override falls back with a reason |
| new vehicles | no rating unless asked, no recommendation at all |

25 tests across the two files.
