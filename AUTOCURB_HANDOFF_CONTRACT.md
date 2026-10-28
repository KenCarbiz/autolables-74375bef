# AUTOCURB_HANDOFF_CONTRACT

What AutoLabels exposes to the future AutoCurb project, as a typed, versioned,
validated payload. Master build sections 37 and 18; package file 18. AutoCurb
is a separate repository that receives its own build prompt later; nothing
here builds AutoCurb, and nothing here is an acquisition formula.

Code: `src/lib/intelligence/autocurbContract.ts` (types, `buildAutocurbHandoff`,
`validateAutocurbHandoff`, the VIN-history normaliser), tests in
`autocurbContract.test.ts`. Every shape it carries comes from
`src/lib/intelligence/contracts.ts`.

Version: `autocurb-handoff-1.0.0`.

## 1. The payload, field by field

| Field | Type | What it is | Source of truth in AutoLabels |
|---|---|---|---|
| `contractVersion` | string | The version AutoCurb pins against | this document |
| `generatedAt` | ISO | When the payload was assembled | the builder |
| `vin` | string | 17 characters, validated | listing |
| `identity` | `IdentitySummary` | year, make, model, trim, version, drivetrain, engine, transmission, colours, mileage, identity match level, factory-verified flag (exact levels only), decode source, provider confidence, freshness | NeoVIN decode, feed; `identityMatch.ts` |
| `mileage` | `MileageFacts` | current reading, when, source, authority class, whether the chronology is consistent | feed, inspection, history |
| `titleOdometer` | `TitleOdometerSummary` | one of VERIFIED_NO_ADVERSE_REPORTED, ADVERSE, REVIEW_REQUIRED, NOT_VERIFIED; brands and JSTL as reported; odometer status; evidence-exact public statement; entitlement-blocked and provider-failed flags | title classifier (stream D), NMVTIS conclusions only, never the report body |
| `vinHistory` | `VinHistorySummary` | ordered listing episodes (price, mileage, seller type, inventory type, source, first and last seen), mileage chronology, prior market exposure days, relisted count, returned-to-dealer, mileage conflict, freshness | `history_payload.entries` through `normalizeHistoryEpisodes` |
| `condition` | `ConditionSummary` | verified / partial / self-reported / unknown, source, inspection date, tyre and brake measurements, open items, completed recon, findings | AutoFilm and dealer inspections |
| `provenance` | `ProvenanceSummary` | designation, sold here, serviced here, service visits and share, years known, AutoFilm inspections, direct trade, facts | DMS and repair orders |
| `marketValue` | `MarketValueV3` | estimate, range, valuation confidence and reasons, qualified comp count, effective sample size, matching tier, identity level, geography, signals with weights, provider agreement, investigation flag, algorithm version, `publishable` | Market Value V3 (stream A) |
| `mds` | `MdsSummary` | days supply, cohort tier (VIN_EXACT, YMMT, YMM, MODEL, NATIONAL), geography, sample size, checked at | exact MDS ladder (`cohortLadder.ts`) |
| `salesStats` | `SalesStatsSummary` | inferred sold count, median last advertised price, median days to sell, cohort tier, geography, period, checked at, `wording: "inferred_sold"` | Inferred Sales Stats |
| `trend` | `TrendSummary` | rising / stable / softening / unknown, basis (sold summary or none), months, checked at | Sold Vehicles Summary when entitled |
| `recall` | `RecallSummary` | VIN contract state, the stored truth state, open and closed counts, model state, do-not-drive, public statement | `recallState.ts`, `recallView.ts`, the recall classifier (stream D) |
| `providerTimestamps` | `ProviderTimestamps` | syndication, NeoVIN, history, MDS, sales stats, sold summary, recall, valuation, title | each capability's last answer |
| `reserved` | list and note | `marketmatch`, `marketmatch_dealers`, `auction`, `fsbo`, with the sentence that AutoLabels never requests them | this contract |

