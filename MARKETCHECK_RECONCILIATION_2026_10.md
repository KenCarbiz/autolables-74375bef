# Late-October 2026 MarketCheck Reconciliation

The change order of 2026-10-27 reconciled against the master build. Nothing
was restarted; every item below was checked against the code on `main` and
either found already satisfied, added, or recorded as blocked. Facts are from
source and read-only production SQL on 2026-10-27.

## 1. Current MarketCheck capabilities verified

Verified means answered 2xx with usable data from this account in the last 30
days: Dealer Inventory Syndication (last 2026-10-03), Dealership Directory,
Inventory Search (answering today), NeoVIN, basic decode, Market Days Supply
(answering today), MarketCheck Price Base (2026-09-11, one reserved call).

Not verifiable from this environment: the live documentation and OpenAPI
(every `marketcheck.com` host is refused by the build sandbox), so no path or
parameter below is marked `verified` in the registry; the handoff reference of
2026-10-21 and the change order are the contract baseline. Nothing in this
tranche sends a parameter the code did not already send.

## 2. Newly incorporated capabilities

- Identity match levels (`EXACT_VIN`, `EXACT_BUILD`, `YMMT`, `YMM`,
  `GENERIC_CANDIDATE`, `UNKNOWN`) with the generic-fallback rules: exact-only
  claims refused below exact identity, Data Confidence capped, candidates
  kept, diagnostics recorded, generic never overwriting exact
  (`src/lib/market/identityMatch.ts`).
- Provider result envelope for every intelligence call: requested and applied
  filters, warnings, notices, provider timestamps, expiry from the registry
  TTL, cost and its source, entitlement state, shape version, outcome class
  (`providerEnvelope.ts`).
- Dealership-group identity with mapping confidence (`authoritative_id`,
  `provider_name`, `name_match`, `none`), pooling only on authoritative ids,
  influence limited to market context, acquisition intelligence and
  management analytics (`dealerGroup.ts`).
- Five equipment categories with the available-is-never-installed guard and a
  configuration comparison that promotes nothing (`equipmentClass.ts`).
- Cohort ladder for MDS and Sales Stats with recorded match level, geography,
  sample size, period and rungs tried; refresh tied to provider regeneration
  (`cohortLadder.ts`).
- Inferred-sold vocabulary and the regression guard over Passport copy
  (`soldLanguage.ts`); the four customer strings built on `sold_stats` were
  reworded to "inferred sold" / "last advertised price before sale".
- Registry entries for Available Options Packages, Sold Vehicles Summary by
  dealership group, the dealership-groups reference, webhooks, and the
  per-capability influence declaration (identity, Vehicle Score, Data
  Confidence, Market Value, Market Value Confidence, Deal Rating, Buyer
  Recommendation, Market Context) with ownership and intake/refresh cadence.
- Eight new flags, all OFF and declared inert in the reader audit until their
  contracts are read: `exact_mds`, `current_sales_stats`, `sold_summary`,
  `generic_vin_fallback`, `available_options_packages`,
  `premium_plus_used_intake`, `premium_used_refresh`, `autorecalls_vin`.

Already satisfied by the master build and not duplicated: fee-normalized
listing basis (`listingFeeBasis.ts`, wired into `marketcheck-sync`), NeoVIN
promotion of warranty / options MSRP / MSRP variants / confidence /
dimensions / country / EV range / taxonomy, the `mc_raw` boundary classifier
and repair migration, the provider contract registry, the enrich cursor
(applied), the syndication refusal classification (deployed), Premium /
Premium Plus intake-vs-refresh strategy (registry cadence), CARFAX feed flags
kept as low-authority claims (`readHistoryFlag`, precedence order), payload
shape drift monitoring, prune protection and cross-rooftop isolation.

## 3. Endpoint and contract changes from the original implementation

