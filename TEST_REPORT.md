# TEST_REPORT

Master build section 39. State of the automated suite on 2026-10-28 (UTC),
run from the Vehicle Intelligence build branch at the shared contracts base.
Every fixture in the suite is synthetic; no production VIN, price, slug or
tenant appears in a test.

## 1. Totals

| Run | Files | Tests | Result |
|---|---|---|---|
| Full suite (`bun run test`) at the contracts base | 358 | 6377 (1 skipped) | 2 failed, 6374 passed |
| Handoff contract and shared contracts (`bunx vitest run src/lib/intelligence`) | 2 | 14 | 14 passed |
| Typecheck (`bunx tsc -p tsconfig.app.json --noEmit`) | | | clean |

Combined: 359 files, 6384 tests, the same two pre-existing failures.

## 2. The two pre-existing failures

Both predate this program and are unrelated to provider or intelligence
code. They are left as they are so the baseline stays comparable; fixing
them is a separate, small change.

| Test | What it asserts | Why it fails today |
|---|---|---|
| `src/lib/complianceRedTeam.test.ts` > summarizeRedTeam blocker flag > sets blocker=false when only warns are present | a warn-only run is not a blocker | the summariser sets the blocker flag from any finding |
| `src/components/compliance/complianceData.test.ts` > issues and overview > does not treat NO_MODEL_CAMPAIGNS_FOUND as compliance clearance | a model-level "no campaigns" answer is not clearance | the 30-day NHTSA clock treats the answer as a completed check |

## 3. Section 39 coverage, mapped to test files

Test files are listed by name next to their module. "Covered" means a
vitest file exercises the rule; "in progress" means the stream building the
module is writing the tests in the same commit; "not found" means no file
with a matching name exists and the next review should search by content
before writing a new one.

| Required coverage | Test file(s) | State |
|---|---|---|
| Pinned feed outcome and honest refusal classification | `pinnedFeedOutcome.test.ts`, `providerEnvelope.test.ts` | covered |
| Crawl outcome, URL policy, price guard, format, queue rotation, stock number, render pacing | `crawlOutcome.test.ts`, `crawlUrlPolicy.test.ts`, `priceGuard.test.ts`, `crawlFormat.test.ts`, `crawlQueueRotation.test.ts`, `crawlerStockNumber.test.ts`, `renderPacer.test.ts` | covered |
| Provider budget admission and recording | `providerBudget.test.ts`, `mcCost.test.ts` | covered |
| Provider registry (ownership, triggers, reserved, deprecated, influences) | `providerRegistry.test.ts` | covered |
| NeoVIN normalisation, sheet, promotion | `normalizeNeovin.test.ts`, `neovinSheet.test.ts`, `neovinPromotion.test.ts` | covered |
| Source data and identity match tiers | `sourceData.test.ts`, `identityMatch.test.ts` | covered |
| Fee basis and price basis | `listingFeeBasis.test.ts`, `priceBasis.test.ts` | covered |
| Cohort ladder (MDS, sales stats tiers) | `cohortLadder.test.ts` | covered |
| Sold wording (inferred sold, never "sold") | `soldLanguage.test.ts` | covered |
| Recall state, view, legacy rows | `recallState.test.ts`, `recallView.test.ts`, `recallViewLegacyRows.test.ts` | covered |
| Dealer group and rooftop scoping | `dealerGroup.test.ts` | covered |
| Flag safety (default off, reader audit, shadow source) | `flagSafety.test.ts` | covered |
| Writer boundary and propagation safety | `writerBoundary.test.ts`, `propagationSafety.test.ts` | covered |
| Payload shape drift and raw payload boundary | `payloadShape.test.ts`, `rawPayloadBoundary.test.ts` | covered |
| Enrich cursor migration | `enrichCursorMigration.test.ts` | covered |
| Edge mirror in sync with the client registry | `edgeLibSync.test.ts` | covered |
| Shared Vehicle Intelligence contracts | `contracts.test.ts` | covered |
| AutoCurb handoff contract | `autocurbContract.test.ts` | covered, 7 tests |
| Market Value V3 and valuation confidence | stream A | in progress |
| Vehicle Score and Data Confidence | stream B | in progress |
| Deal Rating and Buyer Recommendation hard gates | stream C | in progress |
| Title and odometer classifier, recall classifier | stream D | in progress |
| Passport read models (new, used) | stream E | in progress |
| Provider policy and TTL engine | stream G | in progress |
| Syndication sync, prune and segment rules | none by name | not found |
| Comparables engine internals (concentration, outliers, composite, adjustments, similarity) | none by name | not found |
| Title, NMVTIS and VINData boundary (no report body persisted) | none by name | not found |
| Equipment class | none by name | not found |
| Incentives | none by name | not found |

## 4. What the handoff contract tests prove

- A payload built from the contract types carries the version, the
  reserved-capability list in its fixed order, and passes validation.
- The serialised payload contains no acquisition-formula key, no owner count
  and no accident count, by type and by key.
- The validator refuses a suggested offer, a camel-cased maximum
  acquisition at depth, provider raw material, an owner count, reserved
  data, an altered reserved list, a malformed VIN, and sold wording other
  than `inferred_sold`.
- The history normaliser reads the provider's spellings (price, mileage,
  seller type, inventory type, source, first and last seen, in ISO and in
  epoch seconds), orders episodes by first-seen, and never emits owner or
  accident counts.
- The summary reports mileage chronology, market exposure days, relisting
  count, a return to the same source, a backwards mileage as a conflict,
  freshness from the checked-at date, and nulls from an empty history.

## 5. How to reproduce

```
bunx tsc -p tsconfig.app.json --noEmit
bunx vitest run src/lib/intelligence
bun run test
```

The full suite takes several minutes; the two failures named above are the
expected baseline until they are fixed in their own change.
