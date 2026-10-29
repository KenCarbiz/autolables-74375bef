# AutoLabels consolidated release plan (2026-10-29)

Prepared for the owner. Nothing in this round was deployed, published,
migrated, applied or paid for. Production pricing is unchanged.

**Production state, read-only, at 19:17 UTC:**
- The crawler still serves the pause build: the 503 answer has no `control` field, which is the `0aaf4d9` build.
- Cron job 1 (`autolabels_crawl_advertised_prices`) is inactive.
- The latest migration-ledger row is 20261028000000.
- No migration has been applied since then.

**Where this round's work is.**
- It is committed to the review branch `claude/release-plan-2026-10-29`, one commit on top of `main` at `6aeecfb`, not to `main` itself. Section 5 explains why: `main` reaches the live site.
- The evidence package is `scripts/admin-parity/evidence/release-review/` (see its `MANIFEST.txt`).

---

## 0. Three facts that change the plan

1. **Administration V2 is already live.**
   - The live site (autolabels.io and autolables.lovable.app) serves `index-DsYIxfuL.js`. Fetched at 18:49 UTC through the database's outbound HTTP.
   - Its PlatformAdmin chunk contains the Budgets panel sentence added in `bdc86aa` today at 17:11 UTC ("An enforced limit covers every call…").
   - It does not contain the sentence that commit replaced.
   - Its index references the `crawlPaused` module, added in `4cebf53` at 16:02 UTC, and the `AdminV2` chunk.
   - So the live frontend was built from `main` at or after 17:11 UTC today. "The old website" is not a missing publish of Admin V2.
2. **A push to `main` reached the live site within the hour.**
   - Lovable's edit history lists commits and no publish events.
   - Either someone pressed Publish between 17:11 and 18:49 UTC, or the project publishes from `main` on its own.
   - Until you confirm which, treat any push to `main` as a release.
3. **Zod 4.6.7 is already live.**
   - The live `VinBarcodeScanner` chunk carries zod's version constant 4.6.7.
   - It shipped because the lockfile on `main` resolves it (`e53a6f3`), not through a reviewed decision. See section 3.

---

## 1. Launch requirements versus optional work

**Launch scope assumed here:**
- Dealers sign in and manage settings in Administration.
- Dealers create and publish listings, with their passports, through the sticker publish path.
- Dealers sign addenda.
- Customers open passports at `/v/:slug`.
- Automated crawling and optional enrichment stay paused.

**Can the app launch with automated crawling and optional enrichment paused? Yes.** Evidence (code read and tests; file references in the readiness report):
- **The only database block on publish is a known do-not-drive recall** without an admin override (`20260629100000_ingest_publish_and_install_gate.sql`). It is fed by the free NHTSA lookup.
  - `publishListing` reads no crawler field (`price_last_verified_at`, `price_parse_status`).
  - `PublishPriceGate` lets a dealer continue, with an audit warning, when no advertised price is on file.
- **Without crawled values the passport uses `listing.price`** (`passportV2Data.ts:517-519`). Test: "NEW #10 — missing doc fee: no fee row, selling equals total".
- **Without enrichment, passport modules show pending or unavailable states.** Market value, comps, specs, history and title never claim "verified".
  - Tests: `verificationReport.test.ts`, `verificationSummary.test.ts` ("missing data is pending, never fabricated as verified"), `fabricatedClearCanary.test.ts`.
- **The compliance price screen shows "not monitored" without crawl data**, never "matched" (`complianceData.test.ts`).
- **What does change: the MarketCheck feed being off means new inventory is entered by hand**, and sold cars are not removed automatically. Their passports stay live until someone archives them.

