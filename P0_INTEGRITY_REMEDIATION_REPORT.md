# P0 Integrity Remediation — Deployment Plan and Gate 0 Report

Status: **IN PROGRESS** — sections marked `PENDING` are filled as each step lands.
Owner directive: "Verify current main → produce the exact P0 deployment plan → apply approved
migrations/backend rollout → canary MarketCheck and Firecrawl → confirm P0 integrity." Nothing
past Gate 0 is started here.

Times are UTC. Harte INFINITI tenant `3f0f97f5`. Supabase project `onnbmmdbrsgytfozfozn`.

---

## 0. Verified starting state (2026-09-09 00:50)

| Item | Value |
|---|---|
| `origin/main` | `0ed9a930` (Phase 2) on top of `438ab533` (Phase 1); Lovable `latest_commit_sha` = `0ed9a930` — in sync |
| Tests at that SHA | 4,454 passed, typecheck clean |
| P0 migrations applied? | **No** — `captured_method` absent; 25 ledger rows still `render_credits_exhausted`; 58 feed rows still `source_channel='website'`; shape row still `marketcheck_search` |
| Active / archived VINs | 132 / 152 |
| `vehicle_facts` / `vehicle_snapshots` | 5,042 / 313 |
| `advertised_prices` | 1,590 rows, 1,532 with screenshot hash; bucket holds 1,686 objects |
| Crawl ledger | 25 rows, all mislabelled |
| `last_good_count` | 129 |
| Next crons | `marketcheck-sync` hourly at :07, gated to Harte's 03:00 hour → **03:07**; `crawl-advertised-prices` `0 */6` → **06:00** |

**Sequencing consequence.** The deployed `marketcheck-sync` at 00:50 had neither the segment
guard nor the provenance fix. Tonight's 03:07 run would write fresh feed rows as website
observations and, on a bad backstop night (≈45% of runs), rely on the run-level breaker alone.
`marketcheck-sync` therefore deploys **before** the Phase 3–5 build completes; the crawler waits
for pacing and deploys before 06:00.

---

## 1. Deployment sequence

| # | Step | Mechanism | Depends on | Status |
|---|---|---|---|---|
| 1 | Preflight each migration with the exact backfill predicates | `query_database` SELECT | — | **DONE** (§2) |
| 2 | Apply `20260908270000` payload-shape relabel | `query_database` DDL/DML | 1 | **DONE** |
| 3 | Apply `20260908260000` crawl-outcome relabel | same | 1 | **DONE** |
| 4 | Apply `20260908280000` captured_method + backfill | same | 1 | **DONE after one fix** (§2.3) |
| 5 | Add `no_prune` canary flag to `marketcheck-sync`; fix migration typo; commit + push | git → `c60fa9db` | — | **DONE** |
| 6 | Deploy `marketcheck-sync` @ `c60fa9db` | Lovable agent, deploy-only request | 5 | **DONE 01:01:04Z** — Lovable verified `supabase/functions/marketcheck-sync` + `_shared` byte-identical to `c60fa9db`; its own bot had meanwhile pushed `1d8cc426`/`636ec62d` (Supabase `types.ts` regen, +4 lines, no edge code) — local main fast-forwarded onto it |
| 7 | Build Phases 3–5 (truth-write integrity, Firecrawl pacing/format/screenshot, evidence links) | Workflow: 3 builders ∥, 3-lens adversarial review each, bounded fix round | — | IN PROGRESS |
| 8 | Full suite + typecheck + esbuild on every touched edge file; commit + push | local | 7 | PENDING |
| 9 | Apply `20260909010000` vehicle_facts CHECK widen | `query_database` | 8 | PENDING |
| 10 | Deploy `crawl-advertised-prices`, `autofilm-feed`, `factory-sticker-orchestrate` | Lovable agent, deploy-only | 8, 9 | PENDING — must land before 06:00 |
| 11 | MarketCheck canary (no-prune forced sync) | `net.http_post` from SQL, same headers as cron | 6 | **DONE 01:02:13Z — PASS** (§4.1) |
| 12 | Firecrawl canary (5 VINs, single-VIN mode) | same | 10 | PENDING |
| 13 | Observe the real 03:07 nightly under new code (pruning enabled) | read `inventory_sync_runs` | 6 | PENDING |
| 14 | Reconciliation report + Gate 0 status | this document | 11–13 | PENDING |

Invocation for 11/12 reuses the cron's own `net.http_post` call shape (URL, `apikey`/`Authorization`,
`x-cron-secret`) so the canary exercises the production auth path. The shared secret was read from
`cron.job.command` during preflight; it is not reproduced in this document, in chat, or in any commit.

---

## 2. Migrations — preflight, result, rollback

### 2.1 `20260908270000_payload_shape_endpoint_relabel.sql`
- **Purpose:** the payload-shape telemetry recorded the syndication payload under a hardcoded
  `marketcheck_search` / `/search/car/active` label. Relabel the one row; code now derives the label
  from the endpoint the response came back on.
- **Preflight:** 1 row to move, 0 duplicates against an existing syndication row.
- **Result (00:56):** 1 row moved. Verified: `provider=marketcheck_syndication`,
  `endpoint=…/v2/dealerships/inventory`, 41 keys, self-check passed.
- **RLS/index impact:** none.
- **Rollback:** `UPDATE provider_payload_shapes SET provider='marketcheck_search',
  endpoint='https://api.marketcheck.com/v2/search/car/active' WHERE provider='marketcheck_syndication';`
  Reversible; not recommended — the prior label was false.

