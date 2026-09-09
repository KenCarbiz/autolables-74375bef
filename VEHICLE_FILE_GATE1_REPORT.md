# VEHICLE FILE — GATE 1 REPORT (current-state / architecture maps)

Date: 2026-09-09 (UTC). Repo `KenCarbiz/autolables-74375bef`, main at `83baf7cc` when mapping started. Gate 0 is
closed (P0_INTEGRITY_REMEDIATION_REPORT.md). Owner said "Go" at 10:1xZ; this report is the Gate 1 status in the
directive's required format. Nothing was built, deployed or migrated at Gate 1; the deliverables are documents.

## WHAT CHANGED
Six maps, written by the five owning agents the directive names (§1), cross-reviewed by a different domain,
revised, then judged by three independent inspectors, then corrected:

| Deliverable (repo root) | Owner | Size |
|---|---|---|
| `SOURCE_TO_FACT_MATRIX.md` | Agent 1 — Vehicle Truth / Data Architecture | 436 lines |
| `PROVIDER_COST_AND_ENTITLEMENT_MAP.md` | Agent 2 — Providers / Ingestion / Cost | 421 lines |
| `CUSTOMER_DISPLAY_LICENSE_MATRIX.md` | Agent 2 | 122 lines |
| `VEHICLE_FILE_CURRENT_STATE_MAP.md` | Agent 3 — Vehicle File / UX | 484 lines |
| `DUPLICATE_READ_PATHS.md` | Agent 4 — Operations / Compliance | 440 lines |
| `FACT_TO_CONSUMER_MATRIX.md` | Agent 5 — Downstream Consumers | 325 lines |

Every claim in them cites a repo `file:line` or a read-only live query listed in each document's Evidence index;
what could not be established is written UNKNOWN / REVIEW REQUIRED. No file under `src/` or `supabase/` changed.

## WHAT WAS DEPLOYED
Nothing. No migration applied, no function deployed, no cron or secret touched.

## WHAT WAS VERIFIED
Process: 5 map agents → 6 cross-reviews (137 findings, 7 blocking-and-not-confirmed, all resolved in revision;
1,189 tool calls) → 3 inspectors → correction pass (51 findings applied across the six maps: SOURCE_TO_FACT_MATRIX.md 9; PROVIDER_COST_AND_ENTITLEMENT_MAP.md 9; CUSTOMER_DISPLAY_LICENSE_MATRIX.md 5; VEHICLE_FILE_CURRENT_STATE_MAP.md 6; DUPLICATE_READ_PATHS.md 13; FACT_TO_CONSUMER_MATRIX.md 9; code-level findings recorded in each map as 'Inspector finding — code change proposed (owner decision)', none implemented).

Inspector verdicts on "the architecture remains consistent with the evidence" (directive §49):

| Inspector | Verdict |
|---|---|
| I1 — database integrity / RLS / tenant isolation / migrations / rollback | CONSISTENT_WITH_CORRECTIONS |
| I2 — Vehicle Truth accuracy / pricing / provenance / consumer regressions | CONSISTENT_WITH_CORRECTIONS |
| I3 — product UX / role usability / cost / customer safety / performance | CONSISTENT_WITH_CORRECTIONS |

The architecture the directive prescribes — one server-side VehicleFileReadModel, field-specific authority, no
Truth V2, Passport last — stands. The evidence adjusts HOW it must be built (see OPEN RISKS).

Established findings that survived cross-review and inspection (the ones that change the plan):
1. The truth engine is a derived ledger, not a source of record: its only producer re-reads `vehicle_listings`
   after every provider has already written it without precedence; every fact key has exactly one source kind
   in the database, so `vehicle_fact_conflicts = 0` is structural. Facts never refresh for a vehicle whose
   sticker is PUBLISHED; `observed_at` is orchestration time. Freshness must be computed from writer stamps
   (`price_last_verified_at`, `advertised_prices.captured_at`, `specs_decoded_at`, recall stamps), not from facts.
2. Stock has no `vehicle_listings` column; the only durable home is `vehicle_files.stock_number` (130/130), which
   the resolver never reads; six readers look at `mc_attributes.stock_no` (populated on 0). The customer documents
   page prints the last six characters of the VIN labelled "Stock #".
3. Advertised retail has five live homes and is mode-dependent on the Passport (`resolveDisplayPrice`; on Harte the
   served total is the feed `price`, selling = price − doc fee). The Vehicle File truth card shows a stale
   VERIFIED `vehicle_facts.advertised_price` on 99 of 118 VINs. `verify_addendum_price` (the signing gate) takes
   the website channel with no age bound: a July $90,403 capture beats today's $78,084 feed on `JN8AZ3AE1T9720885`.
4. MSRP is two questions: NeoVIN total MSRP (VERIFIED, staff) vs the feed's `mc_attributes.msrp` (semantics
   UNKNOWN, shown to customers as the Passport anchor); they disagree on 104 of 123.
5. Engine/drivetrain are written by `marketcheck-specs` from NeoVIN and overwritten every night by the feed build
   object; the steady-state value is the feed's and can never reach VERIFIED.
6. Three repo migrations were never applied live: `vehicle_listings.title_verification`, `title_report_pulls`
   (NMVTIS meter and 50/month cap) and `marketcheck_comps_cache`. Consequences: NMVTIS attestations cannot save,
   the cap is inert ("0 of 50" forever), every anonymous comparables open is a paid search.
7. `stale_document_flags` carries 7,079 duplicate open rows because the table has no DELETE policy, so the client
   reconcile path's delete matches nothing, silently.
