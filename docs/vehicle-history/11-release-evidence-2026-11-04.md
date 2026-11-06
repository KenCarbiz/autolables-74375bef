# Release evidence, 2026-11-04 (PR #46 current head)

Scope: Ken's eight pre-approval items of 2026-11-04. Nothing in this document was merged, migrated, deployed, published or connected. Every run below was local, against throwaway Postgres 16 clusters, with synthetic secrets and no network calls to any Supabase project or provider.

## Recommendation

**Release the archived-vehicle Passport safety fix on its own, as draft PR #54** (`claude/passport-availability-safety`, off main `b5fbee6`). It is a frontend-only change. It needs no migration, no edge-function deploy, and no change to the public-listing-view deploy hold, because the deployed public-listing-view already returns the listing columns the fix reads (`status`, `archived_at`, `archive_reason`, `published_at`, `id`). After it ships, an archived car reads "No longer listed" with Hold, Reserve and Test Drive off. Nothing reads "Sold" until the custody tables and the #46 server projection ship.

Approvals PR #54 needs, in order:
1. Passport locked-spec sign-off from Ken (the availability strip and disabled purchase actions on non-current cars are a visible change to a locked page).
2. Merge #54 to main.
3. Lovable frontend publish, then a live check on one archived and one published `/v/` slug.

Approvals the rest of #46 still needs (separately): applying the three proposed migrations to AutoLabels Staging (`uakiwvigsmrlyfpsalai`) for physical staging verification; each of the five history policies; deploying public-listing-view and the gateway functions; per-dealer cutover from the legacy shared secret to signed mode.

## Item 1. A previous-stay deal record can never label a car Sold

Rule (`supabase/functions/_shared/listingDisposition.ts`, changed this round):
- "Sold", "Sale pending" and "Transferred" come only from a custody milestone on the newest episode for the tenant and VIN, and only when that episode is bound to this listing and the milestone happened at or after the listing's current `published_at`.
- Any other sale-state custody resolves to `unknown` with basis `ambiguous_sale_evidence`: label "No longer listed", purchase actions off. This also applies to a published listing whose newest episode is an older delivery.
- `vehicle_files` (the deal record) is no longer read. It is one row per tenant and VIN forever, and the listing row itself is reused across stays (unique tenant+VIN), so neither can be tied to a stay.

Evidence:
- Unit: `listingDisposition.test.ts`, 13 tests (bound stay to sold/pending/transferred; earlier-stay delivery, unbound episode, missing listing id, missing milestone date, missing publish date all to unknown; in-stock falls through to listing columns).
- Real function over HTTP, custody tables present (`public_view.test.ts`): `demo-prior-episode-sold` (archived, delivered 300 days ago, before its publish) and `demo-relisted-unreviewed` (published, newest episode delivered before this publish) both return `unknown` / `ambiguous_sale_evidence`; `demo-sold` (delivered after publish, bound) returns `sold`; `demo-deal-signed` (deal record only) returns `missing_from_feed`.
- Same function, custody tables absent: no car returns `sold`; the archived ones return `missing_from_feed`.

## Item 2. Independent release of the Passport fix

PR #54 contains only: `listingDisposition.ts` and its test (copied from #46), `VehiclePassportGoverned.tsx` and `VehiclePassportV2Detail.tsx` (the #46 availability patch, 3-way merged onto main), the `passportDrawers.test.ts` regex update, and test-only harness files under `supabase/tests/public_view/` plus `supabase/tests/rooftopos_stubs.sql`. No migration, no function source, no `supabase/proposed` file.

Its harness runs the **unchanged main** `public-listing-view` against a database built from main's migration history only, and asserts the server sends no `availability`, the listing columns are present, the client fallback yields the right disposition, and no car is ever `sold`.

Results on #54 (local, 2026-11-04): tsc pass; vitest 498 files, 7978 passed, 1 skipped; build pass; public_view 10/10; targeted Passport and disposition tests 102/102. Screenshots of mobile and desktop (available, left feed, sold-in-deal-record, prior episode, and the Reserve drawer) are in `/mnt/project-files/vehicle-history/screenshots/passport-safety-release/`.

## Item 3. Reconciliation with PR #51, AutoCurb and AutoFrame

