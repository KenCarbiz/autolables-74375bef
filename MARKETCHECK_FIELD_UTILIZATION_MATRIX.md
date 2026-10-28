# MARKETCHECK_FIELD_UTILIZATION_MATRIX

Every field MarketCheck sends that this repo receives, with where it lands and
who reads it. Live presence counts are from production on 2026-10-27 (331
`vehicle_listings` rows, 393 `neovin_snapshots`). The handoff's rule (§7):
every normalized field has a real reader or is explicitly archival; nothing
valuable is stored forever unused.

Classification:

- **USED** — read by a product surface or an engine rule.
- **ARCHIVAL** — kept verbatim on purpose; no reader expected.
- **PROMOTE** — received, stored, read by nothing; has a named consumer in the
  handoff and should be normalized (the work in task 7).
- **NEVER SENT** — a key the code reads that the provider does not send on this
  plan; the alias is inert.
- **ARCHIVAL-ONLY BY TERMS** — may not be persisted.

## 1. Dealer Inventory Syndication (`/v2/dealerships/inventory`)

Row kept verbatim in `vehicle_listings.mc_raw` (247 rows carry a feed row) and
`vehicle_value_history.payload`. Normalized copy in `mc_attributes` (63 keys).

| Field | Rows | Normalized to | Reader | Class |
|---|---|---|---|---|
| `id` | 247 | `mc_attributes.mc_listing_id` (251) | none (captured for `/v2/listing/car/{id}`) | ARCHIVAL (intentional) |
| `vin` | 328 | `vehicle_listings.vin` | everything | USED |
| `heading` | 247 | `vehicle_listings.ymm` (via build) | Passport, sticker, truth parser | USED |
| `stock_no` | 247 | `vehicle_files.stock_number` | Vehicle File, forms | USED |
| `source`, `vdp_url` | 247 | `source_url`, `price_source_url`, `mc_attributes.vdp_url` | crawler seed, rooftop match | USED |
| `data_source` | 247 | none | none | ARCHIVAL |
| `inventory_type`, `is_certified` | 247 / 38 | `condition` via `classifyCondition` | everything | USED |
| `vehicle_status` | 139 | none | none | PROMOTE (availability state; New Passport "Availability") |
| `in_transit` | 247 | `mc_attributes.in_transit` (328) | `readModelTypes.DealerStateSection.inTransit` only (shadow) | PROMOTE (public availability) |
| `seller_type` | 247 | `mc_attributes.seller_type` | none | ARCHIVAL |
| `price` | 244 | `price`, `advertised_price_before_doc`, `website_sale_price` (+ tenant doc fee rule) | everything | USED |
| `msrp` | 244 | `mc_attributes.msrp` | sticker, Vehicle File `msrpFeed` | USED |
| `ref_price`, `ref_price_dt` | 207 | `mc_attributes.ref_price` (dt not copied) | Vehicle File market panel reads both from `mc_raw` | USED |
| `price_change_percent` | 206 | `mc_attributes.price_change_percent` | Vehicle File, enrich comp-cut signal | USED |
| `fees` | 139 | none | none | PROMOTE (§8 fee-aware comparables; identified mandatory fees) |
| `price_includes_fees` | 115 | none | none | PROMOTE (§8; listing-level fee basis beats the tenant setting) |
| `miles` | 247 | `mileage` | everything | USED |
| `ref_miles`, `ref_miles_dt` | 151 | `mc_attributes.ref_miles` | none | ARCHIVAL |
| `dom`, `dom_active`, `dom_180` | 247 | `mc_attributes.*` | Vehicle File market panel; comps scoring | USED |
| `dos_active` | 247 | none | Vehicle File market panel reads from `mc_raw` as days-on-site | USED |
| `first_seen_at`, `_date`, `_mc`, `_source` (+`_date`) | 247 | `mc_attributes.first_seen_at` | Vehicle File lifecycle stamps | USED |
| `last_seen_at`, `_date` | 247 | `mc_attributes.last_seen_at` | Vehicle File lifecycle; prune grace candidate | USED |
| `scraped_at`, `_date` | 247 | `mc_attributes.scraped_at` | Vehicle File freshness | USED |
| `carfax_1_owner` | 101 | `mc_attributes.carfax_1_owner` | `readHistoryFlag` (three-state) | USED (low-authority claim) |
| `carfax_clean_title` | 0 non-null (key on 328) | `mc_attributes.carfax_clean_title` | `readHistoryFlag` | NEVER SENT on this plan |
| `exterior_color`, `interior_color`, `base_ext_color`, `base_int_color` | 244-245 | `mc_attributes.*`; `vehicle_facts` marketcheck | sticker, Passport | USED |
| `build.year/make/model/trim/version` | 246-247 | `mc_attributes.*`, `ymm`, `trim`, `vehicle_facts` | everything | USED |
| `build.body_type/body_subtype/vehicle_type` | 247/5/247 | `mc_attributes.*` | sticker, Passport specs | USED |
| `build.engine/engine_size/engine_block/cylinders` | 242 | `mc_attributes.*` | sticker, Passport specs | USED |
| `build.transmission/drivetrain/fuel_type/powertrain_type` | 246 | `mc_attributes.*`, cohort key | sticker, Passport, V2 cohort | USED |
| `build.doors/std_seating` | 246 | `mc_attributes.doors`, `std_seating`, alias `seating` | sticker, Passport | USED |
| `build.city_mpg/highway_mpg` | 245 | `mc_attributes.*` | Passport fuel economy fallback | USED |
| `build.made_in` | 247 | `mc_attributes.made_in` | sticker assembly line | USED |
| `build.overall_height/length/width` | 246 | `mc_attributes.*` | none | ARCHIVAL |
| `build.horsepower`, `build.engine_power` | 0 | `mc_attributes.horsepower` (key on 327, all null) | Passport highlight alias | NEVER SENT |
| `dealer.id/name/dealership_group_name/dealer_type` | 247 | none beyond `mc_raw` | rooftop match reads name/state/street/zip | USED (match) |
| `dealer.street/city/state/zip/country/latitude/longitude/msa_code/phone/seller_email/website` | 222-247 | none beyond `mc_raw` | rooftop match (street, zip, state, hosts) | USED (match) / ARCHIVAL |
| `mc_dealership.mc_dealer_id/mc_rooftop_id/mc_location_id/mc_website_id` | 247 | none beyond `mc_raw` | `listingIdentity` (rooftop, location) | USED (match); PROMOTE to comparable rooftop/group ids (§25) |
| `mc_dealership.mc_dealership_group_id/_name, mc_sub_dealership_group_id/_name, mc_category` | 247 | none | none | PROMOTE (group concentration in V3) |
| `car_location.mc_car_location_id/seller_name` | 114/50 | none | none | ARCHIVAL |
| `media.photo_links`, `media.photo_links_cached` | 247/104 | `photos`, `photo_count`, `hero_image_url` | Passport gallery | USED |
| `extra.options`, `extra.features` | not sent on this plan | `mc_attributes.options/features` fallback | sticker | NEVER SENT (NeoVIN supplies) |

