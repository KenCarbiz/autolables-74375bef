# AutoLabels internal audit — findings and proposed minimal fixes

Analysis only. Nothing was edited, deployed, written or run. Evidence comes from source at local HEAD `e9bf1e7d` (a "Work in progress" commit at 2026-10-20 21:10 UTC) and read-only database queries. **Deployment uncertainty:** no tool here shows which commit www.autolabels.io is serving. Earlier crawls only showed bundle hashes, so whether the live site matches this source is **unverified**.

## Confirmed defects (with evidence)

### 1. Opening Admin rewrites every vehicle's price (high severity)
- Trigger: `src/pages/Admin.tsx`, the `useEffect` keyed on `docFeeSig` (lines ~197-216). It records a baseline the first time `settingsLoading` is false. But `DealerSettingsProvider.load()` (`src/contexts/DealerSettingsContext.tsx` 612-676) runs several times: first anon/no-tenant (cache or defaults, `loading=false`), then again once the user and tenant name/logo resolve (key at line 681). The baseline gets taken from the cached/default fee, then the real DB fee arrives, the signature "changes", and the RPC fires with no edit. A cold cache (new device, cleared storage) is enough to trigger it.
- RPC `recalc_tenant_doc_fee` (migration `20260627050000`): SECURITY DEFINER, EXECUTE granted to `authenticated` (ACL confirmed: postgres/authenticated/service_role, no anon/PUBLIC). Any tenant member of any role can run it, not only admins. Its `UPDATE` has no "value actually differs" filter, so it is not idempotent. It touches every row with `advertised_price_before_doc`, sets `price_parse_status='ok'` and sets `price_last_verified_at=now()`.
- DB evidence: the Harte tenant has 325 listings with `parse=ok`, and the sampled one was "verified" at 2026-10-20 21:09:02, matching the reported toast. That stamp falsely refreshes the price freshness date.

### 2. "All reconciled" is a side effect of defect 1 (high)
- `src/components/admin/PriceAuditPanel.tsx`: the badge counts only `price_parse_status === 'warning'`. Defect 1 just reset all 325 rows to `ok`, so every crawl mismatch was wiped. The panel does no comparison of its own (advertised + doc fee vs stored sale price vs live page). It drops the query `error`, so a failed read shows "All reconciled". It is capped at 500 rows, and rows with a null status (5 here) are never flagged. `configuredDocFee` is read but not compared against each row's `doc_fee`.

### 3. Vehicle ...358190 price/MSRP disagreement (medium)
- `vehicle_listings`: advertised-before-doc 60,665 + doc 895 = 61,560 (inventory/public, internally consistent).
- `vehicle_facts`: `advertised_price` = 58,560 (`dealer_confirmed`), `total_msrp` = 62,040 and `base_msrp` = 58,800 (`neovin`). All dated 2026-07-29, so nearly 3 months stale. Internal Truth reads the old facts. The listing has moved on since then.
- `vehicle_files.msrp` = 0 and `market_value` = 0 for this vehicle (also stale).
- Public MSRP 62,665: the source wasn't found in this pass, so it is **unverified**. 62,665 − 62,040 = 625, which looks like a changed destination charge or option, but that is unconfirmed.
- Defect: Truth shows no freshness marker and lets an old `dealer_confirmed` fact outrank a newer feed price.

### 4. Sync Center "no success" (confirmed data, intentional UI)
- `inventory_sync_runs` for Harte: the latest 6 runs are all `skipped` with 0 seen. `InventorySyncCenter.tsx` 185-235 correctly refuses to count a skip as healthy. "No successful run recorded" is true for the rows it fetches.
- Gap: the MarketCheck header "Connected" (`MarketcheckSyncCard`) reads `marketcheck_sync_config`, not run outcomes. So "connected" and "skipped every hour" can both show at once. The skip reason is probably the source-identity hold, but that is unverified. The stale-sync warning only fires when a success exists, so a tenant that has never succeeded gets no red alert.

