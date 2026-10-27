# MARKET_VALUE_V3_SPEC

AutoLabels Market Value V3 is one canonical, server-side market value for a
vehicle, built from evidence that has already been gathered and validated.
The module is `src/lib/intelligence/marketValueV3.ts` (`buildMarketValueV3`),
the output type is `MarketValueV3` in `src/lib/intelligence/contracts.ts`,
and the algorithm version is `market-value-v3.0.0-shadow`. It is pure: it
fetches nothing, writes nothing and never calls a provider.

It answers the master build prompt's section 29, and it stays inside two
boundaries drawn elsewhere: `market-valuation-write` remains the only writer
of the verdict columns (`writerBoundary.test.ts`), and the Vehicle Score is a
separate conclusion that market data may never raise (section 30).

## 1. Inputs

Every input is evidence that an earlier step produced; the service decides,
it does not collect.

| Input | Source today | Notes |
|---|---|---|
| `comparables` | the V2 engine (`src/lib/market`): `WeightedStats`, winning `ComparableTier`, relaxation steps, `MarketPriceBasis`, identity and concentration facts | `feeNormalized` says whether every comparable shares one fee basis (section 8) |
| `provider` | the validated MarketCheck prediction (`ProviderValuation` + `ProviderValidation`) and its age in days | the Base endpoint today; Premium later |
| `premium` | Premium comparable distribution: P25/P50/P75, count, fee-normalized flag | blocked on the entitlement call; optional |
| `soldContext` | inferred-sold median last advertised price before sale, count, scope, window | never a transaction price |
| `blackBook` | retail figure and an `operational` flag | ignored until the integration is live |
| `exactConfiguration` | a measured adjustment for the exact build, with `supported` | applied only at exact identity |
| `identityLevel` | `IdentityMatchLevel` from `identityMatch.ts` | caps confidence |
| `geography` | ZIP and requested radius | the winning tier's radius wins when known |
| `checkedAt`, `nowMs` | when the evidence was assembled | freshness on the policy TTL |
| `subjectAskingPrice` | carried for the audit trail only | never read; see section 5 |

## 2. Signals

Five estimate signals, each listed in the output in a stable order with
`used`, `weight` and `reason`, so a reviewer can see what counted and why
something did not.

| Signal | Used when | Base weight |
|---|---|---|
| `comparable_distribution` | effective comparables above zero and the distribution is fee-normalized | 1.0 scaled by effective sample size up to 5 |
| `marketcheck_prediction` | the validation says usable and the answer is at most 14 days old | 0.8 |
| `premium_comparables` | at least 3 comparables and fee-normalized | 0.9 scaled by count up to 5 |
| `sold_context` | at least 5 inferred sales in the cohort | 0.4 |
| `black_book` | the integration is operational and returned a figure | 0.5 |

The weights are configuration (`DEFAULT_SIGNAL_WEIGHTS`, overridable per
call), not constants a surface may read. A sixth input, the exact
configuration adjustment, is not an estimate: it moves the final figure by a
measured amount, only when the identity is exact and the evidence supports it.

## 3. Agreement

Disagreement is never averaged away.

- No usable signal: `providerAgreement: "none"`, value null, confidence
  unavailable. Never a zero and never a dollar figure.
- One usable signal: `single_signal`; confidence can be medium at best.
- Two or more: the spread between the highest and lowest usable estimates is
  measured against the comparable median (or the Premium median, or the first
  signal). At or below the threshold (default 7 percent, `disagreementThreshold`)
  the signals are averaged by weight and the agreement is `agree`. Above it the
  strongest-weighted signal decides alone, every other signal is set aside with
  the reason `excluded_material_disagreement`, confidence is capped at low,
  and `investigationFlagged` is true so the disagreement is looked at rather
  than hidden.

`disagreementPct` carries the measured spread either way.

## 4. Confidence

Confidence starts from the V2 rules (`resolveConfidence`): price basis,
provider validity and age, effective sample, independent rooftops, the 20
percent concentration rule, dealer-group identity, primary tier, provider
agreement and material contradictions. V3 then applies caps that only lower:

