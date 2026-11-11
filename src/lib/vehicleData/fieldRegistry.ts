// ──────────────────────────────────────────────────────────────────────
// Provider field registry — every field a provider has been observed to send,
// with where it goes and why.
//
// The question this answers is "we paid for this data: did we receive it, store
// it, use it and display it correctly?". Every observed key has exactly one row
// here. A key the provider sends that has no row is reported by
// unmappedFields() and fails fieldRegistry.test.ts, so a new provider field
// cannot reach a Passport, or be silently dropped, without a decision.
//
// Observed sets come from read-only production audits (Nov 6 2026): 331 stored
// NeoVIN decodes (neovin_snapshots), 154 published vehicle_listings
// (mc_attributes, mc_raw, market_meta, market_payload, history_payload,
// epa_economy), plus MarketCheck release notes v4.8.0 (Sep 15 2026) and v4.9.0
// (Nov 4 2026).
// ──────────────────────────────────────────────────────────────────────

export type FieldGroup =
  | "neovin"          // GET /v2/decode/car/neovin/{vin}/specs → neovin_snapshots.payload
  | "listing"         // GET /v2/search/car/active | /v2/listing/car/{id} → vehicle_listings.mc_raw
  | "listing.build"   // same response, .build object → mc_raw.build
  | "listing.dealer"  // same response, .dealer object → mc_raw.dealer
  | "listing.media"   // same response, .media object → mc_raw.media
  | "mc_attributes"   // normalized copy written by marketcheck-sync / marketcheck-specs
  | "build_sheet"     // mc_attributes.build_sheet (structuredSheet in _shared/neovinSheet.ts)
  | "market_meta"     // vehicle-enrich comps aggregates
  | "market_payload"  // vehicle-enrich / market-valuation-write price prediction projection
  | "history_payload" // GET /v2/history/car/{vin} projection
  | "epa_economy";    // epa-fuel-economy function (fueleconomy.gov)

export type Destination =
  | "customer"          // shown on the customer Passport
  | "calculation"       // feeds a Passport calculation / score / verdict
  | "technical_detail"  // expandable technical section
  | "dealer_only"       // admin or dealer intelligence, never public
  | "data_quality"      // verification, provenance, freshness, matching
  | "downstream"        // stickers, descriptions, other approved consumers
  | "excluded";         // documented reason in `note`

export type FieldStatus =
  | "working"   // reaches its destination, tested
  | "partial"   // reaches part of its destination or only one Passport version
  | "missing"   // available, not yet wired (gap)
  | "blocked"   // needs a migration, deploy, rehydration or new provider access
  | "excluded"; // intentionally not used

export interface FieldRow {
  group: FieldGroup;
  path: string;
  destination: Destination;
  status: FieldStatus;
  /** Where it lands (storage → normalizer → model → module), or why it does not. */
  note: string;
}

const r = (group: FieldGroup, path: string, destination: Destination, status: FieldStatus, note: string): FieldRow =>
  ({ group, path, destination, status, note });

const NEO = "neovin" as const;
const LST = "listing" as const;

