# MARKETCHECK_CAPABILITY_MATRIX

Revised 2026-10-27 for the change order. The executable form of this matrix
is `src/lib/market/providerRegistry.ts`; a test holds every provider path
named here to a registry entry, and holds every market-evidence, acquisition,
offer-context and inventory-state capability to `vehicleScore: false`.

Status vocabulary (change order §12): ACTIVE / SHADOW / ENTITLEMENT_BLOCKED /
AUTOCURB_RESERVED / NOT_USEFUL / DEPRECATED_REPLACED, plus NOT_ACTIVE for a
capability the registry knows but nothing calls yet.

Contract column: `documented` = path per the 2026-10-21 handoff reference;
`unlocated` = capability named by the 2026-10-27 change order whose path has
not been read from the docs (the registry carries a placeholder path for it);
`legacy` = a path the code still calls that the current contract replaces.
Nothing is `verified`: the live docs and OpenAPI are unreachable from the
build environment (ENTITLEMENT_AND_TERMS_REPORT.md §4).

Entitlement column is what production has answered: `answers` (2xx with
usable data in 30 days), `refused` (401/403/429 or empty 200 in 30 days),
`untested` (never called from this account), `disabled` (switched off by the
owner), `unconfigured` (no credential).

Cost is the list default in `mcCost.ts` (owner change order 2026-10-27),
resolved at run time through `effectiveCost` with tenant overrides first.
"before" is the 2026-08-01 capture where it changed.

## A. Operational matrix

