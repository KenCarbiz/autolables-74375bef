# ROLLOUT_AND_ROLLBACK

How the Vehicle Intelligence and Passport 2.0 work reaches production, what
can be switched off, and what a rollback touches. Master build section 38;
state as of 2026-10-27 evening.

## 1. Flags

Flags live in `src/lib/market/flags.ts`, default OFF, and only a literal
`true` in a tenant's `market_flags` turns one on. The reader audit in
`flagSafety.test.ts` records how many production modules read each flag; a
flag with zero readers is a label, not a control, and is reported as inert.

| Flag | Readers | State | Meaning when on |
|---|---|---|---|
| market_value_v2_admin | 1 | control | V2 view to dealer staff |
| market_value_v2_shadow | 1 | control | V2 computed beside production, evidence only |
| market_invalid_claim_suppression | 1 | control | no market claim on an implausible price |
| market_value_v2_public | 0 | inert | V2 on the customer Passport |
| marketcheck_current_endpoint | 0 | inert | documented predict path |
| marketcheck_premium_comparables | 0 | inert | Premium comparables (spend) |
| pricing_position_v2_shadow | 0 | inert | pricing position, shadow |
| exact_mds | 0 | inert | VIN exact MDS ladder |
| current_sales_stats | 0 | inert | VIN / YMMT sales-stats cohorts |
| sold_summary | 0 | inert | Sold Vehicles Summary (entitlement) |
| generic_vin_fallback | 0 | inert | generic fallback price request |
| available_options_packages | 0 | inert | Available Options Packages |
| premium_plus_used_intake | 0 | inert | Premium Plus at used intake |
| premium_used_refresh | 0 | inert | Premium at used refresh |
| autorecalls_vin | 0 | inert | documented AutoRecalls path |
| market_intelligence_v3_shadow | 0 | inert | V3 intelligence record beside production |
| premium_plus_new_intake | 0 | inert | Premium Plus at new first-seen |
| fee_normalized_comps | 0 | inert | fee-normalized comparable basis |
| nmvtis_auto_verify | 0 | inert | exception-based NMVTIS (spend, terms) |
| oem_incentives_v2 | 0 | inert | incentives under the program cache |
| provider_webhooks | 0 | inert | signed webhook intake |
| blackbook_live | 0 | inert | Black Book as a live signal |
| market_value_v3_shadow | 0 | inert | Market Value V3, shadow |
| market_value_v3_public | 0 | inert | Market Value V3 on a customer surface |
| vehicle_score_shadow | 0 | inert | Vehicle Score, shadow |
| vehicle_score_public | 0 | inert | Vehicle Score on a customer surface |
| data_confidence | 0 | inert | Data Confidence beside the score |
| buyer_recommendation | 0 | inert | Buyer Recommendation with hard gates |
| passport_2_new | 0 | inert | Passport 2.0 new experience |
| passport_2_used | 0 | inert | Passport 2.0 used experience |

When a reader is wired, the count in `flagSafety.test.ts` moves in the same
commit, so the table above can be regenerated from the test rather than
trusted.

## 2. Sequence: shadow, canary, public

1. Shadow. The `*_shadow` flag is read by a server-side job only
   (`decideShadowEvaluation` refuses browser and unknown sources), tenant
   scoped, no provider spend, no customer column written, append-only
   evidence. Output carries `publishable: false`.
2. Canary. One tenant, the pilot store, with the shadow output compared with
   today's surfaces for at least seven nightly runs; the section 40 health
   report is re-run before and after; spend is read from
   `provider_call_month('marketcheck')`.
3. Public. The matching `*_public` flag is read by the serving surface for
   the canary tenant first, then per tenant. The customer Passport at `/v/`
   is locked; the Passport 2.0 experiences are new routes behind
   `passport_2_new` and `passport_2_used`, never a replacement of the locked
   page without a fresh owner sign-off.

Nothing goes public while the data-foundation completion gate (section 41)
has an open item.

## 3. Off switches that exist today

| Switch | Scope | Where | Effect |
|---|---|---|---|
| `market_flags.<flag>` | tenant | `dealer_profiles.settings` | the flag's reader stops |
| `provider_call_budgets.enabled` | account | table row for `marketcheck` | gate off: every call admitted (fail-open, logged) |
| `provider_call_budgets.monthly_call_cap` / `reserve_for_essential` | account | same row | the cap and the feed's reserve |
| `enrich-sweep-nightly` cron job | account | `cron.job`, `cron.alter_job(active := false)` | nightly sweep stops; paused since 2026-10-27 |
| `ENRICH_SWEEP_HOUR_UTC` | account | project secret, read on each sync run | hour of the sync's sweep kick; 25 silences it |
| `ENRICH_PER_RUN` | account | project secret | inline enrich cap per feed run, default 10 |
| `ENRICH_INCLUDE_MDS` | account | project secret | MDS call in enrichment, default true |
| `MARKETCHECK_INCENTIVES_ENABLED` | account | project secret | incentives function gate, unset |
| `market_provider_budgets.enabled` | tenant | table | USD reservation budget for the prediction call, off |
| `marketcheck_sync_config.enabled` | tenant | table | the feed pull for that tenant |
| `providerRegistry.policyFor` | code | `src/lib/market/providerRegistry.ts` | reserved, deprecated and never-triggered capabilities refused by construction |

## 4. Rollback, step by step

| Step | Touches | Does not touch |
|---|---|---|
| Turn a flag off | one tenant settings row | any evidence row |
| Disable the budget gate | one budget row | the ledger; refusals already recorded stay |
| Redeploy a function | the function, from the previous commit by hash (the Lovable agent verifies blob hashes against a named commit and deploys one function at a time; the same path rolls back) | data |
| Re-pause the sweep | the cron row | listings |
| Revert a migration | only by a forward migration; today's are reversible by design: the cursor migration is re-applied from its predecessor, the `mc_raw` repair kept every payload in `market_pricing_legacy_payloads`, the budget tables can be disabled without dropping | any ledger |

Rollback never deletes evidence. These stores are append-only and are read,
never truncated, by a rollback: `provider_call_events`,
`provider_request_reservations`, `advertised_prices`,
`advertised_price_crawl_attempts`, `market_pricing_legacy_payloads`,
`neovin_snapshots`, `vehicle_value_history`, `inventory_sync_runs`,
`audit_log`. `authenticated` holds SELECT only on the new ledgers, and
`sandbox_exec` SELECT only, so a surface cannot empty them by mistake.

## 5. Deploy pattern in use

- Code lands on `main` by direct push after `bunx tsc -p tsconfig.app.json
  --noEmit` and `bun run test` (two pre-existing baseline failures are
  recorded in TEST_REPORT.md).
- A migration is applied by hand through the project database connection in
  one transaction and recorded in `supabase_migrations.schema_migrations`
  with the file's version, so the file tree and the database agree.
- An edge function is deployed by the Lovable agent from a named commit, one
  function per request, after it reports matching blob hashes for the
  function and its shared imports. The request forbids edits, migrations,
  secret changes and invocations. Deploys made this way on 2026-10-27:
  marketcheck-sync (twice), marketcheck-specs, crawl-advertised-prices
  (twice), vehicle-enrich, marketcheck-comps.
- Verification after a deploy is read-only SQL on the rows the function
  writes, plus a scheduled check-in on the next nightly run.