export const FIELD_REGISTRY: FieldRow[] = [
  // ── NeoVIN enhanced decode (64 keys observed) ──────────────────────
  r(NEO, "vin", "data_quality", "working", "Snapshot identity; must equal the listing VIN (VIN-mismatch guard)."),
  r(NEO, "year", "data_quality", "working", "Identity cross-check against the listing; listing identity wins."),
  r(NEO, "make", "data_quality", "working", "Identity cross-check."),
  r(NEO, "model", "data_quality", "working", "Identity cross-check."),
  r(NEO, "trim", "customer", "working", "mc_attributes.trim → listing trim when absent; Passport identity."),
  r(NEO, "version", "technical_detail", "working", "mc_attributes.version; build identity for comps matching."),
  r(NEO, "body_type", "technical_detail", "working", "mc_attributes.body_type → Specifications › Body."),
  r(NEO, "body_subtype", "technical_detail", "partial", "Stored on 2 rows only; not rendered."),
  r(NEO, "vehicle_type", "data_quality", "working", "Segment for comps and sticker template matching."),
  r(NEO, "doors", "technical_detail", "working", "Specifications › Body."),
  r(NEO, "seating_capacity", "technical_detail", "working", "Specifications › Seating."),
  r(NEO, "engine", "customer", "working", "Key specs › Engine."),
  r(NEO, "transmission", "customer", "working", "Key specs › Transmission."),
  r(NEO, "transmission_description", "technical_detail", "missing", "Not normalized; transmission already covers the shopper need."),
  r(NEO, "drivetrain", "customer", "working", "Key specs › Drivetrain; EPA matcher input."),
  r(NEO, "fuel_type", "customer", "working", "Specifications; EPA matcher input."),
  r(NEO, "powertrain_type", "calculation", "working", "EPA matcher (HEV/BEV); MPGe unit selection."),
  r(NEO, "city_mpg", "excluded", "excluded", "EPA (fueleconomy.gov) is authoritative for MPG; provider MPG only as fallback in key specs."),
  r(NEO, "highway_mpg", "excluded", "excluded", "EPA is authoritative for fuel economy (as city_mpg)."),
  r(NEO, "combined_mpg", "excluded", "excluded", "EPA is authoritative for fuel economy (as city_mpg)."),
  r(NEO, "electric_range", "technical_detail", "partial", "Promoted by promoteNeovinExtras; EPA rangeMiles is shown in preference."),
  r(NEO, "height", "excluded", "excluded", "Unit not documented in the stored contract; kept as dimensions_raw, not shown."),
  r(NEO, "length", "excluded", "excluded", "Unit not documented; kept raw, not shown (as height)."),
  r(NEO, "width", "excluded", "excluded", "Unit not documented; kept raw, not shown (as height)."),
  r(NEO, "weight", "excluded", "excluded", "Unit not documented; kept raw, not shown (as height)."),
  r(NEO, "country", "technical_detail", "working", "Assembly country → Specifications › Origin."),
  r(NEO, "exterior_color", "customer", "working", "build_sheet.colors.exterior {name, code, msrp}; name shown, code dealer-only."),
  r(NEO, "interior_color", "customer", "working", "build_sheet.colors.interior."),
  r(NEO, "features", "customer", "working", "build_sheet.standard; STANDARD → standard equipment, option-code keys → that option's contents."),
  r(NEO, "high_value_features", "customer", "working", "build_sheet.key_features; option-code keys attributed to the option."),
  r(NEO, "installed_equipment", "excluded", "excluded", "Engineering rows (633+ per car); noise for shoppers. Retained in neovin_snapshots."),
  r(NEO, "installed_options_details", "customer", "working", "build_sheet.options/packages: name, code, msrp; verified=false → 'not verified as installed'."),
  r(NEO, "installed_options_details[].verified", "data_quality", "blocked", "Persisted by structuredSheet from this branch; existing build_sheets need a zero-cost rehydration from neovin_snapshots (prod write, needs approval)."),
  r(NEO, "installed_options_details[].confidence", "data_quality", "blocked", "As verified."),
  r(NEO, "installed_options_details[].type", "data_quality", "blocked", "As verified; 'P' routes to packages."),
  r(NEO, "installed_options_details[].sale_price", "excluded", "excluded", "Equals msrp on every observed row; msrp is the documented price."),
  r(NEO, "installed_options_details[].rule", "excluded", "excluded", "Provider option-rule text; not customer-meaningful."),
  r(NEO, "options_packages", "data_quality", "working", "Comma-separated code list; cross-check for installed codes. Not an array, so not a package source."),
  r(NEO, "package_code", "data_quality", "partial", "14 rows; stored in snapshot only."),
  r(NEO, "msrp", "customer", "working", "build_sheet.pricing.base_msrp → Factory MSRP › Base."),
  r(NEO, "delivery_charges", "customer", "working", "build_sheet.pricing.destination_charge → Factory MSRP › Destination."),
  r(NEO, "combined_msrp", "customer", "working", "build_sheet.pricing.total_msrp → Factory MSRP › Total; reconciled before display."),
  r(NEO, "installed_options_msrp", "data_quality", "working", "Reconciliation check against itemized option prices (conflict → held)."),
  r(NEO, "mc_msrp", "dealer_only", "partial", "msrp_variants; dealer review only."),
  r(NEO, "original_msrp", "dealer_only", "partial", "msrp_variants."),
  r(NEO, "build_specs_msrp", "dealer_only", "partial", "msrp_variants."),
  r(NEO, "oem_msrp", "dealer_only", "partial", "msrp_variants."),
  r(NEO, "msrp_label", "dealer_only", "partial", "Provider's own label for the MSRP basis."),
  r(NEO, "discounts", "excluded", "excluded", "4 rows; provider discount lines are not dealer pricing and never override vAuto."),
  r(NEO, "total_discount", "excluded", "excluded", "As discounts."),
  r(NEO, "warranty", "customer", "blocked", "Original factory terms {duration months, distance miles}. Parser fixed on this branch; needs marketcheck-specs deploy + rehydration. Never shown as remaining coverage without in-service evidence."),
  r(NEO, "rating", "technical_detail", "missing", "Provider-reported crash ratings; Passport uses NHTSA directly for safety ratings. Candidate P2."),
  r(NEO, "record_source", "data_quality", "working", "factoryVerified only for build_oem/build_specs; partial_* and *_mc_listing are not factory builds."),
  r(NEO, "record_confidence", "data_quality", "working", "Data Confidence input (0-100). Never a vehicle-quality claim."),
  r(NEO, "listing_confidence", "data_quality", "partial", "promoteNeovinExtras.confidence."),
  r(NEO, "trim_confidence", "data_quality", "partial", "As listing_confidence."),
  r(NEO, "version_confidence", "data_quality", "partial", "As listing_confidence."),
  r(NEO, "transmission_confidence", "data_quality", "partial", "As listing_confidence."),
  r(NEO, "squish_vin", "data_quality", "partial", "taxonomy; VIN-pattern grouping."),
  r(NEO, "manufacturer_code", "downstream", "partial", "taxonomy; OEM sticker template matching."),
  r(NEO, "decode_version", "data_quality", "partial", "taxonomy; provenance."),
  r(NEO, "generic", "data_quality", "working", "Typical-for-trim fallback flag; an empty array means NOT generic (fixed)."),
  r(NEO, "reason", "data_quality", "partial", "Provider reason on 2 partial decodes; snapshot only."),
  r(NEO, "created_at", "data_quality", "excluded", "Provider record timestamp; fetched_at is our freshness clock."),
  r(NEO, "created_at_date", "data_quality", "excluded", "As created_at."),
  r(NEO, "updated_at", "data_quality", "excluded", "As created_at."),
  r(NEO, "updated_at_date", "data_quality", "excluded", "As created_at."),

  // ── Listing (active search / single listing) ───────────────────────
  r(LST, "id", "data_quality", "working", "mc_attributes.mc_listing_id; listing identity."),
  r(LST, "vin", "data_quality", "working", "Must equal the listing VIN."),
  r(LST, "heading", "excluded", "excluded", "Marketing heading; Passport builds identity from year/make/model/trim."),
  r(LST, "price", "data_quality", "working", "Compared to the dealer-feed price; never overrides it (vAuto is authoritative). Mismatch reported in Data Coverage."),
  r(LST, "msrp", "calculation", "working", "mc_attributes.msrp; discount ladder anchor when no factory MSRP."),
  r(LST, "fees", "data_quality", "partial", "v4.8.0. Stored in mc_raw (128/129). Reconciled against the dealer's configured doc fee; never overrides it."),
  r(LST, "price_includes_fees", "data_quality", "partial", "v4.8.0. Stored in mc_raw (106 true, 23 absent). Absent means unknown, never false."),
  r(LST, "alternate_vin", "data_quality", "missing", "v4.8.0, non-VIN listings only. 0 observed; a listing without a real VIN is not Passport-eligible."),
  r(LST, "miles", "data_quality", "working", "Cross-check against dealer odometer; dealer feed wins."),
  r(LST, "stock_no", "data_quality", "working", "mc_attributes; stock-number matching."),
  r(LST, "inventory_type", "data_quality", "working", "new/used cross-check; dealer condition wins."),
  r(LST, "is_certified", "data_quality", "working", "CPO cross-check; dealer CPO program is authoritative."),
  r(LST, "seller_type", "dealer_only", "working", "mc_attributes.seller_type."),
  r(LST, "vehicle_status", "data_quality", "partial", "Availability signal; dealer feed status wins."),
  r(LST, "in_transit", "customer", "missing", "mc_attributes.in_transit. Not rendered; Availability uses dealer status. Candidate P2."),
  r(LST, "dom", "calculation", "working", "mc_attributes.dom → Days on Market."),
  r(LST, "dom_180", "dealer_only", "working", "Dealer intelligence."),
  r(LST, "dom_active", "dealer_only", "working", "Dealer intelligence."),
  r(LST, "dos_active", "dealer_only", "partial", "Raw only."),
  r(LST, "first_seen_at", "data_quality", "working", "Listing history; never an in-service date."),
  r(LST, "first_seen_at_date", "excluded", "excluded", "Duplicate of first_seen_at."),
  r(LST, "first_seen_at_mc", "data_quality", "partial", "Raw only."),
  r(LST, "first_seen_at_mc_date", "excluded", "excluded", "Date-only duplicate of the timestamp above."),
  r(LST, "first_seen_at_source", "data_quality", "partial", "Raw only."),
  r(LST, "first_seen_at_source_date", "excluded", "excluded", "Date-only duplicate of the timestamp above."),
  r(LST, "last_seen_at", "data_quality", "working", "Freshness."),
  r(LST, "last_seen_at_date", "excluded", "excluded", "Date-only duplicate of the timestamp above."),
  r(LST, "scraped_at", "data_quality", "working", "Freshness."),
  r(LST, "scraped_at_date", "excluded", "excluded", "Date-only duplicate of the timestamp above."),
  r(LST, "price_change_percent", "dealer_only", "partial", "mc_attributes; Price History uses our own dated snapshots."),
  r(LST, "ref_price", "dealer_only", "partial", "Previous price; dated snapshots are the customer source."),
  r(LST, "ref_price_dt", "dealer_only", "partial", "As ref_price."),
  r(LST, "ref_miles", "dealer_only", "partial", "As ref_price."),
  r(LST, "ref_miles_dt", "dealer_only", "partial", "As ref_price."),
  r(LST, "exterior_color", "customer", "working", "Specifications › Colors (factory color name preferred)."),
  r(LST, "interior_color", "customer", "working", "As exterior_color."),
  r(LST, "base_ext_color", "data_quality", "working", "Generic color family; comps matching."),
  r(LST, "base_int_color", "data_quality", "working", "As base_ext_color."),
  r(LST, "carfax_1_owner", "calculation", "working", "One-owner signal (vendor-reported, labelled 'reported')."),
  r(LST, "carfax_clean_title", "calculation", "working", "Title signal; dealer NMVTIS attestation wins."),
  r(LST, "vdp_url", "dealer_only", "working", "Dealer website link; competitor VDPs never public."),
  r(LST, "source", "data_quality", "working", "Provenance."),
  r(LST, "data_source", "data_quality", "working", "Provenance."),
  r(LST, "mc_dealership", "dealer_only", "working", "Rooftop matching; not public."),
  r(LST, "car_location", "excluded", "excluded", "Lot geolocation; dealer address is the customer source."),
  r(LST, "build", "technical_detail", "working", "See listing.build rows."),
  r(LST, "dealer", "dealer_only", "working", "See listing.dealer rows; never in the public payload (mc_raw is denied)."),
  r(LST, "media", "customer", "partial", "See listing.media rows."),
  r("listing.build", "year", "data_quality", "working", "Identity cross-check."),
  r("listing.build", "make", "data_quality", "working", "Identity cross-check."),
  r("listing.build", "model", "data_quality", "working", "Identity cross-check."),
  r("listing.build", "trim", "customer", "working", "mc_attributes.trim."),
  r("listing.build", "version", "technical_detail", "working", "mc_attributes.version."),
  r("listing.build", "body_type", "technical_detail", "working", "mc_attributes.body_type."),
  r("listing.build", "body_subtype", "technical_detail", "partial", "2 rows."),
  r("listing.build", "vehicle_type", "data_quality", "working", "mc_attributes.vehicle_type."),
  r("listing.build", "doors", "technical_detail", "working", "Specifications."),
  r("listing.build", "std_seating", "technical_detail", "working", "Specifications › Seating."),
  r("listing.build", "engine", "customer", "working", "Key specs."),
  r("listing.build", "engine_size", "technical_detail", "working", "Specifications › Displacement."),
  r("listing.build", "engine_block", "technical_detail", "partial", "Stored, not rendered."),
  r("listing.build", "cylinders", "technical_detail", "working", "Specifications › Cylinders."),
  r("listing.build", "transmission", "customer", "working", "Key specs."),
  r("listing.build", "drivetrain", "customer", "working", "Key specs."),
  r("listing.build", "fuel_type", "customer", "working", "Specifications."),
  r("listing.build", "powertrain_type", "calculation", "working", "EPA matcher; MPGe unit."),
  r("listing.build", "city_mpg", "excluded", "excluded", "EPA authoritative; fallback only."),
  r("listing.build", "highway_mpg", "excluded", "excluded", "EPA authoritative; fallback only."),
  r("listing.build", "made_in", "technical_detail", "working", "Specifications › Origin (v4.8.0 also a search filter/facet)."),
  r("listing.build", "overall_height", "excluded", "excluded", "Unit not verified; not shown."),
  r("listing.build", "overall_length", "excluded", "excluded", "As overall_height."),
  r("listing.build", "overall_width", "excluded", "excluded", "As overall_height."),
  r("listing.dealer", "id", "dealer_only", "working", "Rooftop mapping (wrong-rooftop guard)."),
  r("listing.dealer", "name", "dealer_only", "working", "Rooftop mapping; competitor names never public."),
  r("listing.dealer", "website", "dealer_only", "working", "Rooftop mapping by domain."),
  r("listing.dealer", "dealership_group_name", "dealer_only", "working", "Group mapping."),
  r("listing.dealer", "dealer_type", "dealer_only", "partial", "Raw only."),
  r("listing.dealer", "street", "excluded", "excluded", "Dealer address comes from the store profile, not the provider."),
  r("listing.dealer", "city", "excluded", "excluded", "As street: the store profile is the address source."),
  r("listing.dealer", "state", "excluded", "excluded", "As street: the store profile is the address source."),
  r("listing.dealer", "zip", "excluded", "excluded", "As street: the store profile is the address source."),
  r("listing.dealer", "country", "excluded", "excluded", "As street: the store profile is the address source."),
  r("listing.dealer", "latitude", "excluded", "excluded", "As street: the store profile is the address source."),
  r("listing.dealer", "longitude", "excluded", "excluded", "As street: the store profile is the address source."),
  r("listing.dealer", "msa_code", "excluded", "excluded", "Market statistical area code; not used."),
  r("listing.dealer", "phone", "excluded", "excluded", "Contact routing is dealer-configured; provider phone never routes a lead."),
  r("listing.dealer", "seller_email", "excluded", "excluded", "Privacy; never stored outside mc_raw, never public."),
  r("listing.media", "photo_links", "customer", "partial", "Gallery fallback when the dealer feed has no photos."),
  r("listing.media", "photo_links_cached", "customer", "partial", "Cached photo links (50/129)."),

  // ── Normalized columns ─────────────────────────────────────────────
  r("mc_attributes", "build_sheet", "customer", "working", "readBuildSheet → equipment, options, packages, Factory MSRP."),
  r("mc_attributes", "features", "customer", "working", "listingEquipment (denoised flat list)."),
  r("mc_attributes", "options", "customer", "working", "listingEquipment; decode-health null vs [] signal."),
  r("mc_attributes", "base_msrp", "customer", "working", "Factory MSRP fallback when build_sheet.pricing is absent."),
  r("mc_attributes", "delivery_charges", "customer", "working", "As base_msrp."),
  r("mc_attributes", "total_msrp", "customer", "working", "As base_msrp."),
  r("mc_attributes", "horsepower", "customer", "working", "Key specs."),
  r("mc_attributes", "seating", "technical_detail", "working", "Specifications."),
  r("mc_attributes", "owner_count", "calculation", "working", "Owner signal (reported)."),
  r("mc_attributes", "specs_decoded_at", "data_quality", "working", "Decode freshness."),
  r("mc_attributes", "specs_source", "data_quality", "working", "Decode provenance."),
  r("mc_attributes", "specs_attempts", "data_quality", "working", "Retry accounting (launch control)."),
  r("mc_attributes", "specs_attempted_at", "data_quality", "working", "As specs_attempts."),
  r("mc_attributes", "specs_strict_attempted", "data_quality", "working", "As specs_attempts."),
  r("mc_attributes", "fee_basis", "data_quality", "partial", "resolveListingFeeBasis(price, fees, price_includes_fees); written by the next marketcheck-sync. Reported in Data Coverage; never overrides the dealer doc fee."),
  r("mc_attributes", "one_owner_source", "data_quality", "working", "Provenance of the one-owner signal."),
  r("build_sheet", "packages", "customer", "working", "Installed packages with code, MSRP, contents."),
  r("build_sheet", "options", "customer", "working", "Installed options with code, MSRP; not denoised (priced paint stays)."),
  r("build_sheet", "key_features", "customer", "working", "High-value features by category."),
  r("build_sheet", "standard", "customer", "working", "Standard equipment by category."),
  r("build_sheet", "pricing", "customer", "working", "Factory MSRP ladder, reconciled."),
  r("build_sheet", "colors", "customer", "working", "Factory color names."),
  r("build_sheet", "assembly", "technical_detail", "working", "Origin."),
  r("build_sheet", "generic", "data_quality", "working", "Typical-for-trim label; blocks option value and MSRP display."),
  r("build_sheet", "warranty", "customer", "blocked", "Not on any stored build_sheet yet (needs rehydration)."),
  r("build_sheet", "installed_options_msrp", "data_quality", "blocked", "As warranty."),
  r("build_sheet", "msrp_variants", "dealer_only", "blocked", "As warranty."),
  r("build_sheet", "confidence", "data_quality", "blocked", "As warranty."),
  r("build_sheet", "decoded_at", "data_quality", "working", "Freshness."),
  r("build_sheet", "source", "data_quality", "working", "Provenance."),
  r("market_meta", "price_percentile", "dealer_only", "working", "Dealer pricing position."),
  r("market_meta", "search_radius", "customer", "working", "Market Intelligence context."),
  r("market_meta", "similar_count", "customer", "working", "Similar vehicles count."),
  r("market_meta", "like_count", "calculation", "working", "Like-for-like comps; minimum sample for a price verdict."),
  r("market_meta", "like_median", "calculation", "working", "Like-for-like median."),
  r("market_meta", "miles_band_percent", "data_quality", "working", "Comp mileage band."),
  r("market_meta", "avg_dom", "customer", "working", "Market demand (hidden above 75 days)."),
  r("market_meta", "dom_median", "customer", "partial", "Not rendered in V2."),
  r("market_meta", "market_days_supply", "customer", "working", "Market demand."),
  r("market_meta", "inventory_count", "customer", "working", "Market demand."),
  r("market_meta", "price_stats", "calculation", "working", "Comp mean/median."),
  r("market_meta", "miles_mean", "calculation", "working", "Mileage context."),
  r("market_meta", "trim_matched", "data_quality", "working", "Trim match flag; weak basis guard."),
  r("market_meta", "trim_count", "data_quality", "working", "Trim-matched sample size."),
  r("market_meta", "relaxation_tier", "data_quality", "working", "How far matching was relaxed."),
  r("market_meta", "rank_basis", "dealer_only", "working", "Stripped from the public payload."),
  r("market_meta", "rank_miles_banded", "dealer_only", "working", "Dealer rank."),
  r("market_meta", "cheaper_count", "dealer_only", "working", "Stripped from the public payload (no cheaper-car pointers)."),
  r("market_meta", "comp_price_cut_count", "dealer_only", "partial", "Comparable price reductions; dealer only."),
  r("market_meta", "comp_price_cut_total", "dealer_only", "partial", "As comp_price_cut_count."),
  r("market_meta", "sold_stats", "customer", "working", "Recently sold medians, gated by scope/age/sample."),
  r("market_meta", "checked_at", "data_quality", "working", "Freshness."),
  r("market_meta", "last_visit_plan", "dealer_only", "partial", "1 row; enrichment planning."),
  r("market_payload", "marketValue", "calculation", "working", "Price Fairness basis (with market_value)."),
  r("market_payload", "low", "customer", "working", "Market range; no range → no position gauge."),
  r("market_payload", "high", "customer", "working", "As low."),
  r("market_payload", "belowMarket", "calculation", "working", "Fallback only; recomputed from current price."),
  r("market_payload", "position", "calculation", "working", "Legacy position label."),
  r("market_payload", "source", "data_quality", "working", "comps_median = weak basis → no over/under claim."),
  r("market_payload", "checked_at", "data_quality", "working", "Freshness."),
  r("market_payload", "checkedAt", "data_quality", "working", "Legacy spelling of checked_at."),
  r("market_payload", "listingPrice", "data_quality", "partial", "Price at valuation time; stale-verdict guard."),
  r("market_payload", "vin", "data_quality", "working", "VIN match guard."),
  r("market_payload", "raw", "excluded", "excluded", "Raw provider response; never public."),
  r("market_payload", "rawProvider", "excluded", "excluded", "Raw provider response; never public (as raw)."),
  r("history_payload", "available", "data_quality", "working", "History presence."),
  r("history_payload", "entries", "customer", "working", "Listing history timeline (dealer names kept, URLs stripped). Not an ownership record."),
  r("history_payload", "owners", "excluded", "excluded", "Counts dealer listing spells, not owners. Never shown as an owner count (V2 timeline fixed)."),
  r("history_payload", "inServiceDate", "excluded", "excluded", "Always null: listing history is never an in-service date."),
  r("history_payload", "firstSeen", "customer", "working", "'First listed' (estimated)."),
  r("history_payload", "checked_at", "data_quality", "working", "Freshness."),
  r("history_payload", "source", "data_quality", "working", "Provenance."),
  r("epa_economy", "city", "customer", "working", "Fuel Economy (MPG or MPGe by unit)."),
  r("epa_economy", "highway", "customer", "working", "As city."),
  r("epa_economy", "combined", "customer", "working", "As city."),
  r("epa_economy", "annualFuelCost", "customer", "working", "EPA annual fuel cost, labelled as EPA's."),
  r("epa_economy", "ghgScore", "technical_detail", "partial", "Not rendered in V2."),
  r("epa_economy", "co2TailpipeGpm", "technical_detail", "missing", "Not normalized."),
  r("epa_economy", "rangeMiles", "customer", "working", "EV range."),
  r("epa_economy", "fuelType", "customer", "working", "Unit selection (Electricity → MPGe)."),
  r("epa_economy", "atvType", "calculation", "working", "Unit selection (EV → MPGe)."),
  r("epa_economy", "vehicleId", "data_quality", "working", "fueleconomy.gov record id."),
  r("epa_economy", "matchBasis", "data_quality", "working", "Match provenance."),
  r("epa_economy", "matchedOption", "data_quality", "working", "Match provenance."),
  r("epa_economy", "matcherVersion", "data_quality", "working", "Matcher version."),
  r("epa_economy", "source", "data_quality", "working", "Provenance."),
  r("epa_economy", "checkedAt", "data_quality", "working", "Freshness."),
];

const KEY = (g: FieldGroup, p: string) => `${g}::${p}`;
const INDEX = new Map(FIELD_REGISTRY.map((row) => [KEY(row.group, row.path), row]));

export const registryRow = (group: FieldGroup, path: string): FieldRow | undefined => INDEX.get(KEY(group, path));

/**
 * Keys present on a provider object that the registry does not know. A
 * non-empty answer is a decision to make, not data to pass through.
 */
// mc_attributes is a normalized COPY of listing / build / NeoVIN keys, so a key
// already decided in a source group is decided here too.
const FALLBACK_GROUPS: Partial<Record<FieldGroup, FieldGroup[]>> = {
  mc_attributes: ["listing", "listing.build", "neovin"],
};

export const resolveRow = (group: FieldGroup, path: string): FieldRow | undefined =>
  INDEX.get(KEY(group, path)) ?? (FALLBACK_GROUPS[group] ?? []).map((g) => INDEX.get(KEY(g, path))).find(Boolean);

export function unmappedFields(group: FieldGroup, obj: unknown): string[] {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return [];
  return Object.keys(obj as Record<string, unknown>).filter((k) => !resolveRow(group, k));
}