### 5. Description Operations counts (confirmed data)
- `description_cases`: 101 `FAILED_BLOCKED`, 224 `ARCHIVED`. Open exceptions: 284 length-exceeded, 103 validation, 92 channel-generation, 47 blocked, 29 budget-exhausted, 16 equipment conflict, 14 CPO conflict.
- `DescriptionOperations.tsx` 241-290 marks a row `failed` from the case status, but "8/8 variants live" comes from `channelsPresent` (stored channel versions). It does not check whether those versions are current or allowed to publish. That is how "failed" and "8/8 live" end up on the same row: older versions still exist after a blocked re-run. The headline number counts vehicles while the exception totals count events, which is intentional (see comment line 239). Budget exhaustion (29) is labelled as a failure rather than "waiting".

## Not traced in this pass (unverified, stated honestly)
- (4) Publishing gates for listings, documents, retail-ready and new/used/CPO: the DB trigger names exist (`enforce_prep_gate`, `enforce_price_verified_before_sign`, `description_publish_allowed`, `factory_sticker_transition_guard`), but which one actually blocks each publish path wasn't mapped.
- (7) Role preview vs real enforcement: `RoleHome.tsx`, `adminTabAccess.ts`, `RouteCapabilityGuard`, `useFeatureGate` (it lets everything through while loading or on error, by design) and lead-routing scheduler/fallback aren't checked against RLS yet. One concrete finding already: the doc-fee RPC trusts any tenant member, whatever their role.
- (8) `src/data/docFees.ts` static state caps: only Admin consumes them in the files searched. No server-side cap enforcement was found, but this is unconfirmed.
- (9) Settings: confirmed that save prefers `merge_dealer_settings` (patch-only, safe under concurrency). The fallback full-snapshot upsert can overwrite other editors. The local cache is layered under DB values (DB wins). When a read fails, it silently falls back to the cache with no message to the dealer.

## Good safeguards to keep
- Merge RPC for settings, tenant-scoped cache key, the "house" tenant guard.
- Sync Center refusing to treat a skip as healthy.
- Doc-fee RPC membership check, `(SELECT auth.uid())` wrapping, and no anon execute.
- Locked Passport and its price arithmetic are untouched by every fix below.

## Proposed minimal corrections (each with a regression test)
1. Admin doc-fee effect: only take the baseline from the settled DB load (expose a `loadedFromServer` flag or a per-tenant load generation), or better, call the recalc only from the doc-fee field's save handler. Test: mount Admin with a cache fee that differs from the DB fee, and assert the RPC is never called.
2. `recalc_tenant_doc_fee`: add `AND (doc_fee IS DISTINCT FROM v_fee OR website_sale_price IS DISTINCT FROM advertised_price_before_doc + v_fee)`. Stop resetting `price_parse_status` and `price_last_verified_at` on rows it didn't change. Restrict it to admin/owner/manager roles. Test (SQL): calling it twice returns 0 the second time, and a salesperson gets an error.
3. PriceAuditPanel: compute the mismatch client-side (stored sale price ≠ advertised + doc fee, and row doc fee ≠ configured fee), surface query errors, and count null status as "unverified" rather than reconciled. Tests: one per rule.
4. Truth view: show each fact's `updated_at`, and when a listing price is newer than the `dealer_confirmed` fact, show the fact as stale. Test: the fact from 2026-07-29 vs a listing price from 2026-10-20 is marked stale.
5. Sync header: show the latest run's outcome and skip reason next to "Connected". Add a red alert when no successful run has ever been recorded. Test.
6. Description Ops: count channels present only if they are current and allowed to publish. Show budget-exhausted as "waiting". Test.
7. Follow-up read-only pass for the untraced items (4, 7, 8), before any UI approval.

One data note: the 325 overwritten parse statuses can't be restored from the database. The next nightly crawl re-flags real mismatches, so fix 1 and fix 2 should land before that crawl.