| Area | Original | Now |
|---|---|---|
| AutoRecalls | `/v2/recall/car/{vin}` family (four variants) | `/v2/car/autorecalls/{vin}` is the registry's documented path; the legacy family is DEPRECATED_REPLACED. Code still calls the legacy path until the `autorecalls_vin` flag and the entitlement are in place. |
| MDS | year/make/model + ZIP, then all years, then national; nothing recorded | VIN `exact=true` first, then YMMT, YMM, model, national; `match_level` recorded. Specified and tested; sent only under `exact_mds`. |
| Sales Stats | `/v2/sales/car` make+state only, as a fallback behind recents | primary velocity source with VIN / YMMT / YMM cohorts and geography; `recents` re-roled as Past Inventory Search. Sent only under `current_sales_stats`. |
| Sold Vehicles Summary | not called | registry entry with placeholder path, monthly cadence, applied-filter and warning persistence by envelope; blocked on entitlement and path. |
| Premium / Premium Plus | constants only | registry cadence (intake = Premium Plus, refresh = Premium), recording requirements listed; blocked on one authorized call each. |
| Generic fallback | not supported | `fallback_to_generic` modelled as a distinct request fingerprint and a GENERIC_CANDIDATE identity; sent only under `generic_vin_fallback`. |
| Available Options Packages | unknown to the code | registry entry (unlocated path), equipment category and guard. |
| Dealership groups | ids captured on the feed, unread | resolved identity with confidence; reference endpoint registered (unlocated). |

## 4. Pricing changes incorporated

`mcCost.ts` revised with the change-order list and a dated source note: MDS
0.006 -> 0.002, Inferred Sales Stats 0.006 -> 0.002, Past Inventory Search
0.006 -> 0.0025; newly priced MarketMatch 0.35, auction 0.008, FSBO 0.01,
VINData generate 0.49, Available Options Packages 0.002. Unchanged: syndication
1.00, Inventory Search 0.002, Dealer APIs 0.0025, basic decode 0.0015, VIN
History 0.006, NeoVIN 0.08, Price Base 0.07, AutoRecalls 0.07, incentives 0.20.
The registry defaults mirror the table; `effectiveCost` resolves tenant
overrides first; `estimateCost` accepts a substituted price table; a test
pins the revised values and fails if the old MDS / Sales Stats / recents
assumptions return. The old figures are also replaced in the cost report and
the used policy.

## 5. Entitlement-blocked features

Premium, Premium Plus, Sold Vehicles Summary (and its dealership-group view),
AutoRecalls on the documented path, OEM incentives by make/ZIP, webhooks (not
configured), Black Book (no credential). Also the refusals since 2026-10-04 on
syndication, VIN history, recents and Sales Stats: confirmed the same evening
as the account's 5,000-call monthly plan quota, exhausted on Jul 29, Sep 11
and Oct 4 with the feed refused from each date until the 1st of the next
month. The enrich sweep is what spends it (PROVIDER_COST_AND_CACHE_REPORT.md
§2).

## 6. Features intentionally reserved for AutoCurb

MarketMatch dealer rank and VIN rank, auction search, private-party (FSBO)
search. Registered, priced, refused by `policyFor` for both vehicle types, and
barred from every AutoLabels conclusion.

## 7. Cost impact, before vs after

| | Before (prices of 2026-08-01, sweep twice daily) | After (prices of 2026-10-27, cursor applied, registry defaults) |
|---|---|---|
| Pilot rooftop recurring, per month | $270-$960 (sweep) | about $26 under policy defaults; about $110-$380 if the sweep's call mix stays and only the cursor changes |
| Used vehicle intake | $0.24-0.34 | $0.23-0.33 |
| Used vehicle recurring, per week | $0.10 | $0.09 |
| New vehicle recurring, per week | $0.02 | $0.02 |
| Syndication | $1.00 a night, refused | unchanged; refusal now visible |

The price changes alone move little; the cursor fix and the TTL discipline
move most of it. See PROVIDER_COST_AND_CACHE_REPORT.md.

## 8. Provider documentation ambiguity

- The `fees` field's shape is undocumented in anything this repo holds; the
  parser accepts number, money string, item list and map and records which
  shape it saw.
- The generic-fallback response markers (`is_generic`, `candidates`,
  `match_tier`) are read defensively; a fallback request whose body carries
  no marker resolves to UNKNOWN, never to exact.
- Sold Vehicles Summary, Available Options Packages and the dealership-groups
  reference have no path the code can cite; their registry paths are
  placeholders marked `unlocated`.
- Whether refused calls (429) and 404s on the legacy recall path are billed
  is unknown.
- The provider's `applied` section is persisted whenever present; its exact
  shape per endpoint is unverified.

## 9. Production migrations performed or still required

Performed, with authorization, 2026-10-27:

- `next_enrich_batch` replaced (archived filter, 20-hour floor, no
  `market_value` trigger), verified, recorded in the migration ledger
  (`20261027200000`).