### 2.2 `20260908260000_crawl_outcome_relabel.sql`
- **Purpose:** the ledger recorded rate limits as credit exhaustion. Relabel by `render_status`,
  which came straight off the provider and was never part of the misclassification.
- **Preflight:** 15 rows with `render_status=429`, 10 with `402`, **0 with null** (no legacy remainder).
- **Result (00:56):** 15 → `render_rate_limited`, 10 → `render_cost_refused`, 0 legacy. Both
  self-checks passed.
- **RLS/index impact:** none.
- **Rollback:** `UPDATE advertised_price_crawl_attempts SET outcome='render_credits_exhausted'
  WHERE outcome IN ('render_rate_limited','render_cost_refused') AND render_status IN (429,402);`

### 2.3 `20260908280000_advertised_price_captured_method.sql`
- **Purpose:** feed rows were stored as website observations. Add `captured_method`, backfill only
  where the row's own evidence settles it, move feed rows to `source_channel='feed'`.
- **Preflight (rule order):** feed 58 · observed-by-screenshot 1,532 · seed 0 · observed-by-note 0 ·
  manual 0 · **left UNKNOWN 0** — sums to 1,590 = total. Only channel present: `website`.
- **First apply (00:56): FAILED and rolled back.** `GET DIAGNOSTICS v_obs = v_obs + ROW_COUNT` is not
  valid PL/pgSQL. The tool's transaction rolled the whole batch back; no partial state. Fixed in
  `c60fa9db` (assign into a temp, then add).
- **Second apply (00:58): DONE.** 1,532 `website / dealer_vdp_observation` · 58 `feed /
  marketcheck_syndication` · 0 UNKNOWN. Matches preflight exactly. Both self-checks passed.
- **RLS impact:** none — 4 tenant-member policies on `advertised_prices` unchanged, RLS on.
- **Index impact:** `idx_advertised_prices_method (tenant_id, captured_method, captured_at DESC)` added.
- **Consumers affected by the relabel (verified by grep):** `complianceData.ts:361` finds the website
  snapshot by `source_channel==='website'` — the 58 feed rows now correctly fall out of it (those
  VINs read `awaiting_snapshot` instead of a false match). `PriceIntegrityCard` groups by channel and
  will show a `feed` row alongside `website` — informative, not a regression. `PriceIntegrityPanel`
  keys by `vin|channel`; feed rows compare feed price to feed price and count as matched (cosmetic
  inflation of the matched count by ≤58; noted, not fixed here). `auditPacket` now reports the
  headline price only from observed rows and includes total/observed counts.
- **Rollback:** `UPDATE advertised_prices SET source_channel='website' WHERE captured_method=
  'marketcheck_syndication'; DROP INDEX IF EXISTS idx_advertised_prices_method; ALTER TABLE
  advertised_prices DROP COLUMN captured_method;` — reversible; both writers tolerate the column's
  absence (insert retry without it). Dropping it re-contaminates the compliance packet.

### 2.4 `20260909010000_vehicle_facts_check_widen.sql` — APPLIED 01:35Z
- **Purpose:** the TypeScript enums carry `dealer_vdp` and `history_provider`; the live CHECKs did not.
  Nothing persisted them yet, but the write path discarded the upsert error, so the first attempt
  would have silently dropped every fact for that VIN. Widen the three CHECKs; the code fix
  (commit `46c93b2f`) makes any future error visible.
- **Preflight (01:35Z):** live `vehicle_facts_source_kind_check` and `vehicle_source_records_source_kind_check`
  listed the seven original kinds (no `dealer_vdp`); `vehicle_facts_authority_check` listed
  `manufacturer/dealer/shared` (no `history_provider`). Rows that would need the new values: **0**
  (`vehicle_facts` 5,042 total, `vehicle_source_records` 222 total) — superset change, no row can fail.
- **Result:** all three constraints re-read via `pg_get_constraintdef` and now include `dealer_vdp` /
  `history_provider`; the migration's own DO block passed. Row counts unchanged.
- **Rollback:** re-add each constraint with the previous value list (recorded in the preflight above).
  Safe only while no row carries the new values; check `WHERE source_kind='dealer_vdp' OR
  authority='history_provider'` first.

### 2.5 `20260909020000_crawl_queue_observations_only.sql` — APPLIED 01:2xZ (before the crawler deploy)
- **Purpose:** after 2.3 relabelled the feed rows, they were the LATEST row for 128 of 132 active
  Harte VINs, so `advertised_price_crawl_queue` handed the crawler feed rows as "last observation":
  the crawler would have inherited `source_channel='feed'` for its own observations and escalated all
  128 to an evidence render on the first night. The queue now ignores feed rows; a VIN with only feed
  rows enters via the seed path as a first crawl.
- **Result:** the migration's DO self-check passed (0 feed rows returned). Harte queue after: **21 VINs**,
  0 feed rows. Rows/data untouched (function body only).
- **Rollback:** `CREATE OR REPLACE` the previous body (without the two channel predicates).

### 2.6 `20260909030000_vehicle_fact_conflicts_authority_widen.sql` — APPLIED 01:37Z
- **Purpose:** reviewers flagged that `vehicle_fact_conflicts.authority` had the same three-value
  CHECK; `truth.ts` writes `conflict.authority` into it, so a history-provider conflict would be
  rejected. Same family as 2.4.
