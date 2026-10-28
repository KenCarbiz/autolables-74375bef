# VEHICLE_SCORE_AND_CONFIDENCE_SPEC (`vehicle-score-v1.0.0-shadow`, `data-confidence-v1.0.0`)

Two numbers, two questions. The Used Vehicle Score answers "what is this
vehicle, on the evidence we hold?" Data Confidence answers "how much of the
vehicle's story is actually in evidence?" They are computed by separate pure
modules from the same contract summaries, and the design rule that governs
both is that missing evidence moves confidence and never moves the score.

Modules: `src/lib/intelligence/vehicleScore.ts` (`buildVehicleScore`) and
`src/lib/intelligence/dataConfidence.ts` (`buildDataConfidence`). Contracts:
`src/lib/intelligence/contracts.ts`. Both modules are shadow-only: nothing in
`src/pages`, `src/components` or the read models calls them yet, and the
section 38 flags that will gate them (`vehicle_score_shadow`,
`vehicle_score_public`, `data_confidence`) have zero readers.

## Who gets a score

| Case | Result |
|---|---|
| `vehicleType: "new"` | `applicable: false`, `score: null`, reason `vehicle_type_new_no_used_score`. A new vehicle is a factory configuration and a compliance question, not a used-car intelligence problem. |
| Identity below `EXACT_VIN` / `EXACT_BUILD` | `applicable: true`, `score: null`, reason `identity_not_exact:<level>`. `vehicle_score_evidence` is an exact-only claim in `identityMatch.ts`; a YMMT match describes vehicles like this one, not this one. |
| No domain assessable | `score: null`, reason `no_assessable_evidence`. |
| Otherwise | Integer 0 to 100 with a label. |

## Domains, weights and inputs

Starting weights are `SCORE_WEIGHTS` in `contracts.ts`. They are configuration:
`buildVehicleScore(input, { weights })` overrides them per call, and the public
lock should follow a calibration pass over real inventory, not these defaults.

| Domain | Weight | Reads | Assessable when |
|---|---|---|---|
| `integrity` | 35 | `IdentitySummary`, `TitleOdometerSummary` | always for an exact identity |
| `condition` | 30 | `ConditionSummary` | an inspection or self-report is on file (`state` not `unknown`, `source` not `none`) |
| `provenance` | 20 | `ProvenanceSummary` | designation known, or sold/serviced here known, and `source` not `none` |
| `documentation_safety` | 15 | `RecallSummary`, `DocumentationFacts` | VIN recall answered, or any documentation fact is known either way |

`DocumentationFacts` is the one input not yet carried by a contract summary:
`serviceRecordCount`, `inspectionEvidenceOnFile`, `warrantyDocumented`,
`windowStickerOnFile`, each nullable. See open questions.

A domain that is not assessable scores `null`, lists what is missing, and
drops out of the weighted total. The remaining weights are renormalized over
the assessed domains and the result says so
(`weights_renormalized_over_assessed_domains:<keys>`,
`domains_not_assessed:<keys>`), so a thin file and a full file with no adverse
findings land on the same score, and only Data Confidence tells them apart.

## Scoring rules

Every domain starts at 100. Only an actual adverse finding deducts; a weaker
authority caps the domain instead of deducting. All amounts are
`SCORE_DEDUCTIONS` in `vehicleScore.ts` and are starting values.

| Domain | Finding | Deduction |
|---|---|---|
| integrity | junk, salvage or total loss reported (NMVTIS) | 70 |
| integrity | other title brand, each | 35, capped at 70 |
| integrity | odometer rollback indicated | 60 |
| integrity | odometer conflict between readings | 30 |
| integrity | title state `REVIEW_REQUIRED` | 15 |
| condition | open major finding, each | 35, capped at 70 |
| condition | open moderate finding, each | 15, capped at 45 |
| condition | open minor finding, each | 5, capped at 20 |
| condition | open items with no itemized findings, each | 8, capped at 40 |
| condition | lowest tire below 4/32 (worn) or 3/32 (critical) | 15 or 25 |
| condition | thinnest brake below 3 mm (worn) or 2 mm (critical) | 15 or 25 |
| condition | partial inspection | ceiling 85 |
| condition | seller self-report | ceiling 70 |
| provenance | none; the domain is a base by designation | known_since_new 100, serviced_here 85, direct_trade 85, dealer_buyback 75, previous_dealer_sale 70, first_seen 55 (serviced-here-only 80, sold-here-only 75 when the designation is unknown) |
| documentation_safety | open VIN recall, each | 40, capped at 70 |
| documentation_safety | do-not-drive campaign | 100 (domain reads 0) |
| documentation_safety | open OEM service campaign | 10 |

Resolved findings, completed recon, measured tires and brakes, service
visits and known documents are recorded as `evidence` on the domain. A
documentation fact known to be absent (no warranty on file) is evidence, not
a finding, and does not deduct. Title brands reported by NMVTIS are listed by
name in `adverse` so the reason trail matches the public statement.

## What can never raise the score

`SCORE_NEVER_INFLUENCED_BY` in `contracts.ts` names them: market demand,
dealer price, deal rating, MarketMatch, auction, FSBO, cheapness, days supply,
sales velocity, incentives. The enforcement is structural, not a filter:
`VehicleScoreInput` has no field for any of them, and the test spreads a bag
of price and market keys into the input and asserts the result is identical.
A later contributor who wants the market in the score has to add a field to
the input type, which is the review hook.