- #51 (`claude/project-thread-ixjske`, head `d0139b4`) carries rtgip/2. Its `episode_id` is the #46 `vehicle_instances.id`; its `instance_id` is the root of the `previous_instance_id` chain (`rtgip_src.labels_episode_json`). No duplicate vehicle or episode table is introduced.
- #51's availability (listing published and episode open) agrees with the revised rule: a closed or delivered episode never makes a car purchasable, and #51 never derives sold from the deal record.
- AutoFrame's producer maps its numeric episode through `episode_map` to a string ref; AutoFilm routes are reserved in rtgip/2 and not active.
- The vendored shared core is byte-identical across the three repos (all 10 files match the `VENDORED.json` sha256): AutoLabels #51 `d0139b4`, AutoCurb `claude/project-thread-ixjske` `0f32aa4`, AutoFrame `claude/project-thread-ixjske` `1b2e0ee`.
- Action for #51: it contains #46 at `5807e7e` and must pick up this commit. The change is confined to `listingDisposition.ts`, public-listing-view's availability block and tests, none of which the vendored core touches.

## Item 4. All five history policies stay OFF

New test S0 in `vehicle_history_sql.sql`, run immediately after the migration applies and before any test setup writes settings: zero rows in `vehicle_history_settings`; `service.attach_enabled`, `service.allow_service_only_vehicle`, `integration.outbound_capture_enabled` and `access.prior_owner_keeps_transaction_records` are false at tenant and platform scope; all five report `source = safe_default`; `integration.replay_max_batch` is 25. The migration writes no setting rows.

## Item 5. Staging verification

Physical staging is **not done**: it requires applying the spine, vehicle-history and legacy-feed migrations to AutoLabels Staging, which is not authorized. The staging-equivalent local run (real migration history replay plus the proposed migrations, each applied twice and schema-diffed) covers every requested path:

| Path | Tests |
|---|---|
| sold, delivered, AutoFilm MPI | `sold_then_mpi` (deno), vehicle_history_sql "MPI after delivery", sale and listing stay immutable |
| reappearance reviews | vehicle_history_sql S tests, lifecycle N8, public_view relisted-unreviewed |
| tenant and rooftop isolation | spine RLS (10), same VIN at two dealers, lifecycle N6, legacy HTTP cross-tenant refusals, legacy_feeds_sql |
| signed integration requests | deno integration HTTP (raw-byte HMAC, key id, clock skew, wrong tenant) |
| consent | grant tests, prior-owner retention tests |
| rollback | harness rollback stages incl. fail-closed legacy rollback preserving per-dealer auth flags |
| replay protection | idempotency tests, lifecycle N2 and N4, legacy retry, replay cap 25 |

## Item 6. Legacy authentication transition

- Before the migration (`legacy_premigration.test.ts`, new): a legacy `autocurb-sync` push with the shared secret returns 200 with a deprecation header, updates the live car and holds the archived one (archived listing keeps its price); a wrong secret gets 401. The legacy `dms-webhook` (generic provider, `X-Dms-Signature`) returns 200. The legacy `autofilm-feed` lookup secret returns only the live lot; a wrong secret gets 401.
- After the migration: dealers in `allowed` keep working; a dealer moved to signed-only rejects legacy calls; the signed path refuses a body whose tenant differs from the authenticated connection.
- Behavior change for active feeds: archived listings are now held instead of updated.
- Residual risk, unchanged by this work: the legacy shared secret is one global credential. Whoever holds it can still push for any dealer still in `allowed` until that dealer is cut over to signed mode. Cutover is per dealer and needs Ken's approval for each.

## Item 7. Full current-head runs (local, 2026-11-04)

| Run | Result |
|---|---|
| RooftopOS harness (`supabase/tests/rooftopos_harness.sh`) | ALL PASS: 524-file history replay; three proposed migrations each applied twice, idempotent, schema identical; spine RLS 10, apply 10, vehicle history 34, lifecycle 9, legacy feeds 10 SQL PASS notices; deno HTTP and concurrency 27/27; rollback stages pass; public-listing-view and legacy functions 20/20 with custody tables and 18/18 without; integration unit tests 131/131 |
| Typecheck (`tsc -p tsconfig.app.json`) | pass (exit 0) |
| Vitest (`bun run test`) | 514 files, 8150 passed, 1 skipped (exit 0) |
| Production build (`bun run build`) | pass (exit 0) |

A flaky deno dispatch test was found and fixed in the test helper: dispatch compares a millisecond JS clock with microsecond row timestamps, so a row written in the same millisecond is not yet due. The helper now steps 5 ms past it; 0 failures in 15 consecutive runs. In production the row would go out on the next dispatch, so this is not a runtime defect.

CI results for the pushed head are reported in the PR, separately from these local runs.

## Item 8. Separation from PR #52

- #54 shares no file with #52.
- #46 shares two files with #52, both adjacent-line text only: `src/pages/admin/childRoutes.tsx` (route lines) and `src/pages/admin/noPaidCallsOnLoad.test.tsx` (a map entry). No MarketCheck, provider budget, sticker, NeoVIN or window-sticker file is in #46, and #46 calls no MarketCheck function.