- `marketcheck-sync` deployed from `d54927c` (source byte-identical, verified
  by the deploy agent, ~20:55Z).
- `20261027201000_mc_raw_boundary_repair.sql` applied at 21:19Z. Before: 328
  non-null `mc_raw` rows, 247 syndication and 81 legacy pricing payloads (all
  81 on the pilot tenant, all on archived listings). After: 247 non-null, all
  syndication, 0 legacy; 81 payloads preserved intact in
  `market_pricing_legacy_payloads` (81 distinct listings, every one's
  `mc_raw` now null), RLS on, tenant read policy, append-only grants, ledger
  row written. Reversible: the payloads are unchanged in the copy table.
- `20261027202000` applied in the same window: `sandbox_exec` narrowed to
  SELECT on the legacy store, matching the Market V2 evidence-table
  hardening.
- `marketcheck-specs` deployed at 21:21:50Z; `index.ts` and
  `neovinSheet.ts` blob hashes matched `d54927c`. The NeoVIN promotion
  (warranty, options MSRP, MSRP variants, confidence, dimensions, country, EV
  range, taxonomy) now lands on the next decode; nothing re-decodes existing
  VINs, so already-decoded listings gain the keys only when a sweep or an
  operator re-pulls them.

- `20261027203000_enrich_batch_recall_retry_window.sql` applied at about
  21:55Z on the owner's authorization: an attempted, unanswered VIN recall
  is re-asked every 30 days instead of daily. Measured under the cursor's
  own rule with the age floor off: 92 active vehicles offered before, 1
  after (91 were on the recall clause alone). Signature now four
  parameters; ledger row written. Reversible: re-applying 20261027200000
  restores the daily clause.
- `20261027204000_pause_enrich_sweep_nightly.sql` applied in the same
  window: the cron job `enrich-sweep-nightly` (03:15 UTC) set inactive;
  `marketcheck-sync` (hourly, the feed) left active. The 08:00 UTC kick
  from the sync is silenced by the operator setting `ENRICH_SWEEP_HOUR_UTC`
  to 25. Ledger row written. Un-pause is one `cron.alter_job` call.

Applied at about 22:53Z, with the four callers deployed from `2b03c4e` at
22:56Z (blob hashes verified by the deploy agent):
`20261027205000_provider_call_budget.sql`, the hard monthly call cap. The
plan is 5,000 calls a month and the Sep 9 release had the sweep spending
2,000-4,000 a day, which is the whole reason the feed has been refused from
the 4th of each month. `provider_call_admit` admits an essential call (the
feed, its rooftop validation) while the month is under the cap and any other
call only under cap minus a 250-call reserve; `provider_call_events` is the
ledger; `_shared/providerBudget.ts` is wired into vehicle-enrich,
marketcheck-sync, marketcheck-comps and marketcheck-specs, failing open when
the migration is absent. In place before the Nov 1 reset, which is what
keeps the feed alive in November; `authenticated` holds SELECT only on the
ledger (TRUNCATE, REFERENCES and TRIGGER revoked as well, since RLS does
not govern TRUNCATE). Ledger row written.

Not yet authored: the Sold Summary / Available Options / dealership-group
evidence tables, which wait on the contract read.

## 10. Master-prompt items superseded by this add-on

- Master §4 cost assumptions for MDS, Sales Stats and recents: superseded by
  §1 of the change order.
- Master §13 "retire the make+state assumption": superseded by the explicit
  cohort ladder and match-level record.
- Master §9 "evaluate recents as a workaround": superseded by the Past
  Inventory Search role (listing-level recent exits), with Sales Stats as the
  primary aggregate and Sold Summary as the trend source.
- Master §5 status vocabulary: extended with DEPRECATED_REPLACED and
  NOT_USEFUL.
- Master §30 scoring weights: unchanged by instruction (Vehicle Integrity 35,
  Current Condition 30, Maintenance and Dealer Provenance 20, Documentation
  and Safety 15); the registry now makes the market-never-scores rule
  executable.

## Tests added for this add-on