| Key | Product / purpose | Endpoint | Contract | Entitlement | Cost USD | New | Used | Owner | Cadence | Fallback | Freshness (TTL) | Storage (raw -> normalized) | Status |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| syndication | Dealer Inventory Syndication: inventory of record, price, availability, in-transit, fee fields, dealership-group ids | `/v2/dealerships/inventory` | documented | refused since 2026-10-04 (429 nightly; last success Oct 3) | 1.00 | yes | yes | shared | intake + nightly | none; refusal never retires a car | 24 h | `mc_raw` -> listings, files, `mc_attributes` (fee_basis, vehicle_status), `advertised_prices` | ACTIVE |
| dealership_directory | Dealership Directory: canonical mc_* ids for a rooftop | `/v2/dealerships/car` | documented | answers (pin verified Oct 3) | 0.0025 | yes | yes | shared | intake (pin once) | none | pinned; re-validated nightly | `marketcheck_sync_config` | ACTIVE |
| dealership_groups_reference | Dealership Groups reference: authoritative group identity for velocity, stocking and performance comparisons | `/v2/dealerships/groups` | unlocated | untested | 0.0025 | optional | optional | shared | monthly | feed `mc_dealership.*` ids | 30 d | `dealership_groups` | NOT_ACTIVE |
| dealers_search_legacy | Dealers Search, legacy id space (manual dealer_id override only) | `/v2/dealers/car` | legacy | answers | 0.0025 | optional | optional | shared | operator | dealership_directory | n/a | `marketcheck_sync_config` | ACTIVE (legacy) |
| dealer_details_legacy | Dealer details, legacy (labels a manual override) | `/v2/dealer/car` | legacy | answers | 0.0025 | optional | optional | shared | operator | dealership_directory | n/a | `marketcheck_sync_config` | ACTIVE (legacy) |
| active_search | Inventory Search: active-market comparables, cross-channel same-VIN price integrity, fee-normalized comp basis | `/v2/search/car/active` | documented | answers (165 listings refreshed Oct 27) | 0.002 | yes | yes | shared | intake + daily + material event | none | 24 h | `market_cohort_snapshots` (0 rows today) -> `comparables`, `group_similar`, `market_meta` | ACTIVE |
| recents | Past Inventory Search: listing-level recent market exits (expired, inferred sold, owned, date windows, stats, facets where supported) | `/v2/search/car/recents` | documented | refused since Oct 3 | 0.0025 (before 0.006) | optional | yes | shared | monthly | none | 30 d | medians only -> `market_meta.sold_stats` | ACTIVE |
| neovin | NeoVIN: exact factory identity, installed options and packages, MSRP trio, warranty, confidence, dimensions, taxonomy | `/v2/decode/car/neovin/{vin}/specs` | documented | answers (391/393 full builds) | 0.08 | first seen | first seen | shared | intake only | basic_decode | immutable | `neovin_snapshots` -> `build_sheet`, lifted MSRP + promoted keys, `vehicle_facts` | ACTIVE |
| basic_decode | Basic VIN decode (specs, no equipment) | `/v2/decode/car/{vin}/specs` | documented | answers | 0.0015 | optional | optional | shared | intake | basic_decode_root | immutable | `neovin_snapshots` -> `mc_attributes` | ACTIVE |
| basic_decode_root | Basic VIN decode, root path (last fallback) | `/v2/decode/car/{vin}` | documented | answers | 0.0015 | optional | optional | shared | intake | none | immutable | as above | ACTIVE |
| available_options_packages | Available Options Packages: what a trim CAN be ordered with, for configuration comparison, package explanation, missing-build investigation. AVAILABLE is never INSTALLED | `/v2/options/packages` | unlocated | untested | 0.002 | optional (careful) | optional | autolabels | intake | none | 90 d | `available_options_catalog` -> `equipment.factory_available_options` | NOT_ACTIVE |
| price_base | MarketCheck Price Base: independent valuation signal; `fallback_to_generic` is a separate request whose answer is GENERIC_CANDIDATE identity | `/v2/predict/car/us/marketcheck_price` | documented | answers (one reserved call, Sep 11) | 0.07 | optional | yes | shared | intake + 7 d refresh | none | 7 d fresh / 14 d hard | `vehicle_market_valuations`, `market_payload.provider_valuation` | SHADOW |
| price_premium | MarketCheck Price Premium (Premium Comparables): prediction + comparable set; the used REFRESH tier once the build is cached | `/v2/predict/car/us/marketcheck_price/comparables` | documented | untested | 0.07 (placeholder) | optional | yes | shared | 7 d refresh | price_base | 7 d | `vehicle_market_valuations`, `market_cohort_snapshots` | ENTITLEMENT_BLOCKED |
| price_premium_plus | MarketCheck Price Premium Plus: prediction + comparables + NeoVIN; the used INTAKE candidate; records tier, match tier, comp count, provider confidence, decode source, both checked_at | `/v2/predict/car/us/marketcheck_price/comparables/decode` | documented | untested | 0.07 (placeholder) | test once | yes | shared | intake only | price_premium | decode immutable; market 7 d | `vehicle_market_valuations`, `market_cohort_snapshots`, `neovin_snapshots` | ENTITLEMENT_BLOCKED |
| vin_history | History by VIN: mileage chronology, price trajectory, prior exposure, relisting | `/v2/history/car/{vin}` | documented | refused since Oct 3 | 0.006 | no | yes | shared | intake + 30 d / material event | none | 30 d | `history_payload`, `in_service_date` | ACTIVE |
| mds | Market Days Supply: liquidity and holding-risk context; cohort ladder VIN exact=true -> YMMT -> YMM -> model -> national with match_level recorded | `/v2/mds/car` | documented | answers (165 listings) | 0.002 (before 0.006) | optional (management) | yes | shared | intake + 7 d + material event | ymmt -> ymm -> model -> national | 7 d (provider regeneration, not price) | `market_meta.market_days_supply`, `mds_match_level`, `inventory_count` | ACTIVE |
| sales_stats | Inferred Sales Stats: the primary velocity source; inferred sold count, price, mileage, DOM/DOS stats, CPO split, match tier, geography, period | `/v2/sales/car` | documented | refused since Oct 3 | 0.002 (before 0.006) | optional (management) | yes | shared | intake + monthly | recents | 30 d (monthly regeneration) | `market_meta.sold_stats` | ACTIVE |
| sold_summary | Sold Vehicles Summary: 3 / 6 / 12-month trend and direction; stores requested filters, provider-applied filters, warnings, notices, population size, period, scope | `/v2/sold/car/summary` | documented (path placeholder) | untested | 0.002 | optional | yes | shared | monthly | none | 30 d | `market_trend_evidence` -> `market_meta.trend` | ENTITLEMENT_BLOCKED |
| sold_summary_dealership_groups | Sold Vehicles Summary by dealership group: dealer-group velocity and stocking comparison for management and future AutoCurb fit | `/v2/sold/car/summary/dealership_groups` | unlocated | untested | 0.002 | optional | optional | shared | monthly | none | 30 d | `market_trend_evidence` -> `dealership_group_context` | NOT_ACTIVE |
| vindata_access | VINData NMVTIS access report: title brands, odometer, JSTL; session-only by terms | `/v2/vindata/access-report/aamva/{vin}` | documented | untested in 30 d (0 pulls) | unpriced | no | yes (pre-publish) | shared | before a strong public title claim | vindata_generate | provider keeps 90 d | none (terms) | ACTIVE (manual) |
| vindata_generate | VINData NMVTIS generate report | `/v2/vindata/generate-report/aamva/{vin}` | documented | untested in 30 d | 0.49 | no | yes (when absent/stale) | shared | pre-publish, capped 50/dealer/month | none | 90 d | `title_report_pulls` meter only | ACTIVE (manual) |
| autorecalls | AutoRecalls: VIN-specific recall state; only a VIN answer can clear a VIN | `/v2/car/autorecalls/{vin}` | documented | untested on the documented path; legacy family unanswered | 0.07 | yes (arrival + pre-delivery) | yes (intake + periodic + pre-sale) | shared | intake + 30 d | NHTSA model context (never clearance) | 30 d | `recall_check` -> recall_status, counts | ENTITLEMENT_BLOCKED |
| autorecalls_legacy | AutoRecalls legacy path family still called by marketcheck-recalls and vehicle-enrich | `/v2/recall/car/{vin}` | legacy | 404 / empty on every variant | 0.07 | no | no | shared | never | none | n/a | none | DEPRECATED_REPLACED |
| incentives_oem | OEM incentives search: new-vehicle offer context | `/v2/search/car/incentive/oem` | documented | disabled (owner, 2026-07-28; cron still fires into the gate) | 0.20 | yes | no | autolabels | program freshness | none | 24 h | `marketcheck_vehicle_cache` (empty) | NOT_ACTIVE |
| incentives_make_zip | OEM incentives by make and ZIP: the preferred program x market cache dimension | `/v2/search/car/incentive/{make}/{zip}` | documented | untested | 0.20 | yes | no | autolabels | program freshness | incentives_oem | 24 h | `marketcheck_vehicle_cache` | ENTITLEMENT_BLOCKED |
| cached_images | Cached images (links arrive on the feed) | `/v2/image/cache/car/{id}` | documented | answers | 0.001 | passive | passive | autolabels | never requested | none | n/a | `mc_raw.media` -> `photos` | ACTIVE |
| listing_details | Listing details: per-listing options and seller comments when the feed omits them | `/v2/listing/car/{id}` | documented | untested | 0.002 | optional | optional | shared | operator | none | 24 h | none | NOT_ACTIVE |
| fsbo | Private-party active inventory: acquisition asking-price context | `/v2/search/car/fsbo/active` | documented | untested | 0.01 | no | no | autocurb | never in AutoLabels | none | 24 h | none | AUTOCURB_RESERVED |
| auction | Auction active inventory: wholesale context | `/v2/search/car/auction/active` | documented | untested | 0.008 | no | no | autocurb | never in AutoLabels | none | 24 h | none | AUTOCURB_RESERVED |
| marketmatch_dealers | MarketMatch dealer rank: which dealers a vehicle fits | `/v2/marketmatch/dealers/rank` | documented | untested | 0.35 | no | no | autocurb | never in AutoLabels | none | 24 h | none | AUTOCURB_RESERVED |
| marketmatch | MarketMatch VIN rank: 1-20 VIN candidates per dealer per request | `/v2/marketmatch/vins/rank` | documented | untested | 0.35 | no | no | autocurb | never in AutoLabels | none | 24 h | none | AUTOCURB_RESERVED |
| webhooks | Refresh webhooks: HMAC-SHA256 signed POST, timestamp replay window, delivery-id dedup; invalidation only, never spend | portal-configured signed POST to `/webhooks/marketcheck` | documented | not configured | n/a | yes | yes | shared | provider event | none | n/a | `provider_webhook_events` -> stale marks | ENTITLEMENT_BLOCKED |
| blackbook_used_vin | Black Book UsedCar VIN values (non-MarketCheck) | `/UsedCarWS/UsedCarVin/{vin}/{mileage}` | legacy | unconfigured (0/331) | unknown | no | yes | shared | intake + 7 d | none | 7 d | `vehicle_listings.blackbook` (never populated) | ENTITLEMENT_BLOCKED |

