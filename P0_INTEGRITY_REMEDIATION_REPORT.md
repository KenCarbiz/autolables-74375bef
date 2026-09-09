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

### 2.4 `20260909010000_vehicle_facts_check_widen.sql` — PENDING (from Phase 3 build)
- **Purpose:** the TypeScript enums carry `dealer_vdp` and `history_provider`; the live CHECKs do not.
  Nothing persists them today, but the write path discards the upsert error, so the first attempt
  would silently drop every fact for that VIN. Widen the three CHECKs; the code fix makes the error
  visible.
- **Preflight / result / rollback:** PENDING.

---

## 3. Edge functions — what deploys, from which commit

| Function | Commit | Contains | Status |
|---|---|---|---|
| `marketcheck-sync` (+ `_shared/rooftopMatch.ts`) | `c60fa9db` | proportional segment gate · backstop probe union · `source_channel='feed'` + `captured_method` on feed rows · endpoint-derived telemetry label · `no_prune` canary flag | deploy queued |
| `crawl-advertised-prices` (+ `_shared/crawlOutcome.ts`, `_shared/renderPacer.ts`) | PENDING | status-first outcome classifier · `captured_method='dealer_vdp_observation'` · description strip on all VIN-scoped price extraction · rate pacing ≤10/min with Retry-After · html-only routine format · conditional screenshot | after build |
| `autofilm-feed` | PENDING | dealer-controlled facts excluded from `facts[]` | after build |
| `factory-sticker-orchestrate` (`truth.ts`) | PENDING | upsert errors surfaced; per-row fallback; audit row on partial write | after build |

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

## 5. Results — PENDING

### 5.1 WHAT CHANGED
### 5.2 WHAT WAS DEPLOYED
### 5.3 WHAT WAS VERIFIED
### 5.4 WHAT FAILED
### 5.5 DATA IMPACT
### 5.6 COST IMPACT
### 5.7 TEST RESULTS
### 5.8 OPEN RISKS
### 5.9 ROLLBACK STATUS
### 5.10 GO / NO-GO for Gate 0
### 5.11 NEXT GATE
