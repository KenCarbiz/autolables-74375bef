# Passport architecture inspection: read-only findings

I only searched the source code. I made no edits, deploys, publishes or migrations, and called no provider. The MarketCheck cap was not touched. Latest commit on main: `3ee3dda9` (2026-10-31 21:36 UTC). Local branches are just `main` plus the edit branch. No stage-2 or comps branch is visible here.

Deployment caveat: I can't read which version of an edge function is deployed. Everything below describes the repo, not what is live. `public-listing-view` was last deployed in this chat during the payment-estimator step (2026-10-31). `vehicle-enrich`, `marketcheck-recalls` and `marketcheck-specs` are on hold, so the live copies are probably older than main.

## Routing (src/App.tsx)
- `/v/:slug` and `/v3/:slug` (lines 298, 303) go to `VehiclePassportRoute`, which lazy-loads `VehiclePassportGoverned.tsx` (1,798 lines). The A/B split and `governed_routing_enabled` are ignored.
- `/v-next/:slug` (line 306) goes to `VehiclePassportNext.tsx`, a draft. It is noindex (line 55) and not linked from `/v`. It uses the same fetch and the same logic (`derivePassport`, `buildPassportSaleCard`, `deriveVerificationReport`), with a new layout: `components/passport/next/PassportNextLayout` and `lib/passport/nextPassportData`.
- Child pages: `/v/:slug/verification` and `/v/:slug/documents` (lines 307-308), plus the GreatBuy, History and Dealer pages.

## Data path as wired today
```text
stored rows (vehicle_listings + market/history/blackbook payloads)
 -> supabase/functions/public-listing-view/index.ts (allowlist, scrubTitleVerification,
    applyRecallProjection, verifiedInServiceDate L369, fee mode L172-175, freshness checked_at L887-910)
 -> usePublicListing hook
 -> src/lib/passportV2Data.ts derivePassport (legacy deriveRating / confScore)
 -> lib/passport/verificationSummary.ts deriveVerificationReport (8 checks)
 -> VehiclePassportGoverned.tsx render
```

## Evidence matrix
| Requirement | Status | Evidence |
|---|---|---|
| Separate price fairness, vehicle confidence, desirability and evidence confidence | Isolated, not wired | `src/lib/intelligence/*` (marketValueV3, vehicleScore, dealRating, dataConfidence, buyerRecommendation, readModels/used/newPassport) has no importers outside its own folder and tests |
| PASSPORT_2_SERVER_CONTRACTS.md read models | Isolated | Builders are in `lib/intelligence/readModels`. No page or edge function calls them. Section 9 lists contract additions as still needed |
| vehicleFile read model | Mostly isolated | Only `lib/vehicleTruth/recallView.ts` imports it. The `vehicle-file-read-model` function exists, but no Passport page uses it |
| Unbiased, fee-normalized comps (Stage 2) | Not on main | `marketcheck-comps/index.ts:133` still sorts by price ascending, and `:142` ties the price range to the listing (1.0 to 1.35x). The fix is not in local history; the held branch is not visible |
| Missing title must not read as clean | Partial overclaim | Governed L688 correctly uses `titleCheckStatus`. But L558 adds a green "Clean Title" chip from `d.cleanTitle`, which `passportV2Data.ts:621` sets from `mc.carfax_clean_title`, not from the verified title check |
| Missing odometer must not read as clean | Wired via the report | Odometer is a check in `deriveVerificationReport`, and pending is never shown as green (Governed L149-154) |
| VIN-specific recall | Wired for the main claims | L470-473 and L716 show "No open recalls" only when the canonical check is verified |
| NeoVIN 0-100 confidence + factory record_source | Not wired | Neither appears in `public-listing-view` or `passportV2Data` |
| Warranty real in-service date | Wired | `verifiedInServiceDate` in public-listing-view L369 and passportV2Data L659. The ad-first-seen proxy is only used to reject a date |
| AutoFilm verified condition | Not in Passport | Only in `autofilm-feed`, the shared denylist and the unwired `vehicleScore.ts` |
| Incentives | Partial | public-listing-view L250 projects dealer offers. MarketCheck incentives cron is paused and the cache is empty |
| Freshness/provenance | Partial | `checked_at` and `source` are projected (L887-910), but there is no freshness table enforcement from contract section 6 |
| New vs used | Wired | `isNew` branches in passportV2Data. Separate new/used read models exist but are unwired |
| Other positive overclaim | Overclaim | Governed L693 shows "Market Data Verified" whenever `marketAvg` is not null, whatever the comp quality |
| Draft-only layout | Yes | Only `/v-next`. `/v` is locked |

## Rollout flags
- `/v`: no flag. It always renders Governed.
- `/v-next`: always reachable, noindex, no flag.
- Intelligence V3 / score flags: off by default, and moot because nothing imports the code.

## Tests
- Present: `lib/intelligence/*.test.ts` (unit only), `passportV2Data*.test.ts`, `verificationSummary.test.ts`, `VehiclePassportVerification.test.tsx`, `VehiclePassportGreatBuy.tier.test.ts`, `feeBasis.test.ts`, `soldLanguage.test.ts`.
- Gaps: no test that the "Clean Title" chip needs a verified title check; no test for "Market Data Verified" gating; no comps-bias test on `marketcheck-comps`; no test linking a read model to `public-listing-view`; no test of NeoVIN confidence or record_source projection.

## Suggested next steps (need approval; not done)
1. Gate the Governed L558 chip and the L693 badge on the canonical report. This is a bugfix and allowed under the Passport lock.
2. Merge the held Stage-2 comps branch into main, then redeploy `marketcheck-comps` only after the cap decision.
3. Choose whether to wire the read models into `public-listing-view` behind a flag, or retire them.