- **Preflight / result:** 0 conflict rows exist; constraint re-read and now includes `history_provider`.
- **Rollback:** re-add with `manufacturer/dealer/shared`.

---

## 3. Edge functions — what deploys, from which commit

| Function | Commit | Contains | Status |
|---|---|---|---|
| `marketcheck-sync` (+ `_shared/rooftopMatch.ts`) | `c60fa9db` | proportional segment gate · backstop probe union · `source_channel='feed'` + `captured_method` on feed rows · endpoint-derived telemetry label · `no_prune` canary flag | deploy queued |
| `crawl-advertised-prices` (+ `_shared/crawlOutcome.ts`, `_shared/renderPacer.ts`) | `71838b3b` (main `1f7745b4`) | status-first outcome classifier · `captured_method='dealer_vdp_observation'` · description strip on all VIN-scoped price extraction · rate pacing ≤10/min with Retry-After · html-only routine format · conditional screenshot · html-only fallback when the evidence bundle is refused · never inherits a feed channel · archived listings leave the rotation · unchanged price still writes an observation | deploy requested 01:35Z via Lovable |
| `autofilm-feed` | `46c93b2f` (main `1f7745b4`) | dealer-controlled facts excluded from `facts[]`; `facts_excluded_dealer_controlled` count | deploy requested 01:35Z via Lovable |
| `factory-sticker-orchestrate` (`truth.ts`) | `46c93b2f` (main `1f7745b4`) | upsert errors surfaced; per-row fallback; `vehicle_truth_write_error` audit row on partial write | deploy requested 01:35Z via Lovable |

Secrets/env dependencies: `FIRECRAWL_API_KEY(_1)` (existing), optional `FIRECRAWL_RPM` (new, default 10).
No new secrets required.

---

## 4. Canary plans

### 4.1 MarketCheck (after step 6)
Invoke `marketcheck-sync` with `{tenant_id, force: true, no_prune: true}`. Pass criteria, read from
`inventory_sync_runs.raw` and `marketcheck_sync_config.last_status`:
- `seen` ≈ 129 (both segments) — or, if the backstop is short tonight, `segments.new.gate` reads
  `segment_collapsed:new:<n>_vs_<prior>` and **`removed = 0`**;
- `segments.new.gate` / `segments.rest.gate` populated; `canary_no_prune = true`; `prune_skipped`
  begins `canary_no_prune`;
- `supplemental_new.attempts` shows probing continued past a short probe (no `break` on 1);
- `provider_payload_shapes` observation for `marketcheck_syndication` increments; no new row named
  `marketcheck_search`;
- any new `advertised_prices` rows carry `source_channel='feed'` and
  `captured_method='marketcheck_syndication'`; zero new `website` rows from this run.
Then the real 03:07 run, pruning enabled, is read the same way: the correct outcome on an incomplete
segment is **refuse to prune**.

**Result — 01:02:13Z, pg_net request 33627, HTTP 200, not timed out. PASS on every criterion.**

| Criterion | Observed |
|---|---|
| Coverage | `seen 128`, `num_found 57` (owned feed) · new **71 of 72** prior · rest **57 of 60** prior |
| Gate decisions recorded | `segments.new.gate = null`, `segments.rest.gate = null` — both would have ALLOWED pruning, correctly, at 98%/95% coverage |
| No-prune honoured | `prune_skipped = canary_no_prune` · `canary_no_prune = true` · `removed = 0` · 0 rows archived after 01:02 |
| **Probe continuation — the 2026-09-08 bug reproduced live and handled** | `supplemental_new.attempts`: ① `mc_location_id` owned → `num_found 1, ingested 1` (the transient one-car answer) · ② `mc_website_id` → 0 · ③ `mc_dealer_id` → `num_found 1, ingested 0` · ④ `source` owned → 0 · ⑤ `source` unowned → **70 ingested**. Loop continued past ①; `ingested 71 ≥ sufficient 43` (= floor(72 × 0.6)). Old code stopped at ① with `accepted = 1`. |
| Provenance of writes | `prices_recorded 70` — **all** `source_channel='feed'` / `captured_method='marketcheck_syndication'`; **0** written as `website` |
| Telemetry label | `provider_payload_shapes`: `marketcheck_syndication`, observations 1 → 2; 0 rows labelled `marketcheck_search` |
| Provider attribution | primary owned feed still reports `new_units: 0` (`reported: 0`) — vendor-side; unchanged; UNKNOWN pending a MarketCheck ticket |
| Cost | 8 MarketCheck calls (7 syndication + 1 dealer lookup), est. $7 by public list via `mcCost.ts` — identical to a nightly |

Reading note: `prices_recorded 70` is the feed channel establishing its own baseline after the
relabel (only 58 feed-channel rows existed before this run, so 70 VINs had no prior feed row to
compare against). It is not 70 price changes; tomorrow's run writes only on movement.

### 4.2 Firecrawl (after step 10, before 06:00)
Five single-VIN invocations (`body.vin`, render budget 3 each): `1C6SRFFT2NN400176` (used, the
fixture page), `3GNAXUEV9LS593826` (used, open recall), `3PCAJ5BB6PF110401` (CPO),
`JN8AZ3DB3T9431184` (CPO, high price), `5N1BT3BB2TC779545` (new). None has a prior screenshot, so
the two-stage rule should capture one for each. Pass criteria:
- ledger outcome `captured`, or a correctly named failure — **zero** `render_cost_refused` from a
  1-credit html render; any 429 is labelled `render_rate_limited` and the pacer's wait is recorded;