| Item | Flow affected | Blocks launch? | Evidence | Safe to keep disabled? | Implementation / test / deployment |
|---|---|---|---|---|---|
| A. Automated advertised-price crawler | Dealer price verification; compliance price screen | **No** | As above; publish does not read crawler fields | Yes. The pause build is live and the cron is paused | Corrected crawler on `main`, 12 isolated stages pass, not deployed |
| B. Optional paid enrichment (MarketCheck comps, specs, recalls, title, incentives, valuation; Black Book; Firecrawl search; window stickers; Google Places) | Passport modules; dealer enrichment buttons | **No** | Pending and unavailable states (tests above). The recall publish block uses free NHTSA | Yes, with D3–D7 below fixed or accepted | Fail-closed gate on `main`, tested, not deployed. Deployed MarketCheck callers (`2b03c4e`) still fail open |
| C. MarketCheck inventory feed | Inventory freshness; removal of sold cars | **No** for publishing | Refusal leaves inventory untouched (`sync-verify/results/failclosed-lanes-off.txt`) | Yes, **if** someone archives sold cars by hand | Cron paused; provider quota refused until Nov 1 |
| D1. Hand-made listings store only the fee-inclusive price | Customer passport price breakdown | **Yes (recommended)** | `createListing` writes `price` only (`useVehicleListing.ts:267-285`), so the passport shows Selling Price = Total with no doc-fee line. Today 0 of 131 published listings are affected (all came from the feed or crawler); every new hand-made listing would be | n/a | Not implemented. Needs the fee decision (section 4, D-2) |
| D3. A model-level NHTSA campaign is shown as "Open safety recall reported" on this car | Customer passport | **Yes (recommended)** | `riskSignalled` includes model campaigns (`recallView.ts:411-416`), giving `needs_attention` and that wording (`VehiclePassportGoverned.tsx:689-695`). With no VIN-level source while MarketCheck is paused, every car whose model line has a campaign gets it | n/a | Not implemented. Copy change on the locked passport needs your sign-off |
| D4. "History checked" and "Equipment analyzed" are shown with no data | Customer passport | **Yes (recommended)** | Static headings (`VehiclePassportGoverned.tsx:1431-1432`) | n/a | Not implemented. Same sign-off |
| D5. A specs decode attempt is counted when the budget refuses the call | Dealer data quality | No, but fix **before** re-enabling enrichment | `factory-sticker-orchestrate/index.ts:514-527`; cap 3 (`sourceData.ts:36`) | Yes | Not implemented |
| D6, D7. Refusals read as "No factory options found", "Sync complete — no new data", "No OEM window sticker found" | Dealer tools | No | `useVehicleSpecs.ts:32-34`, `OverviewTab.tsx:89-97`, `useOemSticker.ts:22-28` | Yes | Not implemented |
| E. Publish control (automatic or manual) | Every frontend change | **Yes (process)** | Section 0 | n/a | Your answer needed |
| F. Visual acceptance of nine screens | Administration appearance | Your acceptance gate. Not a functional dependency; Admin V2 is already serving | Section 2 | n/a | Packages ready; nothing approved on your behalf |
| G. Administration usability fixes from this round | Admin 02, 05, 10, 11 | No | Section 2 | n/a | Implemented and tested on the branch; not on `main`, not live |
| H. Pending migrations: 20261101/02/04 (crawl), 20261103/06 (budgets), 20261105 (fee-preview record) | Crawl evidence and controls; budgets; ledger | No, while crawling and enrichment are paused | Isolated harnesses pass; production unchanged | Yes | Prepared, not applied |
| I. Policy B (fee basis) | Fee changes and price display | No, if no fee change is made at launch. Related to D1 and the 05 finding | `supabase/proposed/20261031000000` | n/a | Pending your decision |
| J. SignalHouse SDK (SMS) | Lead alerts and texts | No: the deployed SMS functions keep their current bundle until redeployed | Section 3 | n/a | Decision needed before any SMS deploy |
| K. Zod 4 | VIN scanner chunk (live); `marketcheck-specs` and `factory-sticker-orchestrate` on their next deploy | No | Section 3 | n/a | Already live in the frontend |
| L. Test hygiene | Release gate | No | Two clock-dependent fixtures (SB 766 effective date; a recall answer dated Sep 8). `functionAuth` times out only under full-suite load (passes alone, 78/78) | n/a | Fix proposed, not made |
| M. `marketcheck-specs` type errors (14, `neovinSheet.ts`); `marketcheck-sync` scheduled path not exercised at runtime | Feed and specs | No while paused | Readiness report | Yes | Open |

Also found, harmless while MarketCheck is paused:
- `useRecallLookup` expects a `recalls` array that `marketcheck-recalls` no longer returns, so the client always falls back to free NHTSA. The test mocks the old shape.
- CLAUDE.md's "prep sign-off gates publishing" is out of date: only the do-not-drive recall block remains.

---

## 2. Visual review

**Scores** are protocol v2 *masked reference-match scores*:
- The fixture is captured at the references' native 1586×992 and compared pixel for pixel. Neither image is resized; `results.json` records `referenceResampled=false` for all 13.
- **No part of today's gap comes from the old 1600×1000 resampling.**
- **Accepted, unchanged: 01, 06, 08 and 12.** Each capture is pixel-identical to its accepted baseline in this round's final run.
  - Screen 06 changed once mid-round, when a shared fixture changed. I reverted that and scoped the fix to 05.