## 2. NeoVIN (`/v2/decode/car/neovin/{vin}/specs`)

Raw payload captured first to `neovin_snapshots` (393). What the extractor
reads is in `supabase/functions/_shared/neovinSheet.ts` and
`marketcheck-specs`.

| Field | Snapshots | Normalized to | Reader | Class |
|---|---|---|---|---|
| `vin`, `year`, `make`, `model`, `trim`, `version` | 391-393 | spec fills; `vehicle_facts` neovin | sticker, truth | USED |
| `options_packages` | 349 | `build_sheet.packages` (name, code, msrp, contents) | sticker, Passport packages | USED |
| `installed_options_details` | 391 | `build_sheet.options` (name, code, msrp) | sticker, Passport | USED |
| `high_value_features` | 391 | `build_sheet.key_features` | Passport highlights | USED |
| `features` | 391 | `build_sheet.standard`; flat `features` | sticker standard equipment | USED |
| `installed_equipment` | 391 | flat `options` array via `extractLists` only | sticker (noise-filtered) | USED (flat) / excluded from structured sheet by design |
| `msrp`, `delivery_charges`, `combined_msrp` | 391 | `build_sheet.pricing`, lifted `base_msrp`, `delivery_charges`, `total_msrp`; `vehicle_facts` | sticker price table, truth | USED |
| `installed_options_msrp` | 391 | none | none | PROMOTE (Monroney options subtotal; New Passport "installed-options MSRP") |
| `mc_msrp`, `original_msrp`, `build_specs_msrp`, `msrp_label`, `oem_msrp` | 391/316/300/253/71 | none | none | PROMOTE (documented MSRP variants, keep labelled) |
| `exterior_color`, `interior_color` ({name, generic_name, code, msrp}) | 383/382 | `build_sheet.colors` | sticker | USED |
| `made_in`, `made_in_city`, `plant` | via sheet | `build_sheet.assembly` | sticker | USED |
| `country` | 391 | none | none | PROMOTE (assembly country when `made_in` absent) |
| `city_mpg`, `highway_mpg`, `combined_mpg` | 386-387 | spec fills | Passport fuel economy | USED |
| `engine`, `drivetrain`, `transmission`, `transmission_description`, `fuel_type`, `powertrain_type`, `body_type`, `doors`, `seating_capacity` | 391 | spec fills | sticker, Passport | USED |
| `warranty` | 391 | none | none (Passport warranty comes from the owner-maintained `oem_factory_warranties`) | PROMOTE (§9: original factory terms; never "remaining" without in-service evidence) |
| `record_confidence`, `listing_confidence`, `trim_confidence`, `version_confidence`, `transmission_confidence` | 355-391 | none | none | PROMOTE (Data Confidence / exact-match eligibility only, never a quality bonus) |
| `height`, `length`, `width`, `weight` | 391/328 | none | none | PROMOTE (specifications; feed `overall_*` is the current source) |
| `electric_range` | 7 | none | none | PROMOTE (EV specs) |
| `squish_vin`, `manufacturer_code`, `decode_version`, `record_source` | 390-393 | none | none | PROMOTE (taxonomy identity for Sales Stats / MDS cohorts; decode provenance) |
| `rating` | 319 | none | none | ARCHIVAL until meaning is confirmed against the contract |
| `discounts`, `total_discount`, `package_code` | 4-18 | none | none | ARCHIVAL (rare) |
| `generic`, `reason` | 3 | `build_sheet.generic` | sticker AUTO_VERIFIED gate, truth source class | USED |
| `created_at`, `updated_at` (+`_date`) | 391-393 | none | none | ARCHIVAL |