generic fallback cannot produce Factory Verified or any exact claim; generic
fallback caps identity confidence; generic never overwrites exact; available
options never become installed; inferred sold price never renders as a
transaction price (unit guard and source scan over the Passport surfaces);
provider applied filters and warnings persisted and divergence flagged; MDS
and Sales Stats match tier recorded; dealership-group intelligence cannot
modify Vehicle Score (module and registry); cost telemetry uses configurable
pricing; old MDS / Sales Stats / recents cost assumptions removed; fee
normalization handles `price_includes_fees` (existing); legacy `mc_raw`
contamination migrates safely (existing); title listing claims stay
low-authority (existing precedence tests); 429 never becomes a scope
mismatch, NOT_FOUND, CLEAN or zero (pinned feed classifier); NeoVIN is cached,
not repurchased (`shouldDecodeVin`, existing); New and Used cadence rules
remain separate (registry policy tests); every new flag is declared and inert;
the cursor's recall retry window and its signature change are held by the
migration-text test.

## 11. Provider contract read from the MarketCheck MCP schemas (2026-10-27)

The owner connected the MarketCheck MCP server (1.9.3) in the evening. Its
tool schemas and server info are the provider's own parameter contract and
cost nothing to read; no call was made. What they settle:

- Inventory Search (`/v2/search/car/active`): 80+ filters including `vins`
  (up to 10), `taxonomy_vins`, `ymmt`, `match`, `dos_active` and `dom_active`
  ranges (days on site at the current dealer vs cumulative days on market),
  `options_packages` and `high_value_features` with facets, `price_change`,
  `in_transit`, `seller_type` dealer | fsbo | auction, and
  `include_mc_dealership_object` carrying `mc_dealership_group_id`,
  `mc_dealership_group_name`, `mc_sub_dealership_group_id/name`,
  `mc_category` and `mc_rooftop_id`. Any dealer identifier routes the call to
  Dealer Inventory Syndication (`/dealerships/inventory`, rows up to 1,500).
  CARFAX fields are "incomplete ... not supported as filters, facets or
  stats", which matches the low-authority treatment here.
- Past Inventory Search (`/v2/search/car/recents`): expired or sold listings
  only, last 90 days; requires a city, state, zip, geo radius (max 100),
  source or dealer_id; facets, stats and range facets cannot be combined;
  "charged at higher rates than active search"; `expired` is VIN-level and
  `sold=true` is the sold filter.
- Sold Vehicles Summary (`/v2/sold-vehicles/summary`; the server also lists
  it as `/v2/sold/summary`; enterprise-gated): `inventory_type` required;
  month-aligned `date_from`/`date_to` at most a year apart; `summary_by`
  national | state | city_state; `dealership_group_name` exact from the
  directory; `source` is a rooftop inventory_url, comma lists allowed;
  ranking dimensions, measure, order, `top_n`, `limit`, measure filters and
  `rank_after_filters`; the response carries `result_count`, `truncated`,
  `warnings` and `applied` (the defaults and window actually used), with
  price, miles, dom_active, dos_active, msrp and mc_msrp statistics. The
  provider's own wording: sales are inferred and prices are advertised
  asking prices, not transaction prices. The service scales to zero and the
  first call after idle can take about nine seconds, so the client timeout
  must allow it. History starts January 2021.
- Premium (`/v2/predict/car/us/marketcheck_price/comparables`): `vin`
  required; `miles` defaults to 50,000, `zip` to 50501, `dealer_type` to
  franchise, `is_certified` to false. Those defaults would silently price a
  car in Iowa at 50,000 miles, so every call must send and the envelope must
  record all four.
- VIN history (`/v2/history/car/{vin}`): `fields`, `page`, `sort_order`.
- NeoVIN (`/v2/decode/car/neovin/{vin}/specs`): the generic switch is named
  `include_generic`, which is exactly what marketcheck-specs already sends;
  the registry's `generic_vin_fallback` flag governs policy, not the
  parameter.
- Dealership Directory (`/v2/dealerships/car`): group-aware, with facets on
  the group and sub-group ids and names. This is the dealership-groups
  reference the registry had marked unlocated. `/v2/dealers/car` is "being
  phased out".
- OEM incentives: an all-brands search (country required, MSA code, at most
  10 rows) and an OEM-plus-ZIP search that converts the ZIP to an MSA.

Not exposed by the MCP, so still documented and unverified: Market Days
Supply, AutoRecalls, VINData, Price Base, Premium Plus, Available Options
Packages, cached images, listing details, MarketMatch, webhooks.

Discrepancies to resolve in the registry next: FSBO and auction are a
`seller_type` on the active search in the MCP, where the registry carries
them as separate paths; the sold-summary path is spelled two ways by the
server itself. Updating
the registry entries, the capability matrix paths and the edge mirror is the
next tranche; nothing here changes a request the code sends today.
