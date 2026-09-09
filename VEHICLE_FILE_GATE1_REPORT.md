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

---

## Owner decisions on the six Gate 1 questions (2026-09-09, "all six yes go")

| # | Question | Decision and what it means in action |
|---|---|---|
| 1 | VIN scope for parity; archive the other-tenant row? | Parity runs on BOTH scopes: pilot tenant Harte (130 active) is the primary population and the §51 standard is judged on it; all-tenant (131 published) is reported alongside with `JN8AZ3DB6T9435410` (tenant `93ae75c1` "AutoLabels.io", $171, no `vehicle_files` row) named and classified UNEXPLAINED rather than averaged away. **Archiving that row is HELD**: the question was compound and "yes" does not settle an either/or, and it is another tenant's published data. One statement is ready when the owner says so: `UPDATE public.vehicle_listings SET status='archived', archived_at=now(), archive_reason='internal_test_row' WHERE id='03fbcebf-c240-4f4b-b315-10d9b7f54676';` (reversible via the existing unarchive path). |
| 2 | "Current retail" for the §51 standard | The dealer's current claim — `vehicle_listings.price`, which is what the Passport serves — is current retail. The crawler ladder is a different question and is reported separately as `publicAdvertisement`, so a fee-inclusive total compared with a fee-exclusive observation is an EXPECTED SOURCE DIFFERENCE rather than a mismatch. The read model already carries both as named fields. |
| 3 | Three security fixes as separate P0 changes | APPROVED and in preparation: (a) lock `get_vehicle_listing_by_slug` so the anon key cannot bypass the deny-list, (b) tenant-scoped DELETE policy on `stale_document_flags` plus collapse of the 7,079 duplicates, (c) `verify_addendum_price` to require `dealer_vdp_observation` and bound the observation's age. Each is one migration with §55 discipline and a stated rollback; each is applied only after its live before/after evidence is on the record. |
| 4 | Apply the three never-applied title migrations | APPROVED. One idempotent migration brings the database to the state the three describe: `vehicle_listings.title_verification` and the `title_report_pulls` meter, and **not** `title_reports` — the VINData terms forbid persisting the provider response, which is why the third original migration dropped it. Applying the meter is what makes the 50/month NMVTIS cap bind; today it reads "0 of 50" forever and nothing stops a pull. |
| 5 | Licensing review list (§34) | ACCEPTED as the standing list. No customer-facing expansion of any UNKNOWN-REVIEW REQUIRED family until a human checks the contracts; the read model carries the license class per candidate so a customer projection can withhold them mechanically. Nothing here can be resolved by reading the repository: MarketCheck and NeoVIN redistribution rights need the agreements themselves. |
| 6 | Gate 0 leftovers: Firecrawl cadence, the exhausted key, the description model rate card | **Cadence: DONE.** `autolabels_crawl_advertised_prices` moved from `0 */6 * * *` to `20 7 * * *` via `cron.alter_job` (schedule only; the command and its secret were never read or rewritten). Daily at limit 25 is ~750 credits/month against a 1,000 plan and rotates the 57 crawlable used/CPO cars every two to three days; the old cadence would have exhausted the 1,292 remaining credits around 22 September. 07:20 keeps it clear of the 06:00 description reconcile and the hourly sync at :07. **Exhausted key: OWNER ACTION.** Removing `FIRECRAWL_API_KEY_1` is a dashboard and billing decision; until then the balance-based selection uses whichever team can pay, which is correct behaviour and costs nothing. **Rate card: BLOCKED ON DATA.** A pricing entry for `gpt-5.6-luna` needs the real per-token rates; inventing them would make the dollar budget bind on fiction, which is worse than the count cap alone. Supply the rates and it is a one-line table entry. |

---

## P0 security and title batch — applied and verified (2026-09-09, 11:53Z–12:46Z)

All four owner-approved database changes are applied. Each was prepared read-only with §55 discipline,
reviewed, then applied through Lovable from the committed file; Lovable recorded byte-identical copies
under its own timestamps (`20260909115524`, `20260909115717`, `20260909115938`), which is independent
confirmation that what ran is what was written.

| Change | Result | Proof |
|---|---|---|
| `20260909100000` — revoke anon/authenticated EXECUTE on `get_vehicle_listing_by_slug` | APPLIED | A direct `/rest/v1/rpc/` call with the anon key now returns **401, `permission denied for function get_vehicle_listing_by_slug`**; before, it returned all 86 columns of any published or archived listing. `has_function_privilege`: anon `false`, authenticated `false`, service_role `true`. |
| `20260909101000` — DELETE policy on `stale_document_flags` + collapse | APPLIED | Open rows **7,080 → 2**; 7,078 duplicates removed, both survivors the newest of their group (asserted by the migration's own self-check). Policy `tenant delete stale_document_flags` present, `TO authenticated`, `(SELECT auth.uid())`. |
| `20260909102000` — `verify_addendum_price` observation bound | APPLIED | Live function body now requires `captured_method = 'dealer_vdp_observation'`, bounds the observation at seven days, and treats a later `price_rejected` as superseding. Four active vehicles change the number the gate compares against. |
| `20260909103000` — title backlog | APPLIED | `vehicle_listings.title_verification` present; `title_report_pulls` present with RLS on and its tenant-read policy; **`title_reports` correctly still absent** (VINData terms forbid persisting the provider response). The NMVTIS 50/month cap can now bind — it read "0 of 50" forever because its meter table did not exist. |

**Passport regression, run at every step.** `public-listing-view` called with the anon key for a real
published slug returned HTTP 200 with identity and price intact and no `install_token`, `mc_raw` or
`price_parse_notes`, before the revoke, after the revoke, after the scrub redeploy, and after the title
column landed. Payload 41,555 bytes, 94 keys.

**Two code fixes shipped alongside** (commit `5c8da6aa`), because neither database change was sufficient
on its own:
- The signing gate's other half lives in the browser. `useAdvertisedPrices.byVin` fed
  `addendums.vehicle_price` and preferred any row labelled `website` at any age from any writer. It now
  applies the same seven-day, `dealer_vdp_observation`-only bound as the server, so the two agree and a
  two-month-old capture can no longer reach a customer's signature page.
- `title_verification` carries `verified_by`, an internal user id, and both sister-app feeds and the
  public view copy the listing row allow-by-default. It is now scrubbed through an allow-list in
  `_shared/lotFeedRow.ts` and `public-listing-view`, deployed before the column existed. This is what
  the title migration was held on.

**Residual items** recorded by the preparation agents, none blocking: the browser's `getBySlug` survives
as dead code that would now fail if wired up; a future migration copying the old `GRANT EXECUTE ... TO
anon` line would silently re-open the RPC; the partial unique index that would make flag duplication
structurally impossible was deliberately NOT added, on evidence it breaks the orchestrator's addendum
path; past NMVTIS spend is unrecoverable, so this month's cap starts from zero.