## 3. Active inventory search (comparables)

Per listing, read by `vehicle-enrich` and `marketcheck-comps`: `vin`, `price`,
`miles`, `heading`, `build.year/make/model/trim/drivetrain`, `dealer.name` |
`seller_name`, `dealer.city/state`, `dist`, `dom`, `dom_active`, `ref_price`,
`price_change_percent`, `media.photo_links[0]`; response `num_found`.

Stored comparable (9 fields): `vin, ymm, trim, miles, price, dist, dealer, dom,
image`. Everything the V3 engine needs beyond that — `is_certified`,
`fees`, `price_includes_fees`, `mc_dealership.mc_rooftop_id`,
`mc_dealership_group_id`, `first_seen_at`, `last_seen_at`, `inventory_type`,
`msrp` — is on the provider row and discarded. Class: PROMOTE into
`market_cohort_snapshots.observations` (the table exists, 0 rows).

## 4. VIN history (`/v2/history/car/{vin}`)

Read per episode: `price`, `miles`, `seller_type`, `inventory_type`,
`dealer.name` | `seller_name`, `source`, `vdp_url`, `first_seen_at(_date)`,
`last_seen_at(_date)`. Stored to `history_payload.entries`; derived
`in_service_date` (first new-inventory episode). USED. Not stored: listing
episode id, `price_change` deltas, `dom` per episode, `mc_dealership` ids.
Owner count is deliberately not derived (§15).

## 5. MDS, recents, sales

- MDS: reads `mds | market_days_supply | days_supply`, `count | inventory_count
  | total`. USED. Not requested: `vin`, `exact`, `ymmt`, `include_sold`.
- Recents: `price`, `dom`, `miles` medians from up to 50 rows; `num_found`.
  USED. Rows discarded by design (public payload).
- Sales: `count | num_found | sales_count`, `price_stats.median`,
  `dom_stats.median`, `miles_stats.median`. USED at make+state only. Not
  requested: VIN / taxonomy VIN / YMMT cohorts, CPO split, percentiles,
  mileage stats, generation timestamp.

## 6. Recalls (MarketCheck), incentives, VINData

- Recall campaign fields read: `NHTSACampaignNumber | CampaignNumber |
  campaign_id | id`, `Component`, `Summary`, `Consequence`, `Remedy`,
  `Manufacturer`, `ReportReceivedDate`, `status`. Product unanswered; all
  UNKNOWN. USED when it answers.
- Incentives: `offer.offer_type`, `amounts[0].{apr,monthly,term,term_unit}`,
  `cashback_amount`, `titles[]`, `offers[]`, `disclaimers[]`,
  `cashback_target_group`, `valid_through`, `vehicles[]`, `state`/`zip`. Off.
- VINData: `titleBrandReported[]`, `junkSalvageTotalLoss[]`,
  `titleInformation[]`, `odometerInformation[]`. ARCHIVAL-ONLY BY TERMS
  (session summary, never written).

## 7. Summary of PROMOTE items (task 7 scope)