- `paced_wait_ms` present in the audit details for each render;
- new `advertised_prices` rows with `captured_method='dealer_vdp_observation'`, screenshot path + hash;
- for the RAM: `advertised_price_before_doc` 24,981, `website_sale_price` 25,876, `doc_fee` 895,
  `dealer_discount` from the page's own ladder (11,944), **not** from description copy;
  `history_report_url` = the tokenized CARFAX link; no clean-title write;
- no change to any customer-visible price arithmetic (Passport reads `vehicle_listings`, untouched).
Cost ceiling: ≤ 5 VINs × 2 renders ≈ 10–15 credits.

---

## 5. Results — Gate 0 status (2026-09-09, as of 03:20Z)

### 5.1 WHAT CHANGED
All on `main` (Lovable-watched). Pre-change main was `4ebb0479`.

| Commit | Change |
|---|---|
| `438ab533` | `_shared/rooftopMatch.ts`: proportional segment-collapse gate (`SEGMENT_COLLAPSE_FLOOR = 0.6`), `sufficientCoverage`, `probeCoverageSatisfied` |
| `0ed9a930` | `marketcheck-sync`: backstop probe union (no `break` on a one-car probe); endpoint-derived telemetry label; feed rows written `source_channel='feed'` / `captured_method='marketcheck_syndication'`. `_shared/crawlOutcome.ts`: status-first classifier. Crawler: `captured_method='dealer_vdp_observation'`, description strip on every VIN-scoped price extraction. Migrations 260000 / 270000 / 280000. `auditPacket.ts`: headline price from observed rows only |
| `c60fa9db` | `no_prune` canary flag on `marketcheck-sync`; migration 280000 PL/pgSQL fix |
| `46c93b2f` | `truth.ts`: `upsertRowsWithFallback` (batch then row-by-row, errors to `audit_log` as `vehicle_truth_write_error`, `facts_written` / `fact_write_errors` on the result). Migration 20260909010000 (CHECKs widened). `autofilm-feed`: dealer-controlled facts withheld from `facts[]`, `facts_excluded_dealer_controlled` count |
| `71838b3b` | Crawler: html-only routine render; separate evidence render (price/fee change, no prior screenshot, or `force_screenshot`); `_shared/renderPacer.ts` (10/min default via `FIRECRAWL_RPM`, Retry-After, ≤2 429 retries, deadline-aware); html-only fallback when the evidence bundle is refused (non-429); unchanged price still writes an observation row (queue rotation); `observationChannel()` so a feed channel is never inherited; failed screenshot query reads as "has screenshot"; archived listings leave the rotation (queue rows skipped unless the VIN was named; seeds exclude archived). Migration 20260909020000 (queue ignores feed rows) |
| `1f7745b4` | `src/lib/evidence/priceEvidenceUrl.ts` + `PriceIntegrityCard`: signed URL minted on click under the viewer's session; bucket stays private |
| `7657e25d` | Migration 20260909030000: `vehicle_fact_conflicts.authority` CHECK widened (reviewer finding) |
| `8d27373e` | Crawler `credit_check` mode (platform callers only; env names and key lengths, never values); `render_budget` reports the budget the run started with |
| `f4022e95` | `_shared/renderKey.ts`: per-run key selection from the provider's credit-usage answer; choice recorded by env name in the run summary |
| `e1bc9450` | Guard-rejected price recorded in the ledger as `price_rejected` (was `captured`); the screenshot already taken is named in the audit row |

Tests added: `rooftopMatch` (57), `crawlOutcome` (16), `priceEvidence` (9), `renderPacer` (29), `crawlFormat` (44), `renderKey` (12), `checkConstraintDrift` (6), `factWriteFallback`, `autofilmFeedFacts`, `priceEvidenceUrl`, `PriceIntegrityCard`.

Not changed: the Passport (`VehiclePassportGoverned.tsx`) and its price arithmetic; `vehicle_facts` / `vehicle_snapshots` data; any consumer's read path; any secret; any cron; the `price-evidence` bucket (still `public = false`).

### 5.2 WHAT WAS DEPLOYED

| Function | Commit deployed | When (UTC) | Via |
|---|---|---|---|
| `marketcheck-sync` | `c60fa9db` | 01:01:04 | Lovable `supabase--deploy_edge_functions`, diff-verified |
| `crawl-advertised-prices` | `1f7745b4` → `8d27373e` → `f4022e95` → `e1bc9450` | 01:36 → 01:43 → 01:49 → 01:58 | same, each diff-verified against the named SHA |
| `autofilm-feed` | `1f7745b4` | 01:36 | same |
| `factory-sticker-orchestrate` | `1f7745b4` | 01:36 | same |

Migrations applied live (all via `query_database`, each self-verifying): 260000, 270000, 280000 (§2.1–2.3), 20260909020000 (§2.5, ~01:25), 20260909010000 (§2.4, 01:35), 20260909030000 (§2.6, 01:37).

### 5.3 WHAT WAS VERIFIED

**MarketCheck canary (§4.1): PASS on every criterion** (table above, 01:02Z).

**Firecrawl canary (§4.2): PASS after one root-cause fix.**