- **Pending: 02, 03, 04, 05, 07, 09, 10, 11, 13.** None is approved.

**Where the missing points come from.** Every pixel the score counts as different was assigned to one cause:
- **The method** (`scripts/admin-parity/decompose.cjs`) reads DOM line, icon and box positions from the same native capture.
- **The table** shows points of the score at a 2px / 4px text-position tolerance.
- **Font** means the two "glyph rasterization" and "type size" columns. They count only text sitting where the mock's text sits.

| Screen | Score | Missing points | Glyph rasterization | Type size or width, in place | Text position (moved or where the mock has none) | Icons | Geometry (fills, borders, spacing, sizes) |
|---|---|---|---|---|---|---|---|
| 01 | 92.99% | 7.01 | 0.29 / 0.33 | 2.72 / 4.55 | 2.41 / 0.53 | 0.56 | 1.04 |
| 02 | 88.01% | 11.99 | 0.00 / 0.00 | 0.00 / 0.16 | 3.88 / 3.72 | 0.40 | 7.72 |
| 03 | 90.70% | 9.30 | 0.00 / 0.00 | 0.13 / 0.42 | 3.16 / 2.88 | 0.25 | 5.76 |
| 04 | 89.87% | 10.13 | 0.00 / 0.00 | 0.02 / 0.34 | 6.36 / 6.04 | 0.53 | 3.21 |
| 05 | 89.87% | 10.13 | 0.00 / 0.00 | 0.00 / 0.09 | 5.08 / 4.99 | 0.23 | 4.83 |
| 06 | 94.11% | 5.89 | 0.53 / 0.53 | 1.87 / 2.35 | 1.42 / 0.95 | 0.32 | 1.74 |
| 07 | 87.86% | 12.14 | 0.03 / 0.03 | 0.12 / 0.96 | 5.50 / 4.66 | 0.29 | 6.20 |
| 08 | 92.12% | 7.88 | 0.09 / 0.13 | 0.27 / 1.50 | 5.03 / 3.76 | 0.51 | 1.98 |
| 09 | 86.53% | 13.47 | 0.02 / 0.02 | 0.47 / 1.38 | 5.05 / 4.14 | 0.27 | 7.67 |
| 10 | 89.53% | 10.47 | 0.27 / 1.09 | 0.30 / 1.98 | 6.29 / 3.80 | 0.18 | 3.42 |
| 11 | 89.84% | 10.16 | 0.08 / 0.08 | 0.07 / 0.63 | 5.10 / 4.54 | 0.09 | 4.81 |
| 12 | 92.22% | 7.78 | 0.05 / 0.38 | 0.44 / 2.25 | 4.39 / 2.24 | 0.39 | 2.51 |
| 13 | 87.77% | 12.23 | 0.00 / 0.00 | 0.19 / 0.56 | 5.68 / 5.32 | 0.31 | 6.05 |

**Reading:**
- On the nine pending screens, **measured font differences are 0.00 to 3.07 points**, at most 0.57 at the strict tolerance. Glyph rasterization is at most 1.09 points.
- The rest is **intentional or proposed layout**:
  - text that sits elsewhere because of the approved title block, section row and margins: 2.9–6.4 points;
  - geometry such as card sizes, bands, borders and spacing: 3.2–7.7 points;
  - icon substitution: 0.1–0.5 points.