1. `fees`, `price_includes_fees` -> listing fee basis (feed subject and
   comparables). Unknown stays unknown, never zero.
2. NeoVIN `warranty` -> original factory warranty terms (labelled original,
   not remaining).
3. NeoVIN `installed_options_msrp` + MSRP variants -> MSRP reconciliation.
4. NeoVIN confidence set -> Data Confidence inputs.
5. NeoVIN `height/length/width/weight`, `country`, `electric_range`,
   `squish_vin`, `manufacturer_code` -> specifications and cohort identity.
6. Feed `vehicle_status`, `in_transit` -> availability state.
7. Comparable rows: `is_certified`, `fees`, `price_includes_fees`,
   `mc_rooftop_id`, group ids, `first_seen_at` -> `market_cohort_snapshots`.

## 8. Known from the provider's MCP schemas (read 2026-10-27), unread

Fields and parameters the provider's own tool schemas name that this repo
does not yet read or send. Class for all of them: **KNOWN, UNREAD** (named
by the provider, no reader here yet). Registry entries carry the request
side in `requestContract`.

| Surface | Field or parameter | What it is | Intended consumer |
|---|---|---|---|
| active search row | `dos_active` | days the listing has been active at the current dealer | comparable staleness (dealer-level), Market Context; the feed copy is already read as days-on-site |
| active search row | `dom_active` | cumulative days the vehicle has been listed across dealers | total market exposure for comps and VIN history; distinct from `dos_active` |
| active search row | `mc_dealership.mc_sub_dealership_group_id`, `_name` | sub-group identity below the dealership group | group concentration cap in Market Value V3; dealership-group context |
| active search row | `mc_dealership.mc_category` | Dealer, Retailer, Dealership Group, Aggregator, Marketing, Financing | exclude aggregator and marketing rows from comparable evidence |
| active search row | `in_transit` | listing is in transit | availability state (New Passport), comparable eligibility |
| active search row | `price_change` / `price_change_percent` as a filter | positive and negative price movement | price-cut signal already read from the feed; as a search filter for market context |
| active search request | `vins` (max 10), `taxonomy_vins`, `ymmt`, `match` | cohort addressing by VIN list, 10-character taxonomy VIN, Year/Make/Model/Trim | exact and YMMT cohort rungs (`cohortLadder.ts`) |
| active search request | `options_packages`, `high_value_features` (+ `exclude_*`), via `facets` | equipment-level filtering with facet-discovered values | configuration-aware comparables; AVAILABLE is never INSTALLED |
| active search request | `include_mc_dealership_object` | returns the mc_* ids, group ids and category per row | comparable rooftop and group identity (`dealerGroup.ts`) |
| active search request | `seller_type` dealer, fsbo, auction | seller class | AutoLabels sends dealer only; the other two are AutoCurb-reserved |
| recents request | `sold`, `expired` (VIN-level), `owned`, `active_inventory_date_range` | sold vs expired semantics, ownership, date windows | Past Inventory Search role; inferred-sold wording |
| sold summary response | `month`, grouping fields, `rank`, `sold_count` | one row per month per group | market trend (3 / 6 / 12 months) |
| sold summary response | `price`, `miles`, `dom_active`, `dos_active`, `msrp`, `mc_msrp` with `count`, `mean` and percentiles | inferred-sold statistics per group | velocity and trend context; never a transaction price |
| sold summary response | `price_over_msrp_percentage`, `price_over_mc_msrp_percentage` | advertised price relative to MSRP | new-vehicle market context |
| sold summary response | `result_count`, `truncated`, `warnings`, `applied` | the envelope: what the provider actually used | persisted verbatim by the provider result envelope (`providerEnvelope.ts`) |
| Premium request | `miles`, `zip`, `dealer_type`, `is_certified` | required-in-practice inputs with silent defaults | always sent and recorded on the envelope |
| directory request | `facets` on `mc_dealership_group_id`, `_name`, sub-group ids | the dealership-groups reference | group identity resolution; `get_sold_summary` group names |
| sold summary request | `ranking_dimensions` with `dealership_group_name`, or `dealership_group_name` as a filter | the dealership-group variant on the same endpoint; about 38% of inferred sales carry a group | sold_summary_dealership_groups (`dealership_group_context`); never a Vehicle Score input |
| sold summary request | `ranking_measure` dotted statistics (`price.p50`, `dom_active.mean`, `price.sum`), `top_n`, `limit`, `rank_after_filters` | how the monthly rows are ranked and cut | velocity and trend context; `truncated` must be read before a total is trusted |