Everything with a date carries the contract's `Freshness` (checked at, TTL,
stale at, state), so AutoCurb never invents a TTL and never reads a stale
figure as current.

## 2. What is deliberately absent

`validateAutocurbHandoff` refuses a payload that carries any of these, after
normalising case and separators, at any depth:

- AutoCurb's formula: `max_acquisition`, `recommended_max_acquisition`,
  `suggested_offer`, `target_gross`, `recon_economics`,
  `expected_recon_economics`, `holding_risk_reserve`, `acquisition_costs`,
  `wholesale_downside`, `auction_downside`, `marketmatch_fit`,
  `marketmatch_dealer_fit`, `manager_override`, `manager_approval`.
- Counts listing history cannot know (section 15): `owner_count`, `owners`,
  `accident_count`, `accidents`.
- Provider raw material (contracts `FORBIDDEN_READ_MODEL_KEYS`): `mc_raw`,
  `api_key`, `rawProvider`, `raw_payload`, `provider_pricing`,
  `report_body`, `aamva_report`.
- Any top-level key named after a reserved capability, and any change to the
  reserved list itself.
- A sold-statistics block whose wording is not `inferred_sold`.

## 3. Versioning and change rules

- Semantic versioning on `AUTOCURB_CONTRACT_VERSION`. Adding an optional field
  is a minor change; removing, renaming or re-typing a field, or changing a
  state vocabulary, is a major change. AutoCurb pins a major version and
  reads `contractVersion` before anything else.
- A new state in any vocabulary (title, recall, condition, provenance,
  cohort tier, trend) is a minor change only if AutoCurb's documented
  fallback is "treat as unknown"; otherwise major.
- The reserved list only grows. Removing a capability from it is a product
  decision taken in the master prompt, not a contract edit.
- The validator is part of the contract: a payload it refuses is not a valid
  handoff whatever its version string says.
- Every change to this file is accompanied by a change to
  `autocurbContract.test.ts` in the same commit.

## 4. What AutoCurb adds later, on its side

MarketMatch dealer fit, auction and wholesale downside, private-party and
FSBO context, expected recon economics, holding-risk reserve, target gross,
acquisition costs, recommended maximum acquisition, suggested offer, manager
approval and override. None of these may feed back into the used Vehicle
Score (section 30; contracts `SCORE_NEVER_INFLUENCED_BY`).

## 5. Reserved capabilities and where they are already refused

The provider registry (`src/lib/market/providerRegistry.ts`) carries each
reserved capability with `ownership: "autocurb"`, `status: "autocurb_reserved"`,
`triggers: ["never"]` and `appliesTo` of `no` for both AutoLabels vehicle
types:

| Registry key | Path | Billing product |
|---|---|---|
| `fsbo` | `/v2/search/car/fsbo/active` | fsbo |
| `auction` | `/v2/search/car/auction/active` | auction |
| `marketmatch_dealers` | `/v2/marketmatch/dealers/rank` | marketmatch |
| `marketmatch` | `/v2/marketmatch/vins/rank` | marketmatch |

`policyFor(key, "new" | "used")` returns `allowed: false` for all four with the
reasons `autocurb_reserved`, `not_for_<type>` and `never_triggered`;
`publicBrowseMayTrigger` is the literal `false` for every key; and
`NON_SCORE_AUTHORITIES` keeps `acquisition` and `offer_context` out of the
Vehicle Score. The MarketCheck MCP schema read of 2026-10-27 shows FSBO and
auction as a `seller_type` on the active search; the registry still treats
them as separate reserved capabilities until that discrepancy is resolved in
the registry reconciliation stream.

## 6. Delivery

The payload is a server-side object. How it reaches AutoCurb (a signed
endpoint on the shared project, a row in a shared table, or an export job)
is decided with AutoCurb's own prompt; this contract fixes only the shape and
the rules. Whatever the transport, the validator runs before anything leaves
AutoLabels.