- The geometry column does not move between tolerances, so it is not a tolerance artefact.
- **Correction.** The earlier 03/04/07 lists labelled three boxes "font rasterization" (03 #9, 04 #7, 07 #9). Measured inside those boxes the font share is 23%, 0% and 0%. They are relabelled (`itemcheck.cjs`, `EXCEPTIONS-03-04-07.md`).
- **Capture stability.** Two captures of 07 taken minutes apart differ by 19 pixels in one small unmasked region. Scores are equal to two decimals.

**Usability defects fixed this round.** No broad score tuning, and no accepted screen changes. Scores for the pending screens are unchanged to two decimals.

| # | Screen | Defect | Fix | Test |
|---|---|---|---|---|
| 1 | 02 | In the design fixture an edit said "Review to apply them" but Review changes stayed disabled, with no reason | The fixture opens the review list; Apply stays disabled and says "Design fixture: saving is disabled." Live mode is unchanged | `brandViews.test.tsx` "the design fixture opens the review…" |
| 2 | 10, 11 (and every document settings review) | Closing the review dialog left keyboard focus on the page body | Shared `useReturnFocus` added to both dialogs | `ApprovalRulesView.test.tsx` "returns focus…" fails without the fix; state runs show focus returned in all 14 closes |
| 3 | 10 | Rule text read "must complete a completed K-208 inspection, verified installs" | It now reads "needs a completed K-208 inspection and verified installs" | `publishingPolicy.test.ts` "names the retail-readiness gates…" |
| 4 | 05 (phone) | Scope select clipped "Active inventory (default"; the policy list wrapped one value over four lines; the consistency header squeezed its description to one word per line | Phone-only layout classes (`sm:` keeps desktop identical) | Phone captures in `phone/05-*` |
| 5 | 05 | The preview showed "2024 Example Crossover" with stock EX-1041, which is row 1's "2023 Example Sedan" | The 05 fixture names the preview after that vehicle (06's shared fixture untouched) | Capture; 06 identical to its baseline |

**Open finding on 05, reported and not changed.**
- For stock EX-1041 the preview reads Selling price $38,630 + $895 = $39,525.
- The consistency card reads $39,525 before fee + $895 = $40,420.
- The two read different stored fields under the stated basis. This is the Policy B question in section 4.

**Package** (`scripts/admin-parity/evidence/release-review/`):
- **Annotated images:** desktop, phone and a child or state view for each of the nine screens (28 images).
- **Numbered exception lists:** `EXCEPTIONS-02-05-09-10-11-13.md` and `EXCEPTIONS-03-04-07.md`.
- **Supporting evidence:** cause maps, state captures with `states.json`, and phone viewports.

---

## 3. Dependency questions (separately)

Both changes came from one Lovable request at 21:47 UTC on 10-28, "Fix all known dependency security issues". Its scan listed advisories for four packages, and the agent changed them in `e53a6f3` without reporting a review.

### SignalHouse SDK 1.0.66 → 1.6.0

- **Why it changed:** advisory GHSA-8r9p-f939-6h3c and GHSA-q3jh-wrc6-jgq8 (high) in `follow-redirects`, a dependency of the SDK through axios.
- **Was 1.6.0 necessary? No.**
  - A fresh lock of 1.0.66 resolves axios 1.21.0 and follow-redirects 1.16.2, and `npm audit` reports 0 vulnerabilities.
  - The old lockfile had pinned follow-redirects 1.16.0.
- **Affected code:**
  - `_shared/signalhouse.ts` (`sendSMS`), used by `send-sms` and `verify-passport-document-request`;
  - `signalhouse-webhook` imports only a pure helper but loads the SDK at start.
  - The frontend does not use the SDK.
- **Compatibility evidence** (`scripts/sms-verify/`, real package, no provider call):
  - Same request, same auth and same response envelope in both versions.
  - 1.6.0 adds a 30-second timeout. 1.0.66 has none: in the harness a hung request held until the stand-in answered at 40 seconds.
  - 1.6.0 is a deprecated shim, end of life 2027-05-01.
  - Neither version's install script runs under Bun without `trustedDependencies`.
- **Smallest viable alternative:** 1.0.66 with the refreshed lockfile (`scripts/sms-verify/proposed-revert-sdk-1.0.66.patch`).
- **Recommendation:** keep 1.6.0 for the timeout, pin it exactly (`"1.6.0"`, not `^1.6.0`), and move to `@signalhouse-sms/sdk` before 2027-05-01.
  - Either choice resolves the advisory.
  - Not part of any launch batch: SMS functions are not redeployed until you decide.

### Zod 3.25.76 → 4.6.7

- **Why it changed:** advisory GHSA-mrhx-c7xc-m3w5 (high), "Zod can exhaust memory while validating oversized constrained collections", affecting every version below 4.6.6.
  - Confirmed through the npm registry's audit API.
  - No 3.x release fixes it.
- **Was it necessary?**
  - To clear the advisory, yes.
  - For actual exposure, no. The only runtime use of zod is `src/lib/factorySticker/validate.ts` and its edge copy.
  - Schemas are built when the module loads, but `validateStickerData` is called only in tests.
  - The production paths import `vinNormalize`, which does not use zod. The vulnerable validation path is not reached.