## Labels

`scoreLabel(score, bands)` maps on `DEFAULT_SCORE_LABEL_BANDS`: Outstanding
at 90, Excellent at 80, Good at 70, Fair at 60, Caution below. The bands are
overridable per call (`labelBands`). The label set itself is `SCORE_LABELS`
in the contracts and is not configuration.

## Data Confidence

`buildDataConfidence(input, { bands })` scores coverage of the facts the file
is expected to hold, per domain, then applies caps.

| Domain | Expected facts (used) | Authoritative when |
|---|---|---|
| integrity | identity_exact, factory_decode_confidence, title_checked, odometer_checked | identity from NeoVIN; title and odometer from the government record |
| condition | inspection_on_file, tires_measured, brakes_measured, open_items_reviewed | state `verified` or `partial` (a seller self-report is present but weak) |
| provenance | relationship_known, service_history_known, sold_here_known, inspection_count_known | source `dms` |
| documentation_safety | vin_recall_answered, warranty_documented, window_sticker_on_file, service_records_known, inspection_evidence_known | always |

New vehicles are measured on integrity and documentation only (identity,
decode confidence, VIN recall, warranty, window sticker); condition and
provenance coverage are `null`, not zero.

Credit per present fact (`DATA_CONFIDENCE_RULES`): current 1.0, freshness
unknown 0.75, stale 0.5; a dealer-held document fact has no TTL and earns
full credit; a fact from a weak authority is multiplied by 0.7. Domain
coverage is earned credit over expected facts; overall coverage is the mean
of the expected domains. Then:

- each unresolved conflict (caller-named, plus an odometer conflict or
  rollback from the title summary) removes 10 points, capped at 30, and any
  conflict caps the level at Moderate;
- a factory-decode confidence below 0.7 removes 5 points;
- stale facts are listed by key in `staleFacts`.

Level by `DEFAULT_DATA_CONFIDENCE_BANDS`: High at 85, Moderate at 60, Limited
below, then capped by `identityConfidenceCeiling(matchLevel)`: exact is High,
YMMT caps at Moderate, YMM and generic cap at Limited, unknown identity is
Limited with reason `identity_unknown_confidence_limited`.

Presentation: the public surface shows High, Moderate or Limited and the
reasons. `coveragePct` is internal and is not shown as a percentage, which
would read as precision the evidence does not have.

## Relation to `buyingConfidence.ts` (v1)

`computeBuyingConfidence` (bands exceptional, strong, fair, caution) mixes
price position with condition evidence in one number. The new pair separates
them: the Vehicle Score has no price input, and the price question moves to
the Deal Rating. v1 stays in the tree and keeps its current readers until the
shadow comparison is done; it is superseded in shadow, not removed.

## Section 39 cases covered by the tests

| Case | Test |
|---|---|
| price, value, deal rating, demand cannot change the score | `vehicleScore.test.ts` "no market input" |
| unknown evidence lowers confidence, not the score | `vehicleScore.test.ts` "thin file and full file"; `dataConfidence.test.ts` "keeps its score band and loses confidence" |
| title brand lowers integrity only | "a title brand lowers integrity and nothing else" |
| junk/salvage/total loss | "takes integrity to the floor" |
| odometer rollback vs conflict | "rollback lowers integrity more than a conflict" |
| open recall lowers documentation_safety only; do-not-drive reads 0 | "open recall", "do-not-drive" |
| major condition finding lowers condition only; resolved findings do not | "major open condition finding", "resolved finding" |
| self-report capped, not deducted | "worn tires and brakes; seller self-report" |
| new vehicle has no used score | "a new vehicle gets no used score" |
| identity below exact cannot carry a score | "identified below exact" |
| weights sum to 100, renormalization, overrides | "weights and renormalization" |
| labels and band overrides | "labels" |
| full file High, thin Limited, partial Moderate, bands configurable | `dataConfidence.test.ts` "coverage and the public level" |
| identity ceiling, conflicts cap, stale facts, weak decode confidence, weak authority | "what lowers confidence" |
| new vehicle: condition and provenance not expected | "new vehicles" |

Fixtures are synthetic (`scoreFixtures.test.ts`); no production VIN, price,
dealer or report appears in the tests.

## Open questions for the owner and the other streams

1. `DocumentationFacts` has no contract summary. Either stream E's read model
   supplies the four booleans from `vehicle_documents` and the warranty
   summary, or a `DocumentationSummary` is added to `contracts.ts`.
2. Deductions and label bands are starting values. The shadow run should
   compare score distribution against v1 `computeBuyingConfidence` bands on
   real inventory before `vehicle_score_public` is considered.
3. Provenance scores depth of relationship with no adverse entries. If the
   owner wants a previous-dealer-sale or buyback designation to read as a
   finding rather than a lower base, that is a one-line change in
   `SCORE_DEDUCTIONS.provenance.base`.
4. Data Confidence treats a seller self-report as present but weak (0.7).
   If the owner prefers it not to count at all, set `weakAuthorityCredit`
   to 0.