First run, 01:38Z, VIN `1C6SRFFT2NN400176`: cheap fetch 403 (Harte's site refuses plain fetches, so every visit is a render); evidence bundle refused **402**; html-only fallback also refused **402**; ledger `render_cost_refused` with `evidence_refused=402`, `paced_wait_ms=6220` (the pacer held the second render 6.2 s — pacing proven). The provider's message named credits, and an html render had cost one credit the day before against a dashboard showing 1,328. The new `credit_check` mode settled it:

| Env var | Team balance (01:43Z) | Plan | Period ends |
|---|---|---|---|
| `FIRECRAWL_API_KEY_1` (was preferred) | **−11** | 1,000 | 2026-09-17 |
| `FIRECRAWL_API_KEY` (the dashboard's team) | **1,316** | 1,000 | 2026-10-04 |

Every 402 since at least 2026-09-06 (144 `render_status 402` audit rows, 181 at 429, 0 successes) was the function spending an exhausted team while the owner read a healthy one. Fix `f4022e95`: one free credit-usage GET per key at run start, spend the key with the highest positive balance. No credits were bought.

Second run, 01:49–01:52Z, five single-VIN invocations (`render_key.env = FIRECRAWL_API_KEY`, reason `most_credits`):

| VIN | Cheap | Render | Ledger | Observation row | Listing components written |
|---|---|---|---|---|---|
| `1C6SRFFT2NN400176` (used RAM, fixture) | 403 | 200 html+screenshot | `captured` | `website` / `dealer_vdp_observation` / $25,876 / screenshot `…/1788918584329.png` sha `30d76ae5…` | before-doc **24,981** · sale **25,876** · doc fee **895** · dealer discount **11,944** (the page's own ladder, not description copy) · term "Selling Price" · CARFAX tokenized link · `title_status` null (no clean-title write) |
| `3GNAXUEV9LS593826` (used Equinox) | 403 | 200 | `captured` | $14,861, screenshot + sha | 13,966 / 14,861 / 895 / 3,548 · CARFAX link |
| `3PCAJ5BB6PF110401` (CPO QX50) | 403 | 200 | `captured` | $30,129, screenshot + sha | 29,234 / 30,129 / 895 / 1,288 · CARFAX link |
| `JN8AZ3DB3T9431184` (CPO QX80) | 403 | 200 | `captured` | $85,478, screenshot + sha | 84,583 / 85,478 / 895 / 13,997 · CARFAX link |
| `5N1BT3BB2TC779545` (new Rogue, hartecars.com) | 403 | 200 | `captured` at 01:51 → **`price_rejected`** after `e1bc9450` (01:58) | none — misparse guard: scraped 36,100 > feed 34,390 × 1.02 | `price_parse_status = warning`; components untouched |

- Provenance: all 4 new rows carry `source_channel='website'` + `captured_method='dealer_vdp_observation'`; 0 rows inherited `feed`.
- Evidence: 5 objects in `price-evidence` (1.5–2.0 MB each), bucket `public=false`, `price_evidence_view` SELECT policy for accepted tenant members / admins is in place, so the click-to-sign path in `PriceIntegrityCard` has the permission it needs.
- Badge writes: `carfax_1_owner=true` on the four used/CPO VINs was **already there from the feed** (`one_owner_source` null, not `dealer_vdp`); the crawl wrote no badge and no title status.
- Pacing: `renders_per_minute 10`, no 429 in the second run; first run showed the 6.2 s hold.
- Queue: Harte `advertised_price_crawl_queue` 21 → **25 VINs, 0 feed rows** (the four observed VINs joined the rotation).
- Cost measured: team balance 1,316 → **1,311 after five html+screenshot renders = 1 credit per evidence render**.
- The Rogue's ledger row said `captured` for a visit that wrote nothing: fixed in `e1bc9450` — re-canaried at 01:58Z after deploy: ledger now `price_rejected` (attempts 1, detail `advertised_above_feed scraped=36100 feed=34390`), the audit row names the screenshot (`…/1788919119276.png`), no observation row written, 1 credit spent. PASS.

**AutoFilm feed:** on 132 live Harte VINs there are 2,440 facts, of which **204 are dealer-controlled** and now withheld from `facts[]`; 119 VINs carried an `advertised_price` fact labelled VERIFIED and **99 disagreed with the listing** — none of those reach the feed any more; the live listing row is the only price in the payload.

**Truth writer:** CHECKs widened (§2.4, §2.6) with 0 rows affected; write errors now land in `audit_log` (`vehicle_truth_write_error`). No `vehicle_facts` / `vehicle_snapshots` / `vehicle_source_records` row was changed (5,042 / 313 / 222 before and after).

### 5.4 WHAT FAILED
1. First Firecrawl canary: 402 on both formats. Root cause: key precedence pointed at a team at −11 credits. Fixed (`f4022e95`), re-canaried, PASS.
2. Ledger said `captured` for the Rogue while the misparse guard wrote nothing. Fixed (`e1bc9450`). Re-verified 01:58Z: ledger reads `price_rejected`. PASS.
3. `render_budget` in the run summary reported the paced ceiling (36) on a 3-render single-VIN run. Fixed (`8d27373e`).
4. hartecars.com **new-car** VDP: the extractor reads 36,100 (MSRP-shaped) as the selling price; the guard correctly refused it. Label tuning for that template is a Gate 1 item, not P0. One screenshot object from the first Rogue run (`…/5N1BT3BB2TC779545/1788918692748.png`) is unreferenced by any row (the audit row now names the path going forward).
5. Nothing else failed. No migration rolled back. No deploy failed.

### 5.5 DATA IMPACT
- `advertised_prices`: +70 feed rows (MarketCheck canary, 01:02) and +4 observation rows (Firecrawl canary); relabels from §2.3 (1,532 observed, 58 feed, 0 UNKNOWN); no deletes.
- `vehicle_listings`: 4 VINs updated with price components, `website_price_term`, `history_report_url`, `price_source_url`; the Rogue got `price_parse_status='warning'`. The Passport reads these columns, so those four vehicles now show a page-derived Dealer Discount line where the feed had none — the intended data wiring, arithmetic unchanged.
- `advertised_price_crawl_attempts`: relabelled (15 → `render_rate_limited`, 10 → `render_cost_refused`); 5 canary rows.
- `provider_payload_shapes`: 1 row relabelled `marketcheck_syndication`.
- `vehicle_facts` / `vehicle_snapshots` / `vehicle_source_records` / `vehicle_fact_conflicts`: 0 rows changed.
- Storage: +5 objects (~8.7 MB) in the private bucket.
- `audit_log`: canary rows only.

### 5.6 COST IMPACT
- MarketCheck: 8 calls (~$7 list) for the canary; nightly cadence unchanged.
- Firecrawl: **6 credits** spent (five canary renders plus the Rogue re-check). Measured rate: 1 credit per html render and 1 per html+screenshot render.
- Projection the owner must decide on: Harte refuses plain fetches, so every visit is a render. Cron is `0 */6 * * *` with `limit 25` → up to **100 renders/day ≈ 3,000/month** against a 1,000-credit plan (1,311 on hand until 2026-10-04; the other team resets to 1,000 on 2026-09-17 and selection will use it when it holds more). Daily cadence at `limit 35` would be ≈ 1,050/month. Nothing was changed; the cron runs as configured.
- Lovable agent credits for four deploys: 2.4.

### 5.7 TEST RESULTS
- Full suite: 274 files, **4,567 passed**, 1 skipped, 0 failed (01:59Z, at `e1bc9450`).
- Typecheck (`tsc -p tsconfig.app.json --noEmit`): exit 0.
- esbuild bundle of `crawl-advertised-prices`, `autofilm-feed`, `factory-sticker-orchestrate`, `marketcheck-sync`: OK.
- Edge sticker mirror (`bun run sync:edge-sticker`): in sync.
- Live self-checks: every migration's DO block passed; queue self-check 0 feed rows.

### 5.8 OPEN RISKS
1. ~~The 03:07Z nightly with pruning enabled had not run yet~~ — ran 03:07Z, PASS (§5.10a).
2. The 06:00Z crawl cron is the first unattended paced run on the new code (25 VINs, ≤ 25 credits expected).
3. Two Firecrawl teams are billed; the owner may want to retire `FIRECRAWL_API_KEY_1` from the secrets (owner action; nothing here changes secrets).
4. New-car VDP label tuning (hartecars.com) before new cars get page-observed prices.
5. Screenshot orphan (one object) from §5.4.4.
6. Reviewer note carried forward: `notes ILIKE '%crawl%'` backfill in §2.3 may have over-matched by ≤ 58 rows; not fixed here.

### 5.9 ROLLBACK STATUS
Nothing rolled back; nothing needs to be. Per-migration rollback SQL is in §2. Function rollback = redeploy the prior commit through Lovable (`4ebb0479` is the last pre-change main; `marketcheck-sync` at `c60fa9db` is the current good state). Secrets and crons untouched, so no rollback there.

### 5.10 GO / NO-GO for Gate 0
**GO** — every P0 migration is applied and self-verified; every P0 function is deployed from a diff-verified commit; both provider canaries pass with provenance, pacing, evidence and cost recorded; the one ledger defect the canary exposed is fixed and re-verified. Total Firecrawl spend for Gate 0: 6 credits. The 03:07Z nightly with pruning enabled ran and passed (§5.10a).

### 5.10a Nightly `marketcheck-sync` with pruning ENABLED — observed 03:14Z: PASS
Cron fired 03:07:00Z (`cron.job_run_details` succeeded), function ran 03:07:02–03:07:59, `inventory_sync_runs` status `success`.

| Criterion | Observed |
|---|---|
| Coverage | `seen 128`, owned feed `num_found 57` · new **71 of 72** · rest **57 of 60** — identical to the canary |
| Gates | `segments.new.gate = null`, `segments.rest.gate = null` — pruning allowed at 98% / 95%; no `segment_collapsed` |
| Probe union | probe ① again returned the one-car answer (`mc_location_id` → 1); loop continued to probe ⑤ (70); `ingested 71 ≥ sufficient 43` |
| Removed | **2**, both `archive_reason = left_feed`, both `feed_source = marketcheck`, both created by the 2026-09-08 03:07 nightly and absent from every probe at 01:02 and 03:07: `JN8AZ2NE5L9251062`, `YV4102PK5M1682085`. Rows retained (`status = archived`, `archived_at` set); nothing deleted — the RPC's `listings_deleted` key is a compatibility alias of `listings_archived` |
| Not removed, correctly | two other unseen VINs (`5N1AT3CB7MC736556`, `JN8AZ3CC5T9624253`) have `feed_source = null` (added by hand, no `source_url`); the prune touches only feed-sourced rows |
| Provenance of writes | `prices_recorded 0` and **0** `advertised_prices` rows since 03:00 — feed prices were unchanged after the canary's baseline; nothing written, nothing mislabelled |
| Counts | active 132 → **130**, archived 152 → **154** |
| Cost | 8 MarketCheck calls (~$7), projected ~$210/month at this cadence — unchanged from before |

### 5.11 NEXT GATE
Stopping here. Gate 1 (Vehicle File current-state read model, shadow mode) begins only on owner approval. Decisions for the owner before Gate 1:
1. Firecrawl cadence / per-run limit (§5.6).
2. Whether to retire the exhausted key from the secrets.
3. Approval to tune new-car price labels for hartecars.com.

---

## Appendix A. Overnight job verification (routine check-in, read 04:30–04:45Z)

Read from `net._http_response`, `cron.job_run_details`, `audit_log` and the tables the jobs write. Nothing was changed by this pass.

| Job (UTC) | Result | Verdict |
|---|---|---|
| `carfax-link-sweep` 04:15, dry run (`apply:false`, limit 100) | HTTP 200. `examined 100, found 0, written 0, no_vdp_url 2, fetch_failed 98` — every fetch failed `blocked_by_site` 403 (the dealer's WAF refuses plain fetches, the same 403 the crawler's cheap fetch gets) | **Left dry. Not flipped to write** — it found nothing to write. The crawler already harvests the tokenized CARFAX link off each Firecrawl-rendered VDP (4 written tonight, §5.3), so for Harte this sweep is redundant unless it is given a rendered fetch |
| `specs-backfill` 03:45 (first scheduled run) | HTTP 200 `{"ok":true,"depth":0}`; one link only (no depth-1 chain); 0 listings touched 03:44–04:00; no NeoVIN payload shape observed tonight | **0 paid calls.** The only published listing without a build sheet (`JTMABABA5PA005774`) is at `specs_attempts 3` with `specs_strict_attempted true`, so the sweep stopped at the attempt cap. No runaway chaining |
| `passport-delivery-flush` (every 5 min, 00–02h and 06–23h) | HTTP 200 `{"ok":true,"sent":[],"failed":[],"retrying":[],"cancelled":[]}` on every firing 00:00–02:55; all 89 pg_net responses 00:00–03:00 were 200 | **401 gone — the deploy landed** |
| `intake-draft-sweep` 03:20 | audit `intake_draft_sweep_run`: `scanned 173, failed 0, clearance_recomputed 173` | PASS |
| `get-ready-sweep` 03:25 | cron succeeded. `sweep_missing_get_ready()` returns its counts as jsonb and writes **no audit row** (pg_cron discards the return value), so there is nothing in `audit_log` to confirm by design | ran; counts not recoverable after the fact |
| `getready-install-safety-net` 04:30 | audit `install_safety_net_run`: `candidates 0, lines_flipped 0, addendums_updated 0` | PASS |
| `ingest-orchestrate-sweep` 03:30 | pg_net reports a 5,000 ms timeout (job 7 sets no `timeout_milliseconds`, so the default applies) but the function ran: audit `ingest_orchestrate_sweep` 03:30:40 | ran; the cron entry needs a timeout so its response is kept (owner change) |
| `advertised_prices` feed rows | 70 feed rows written by the 01:02 canary sync with `captured_by null`, `source_channel 'feed'`, `captured_method 'marketcheck_syndication'` | fixed, confirmed |

### A.1 Description spend — the item that costs money
`description_model_executions` (all tenants; requester null = system):

| Day (UTC) | Executions | Tokens in / out |
|---|---|---|
| 09-06 | 19 | 462,573 / 16,080 |
| 09-07 | **562** | 1,852,001 / 167,769 |
| 09-08 | **506** | 2,850,878 / 301,240 |
| 09-09 to 04:30 | **207** | 1,115,938 / 127,289 |

- Budget row (Harte): `daily_generation_limit 500`, `monthly_generation_budget $135`, `max_cost_per_generation $0.10`, `hard_stop_pct 100`. Both 09-07 and 09-08 finished **over the 500/day count cap**.
- `cost_state = 'unavailable'` and `cost_amount = 0` on **all 1,294 rows** (provider `openai`, model `gpt-5.6-luna`): the pricing table has no entry for that model, so the dollar budget and the per-generation cap cannot bind; only the count cap does. Five `description_model_cost_unmeasured` audit rows were written tonight alone.
- Where today's 207 came from: **157 executions across 16 vehicles at 01:03–01:09**, directly after the 01:02 MarketCheck canary sync, and **50 across 5 vehicles at 03:08–03:10** after the nightly. A sync that changes a vehicle's description inputs re-fires generation plus a repair pass per channel — about ten model executions per vehicle. The 01h burst is therefore a cost consequence of the canary run that this report should own.
- Tonight's five gate evaluations: 1 PASS, 1 REVIEW, 3 REJECT (evidence gate blocking). The 06:00 reconcile has not run, so the `CHANNEL_PRICE_NOT_ALLOWED` / `REQUIRED_DISCLOSURE_MISSING` / `CHANNEL_LENGTH_EXCEEDED` comparison is still pending.

**Owner decisions:** supply pricing for `gpt-5.6-luna` (or switch the configured model to one the cost table knows) so the dollar budget binds; decide whether a sync-triggered regeneration should be rate-limited per day; the 500/day count cap has been exceeded two days running.

### A.2 Not acted on, per the standing instruction
Empty `addendum product_rules` (owner's product data); CT "AS IS" Buyers Guides (legal document); `packet-backfill` and `send-ct-mvp-compliance-digests` scheduling — both are now present in `cron.job` (jobs 27 at 09:40 and 28 hourly); `packet-backfill` spends money and has not been reviewed here.

---

## Appendix B — 06:00Z first unattended crawl run, and the description reconcile (checked 06:25Z)

### B.1 The 06:00 crawl: a defect, found and fixed
The cron fired `crawl-advertised-prices` with `limit 25`. The gateway answered **504 `IDLE_TIMEOUT` (150 s)**;
the function kept working to its own 220 s budget. What it did before stopping:

| VIN | Captured at | Seconds in | Result |
|---|---|---|---|
| `3VWEM7BU8RM082795` | 06:00:51 | 51 | observation row, screenshot + sha |
| `5N1AL1FWXTC358105` | 06:01:50 | 110 | observation row, screenshot + sha |
| `3N1AB8BV3MY259117` | 06:02:46 | 166 | observation row, screenshot + sha (after the gateway had already given up) |
| `5UXCW2C03N9J22405` | 06:03:27 | 207 | observation row, screenshot + sha |
| fifth vehicle | ~06:03:33 | 213 | render fired inside the last 7 s of the budget, **1 credit paid, nothing written** |

- 4 of 25 vehicles reached; 21 untouched; the run summary was lost with the 504. All four rows are
  `website / dealer_vdp_observation`, all `First crawl`, pacing recorded, key `FIRECRAWL_API_KEY`.
- Credits: 1,310 → **1,305** (four renders written + one lost). Queue 25 → 29 VINs, 0 feed rows.
- Root cause: a paced, screenshot-backed visit of this dealer's pages takes 30–60 s (Firecrawl full-page
  render + 1.5–2 MB screenshot copy), so one request can hold four or five vehicles, not twenty-five,
  and the 220 s budget was already past the gateway's 150 s idle limit.
- Fix, commit `593fb5d2`: each request works inside a **120 s link budget**, refuses to start a render it
  cannot finish (**40 s headroom**), and when it runs out of time with rows left it **chains the remainder
  to a fresh request** with `limit` reduced by what it processed, at most 12 links deep. Single-VIN and
  test-button calls never chain. Every link writes an `advertised_price_crawl_run` audit row (summary,
  pacing, next-link status) so a lost response still leaves a record.
- Chain canary, deployed 06:35Z from `bbea9939` (function dirs identical to `593fb5d2`):
  - `limit 4` (06:36:55): one link, 4 processed in 60 s, HTTP 200 with the full body, `next_link null`,
    audit row written. Renders were faster this time (~15 s each), so no handoff was needed.
  - `limit 8` (06:41:32): **link 0** picked 8, processed 5 in 94 s, `ran_out_of_time true`,
    `next_link {depth 1, limit 3, fired}`, answered 200 (no 504); **link 1** picked 3, processed 3 in
    60 s, `next_link null`. Both links left `advertised_price_crawl_run` audit rows. 8 renders, 5
    observation rows with screenshots, 3 refused by the guard. Pacer wait recorded (3.1 s / 4.0 s).
    **The chain works.**
- The two canaries exposed a second defect: a vehicle whose page price the guard refuses writes no row,
  so its clock never advances and it is first in line every run — the same new QX60 was rendered and
  refused at 06:37 and again at 06:41. 128 of Harte's 130 active listings carry a VDP URL and **71 are
  new cars**, whose pages read above the feed price (MSRP-shaped) on both harteinfiniti.com and
  hartecars.com; without a fix, every run would spend its budget refusing the same pages. Fix, commit
  `16bcff2e`: a vehicle with a `price_rejected` ledger entry inside the last **seven days** is left
  alone on both the queue and seed paths (a named VIN is still visited), reported as `backoff_skipped`.
  Verification after deploy (06:52Z, `limit 1`, function dirs at `16bcff2e`): `backoff_skipped 5` — all five refused VINs left alone — and the one vehicle visited (`5N1AC0FX9VC607600`) was captured with a screenshot. **PASS.** Full suite after both fixes: 274 files, 4,576 passed, 1 skipped; typecheck clean.
- Credits: 1,305 → 1,292 across the two chain canaries and the backoff check (13 renders). Gate 0 total: **24 credits**.

Cost consequence for the owner's cadence decision (§5.6): with chaining the cron now does what it was
asked — up to 25 renders per run, 4 runs a day, over a universe of 128 crawlable VINs (57 used/CPO once
the 71 new cars are backed off). Until the cadence is changed that is up to ≈100 credits/day against
1,293 on hand; with the new cars backed off and the used cars rotating, closer to 57 per rotation.

### B.2 Description reconcile (06:00Z)
`description-reconcile-nightly` answered **202 `kicked`** at 06:00:05. As of 06:25 the kicked sweep had
produced **no new preflight or validation rows** and the day's model executions were still **207**
(unchanged since 03:11), so the blocked-count comparison cannot be made yet. For the record, blocking
validation findings by code:

| Code | 8 Sep (findings / cases) | 9 Sep to 06:25 (findings / cases) |
|---|---|---|
| `CHANNEL_PRICE_NOT_ALLOWED` | 243 / 50 | 112 / 21 |
| `REQUIRED_DISCLOSURE_MISSING` | 63 / 40 | 17 / 12 |
| `UNSUPPORTED_FEATURE_CLAIM` | 0 | 3 / 2 |
| `CHANNEL_LENGTH_EXCEEDED` | 0 in this table | 0 |

The 8 Sep preflight table shows 51 passed, 4 `BUDGET_EXCEEDED`, 1 `DEALER_IDENTITY_INCOMPLETE`. The
routine's "57 / 15 / 33" figures were counted from a different surface than these two tables; the
per-case counts above are the comparable series going forward. Budget and crons untouched.