- **Affected code:**
  - the frontend VIN scanner chunk, **already live with 4.6.7**;
  - the edge functions `marketcheck-specs` and `factory-sticker-orchestrate` (through `normalizeNeovin` → `validate.ts`), which resolve bare `zod` from the lockfile's `node_modules` on their next deploy. The deployed copies predate the change.
- **Compatibility evidence:**
  - App typecheck clean on 4.6.7.
  - Full suite on the lockfile's dependencies: 7,382 passed, 1 skipped, and the same 2 clock-dependent failures as on zod 3. This includes `validate.test.ts`, which exercises the schemas.
  - Production build succeeds.
  - The code uses `superRefine`, `ZodIssueCode.custom`, `.strict()`, `.datetime({offset})` and `.url()`, all present in zod 4's classic API.
  - Zod 4 rewords its built-in messages. No code or UI matches on them.
- **Smallest viable alternative:** pin `zod` back to `^3.25.76` and refresh the lockfile. That leaves the advisory open (unreachable today) and needs a frontend release to take effect.
- **Recommendation:** keep 4.6.7.
- **Related:** react-router-dom 6.30.2 → 6.30.6 in the same commit is a patch release. Two moderate advisories remain that only react-router 7 fixes; not proposed.

---

## 4. Decisions for you (business choices only)

| # | Decision | Options | Evidence | Recommendation | What waits on it |
|---|---|---|---|---|---|
| D-1 | Provider caps and which paid services run at launch | (a) all optional enrichment off at launch; (b) the proposed limits: feed 100 calls a month, MarketCheck enrichment 1,000, Firecrawl 500 in a pilot month, Google Places 20, VinAudit, MonroneyLabels and Black Book off | Readiness report, provider table (list prices; unknown prices make dollar caps unusable) | (a) for launch; set (b) only when you want enrichment back | Budget migrations 20261103 + 20261106 (batch 4) |
| D-2 | Fee policy | (i) adopt Policy B or not; (ii) for hand-made listings, itemize the doc fee (store the before-fee price and the fee) or keep showing the total only | 05 finding (section 2); D1 (section 1); `supabase/proposed/20261031000000` | Itemize on hand-made listings (needed for D1); decide Policy B separately | D1 fix (batch 1b); any fee change |
| D-3 | SignalHouse SDK | Keep 1.6.0 (pin exactly) or revert to 1.0.66 with the refreshed lockfile | Section 3 | Keep 1.6.0, pinned | Any SMS function deploy |
| D-4 | Zod | Keep 4.6.7 (live) or revert to 3.25.76 (advisory open, unreachable) | Section 3 | Keep 4.6.7 | Deploys of `marketcheck-specs` and `factory-sticker-orchestrate` |

---

## 5. Release path (verified)

| Action | What it changes | Evidence |
|---|---|---|
| Push to `main` | Lovable syncs the repository and rebuilds the preview. **The live frontend also carried `bdc86aa` code within about 1.5 hours.** Automatic or manual publish is unconfirmed | Section 0. The edit history shows commits and no publish events |
| Publish in Lovable | Rebuilds the frontend from `main` at publish time and serves it on autolabels.io and autolables.lovable.app. Does not deploy edge functions or run migrations | Live bundle contents; crawler and ledger evidence below |
| Deploy an edge function | Changes that function's server behaviour at once. No frontend change | The crawler serves the pause build (`0aaf4d9`, deployed 15:40 UTC) although `main` has carried the corrected crawler since 16:02. Probe at 19:17 UTC: 503 body without `control` |
| Apply a migration | Only when applied explicitly | The ledger ends at 20261028000000. Files on `main` since then (e.g. 20261029120000) are not recorded |

**Customer-facing surfaces already updated automatically:**
- The live frontend at or after `bdc86aa`: Administration V2 with the Budgets & alerts tab and the fail-closed copy, and the crawl buttons that show the pause message.
- Customer passport pages run whatever passport code was on `main` at that build. The passport source is unchanged in this round.
- Zod 4.6.7 in the VIN scanner.
- Database changes applied on 10-28 are live: the Admin V2 policy-apply and settings-authority migrations, and the fee-preview function fix.

**Why this round is on a branch.**
- `main` appears to publish, and you asked for nothing to be published.
- This round's code (the five usability fixes, the measurement tools, the package and this plan) is on `claude/release-plan-2026-10-29`.
- Fast-forwarding `main` to it is batch 1a below.
- The older session branch `claude/continue-previous-emv49c` holds six unmerged Market V2 commits from 2026-09-10, including two migrations that are not on `main`. It is left untouched and is not part of any batch here.

