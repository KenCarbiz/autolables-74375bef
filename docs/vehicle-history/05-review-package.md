# Review package: PR #46 corrections (2026-11-01)

Status wording used here:

- **Local**: ran in this sandbox against a throwaway Postgres 16. No Supabase project was touched.
- **CI**: the GitHub Actions `test` job on the PR branch.
- **Draft PR**: the code is on GitHub on `claude/vehicle-history-foundation` (draft PR #46). It is remote code, but nothing is merged, deployed, published, applied or enabled.

Nothing in this package was applied to production. All holds are unchanged: the deploy hold on `public-listing-view`, `vehicle-enrich`, `marketcheck-recalls` and `marketcheck-specs`; the MarketCheck pause; the crawler pause; Stage 2 (PR #42); duplicate reconciliation in detection-only mode with no purge.

## 1. Sold and archived customer experience

### What the customer saw before (captured, not assumed)

`get_vehicle_listing_by_slug` returns `published` listings and also `archived` listings that have `archived_at` set (`20260729030000_retire_instead_of_delete.sql:100`). `public-listing-view` forwards the row, and `VehiclePassportGoverned.tsx` had no branch on `status`. So an archived car rendered exactly like a car for sale. It showed:

- Today's Sale Price;
- Schedule Test Drive and Request Vehicle Hold;
- Build My Payment and Watch Price;
- the floating CTA dock and the Next Steps buttons;
- the reserve and test-drive sub-pages.

Screenshots: `before-*.png` in `/mnt/project-files/vehicle-history/screenshots/passport-disposition/`. These come from the real page at commit 87a1a50 rendering the real `public-listing-view` response from a scratch database.

### What "archived" actually means in the data

`archive_reason` is set only to:

- `left_feed` or `removed_from_feed`, by the inventory prune;
- `duplicate_reconciled`, by 0014;
- nothing, for a manual archive.

The column comment says it "never asserts sold". Sale evidence exists only in two places:

- custody milestones, in the proposed vehicle history tables;
- `vehicle_files.deal_status` (`signed` or `delivered`).

`vehicle_files.updated_at` moves on any edit, and the table keeps one row per tenant and VIN forever. A deal status therefore cannot be dated, and a delivery from a car's earlier stay could mark a relisted car sold. The rule below accounts for that.

### Disposition rule (`supabase/functions/_shared/listingDisposition.ts`)

| Evidence | Disposition | Customer label | Purchase actions |
|---|---|---|---|
| Custody `delivered` | `sold` | Sold | Off |
| Custody `sold` or `awaiting_delivery` | `sale_pending` | Sale pending | Off |
| Custody `transferred_out` | `transferred` | No longer at this dealership | Off |
| Listing archived and deal `delivered` | `sold` (basis `deal_record`) | Sold | Off |
| Listing archived and deal `signed` | `sale_pending` | Sale pending | Off |
| Archived, `left_feed` or `removed_from_feed` | `missing_from_feed` | No longer listed | Off |
| Archived, `duplicate_reconciled` or `withdrawn` | `withdrawn` | No longer listed | Off |
| Archived, no or unknown reason | `unknown` | No longer listed | Off |
| Published, no contrary custody evidence | `available` | (none) | On |

Archived alone never produces "Sold". A published listing is never marked sold by a `vehicle_files` deal record, because that record cannot be dated. Without the custody tables in production, that case stays a known gap until the custody milestones are applied and recorded.

### Changes

- **`public-listing-view` (prepared; deployment still held):**
  - Adds `availability` to the response: `{ disposition, basis, purchasable, price_status, as_of }`.
  - Reads `vehicle_instances` and `vehicle_files` (`deal_status` and `updated_at` only). If either read fails, the decision falls back to the listing columns.
  - When the car is not purchasable, it sets `payment_estimator` to off and `price_drop_watch` to false.
  - It never adds a transaction price, deal record, buyer or contract field to the response.
- **Passport (`VehiclePassportGoverned.tsx`, locked design):** only availability labels and action gating. Nothing else was restructured.
  - **Added:** a status card (label and one sentence) above the price, on mobile and in the desktop Action Center.
  - **Price:** shown as "Last advertised price · Not a current offer · listing ended {date}". There is no breakdown, no You Save, no payment and no below-market chip.
  - **Hidden** when the car is not purchasable:
    - Schedule Test Drive and Request Vehicle Hold;
    - Build My Payment and Watch Price;
    - the CTA dock;
    - the Next Steps Hold and Test Drive buttons;
    - sticky-bar purchase keys (`test_drive`, `todays_price`, `reserve`, `pre_qualified`, `apply_financing`, `check_availability`, `payment_options`, `calculate_payment`);
    - the price in the sticky header.
  - **Kept:** Value My Trade, Ask a Question or Contact, Documents, Save, Share, Call and Text, and the whole vehicle record below.
- **Sub-pages (`VehiclePassportV2Detail.tsx`):** `reserve`, `test-drive`, `todays-price` and `check-availability` show the status message with a Contact button instead of a form. The "Request Hold" cross-CTA becomes "Contact Dealer". Test Drive and Price leave the bottom bar.
- **Older servers:** the browser reads `availability` when it is present. Otherwise it derives the same answer from `status`, `archived_at` and `archive_reason`, which the currently deployed `public-listing-view` already returns. If only the frontend were published, archived cars would read "No longer listed" with purchase actions off. They would never read "Sold", because a sale needs the server-side evidence.

### Historical access is preserved

- The Documents panel and `/v/:slug/documents` are unchanged.
- The vehicle record modules (verification, history, warranty, specifications) are unchanged.
- The authenticated owner view (`vehicle_history_owner_view`) is separate and is covered in section 3.

### Evidence

- **Before and after screenshots** (`/mnt/project-files/vehicle-history/screenshots/passport-disposition/`):
  - `sold` and `left-feed`, at 390px mobile and 1440px desktop;
  - `available`, at both widths;
  - the sold car's `/reserve` page, on mobile.
- **Text check over all 14 captures:**
  - Before: every page offered Hold and Test Drive, including the sold car's reserve page.
  - After: the sold and left-feed pages offer neither and show the status label. The available pages are unchanged.
- **Design preservation:** the available car's before and after screenshots are pixel-identical at both widths (PIL difference bounding box: none).
- **Real public response** (`supabase/tests/public_view/run.sh`): it runs the real `public-listing-view/index.ts` against a scratch database that replays all 524 migrations. There are 10 checks:
  - each disposition, with its basis;
  - no purchase payload on non-purchasable cars;
  - no `deal_status`, `sale_price`, `customer_name`, `install_token` or `created_by` in the response;
  - an unknown slug returns 404;
  - the bare VIN of a sold car is still not purchasable.

  The suite runs twice: once with the custody tables, and once without them as production is today. Without them, a delivered car reads `missing_from_feed`, never sold.
- **Test double:** PostgREST could not be installed here (the binary download was refused). `supabase/tests/public_view/gateway.ts` answers the PostgREST subset the function uses, as `service_role` with the JWT role claim. The SQL and the function code are the real ones; the HTTP translation is the one stand-in.

## 2. Legacy integrations

### Audit against the spine

| | autofilm-feed (GET) | autocurb-sync (POST) | dms-webhook (POST) |
|---|---|---|---|
| Credential before | One global `AUTOLABELS_LOOKUP_SECRET` | One global `AUTOCURB_SYNC_SECRET` | One secret per vendor |
| Tenant before | `tenant_id` query param | `autocurb_tenant_id` in the body | `X-Dms-Tenant` header |
| Cross-dealer exposure before | Any key holder reads any dealer | Any key holder writes any dealer | A vendor secret writes any dealer |
| Freshness before | None | None (a captured body replays forever) | None |
| Archived listing before | List filtered it out; detail returned rows with no `archived_at` and status `archived`/`sold`/`expired` | Updated price, mileage etc. on archived rows | Same as autocurb-sync |
| Signed mode now | `X-Rooftop-*` over `GET <path>?<sorted query>` | `X-Rooftop-*` over the raw body, plus `Idempotency-Key` | Same as autocurb-sync |
| Tenant now (signed) | The key's connection; a different `tenant_id` is 403 `tenant_mismatch` | Same; a different `autocurb_tenant_id` is 403 | Same; a different `X-Dms-Tenant` is 403 |
| Archived now | Detail returns 404 `not_current_inventory` | Not updated; reappearance review opened; listed under `held` | Same as autocurb-sync |

Signed mode reuses the spine's credentials: tenant-scoped `integration_connections` and Vault-held keys. A new `legacy_feed_bindings` row binds a connection to a feed. Retries are recorded in `legacy_feed_receipts`:

- the same key and the same body return the stored answer with `Idempotent-Replay: true` and no writes;
- the same key with a different body returns 409.

A captured signed request replayed inside the 300s window with a swapped (unsigned) `Idempotency-Key` is also caught, because the receipt is keyed on the signature as well.

### Transition (nothing breaks)

The unsigned shared-secret format keeps working by default, with header `X-AutoLabels-Auth-Deprecated: legacy-shared-secret`. Each dealer is cut over separately:

1. Create the connection and key.
2. Add the binding.
3. The producer switches to signed requests.
4. Verify.
5. Set `legacy_unsigned = 'rejected'` for that dealer. The legacy format then returns 401 `legacy_auth_retired` for that dealer only.

Rollback is setting it back to `allowed`; nothing is deleted. Full detail is in `04-legacy-feed-transition.md`. Before the migration is applied, the legacy check fails open, so today's callers are unaffected.

### Who produces these calls

- **AutoCurb repository** (`KenCarbiz/hartecash-2edb8fec`, attached read-only at b249278): it has **no caller** of `autocurb-sync` and no reference to `dms-webhook`, `autofilm-feed` or `AUTOLABELS_LOOKUP_SECRET`. The producer of `autocurb-sync` traffic is unidentified.
- **AutoFilm:** no repository is available in this session.
- **DMS vendors:** whether they can send `X-Rooftop-*` headers is unknown.

All three producer sides are **unimplemented and unverified**.

### Evidence

- **Unit tests:** 30 in `_shared/legacyFeeds` (vitest).
- **SQL:** `legacy_feeds_sql.sql`, 10 PASS. It covers:
  - binding rules, and that a dealer cannot read another dealer's bindings;
  - the claim outcomes;
  - the per-dealer legacy switch;
  - the archived hold, which leaves the listing byte-identical.
- **Real functions over HTTP** (`legacy_feeds_http.test.ts`, 7 tests): `autocurb-sync`, `dms-webhook` and `autofilm-feed` run from their real source against the scratch database. They cover:
  - dealer A's key naming dealer B is refused, and B is untouched;
  - a retried push returns once, and does not overwrite a later change;
  - a stale request is refused;
  - an archived listing is held, not updated, and gets one open review;
  - the legacy format works, and is refused after cutover;
  - A's feed read excludes the archived car and cannot read B.

## 3. The five policy settings

None is enabled anywhere. In production they do not exist yet: the migration is not applied. Once applied, each takes the safe default below until a platform admin changes it.

This pass also fixed a gap in the inheritance rule. Before, a dealer could switch on an `all_true` policy when the platform level had no row. Now the platform's safe default counts when it has no row, so an enable needs a platform admin first. Test S9b covers this.

**Writes, for all five:**

- Only `vehicle_history_set_setting`, which checks the role, type and bounds, the parent cap, the expected version (under an advisory lock), and requires a reason.
- Each write is an append-only version row plus an audit row.
- Platform scope: platform admin only. Tenant scope: that dealer's owner or admin, and never above the platform cap. Other staff can read effective values only.

**Rollback, for all five:** write the previous value as a new version. History is kept. The migration rollback (`...foundation.rollback.sql`) also turns on the platform holds and revokes client EXECUTE, keeping all data.

| Setting | Behaviour when on | Scope and combine | Default / effective today | Enforced in | Privacy consequence |
|---|---|---|---|---|---|
| `service.attach_enabled` | An event with a `service_visit_ref` creates or uses a `service_visits` row and anchors evidence to VIN plus visit, including for sold, delivered and archived cars. When off, an in-stock car keeps the spine 1.0 path exactly, and a car not in stock is held (retried hourly), not dropped. | Platform, tenant (store stored, not yet consumed); all levels must agree | false / not installed | `integration_apply_event` | Dealer-private service evidence for cars the dealer no longer owns. Never public, never on the Passport. |
| `service.allow_service_only_vehicle` | A VIN this dealer never stocked gets a service visit. **Proposed policy, now coded:** only from verified, authorized intake: an active signed connection with the right scope, a full 17-character VIN, and a repair order number. Otherwise it is quarantined as `service_only_unverified`. It never creates a custody episode or a listing. | Platform, tenant; all agree | false / not installed | `integration_apply_event` | Creates a record about a vehicle and visit that never passed through sales. Visible to that dealer's staff only. |
| `integration.outbound_capture_enabled` | Recording sold, delivered, voided or archived milestones also writes an outbox event, in the same transaction. | Platform, tenant; all agree | false / not installed | `vehicle_history_record_milestone` | Sale events become available to connected apps (AutoFilm, AutoCurb) once delivery is also on and a consumer exists. No consumer is verified. **Not proposed; awaiting your decision.** |
| `integration.replay_max_batch` | Caps how many dead or unmatched inbox rows one replay call may re-queue. | Platform, tenant; the smallest value wins; 1 to 500 | 25 / not installed | `integration_replay_inbox` | None directly; it limits the size of operator mistakes. **Not proposed; awaiting your decision.** |
| `access.prior_owner_keeps_transaction_records` | **Proposed policy, now coded:** after a relationship ends, a former customer keeps reading their own episode's transaction milestones only while the policy is on and a retention date (`transaction_access_until`, set by a manager through `vehicle_history_set_transaction_retention`) is in the future. They never see the next owner's episode or any service after their end date. A revoked grant reads nothing. | Platform, tenant; all agree | false / not installed | `vehicle_history_can_read`, `vehicle_history_owner_view` | A signed-in user with a grant row: VIN or QR knowledge is not enough. No retention period exists yet; until one is set per grant, access ends with the relationship. |

`service.attach_enabled` is the fifth setting awaiting approval. It is listed first because the other service setting depends on it. No approval is inferred for `service.attach_enabled`, `integration.outbound_capture_enabled` or `integration.replay_max_batch`.

**Tests:**

- S3: service-only intake is refused by default, is refused again without a repair order number when the policy is on, and with one creates a visit and no inventory.
- S9b: a dealer cannot enable a policy alone.
- S12 and S12b: the former customer is refused with no retention date, reads their own records inside retention, never sees the next owner's or later service, and loses access when retention passes.

## 4. Integration boundary

| Pair | Status |
|---|---|
| AutoFilm to AutoLabels (MPI, repairs) | **The receiving path passes local tests.** `sold_then_mpi.test.ts` drives the real AutoFilm v1 adapter (signed `x-af-*`), the real ingest and apply handlers, and the proposed SQL. A car is sold, then delivered, then an `mpi.report.published` arrives. Result: the same `vehicles` row, one new `service_visits` row with no episode link, evidence anchored to VIN plus visit, no new or active episode, the listing unchanged and no reappearance review. The producer side is the adapter's documented wire shape; **AutoFilm's own code is unavailable and unverified.** |
| AutoLabels to AutoFilm (custody events) | Outbox and dispatch are tested locally. **The AutoFilm receiver is unimplemented or unverified.** |
| AutoCurb to AutoLabels (`autocurb-sync`) | The AutoLabels side passes local HTTP tests. **No producer exists in the AutoCurb repository; unverified.** |
| AutoLabels to AutoCurb | **Unimplemented.** The AutoCurb repository has no receiver for AutoLabels events. |
| AutoFrame | Not started. |

## 5. Results

### Local (this sandbox, 2026-11-01)

| What | Result |
|---|---|
| `bunx tsc -p tsconfig.app.json --noEmit` | Clean |
| `bun run test` (full vitest) | 512 files, 8121 passed, 1 skipped, 0 failed (two source-text assertions updated for the moved header reads and the purchasable dock gate) |
| `supabase/tests/rooftopos_harness.sh` | All stages pass (listed below) |
| `supabase/tests/public_view/run.sh` with custody tables | 18 passed (10 public view, 7 legacy feed HTTP, 1 cleanup) |
| `supabase/tests/public_view/run.sh` without custody tables | 10 passed, 8 ignored (legacy feed HTTP needs the proposed migration) |

The harness stages are:

- stubs, and the migration history replay;
- spine, foundation and legacy feed migrations, each applied twice with identical schema dumps;
- SQL suites: spine RLS 10, spine apply 10, vehicle history 33, legacy feeds 10;
- Deno HTTP and concurrency: 27, including the sold-then-MPI scenario;
- both rollbacks, keeping data and revoking client EXECUTE;
- the public view and legacy HTTP suites;
- vitest for integrations, legacy feeds and disposition.

### CI (GitHub Actions on the draft PR)

The `test` job reports separately and is linked from the PR. CI runs the repo's vitest suite only. It does **not** run the Postgres harness, the Deno HTTP tests or the Playwright screenshots, which ran locally only.

### Not run anywhere

- Supabase staging or production.
- A real PostgREST.
- AutoFilm or AutoCurb producers.
- Real DMS vendors.

## 6. Migration order and compatibility with PR #36

| Order | File | Depends on | Rollback |
|---|---|---|---|
| 1 | `supabase/proposed/20261030000000_rooftopos_spine.sql` (from PR #36) | `tenants`, `tenant_members`, `vehicle_listings`, Vault | Not applying it; once applied it is inert until the env flag and direction flags are set |
| 2 | `supabase/proposed/20261109000000_vehicle_history_foundation.sql` | 1, `user_roles`, `dealer_stores`, `vehicle_files` | `.rollback.sql`: platform holds on, client EXECUTE revoked, data kept |
| 3 | `supabase/proposed/20261109010000_legacy_feed_hardening.sql` | 1, 2 (`vehicle_history_flag_reappearance`) | `.rollback.sql`: every dealer back to legacy `allowed`, client EXECUTE revoked, bindings and receipts kept |

**PR #36:**

- This branch merges `claude/project-thread-9d8x1r`.
- The spine file moved to `supabase/proposed/`, so merging cannot apply it.
- Migration 2 replaces `integration_claim_inbox` and `integration_apply_event` with the same signatures.
- The spine's own SQL and HTTP suites still pass after 2 and 3 are applied.
- If PR #36 merged first, this branch needs only that move kept.

**Numbering:** no open branch uses `20261109*`. `main`'s proposed files stop at `20261108000000`. Drizzle production is at 0017 (memory), so real numbers are assigned at apply time and checked against open branches then.

## 7. Release steps (each needs its own approval)

1. Apply migrations 1 to 3 with all defaults; nothing changes for customers or feeds.
2. Deploy `public-listing-view`: **held** under the current deploy hold, and it needs your Passport sign-off.
3. Publish the frontend: Passport availability gating and sub-page gating.
4. Deploy `autocurb-sync`, `dms-webhook` and `autofilm-feed`: signed mode off by default in effect, since there are no bindings until created.
5. Per dealer: connections, keys and bindings, then producer cutover, then `legacy_unsigned = 'rejected'`.
6. Policy settings: only those you approve, platform first.