8. `get_vehicle_listing_by_slug` is SECURITY DEFINER, `SELECT *`, EXECUTE-granted to anon: the edge function
   strips `install_token`, `mc_raw` and friends before serving, but a direct RPC call with the anon key does not.
9. Get Ready on Harte is 100% seeded and 0% executed (130 records pending, 0 signed inspections, 0 sign-offs), and
   58 of 58 used vehicles are published while `blocked_inspection_not_started`; 9 published cars are REMOVED in
   `vehicle_lifecycle`. Operational facts today come from flags, not completed workflow events (§36).
10. The used-car sticker adds the settings doc fee on top of a fee-inclusive price on the pilot tenant (live), and
    `nightlyComplianceAudit.ts` selects columns that do not exist and aborts.
11. Cost: only `marketcheck-sync` meters MarketCheck; enrich (~$0.17 list/VIN), NeoVIN ($0.08), comps, recalls,
    market pricing are unmetered and have no dollar cap; description spend is unmeasurable (no pricing entry for
    `gpt-5.6-luna`), 500/day count cap exceeded two days running.
12. Licensing: nothing in the repo grants redistribution rights for any paid family; MarketCheck analytics (market
    value, DOM, comparables, MDS-derived text) are displayed to anonymous shoppers today and are classified
    UNKNOWN-REVIEW REQUIRED. Federal data (NHTSA, EPA) is CLEARED on code-comment evidence only.
13. One published listing is not Harte: `JN8AZ3DB6T9435410` in tenant "AutoLabels.io" at $171, publicly resolvable.

## WHAT FAILED
Nothing in the Gate 1 process failed (20 + 6 agents, 0 errors). The findings above describe production defects
the maps surfaced; none was changed at Gate 1.

## DATA IMPACT
None. All database access was read-only SELECT on the public schema.

## COST IMPACT
No provider was called (agents were forbidden to spend). Lovable credits: 0. Orchestration: ~5.4M agent tokens.

## TEST RESULTS
No code changed at Gate 1. Last full suite (Gate 0, at `16bcff2e`): 274 files, 4,576 passed, 1 skipped; typecheck clean.

## OPEN RISKS (what the shadow read model must handle — consolidated from the three inspectors)
- Scope: declare the VIN population (pilot 130 active vs 131 published across tenants) and emit UNEXPLAINED, never
  a crash or an average, for the other-tenant row and for any listing without a `vehicle_files` row.
- Run as service role with an explicit `tenant_id` on every table; two tenant-scoping models coexist
  (`current_tenant_id()` on listings/files/prep vs `tenant_members` lists elsewhere). Key on `vehicle_listings.id`;
  join `vehicle_files` on `(tenant_id, upper(vin))`; join `advertised_prices` the same way and ignore its 447
  orphan rows; cast the text/uuid mismatches (`vehicle_value_history.tenant_id`, `audit_log.store_id`).
- Price: compare per concept (feed total, selling = total − doc fee, crawler ladder, fact) and reproduce
  `buildSalePriceCard` exactly for the Passport projection; website candidates must require
  `captured_method = 'dealer_vdp_observation'` and an age bound; a `price_rejected` outcome supersedes an older
  website row; refused observations exist only in `audit_log` (`advertised_price_crawl_skipped`).
- Stock from `vehicle_files.stock_number` only; MSRP as two named questions; engine/drivetrain NeoVIN candidate
  from `build_sheet` / `neovin_snapshots`; condition CPO conflicts (35/130) and stale VERIFIED condition on 3;
  mileage NULL vs 0 on new cars is EXPECTED SOURCE DIFFERENCE; identity from `ymm` parsers disagrees on
  multi-word makes.
- Recall lives in three stores with different coverage; freshness = greatest of their stamps, per source.
- Never call a provider to fill a gap; never touch write paths that fire on reads today (stale-flag reconcile,
  description refresh, truth rewrite); never build the timeline from the tenant-wide `audit_log` tail (254 KB,
  unindexed) — use `vehicle_change_history` / `vehicle_value_history`.
- Carry the license class per family so customer projections can withhold UNKNOWN families.

## ROLLBACK STATUS
Not applicable: documents only. Nothing to roll back.

## NEXT GATE
Gate 2 = build `VehicleFileReadModel` in SHADOW MODE (§50), compare CURRENT vs NEW RESOLVED for every active VIN
on the twelve critical fields, and return `VEHICLE_FILE_SHADOW_PARITY_REPORT.md` with VIN / stock / mileage /
retail at 100% EXPLAINED (§51). Not started; waits for owner approval of Gate 1 and the decisions below.

Decisions for the owner before Gate 2:
1. VIN scope for parity: pilot tenant only (130), or all published (131) including the AutoLabels.io test row —
   and whether to archive that row.
2. "Current retail" for the §51 standard: the feed `price` (what the Passport serves) or the crawler ladder.
3. Security fixes found at Gate 1 that are outside the Gate 1 mandate and need your go-ahead as separate P0
   changes: (a) `get_vehicle_listing_by_slug` → explicit customer-safe column list; (b) tenant-scoped DELETE
   policy on `stale_document_flags` (CLAUDE.md RLS shape); (c) `verify_addendum_price` to require
   `dealer_vdp_observation` and an age bound. Each is one migration with a stated rollback.
4. Whether to apply the three never-applied title migrations before any NMVTIS pull (or keep NMVTIS off).
5. Licensing review list (§34): the MarketCheck families displayed to shoppers today, and NeoVIN redistribution
   via `autofilm-feed` / `vehicle-lookup`. Until decided, no customer-facing expansion.
6. Still open from Gate 0: Firecrawl cadence/limit; retiring the exhausted key; a pricing entry for the
   description model (or a model the cost table knows).