---

## 6. Release batches

Each batch needs one approval. Batches 1a and 2 are what launch needs; the rest can follow.

**1a. Administration fixes from this round** (frontend; fast-forward `main` to the review branch, which publishes):
- *Gate:* typecheck, full suite, production build, parity run with 01/06/08/12 identical. All pass on the branch, except the 2 known clock fixtures.

**1b. Customer passport truth fixes** (frontend; not yet implemented):
- D3 recall wording for model-level campaigns;
- D4 "checked" and "analyzed" headings only when data exists;
- D1 fee itemization on hand-made listings, after D-2;
- D6/D7 dealer messages.
- *One approval:* your copy sign-off on the locked passport plus the merge.
- *Gate:* the suite including the price-model tests, `/v/demo` preview scenarios `new2026` and `sparse`, a hand-made listing published in the preview, and the passport skeleton unchanged.

**2. Fail-closed provider gate** (edge deploys; one approval; no migration needed):
- **Functions:** deploy `vehicle-enrich`, `marketcheck-sync`, `-comps`, `-specs`, `-recalls`, `-incentives`, `-title-report`, `firecrawl-scrape`, `google-reviews`, `oem-brochure`, `oem-owners-manual`, `oem-window-sticker` and `blackbook-values` from one named commit, with blob hashes verified.
- **Effect without migrations:**
  - MarketCheck stays under the existing 5,000-call platform cap.
  - Every provider without a budget row (Firecrawl, Black Book, VinAudit, MonroneyLabels, Places) is refused, so optional enrichment is paused server-side.
- **Requires** D-4, because `marketcheck-specs` bundles zod.
- **Should follow** the D5 fix if any enrichment will be re-enabled later.
- **Gate:**
  - deploy-path `deno check`;
  - harness reruns;
  - blob-hash match;
  - for 24 hours the ledger shows refusals for unbudgeted providers and no unreconciled reservations.

**3. Crawl evidence and controls** (migrations 20261101 + 20261102 + 20261104, then the corrected crawler with execution and promotion off): one approval. Not needed for launch.

**4. Budget lanes** (migrations 20261103 + 20261106 with your D-1 limits set in the same window): one approval. Not needed if enrichment stays off.

**5. Fee-preview record** (20261105): a ledger record only, any time.

**Steps that genuinely need their own approval:**
- **Each paid pilot.** Observation-only crawls spend renderer credits.
- **Promotion of crawled prices.**
- **Resuming any cron.**
- **Policy B**, because it changes how prices are computed.
- **Any SMS function deploy**, because of D-3.
- **Archiving or backfilling listing data.**

---

## 7. Timeline (dependency-based)

**Assumptions:**
- One engineer.
- Your answers to section 0 item 2 and D-2 by the start of day 2; copy sign-off within that day.
- Lovable deploys work as they did on 10-27 and 10-29.

| Step | Depends on | Effort | Test gate |
|---|---|---|---|
| Confirm publish mode | Your answer | Minutes | n/a |
| 1a ready to merge | Done | 0 | Passed on the branch |
| Implement D3, D4, D6, D7 | Nothing | ~0.5 day | Unit tests for the new wording; passport preview scenarios |
| Implement D1 | D-2 | 0.5–1 day | Price-model tests (`priceModel.salecard.test.ts`), sticker publish tests, a hand-made listing in the preview |
| Fix the two clock fixtures | Nothing | ~1 hour | Full suite green except the `functionAuth` load timeout, verified alone |
| Release 1a + 1b | The above + your copy sign-off | Hours | Suite, build, parity identical for the accepted four, preview passport check |
| Release 2 (fail-closed gate) | D-4 | ~0.5 day including verification | Blob hashes; 24-hour ledger watch |
| Visual acceptance of the nine pending screens | Your review | In parallel | n/a |

**Technical critical path:** D1 (blocked on D-2), then release 1b, then release 2 and its 24-hour watch.
- **Earliest launch-ready state:** about 3 working days, if D-2 is answered on day 1. Day 1–2 is the passport fixes; day 2 releases 1a/1b; days 2–3 are the fail-closed deploy and its watch.
- **Not on the launch path:** batches 3–5, any pilot, and resuming the cron.

**Remaining test gates not yet run:**
- 1b's tests (it is not yet implemented);
- the production ledger watch after release 2;
- a full-suite run with the clock fixtures fixed.