| Condition | Cap | Reason recorded |
|---|---|---|
| comparable tier was relaxed | medium | `comparable_tier_relaxed:<steps>` |
| the estimate has no comparable distribution behind it | medium | `no_comparable_distribution_in_estimate` |
| single signal | medium | `single_signal` |
| material disagreement | low | `sources_materially_disagree` |
| identity YMMT, YMM or generic candidate | medium | `identity_<level>_caps_confidence` |
| identity unknown | low | `identity_unknown` |
| a mixed-basis comparable distribution | signal unused | `comparables_fee_basis_not_normalized` |

A high confidence therefore requires exact identity, a fee-normalized primary
distribution with five or more effective comparables from three or more
rooftops, a fresh usable prediction that agrees within 3 percent, and no
relaxation or contradiction. That is deliberately hard to reach.

## 5. Price-blindness

The dealer's asking price is not an input to the value. `subjectAskingPrice`
exists on the input only so an audit row can show what the dealer was asking
when the value was computed; the test `the dealer's asking price changes
nothing` holds the output identical with and without it. Comparing the price
with the value is the Deal Rating's job (section 32).

## 6. Range

- With the comparable distribution in the estimate: P25 to P75, stretched to
  include the estimate.
- With only the prediction: the provider's own range, stretched to include
  the estimate.
- Otherwise: plus and minus `fallbackRangePct` (default 5 percent).
- Under material disagreement the range is widened by the measured spread.

The range is never narrower than the evidence it came from.

## 7. Geography and tier

`matchingTier` is the V2 winning tier. The geography scope follows the
tier's radius (A and B50 are 50 miles, B100 is 100, B200 is 200): local up
to 100 miles, regional up to 300, national for the context tiers D, E and F.
Without a tier the requested radius decides; without either it is unknown.

## 8. Outputs

`MarketValueV3`: `algorithmVersion`, `estimatedValue`, `rangeLow`,
`rangeHigh`, `confidence`, `confidenceReasons`, `qualifiedCompCount`
(eligible primary comparables), `effectiveSampleSize`, `matchingTier`,
`identityLevel`, `geography`, `signals`, `providerAgreement`,
`disagreementPct`, `investigationFlagged`, `checkedAt`, `freshness` (TTL 7
days, `MARKET_VALUE_V3_TTL_DAYS`) and `publishable`.

## 9. Shadow and rollout

`publishable` is the literal false in this version. The service runs under
`market_value_v3_shadow` once a server-side caller is wired (none is yet;
the flag is declared inert in `flagSafety.test.ts`), writes evidence only,
and never touches `market_value`, `market_position`, `market_checked_at` or
`market_payload`. `market_value_v3_public` is the only switch that would put
the figure on a customer surface, and only after a canary tenant has
produced shadow evidence that the figure, range and confidence behave.

## 10. What is blocked on the provider, and what happens without it

- Premium comparables: unproven until one authorized call. Without them the
  `premium_comparables` signal is listed as absent and nothing else changes.
- Sold Vehicles Summary and current Sales Stats cohorts: the sold context
  arrives as inferred figures or not at all; below five observations it is
  listed and not used.
- Black Book: no credentials; the signal is listed with
  `black_book_not_operational` and ignored.
- The prediction itself is refused while the monthly plan quota is
  exhausted; an absent or expired prediction leaves the comparable
  distribution as a single signal, capped at medium.

## 11. Tests

`src/lib/intelligence/marketValueV3.test.ts`, 19 cases: agreement and
weighting, stable signal order, agreement raises nothing beyond evidence,
thin sample, relaxed tier, material disagreement set aside and flagged,
single signal, identity caps, no signal is unavailable and never zero,
expired or rejected prediction, price-blindness, Black Book operational or
not, inferred-sold sample threshold and lower weight, Premium fee basis and
sample, exact-configuration adjustment only at exact identity, mixed fee
basis excluded, range never narrower than P25 to P75, geography by tier,
freshness on the TTL and the borrowed evidence stamp.