Price and fee fields on the feed (`price`, `msrp`, `fees`, `price_includes_fees`,
`ref_price`, `price_change_percent`) are part of `syndication`; the
listing-level fee basis is resolved by `resolveListingFeeBasis` and written to
`mc_attributes.fee_basis` (ACTIVE in code, deployed with `marketcheck-sync`
on 2026-10-27; populates on the next successful feed).

## B. Influence matrix

Which server-side conclusions each capability's evidence may reach. A blank
cell is "never". The registry enforces the `vehicleScore` column; the others
are the contract the read models are built to.

| Key | Identity | Vehicle Score | Data Confidence | Market Value | MV Confidence | Deal Rating | Buyer Recommendation | Market Context |
|---|---|---|---|---|---|---|---|---|
| syndication | yes | | yes | | | | | |
| dealership_directory | | | | | | | | yes |
| dealership_groups_reference | | | | | | | | yes |
| dealers_search_legacy | | | | | | | | |
| dealer_details_legacy | | | | | | | | |
| active_search | | | | yes | yes | yes | yes | yes |
| recents | | | | | yes | | | yes |
| neovin | yes | yes (Vehicle Integrity: exact build) | yes | yes | | | | |
| basic_decode | yes | | yes | | | | | |
| basic_decode_root | yes | | yes | | | | | |
| available_options_packages | | | | | | | | yes |
| price_base | | | | yes | yes | yes | yes | yes |
| price_premium | | | | yes | yes | yes | yes | yes |
| price_premium_plus | yes | | yes | yes | yes | yes | yes | yes |
| vin_history | | yes (Vehicle Integrity: odometer chronology) | yes | | | | yes (odometer hard gate) | yes |
| mds | | | | | yes | | | yes |
| sales_stats | | | | | yes | | | yes |
| sold_summary | | | | | yes | | | yes |
| sold_summary_dealership_groups | | | | | yes | | | yes |
| vindata_access | | yes (Integrity, Documentation and Safety) | yes | | | | yes (title and odometer hard gates) | |
| vindata_generate | | yes | yes | | | | yes | |
| autorecalls | | yes (Documentation and Safety) | yes | | | | yes (safety hard gate) | |
| autorecalls_legacy | | | | | | | | |
| incentives_oem | | | | | | | | |
| incentives_make_zip | | | | | | | | |
| cached_images | | | | | | | | |
| listing_details | yes | | yes | | | | | |
| fsbo | | | | | | | | |
| auction | | | | | | | | |
| marketmatch_dealers | | | | | | | | |
| marketmatch | | | | | | | | |
| webhooks | | | yes (freshness) | | | | | |
| blackbook_used_vin | | | | yes | yes | | | |

Rule held by test: no market-evidence, acquisition, offer-context or
inventory-state capability reaches Vehicle Score. Vehicle Score stays
Vehicle Integrity 35 / Current Condition 30 / Maintenance and Dealer
Provenance 20 / Documentation and Safety 15, and market richness does not
move it.

## C. Identity match levels in force

`EXACT_VIN`, `EXACT_BUILD`, `YMMT`, `YMM`, `GENERIC_CANDIDATE`, `UNKNOWN`
(`src/lib/market/identityMatch.ts`). Factory Verified, exact configuration,
exact installed equipment, exact trim/version, exact MSRP and Vehicle Score
evidence require `EXACT_VIN` or `EXACT_BUILD`; a generic fallback answer is
priced and labelled, caps Data Confidence at `limited`, keeps its candidate
definitions, and never overwrites an exact fact.
