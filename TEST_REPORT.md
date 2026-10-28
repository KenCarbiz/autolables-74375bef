# TEST_REPORT

Master build section 39. State of the automated suite on 2026-10-28 (UTC),
run from `main` after the eight build streams and the cursor amendment merged.
Every fixture in the suite is synthetic; no production VIN, price, slug or
tenant appears in a test.

## 1. Totals

| Run | Files | Tests | Result |
|---|---|---|---|
| Full suite (`bun run test`) on `main` at the merge | 371 | 6571 (1 skipped) | 2 failed, 6568 passed |
| Vehicle Intelligence modules (`bunx vitest run src/lib/intelligence`) | 15 | 175 | 175 passed |
| Typecheck (`bunx tsc -p tsconfig.app.json --noEmit`) | | | clean |

The intelligence run is a subset of the full suite. The same two
pre-existing failures remain and nothing else fails.

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
| Market Value V3 and valuation confidence | `marketValueV3.test.ts` | covered |
| Vehicle Score and Data Confidence | `vehicleScore.test.ts`, `dataConfidence.test.ts`, `scoreFixtures.test.ts`, `buyingConfidence.test.ts` | covered |
| Deal Rating and Buyer Recommendation hard gates | `dealRating.test.ts`, `buyerRecommendation.test.ts` | covered |
| Title and odometer classifier, recall classifier | `titleOdometer.test.ts`, `recallContract.test.ts` | covered |
| Passport read models (new, used) | `readModels/listingFacts.test.ts`, `readModels/usedPassport.test.ts`, `readModels/newPassport.test.ts` | covered |
| Provider policy and TTL engine | `providerPolicy.test.ts` (src/lib/market) | covered |
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

## 6. Administration V2 (2026-10-28)

State of the suite after the Administration refresh merged (keystone
`4ceac63` through the ending SHA named in `ADMIN_V2_FINAL_REPORT.md`). The
two pre-existing failures in section 2 are unchanged; nothing in the
Administration scope fails.

| Run | Files | Tests | Result |
|---|---|---|---|
| Full suite (`bun run test`) on the final main | 419 | 6986 (1 skipped) | 2 failed (section 2), 6983 passed |
| Administration suites (`bunx vitest run src/lib/admin src/pages/admin src/components/admin src/contexts/DealerSettingsContext.test.tsx`) | 48 | 415 | all passed |
| Parity harness unit tests (`node --test scripts/admin-parity/harness.test.cjs`) | 1 | 10 | all passed |
| Typecheck, production build | | | clean; the development-only fixture page is absent from the bundle |

Coverage by the handoff's test categories, mapped to files:

| Required coverage | Test file(s) | State |
|---|---|---|
| Security and permissions: a salesperson lands nowhere in Administration, forbidden tabs fall back, visibility never widens, restricted roles read but cannot apply | `src/lib/admin/sections.test.ts`, `src/pages/admin/children/FeeReviewPage.test.tsx`, `src/pages/admin/views/documents/ApprovalRulesView.test.tsx`, `ServicePolicyView.test.tsx`, `src/pages/admin/children/MemberRolePage.test.tsx`, `src/lib/admin/people.test.ts`, `enforcementMap.test.ts` | covered |
| Settings lifecycle: no write on mount, Review disabled when clean, changed keys only, refused writes never cached, re-baseline on load | `src/pages/admin/views/brand/brandViews.test.tsx`, `src/contexts/DealerSettingsContext.test.tsx`, `src/pages/admin/views/customer/customerViews.test.tsx`, `src/pages/admin/views/documents/*.test.tsx`, `src/lib/admin/reviewApply.test.ts` | covered |
| Pricing: cent-exact dry run, zero fee when disabled, consistency, rule matching, review-gated apply, unknown counts block apply | `src/lib/admin/pricing/*.test.ts`, `src/pages/admin/views/pricing/pricingData.test.ts`, `PriceRulesView.test.tsx`, `ProductsView.test.tsx`, `ApplicabilityView.test.tsx`, `src/pages/admin/children/FeeReviewPage.test.tsx`, `ProductApplicabilityPage.test.tsx`, `src/lib/admin/sql/*.test.ts` | covered |
| System health: HTTP-before-text classification, typed states, cron row alone is unknown, freshness, counts never zero on failure, RPC fallbacks, no reads or writes on mount | `src/lib/admin/health.test.ts`, `src/lib/admin/integrations/*.test.ts`, `src/pages/admin/views/integrations/*.test.tsx`, `src/pages/admin/children/SyncRunPage.test.tsx`, `src/lib/admin/attention.test.ts` | covered |
| Routing: no route enabled without a destination, accepted-only advancement, audit without PII, dry run sends nothing | `src/lib/admin/routingDraft.test.ts`, `src/lib/admin/escalation.test.ts`, `src/lib/admin/effectivePolicy.test.ts`, `src/pages/admin/children/EscalationPage.test.tsx` | covered |
| Publishing and documents: nested rules merged not replaced, warnings, service gates, saved print profile never reads Tested | `src/lib/admin/publishingPolicy.test.ts`, `src/lib/admin/documentPolicy.test.ts`, `src/pages/admin/views/publishing/*.test.tsx`, `src/pages/admin/views/documents/*.test.tsx` | covered |
| Visual: every screen renders from its fixture, the harness scores, masks and landmarks behave | `src/pages/admin/fixtures/*.test.tsx`, `scripts/admin-parity/harness.test.cjs`, `bun run admin:parity` | covered; scores in `ADMIN_V2_PARITY_REPORT.md` |

Reproduce:

```
bunx tsc -p tsconfig.app.json --noEmit
bunx vitest run src/lib/admin src/pages/admin src/components/admin src/contexts/DealerSettingsContext.test.tsx
node --test scripts/admin-parity/harness.test.cjs
bun run admin:parity
bun run test
```
