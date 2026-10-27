// GENERATED — do not edit.
// Mirror of src/lib/market/providerRegistry.ts, copied so the edge runtime can
// bundle the engine (Supabase ships only supabase/functions/). Edit the
// source file and run `bun run sync:edge-sticker`.
// ── The provider contract registry ─────────────────────────────────────────
//
// One place that says, for every MarketCheck capability this product touches:
// which endpoint, what it bills under, which vehicles it applies to, what may
// trigger it, how long an answer is good for, what the call may cost, what the
// account must be entitled to, and whether a customer page may ever cause it.
//
// Until now every edge function decided those things for itself. The sweep
// re-bought the lot twice a day because nothing said "once a day"; the comps
// route can buy a page from an anonymous browser because nothing said "never
// from a public page"; the incentives cron fires nightly into an env gate
// because nothing said "off". This module is the statement. It is pure and
// performs no I/O: an edge function consults it, it does not call anything.
//
// Costs here are DEFAULTS, copied from the public list in mcCost.ts, and every
// consumer resolves them through `effectiveCost` with the tenant's configured
// overrides first. A business rule that reads the literal is the defect §23
// names; the test suite forbids it.
//
// Contract status is explicit. `documented` means the path is what the
// 2026-10-21 handoff reference documents; `verified` is reserved for a path
// that has been checked against the live OpenAPI document, which this
// environment cannot reach (ENTITLEMENT_AND_TERMS_REPORT.md §4). Nothing in
// this file is verified yet, and the registry says so rather than implying it.

export type ProviderName = "marketcheck" | "blackbook";

export type VehicleApplicability = "yes" | "no" | "optional" | "first_seen" | "test";

export type CapabilityStatus =
  | "active"
  | "shadow"
  | "entitlement_blocked"
  | "autocurb_reserved"
  | "not_active"
  | "retired";

export type CapabilityTrigger =
  | "scheduled"
  | "intake"
  | "material_event"
  | "operator"
  | "valuation_writer"
  | "never";

export type AuthorityClass =
  | "inventory_state"
  | "factory_build"
  | "market_evidence"
  | "listing_history"
  | "title_history"
  | "safety"
  | "offer_context"
  | "acquisition";

export type ContractStatus = "documented" | "verified" | "legacy";

export interface ProviderCapability {
  /** Stable key; matches the capability matrix row. */
  key: string;
  provider: ProviderName;
  /** Human product name as the provider sells it. */
  product: string;
  /** Path under the provider base. `{vin}` etc. are placeholders. */
  path: string;
  /** Which `MC_CALL_PRICE_USD` key the call bills under. */
  billingProduct: string;
  contract: ContractStatus;
  /** Where the current contract is documented. */
  reference: string | null;
  appliesTo: { new: VehicleApplicability; used: VehicleApplicability; autocurb: VehicleApplicability };
  status: CapabilityStatus;
  /** What is allowed to cause a paid call. `never` means the registry forbids it. */
  triggers: CapabilityTrigger[];
  /** Target freshness in hours; null when the answer is immutable or not cached. */
  ttlHours: number | null;
  /** Dimensions that make two requests the same request. */
  cacheKey: string[];
  /** Default unit cost in USD from the public list; overridable per tenant. */
  defaultCostUsd: number;
  /** What the account must hold for the call to answer. */
  entitlement: string;
  /** Retries the transport may make above a reservation. Zero below it. */
  maxRetries: number;
  rateLimitStrategy: "serial" | "backoff" | "none";
  fallback: string | null;
  rawStore: string | null;
  normalizedDestinations: string[];
  authority: AuthorityClass;
  /** May an anonymous Passport load ever cause this call. Always false when paid. */
  publicBrowseMayTrigger: false;
  notes: string;
}

const MC_DOCS = "https://docs.marketcheck.com/docs/api/cars";

export const PROVIDER_CAPABILITIES: readonly ProviderCapability[] = [
  {
    key: "syndication",
    provider: "marketcheck",
    product: "Dealer Inventory Syndication",
    path: "/v2/dealerships/inventory",
    billingProduct: "dealer_inventory_syndication",
    contract: "documented",
    reference: `${MC_DOCS}/inventory/introduction`,
    appliesTo: { new: "yes", used: "yes", autocurb: "optional" },
    status: "active",
    triggers: ["scheduled", "operator"],
    ttlHours: 24,
    cacheKey: ["tenant", "mc_scope_param", "mc_scope_value", "owned"],
    defaultCostUsd: 1.0,
    entitlement: "dealer_inventory_syndication",
    maxRetries: 2,
    rateLimitStrategy: "backoff",
    fallback: null,
    rawStore: "vehicle_listings.mc_raw",
    normalizedDestinations: ["vehicle_listings", "vehicle_files", "mc_attributes", "advertised_prices", "vehicle_value_history"],
    authority: "inventory_state",
    publicBrowseMayTrigger: false,
    notes: "A refusal must be reported as a refusal and may never retire inventory.",
  },
  {
    key: "dealership_directory",
    provider: "marketcheck",
    product: "Dealership Directory",
    path: "/v2/dealerships/car",
    billingProduct: "dealer_api",
    contract: "documented",
    reference: `${MC_DOCS}/inventory/introduction`,
    appliesTo: { new: "yes", used: "yes", autocurb: "optional" },
    status: "active",
    triggers: ["operator"],
    ttlHours: null,
    cacheKey: ["inventory_url"],
    defaultCostUsd: 0.0025,
    entitlement: "dealer_api",
    maxRetries: 0,
    rateLimitStrategy: "none",
    fallback: null,
    rawStore: "marketcheck_sync_config.last_status",
    normalizedDestinations: ["marketcheck_sync_config"],
    authority: "inventory_state",
    publicBrowseMayTrigger: false,
    notes: "Resolves a rooftop once; the pin is re-validated from the feed, not re-resolved.",
  },
  {
    key: "dealers_search_legacy",
    provider: "marketcheck",
    product: "Dealers Search (legacy id space)",
    path: "/v2/dealers/car",
    billingProduct: "dealer_api",
    contract: "legacy",
    reference: null,
    appliesTo: { new: "optional", used: "optional", autocurb: "optional" },
    status: "active",
    triggers: ["operator"],
    ttlHours: null,
    cacheKey: ["zip", "state"],
    defaultCostUsd: 0.0025,
    entitlement: "dealer_api",
    maxRetries: 0,
    rateLimitStrategy: "none",
    fallback: "dealership_directory",
    rawStore: "marketcheck_sync_config.last_status",
    normalizedDestinations: ["marketcheck_sync_config.dealer_id"],
    authority: "inventory_state",
    publicBrowseMayTrigger: false,
    notes: "Geography-only search whose ids collide with other rooftops in the syndication id space; kept for the manual dealer_id override only.",
  },
  {
    key: "dealer_details_legacy",
    provider: "marketcheck",
    product: "Dealer details (legacy)",
    path: "/v2/dealer/car",
    billingProduct: "dealer_api",
    contract: "legacy",
    reference: null,
    appliesTo: { new: "optional", used: "optional", autocurb: "optional" },
    status: "active",
    triggers: ["operator"],
    ttlHours: null,
    cacheKey: ["dealer_id"],
    defaultCostUsd: 0.0025,
    entitlement: "dealer_api",
    maxRetries: 0,
    rateLimitStrategy: "none",
    fallback: "dealership_directory",
    rawStore: "marketcheck_sync_config.last_status",
    normalizedDestinations: ["marketcheck_sync_config"],
    authority: "inventory_state",
    publicBrowseMayTrigger: false,
    notes: "Name and state of a legacy dealer id; used only to label a manual override.",
  },
  {
    key: "active_search",
    provider: "marketcheck",
    product: "Active Inventory Search",
    path: "/v2/search/car/active",
    billingProduct: "inventory_search",
    contract: "documented",
    reference: `${MC_DOCS}/inventory/introduction`,
    appliesTo: { new: "yes", used: "yes", autocurb: "optional" },
    status: "active",
    triggers: ["intake", "scheduled", "material_event", "operator"],
    ttlHours: 24,
    cacheKey: ["cohort_hash", "zip", "radius", "car_type"],
    defaultCostUsd: 0.002,
    entitlement: "inventory_search",
    maxRetries: 2,
    rateLimitStrategy: "serial",
    fallback: null,
    rawStore: "market_cohort_snapshots",
    normalizedDestinations: ["vehicle_listings.comparables", "vehicle_listings.group_similar", "vehicle_listings.market_meta"],
    authority: "market_evidence",
    publicBrowseMayTrigger: false,
    notes: "fees and price_includes_fees on each row feed the comparable basis. One cohort informs many vehicles.",
  },
  {
    key: "neovin",
    provider: "marketcheck",
    product: "NeoVIN decode",
    path: "/v2/decode/car/neovin/{vin}/specs",
    billingProduct: "neovin",
    contract: "documented",
    reference: `${MC_DOCS}/vehicle-specs/neovin`,
    appliesTo: { new: "first_seen", used: "first_seen", autocurb: "optional" },
    status: "active",
    triggers: ["intake", "operator"],
    ttlHours: null,
    cacheKey: ["vin"],
    defaultCostUsd: 0.08,
    entitlement: "neovin",
    maxRetries: 0,
    rateLimitStrategy: "serial",
    fallback: "basic_decode",
    rawStore: "neovin_snapshots",
    normalizedDestinations: ["mc_attributes.build_sheet", "mc_attributes.base_msrp", "vehicle_facts"],
    authority: "factory_build",
    publicBrowseMayTrigger: false,
    notes: "Immutable; never rebought once a real sheet exists. Three attempts, strict first, refusals uncounted.",
  },
  {
    key: "basic_decode",
    provider: "marketcheck",
    product: "Basic VIN decode",
    path: "/v2/decode/car/{vin}/specs",
    billingProduct: "basic_vin_decode",
    contract: "documented",
    reference: `${MC_DOCS}/vehicle-specs/neovin`,
    appliesTo: { new: "optional", used: "optional", autocurb: "optional" },
    status: "active",
    triggers: ["intake"],
    ttlHours: null,
    cacheKey: ["vin"],
    defaultCostUsd: 0.0015,
    entitlement: "basic_vin_decode",
    maxRetries: 0,
    rateLimitStrategy: "serial",
    fallback: null,
    rawStore: "neovin_snapshots",
    normalizedDestinations: ["mc_attributes"],
    authority: "factory_build",
    publicBrowseMayTrigger: false,
    notes: "Specs only, no equipment; leaves options null so NeoVIN is retried.",
  },
  {
    key: "basic_decode_root",
    provider: "marketcheck",
    product: "Basic VIN decode (root)",
    path: "/v2/decode/car/{vin}",
    billingProduct: "basic_vin_decode",
    contract: "documented",
    reference: `${MC_DOCS}/vehicle-specs/neovin`,
    appliesTo: { new: "optional", used: "optional", autocurb: "optional" },
    status: "active",
    triggers: ["intake"],
    ttlHours: null,
    cacheKey: ["vin"],
    defaultCostUsd: 0.0015,
    entitlement: "basic_vin_decode",
    maxRetries: 0,
    rateLimitStrategy: "serial",
    fallback: null,
    rawStore: "neovin_snapshots",
    normalizedDestinations: ["mc_attributes"],
    authority: "factory_build",
    publicBrowseMayTrigger: false,
    notes: "Last decode fallback; core specs only.",
  },
  {
    key: "price_base",
    provider: "marketcheck",
    product: "MarketCheck Price (Base)",
    path: "/v2/predict/car/us/marketcheck_price",
    billingProduct: "price_prediction",
    contract: "documented",
    reference: `${MC_DOCS}/market-insights/marketcheck-price`,
    appliesTo: { new: "optional", used: "yes", autocurb: "optional" },
    status: "shadow",
    triggers: ["valuation_writer"],
    ttlHours: 24 * 7,
    cacheKey: ["vin", "miles", "dealer_type", "is_certified", "zip"],
    defaultCostUsd: 0.07,
    entitlement: "price_prediction",
    maxRetries: 0,
    rateLimitStrategy: "none",
    fallback: null,
    rawStore: "vehicle_market_valuations",
    normalizedDestinations: ["vehicle_market_valuations.provider_prediction", "market_payload.provider_valuation"],
    authority: "market_evidence",
    publicBrowseMayTrigger: false,
    notes: "Reserved under the tenant budget; one live reservation per request fingerprint; is_certified always sent.",
  },
  {
    key: "price_premium",
    provider: "marketcheck",
    product: "MarketCheck Price (Premium)",
    path: "/v2/predict/car/us/marketcheck_price/comparables",
    billingProduct: "price_prediction",
    contract: "documented",
    reference: `${MC_DOCS}/market-insights/marketcheck-price`,
    appliesTo: { new: "optional", used: "yes", autocurb: "optional" },
    status: "entitlement_blocked",
    triggers: ["valuation_writer"],
    ttlHours: 24 * 7,
    cacheKey: ["vin", "miles", "dealer_type", "is_certified", "zip"],
    defaultCostUsd: 0.07,
    entitlement: "price_prediction_premium",
    maxRetries: 0,
    rateLimitStrategy: "none",
    fallback: "price_base",
    rawStore: "vehicle_market_valuations",
    normalizedDestinations: ["vehicle_market_valuations", "market_cohort_snapshots"],
    authority: "market_evidence",
    publicBrowseMayTrigger: false,
    notes: "Untested on this account. Cost is a placeholder until one authorized call reports it.",
  },
  {
    key: "price_premium_plus",
    provider: "marketcheck",
    product: "MarketCheck Price (Premium Plus)",
    path: "/v2/predict/car/us/marketcheck_price/comparables/decode",
    billingProduct: "price_prediction",
    contract: "documented",
    reference: `${MC_DOCS}/market-insights/marketcheck-price`,
    appliesTo: { new: "test", used: "yes", autocurb: "optional" },
    status: "entitlement_blocked",
    triggers: ["intake"],
    ttlHours: 24 * 7,
    cacheKey: ["vin", "miles", "dealer_type", "is_certified", "zip"],
    defaultCostUsd: 0.07,
    entitlement: "price_prediction_premium_plus",
    maxRetries: 0,
    rateLimitStrategy: "none",
    fallback: "price_premium",
    rawStore: "vehicle_market_valuations",
    normalizedDestinations: ["vehicle_market_valuations", "market_cohort_snapshots", "neovin_snapshots"],
    authority: "market_evidence",
    publicBrowseMayTrigger: false,
    notes: "Used-intake candidate: prediction + comparables + NeoVIN in one call. The decode half is immutable; the market half expires.",
  },
  {
    key: "vin_history",
    provider: "marketcheck",
    product: "History by VIN",
    path: "/v2/history/car/{vin}",
    billingProduct: "vin_history",
    contract: "documented",
    reference: `${MC_DOCS}/inventory/introduction`,
    appliesTo: { new: "no", used: "yes", autocurb: "yes" },
    status: "active",
    triggers: ["intake", "material_event", "operator"],
    ttlHours: 24 * 30,
    cacheKey: ["vin"],
    defaultCostUsd: 0.006,
    entitlement: "vin_history",
    maxRetries: 2,
    rateLimitStrategy: "serial",
    fallback: null,
    rawStore: null,
    normalizedDestinations: ["vehicle_listings.history_payload", "vehicle_listings.in_service_date"],
    authority: "listing_history",
    publicBrowseMayTrigger: false,
    notes: "Never an owner count, never an accident history. Not routine for new vehicles.",
  },
  {
    key: "mds",
    provider: "marketcheck",
    product: "Market Days Supply",
    path: "/v2/mds/car",
    billingProduct: "market_days_supply",
    contract: "documented",
    reference: `${MC_DOCS}/market-insights/market-days-supply`,
    appliesTo: { new: "optional", used: "yes", autocurb: "yes" },
    status: "active",
    triggers: ["intake", "scheduled", "operator"],
    ttlHours: 24 * 7,
    cacheKey: ["vin_exact_or_ymmt", "zip", "radius", "car_type"],
    defaultCostUsd: 0.006,
    entitlement: "market_days_supply",
    maxRetries: 2,
    rateLimitStrategy: "serial",
    fallback: "ymmt_then_ymm_then_national",
    rawStore: null,
    normalizedDestinations: ["market_meta.market_days_supply", "market_meta.inventory_count"],
    authority: "market_evidence",
    publicBrowseMayTrigger: false,
    notes: "Cohort order: vin exact=true, YMMT local, YMM local, model local, national. Liquidity, not quality.",
  },
  {
    key: "sales_stats",
    provider: "marketcheck",
    product: "Inferred Sales Stats",
    path: "/v2/sales/car",
    billingProduct: "sales_stats",
    contract: "documented",
    reference: `${MC_DOCS}/market-insights/inferred-sales-stats`,
    appliesTo: { new: "optional", used: "yes", autocurb: "yes" },
    status: "active",
    triggers: ["scheduled", "operator"],
    ttlHours: 24 * 30,
    cacheKey: ["cohort", "state"],
    defaultCostUsd: 0.006,
    entitlement: "sales_stats",
    maxRetries: 2,
    rateLimitStrategy: "serial",
    fallback: "recents",
    rawStore: null,
    normalizedDestinations: ["market_meta.sold_stats"],
    authority: "market_evidence",
    publicBrowseMayTrigger: false,
    notes: "Provider regenerates monthly; buying it nightly buys the same number. Sold is inferred, never a transaction price.",
  },
  {
    key: "recents",
    provider: "marketcheck",
    product: "Recent (delisted) listings",
    path: "/v2/search/car/recents",
    billingProduct: "recent_inventory",
    contract: "documented",
    reference: `${MC_DOCS}/inventory/introduction`,
    appliesTo: { new: "optional", used: "yes", autocurb: "yes" },
    status: "active",
    triggers: ["scheduled", "operator"],
    ttlHours: 24 * 30,
    cacheKey: ["cohort", "state"],
    defaultCostUsd: 0.006,
    entitlement: "recent_inventory",
    maxRetries: 2,
    rateLimitStrategy: "serial",
    fallback: null,
    rawStore: null,
    normalizedDestinations: ["market_meta.sold_stats"],
    authority: "market_evidence",
    publicBrowseMayTrigger: false,
    notes: "Listing-level recent evidence; medians only leave the function.",
  },
  {
    key: "sold_summary",
    provider: "marketcheck",
    product: "Sold Vehicles Summary",
    path: "/v2/sold/car/summary",
    billingProduct: "sales_stats",
    contract: "documented",
    reference: `${MC_DOCS}/market-insights/sold-vehicles-summary`,
    appliesTo: { new: "optional", used: "yes", autocurb: "yes" },
    status: "entitlement_blocked",
    triggers: ["scheduled"],
    ttlHours: 24 * 30,
    cacheKey: ["cohort", "geography", "month"],
    defaultCostUsd: 0.006,
    entitlement: "sold_vehicles_summary",
    maxRetries: 2,
    rateLimitStrategy: "serial",
    fallback: null,
    rawStore: "market_trend_evidence",
    normalizedDestinations: ["market_meta.trend"],
    authority: "market_evidence",
    publicBrowseMayTrigger: false,
    notes: "Path and cost are placeholders until the contract is read; stored with cohort, geography, window and inferred-sold semantics.",
  },
  {
    key: "vindata_access",
    provider: "marketcheck",
    product: "VINData NMVTIS access report",
    path: "/v2/vindata/access-report/aamva/{vin}",
    billingProduct: "vindata_access",
    contract: "documented",
    reference: `${MC_DOCS}/third-party/vindata`,
    appliesTo: { new: "no", used: "yes", autocurb: "yes" },
    status: "active",
    triggers: ["operator", "material_event"],
    ttlHours: 24 * 90,
    cacheKey: ["vin"],
    defaultCostUsd: 0,
    entitlement: "compliance_pro",
    maxRetries: 0,
    rateLimitStrategy: "none",
    fallback: "vindata_generate",
    rawStore: null,
    normalizedDestinations: ["session_only"],
    authority: "title_history",
    publicBrowseMayTrigger: false,
    notes: "Access first; the provider keeps a generated report 90 days. Terms: no persistence beyond a session.",
  },
  {
    key: "vindata_generate",
    provider: "marketcheck",
    product: "VINData NMVTIS generate report",
    path: "/v2/vindata/generate-report/aamva/{vin}",
    billingProduct: "vindata_generate",
    contract: "documented",
    reference: `${MC_DOCS}/third-party/vindata`,
    appliesTo: { new: "no", used: "yes", autocurb: "yes" },
    status: "active",
    triggers: ["operator"],
    ttlHours: 24 * 90,
    cacheKey: ["vin"],
    defaultCostUsd: 0.49,
    entitlement: "compliance_pro",
    maxRetries: 0,
    rateLimitStrategy: "none",
    fallback: null,
    rawStore: null,
    normalizedDestinations: ["session_only", "title_report_pulls"],
    authority: "title_history",
    publicBrowseMayTrigger: false,
    notes: "Capped at 50 per dealer per month server-side. Exception-based automation is an owner decision.",
  },
  {
    key: "autorecalls",
    provider: "marketcheck",
    product: "AutoRecalls (VIN)",
    path: "/v2/car/autorecalls/{vin}",
    billingProduct: "auto_recalls",
    contract: "documented",
    reference: `${MC_DOCS}/third-party/autorecalls`,
    appliesTo: { new: "yes", used: "yes", autocurb: "yes" },
    status: "entitlement_blocked",
    triggers: ["intake", "scheduled", "material_event", "operator"],
    ttlHours: 24 * 30,
    cacheKey: ["vin"],
    defaultCostUsd: 0.07,
    entitlement: "autorecalls",
    maxRetries: 0,
    rateLimitStrategy: "serial",
    fallback: "nhtsa_model_context",
    rawStore: "vehicle_listings.recall_check",
    normalizedDestinations: ["recall_status", "open_recall_count", "closed_recall_count"],
    authority: "safety",
    publicBrowseMayTrigger: false,
    notes: "Only a VIN answer can clear a VIN. The legacy /v2/recall/car/{vin} family is retired by this entry.",
  },
  {
    key: "autorecalls_legacy",
    provider: "marketcheck",
    product: "AutoRecalls (legacy path)",
    path: "/v2/recall/car/{vin}",
    billingProduct: "auto_recalls",
    contract: "legacy",
    reference: null,
    appliesTo: { new: "no", used: "no", autocurb: "no" },
    status: "retired",
    triggers: ["never"],
    ttlHours: null,
    cacheKey: ["vin"],
    defaultCostUsd: 0.07,
    entitlement: "autorecalls",
    maxRetries: 0,
    rateLimitStrategy: "none",
    fallback: null,
    rawStore: null,
    normalizedDestinations: [],
    authority: "safety",
    publicBrowseMayTrigger: false,
    notes: "Still called by marketcheck-recalls and vehicle-enrich; answered 404 or empty on every variant.",
  },
  {
    key: "incentives_oem",
    provider: "marketcheck",
    product: "OEM incentives (search)",
    path: "/v2/search/car/incentive/oem",
    billingProduct: "oem_incentive",
    contract: "documented",
    reference: `${MC_DOCS}/incentives/incentive-search-api`,
    appliesTo: { new: "yes", used: "no", autocurb: "no" },
    status: "not_active",
    triggers: ["scheduled"],
    ttlHours: 24,
    cacheKey: ["make", "model", "year", "zip_or_msa", "offer_type"],
    defaultCostUsd: 0.2,
    entitlement: "oem_incentive",
    maxRetries: 0,
    rateLimitStrategy: "none",
    fallback: null,
    rawStore: "marketcheck_vehicle_cache",
    normalizedDestinations: ["incentive_programs"],
    authority: "offer_context",
    publicBrowseMayTrigger: false,
    notes: "Owner-disabled 2026-07-28. Cache by program and market, never per VIN. Never a Vehicle Score input.",
  },
  {
    key: "incentives_make_zip",
    provider: "marketcheck",
    product: "OEM incentives by make and ZIP",
    path: "/v2/search/car/incentive/{make}/{zip}",
    billingProduct: "oem_incentive",
    contract: "documented",
    reference: `${MC_DOCS}/incentives/incentive-search-api`,
    appliesTo: { new: "yes", used: "no", autocurb: "no" },
    status: "entitlement_blocked",
    triggers: ["scheduled"],
    ttlHours: 24,
    cacheKey: ["make", "zip"],
    defaultCostUsd: 0.2,
    entitlement: "oem_incentive",
    maxRetries: 0,
    rateLimitStrategy: "none",
    fallback: "incentives_oem",
    rawStore: "marketcheck_vehicle_cache",
    normalizedDestinations: ["incentive_programs"],
    authority: "offer_context",
    publicBrowseMayTrigger: false,
    notes: "Preferred cache dimension once incentives return.",
  },
  {
    key: "cached_images",
    provider: "marketcheck",
    product: "Cached images",
    path: "/v2/image/cache/car/{id}",
    billingProduct: "cached_images",
    contract: "documented",
    reference: `${MC_DOCS}/inventory/introduction`,
    appliesTo: { new: "optional", used: "optional", autocurb: "no" },
    status: "active",
    triggers: ["never"],
    ttlHours: null,
    cacheKey: ["url"],
    defaultCostUsd: 0.001,
    entitlement: "cached_images",
    maxRetries: 0,
    rateLimitStrategy: "none",
    fallback: null,
    rawStore: "vehicle_listings.mc_raw.media",
    normalizedDestinations: ["vehicle_listings.photos"],
    authority: "inventory_state",
    publicBrowseMayTrigger: false,
    notes: "Links arrive on the feed; the product never requests them itself.",
  },
  {
    key: "listing_details",
    provider: "marketcheck",
    product: "Listing details",
    path: "/v2/listing/car/{id}",
    billingProduct: "inventory_search",
    contract: "documented",
    reference: `${MC_DOCS}/inventory/introduction`,
    appliesTo: { new: "optional", used: "optional", autocurb: "optional" },
    status: "not_active",
    triggers: ["operator"],
    ttlHours: 24,
    cacheKey: ["mc_listing_id"],
    defaultCostUsd: 0.002,
    entitlement: "inventory_search",
    maxRetries: 0,
    rateLimitStrategy: "none",
    fallback: null,
    rawStore: null,
    normalizedDestinations: [],
    authority: "inventory_state",
    publicBrowseMayTrigger: false,
    notes: "mc_listing_id is captured for it; the only source of per-listing options and seller comments when the feed omits them.",
  },
  {
    key: "fsbo",
    provider: "marketcheck",
    product: "Private-party active inventory",
    path: "/v2/search/car/fsbo/active",
    billingProduct: "inventory_search",
    contract: "documented",
    reference: `${MC_DOCS}/inventory/introduction`,
    appliesTo: { new: "no", used: "no", autocurb: "yes" },
    status: "autocurb_reserved",
    triggers: ["never"],
    ttlHours: 24,
    cacheKey: ["cohort", "zip"],
    defaultCostUsd: 0.002,
    entitlement: "inventory_search",
    maxRetries: 0,
    rateLimitStrategy: "none",
    fallback: null,
    rawStore: null,
    normalizedDestinations: [],
    authority: "acquisition",
    publicBrowseMayTrigger: false,
    notes: "Acquisition context only; never a Vehicle Score input.",
  },
  {
    key: "auction",
    provider: "marketcheck",
    product: "Auction active inventory",
    path: "/v2/search/car/auction/active",
    billingProduct: "inventory_search",
    contract: "documented",
    reference: `${MC_DOCS}/inventory/auction-search`,
    appliesTo: { new: "no", used: "no", autocurb: "yes" },
    status: "autocurb_reserved",
    triggers: ["never"],
    ttlHours: 24,
    cacheKey: ["cohort", "zip"],
    defaultCostUsd: 0.002,
    entitlement: "inventory_search",
    maxRetries: 0,
    rateLimitStrategy: "none",
    fallback: null,
    rawStore: null,
    normalizedDestinations: [],
    authority: "acquisition",
    publicBrowseMayTrigger: false,
    notes: "Wholesale context only.",
  },
  {
    key: "marketmatch_dealers",
    provider: "marketcheck",
    product: "MarketMatch dealer rank",
    path: "/v2/marketmatch/dealers/rank",
    billingProduct: "unknown",
    contract: "documented",
    reference: `${MC_DOCS}/market-insights/marketmatch`,
    appliesTo: { new: "no", used: "no", autocurb: "yes" },
    status: "autocurb_reserved",
    triggers: ["never"],
    ttlHours: 24,
    cacheKey: ["vin", "geography"],
    defaultCostUsd: 0,
    entitlement: "marketmatch",
    maxRetries: 0,
    rateLimitStrategy: "none",
    fallback: null,
    rawStore: null,
    normalizedDestinations: [],
    authority: "acquisition",
    publicBrowseMayTrigger: false,
    notes: "Which dealers a vehicle fits; acquisition placement, never quality. Unpriced.",
  },
  {
    key: "marketmatch",
    provider: "marketcheck",
    product: "MarketMatch VIN rank",
    path: "/v2/marketmatch/vins/rank",
    billingProduct: "unknown",
    contract: "documented",
    reference: `${MC_DOCS}/market-insights/marketmatch`,
    appliesTo: { new: "no", used: "no", autocurb: "yes" },
    status: "autocurb_reserved",
    triggers: ["never"],
    ttlHours: 24,
    cacheKey: ["dealer", "vins"],
    defaultCostUsd: 0,
    entitlement: "marketmatch",
    maxRetries: 0,
    rateLimitStrategy: "none",
    fallback: null,
    rawStore: null,
    normalizedDestinations: [],
    authority: "acquisition",
    publicBrowseMayTrigger: false,
    notes: "Dealer/vehicle fit, not vehicle quality. Unpriced.",
  },
  {
    key: "blackbook_used_vin",
    provider: "blackbook",
    product: "Black Book UsedCar VIN values",
    path: "/UsedCarWS/UsedCarVin/{vin}/{mileage}",
    billingProduct: "unknown",
    contract: "legacy",
    reference: null,
    appliesTo: { new: "no", used: "yes", autocurb: "yes" },
    status: "entitlement_blocked",
    triggers: ["intake", "scheduled"],
    ttlHours: 24 * 7,
    cacheKey: ["vin", "mileage", "zip"],
    defaultCostUsd: 0,
    entitlement: "blackbook_credentials",
    maxRetries: 0,
    rateLimitStrategy: "none",
    fallback: null,
    rawStore: null,
    normalizedDestinations: ["vehicle_listings.blackbook"],
    authority: "market_evidence",
    publicBrowseMayTrigger: false,
    notes: "Never configured on this project. Not a live valuation signal until rows populate.",
  },
];

export const PROVIDER_CAPABILITY_KEYS = PROVIDER_CAPABILITIES.map((c) => c.key);

const BY_KEY = new Map(PROVIDER_CAPABILITIES.map((c) => [c.key, c]));

export function capability(key: string): ProviderCapability | null {
  return BY_KEY.get(key) ?? null;
}

/**
 * Find the capability a URL or path belongs to. Placeholders in registry
 * paths (`{vin}`) match one path segment. The longest matching path wins so
 * `/v2/predict/car/us/marketcheck_price/comparables/decode` resolves to
 * Premium Plus rather than to Base.
 */
export function capabilityForPath(urlOrPath: string): ProviderCapability | null {
  const path = urlOrPath.replace(/^https?:\/\/[^/]+/, "").split("?")[0];
  let best: ProviderCapability | null = null;
  for (const c of PROVIDER_CAPABILITIES) {
    const pattern = "^" + c.path.replace(/[.*+?^${}()|[\]\\]/g, (m) => (m === "{" || m === "}" ? m : `\\${m}`))
      .replace(/\{[a-z_]+\}/g, "[^/]+") + "$";
    if (new RegExp(pattern).test(path) && (!best || c.path.length > best.path.length)) best = c;
  }
  return best;
}

/** Per-tenant overrides of the default unit cost, keyed by capability key. */
export type CostOverrides = Partial<Record<string, number>>;

/**
 * The unit cost a consumer may plan with. Configuration first, default second.
 * A negative or non-finite override is ignored rather than trusted.
 */
export function effectiveCost(key: string, overrides?: CostOverrides | null): number | null {
  const c = BY_KEY.get(key);
  if (!c) return null;
  const o = overrides?.[key];
  if (typeof o === "number" && Number.isFinite(o) && o >= 0) return o;
  return c.defaultCostUsd;
}

export type VehicleType = "new" | "used";

/**
 * May this capability be bought for this vehicle type, and on what trigger.
 *
 * "optional" is NOT "yes": an optional capability is bought only when a
 * tenant policy names it, which is how new vehicles stay off the used-car
 * endpoints by default (§19) without the registry having to know every
 * tenant.
 */
export interface CapabilityPolicy {
  key: string;
  allowed: boolean;
  requiresTenantOptIn: boolean;
  triggers: CapabilityTrigger[];
  ttlHours: number | null;
  reasons: string[];
}

export function policyFor(key: string, vehicleType: VehicleType): CapabilityPolicy {
  const c = BY_KEY.get(key);
  if (!c) return { key, allowed: false, requiresTenantOptIn: false, triggers: [], ttlHours: null, reasons: ["unknown_capability"] };
  const reasons: string[] = [];
  const applies = c.appliesTo[vehicleType];
  if (c.status === "retired") reasons.push("retired");
  if (c.status === "autocurb_reserved") reasons.push("autocurb_reserved");
  if (c.status === "not_active") reasons.push("not_active");
  if (c.status === "entitlement_blocked") reasons.push("entitlement_blocked");
  if (applies === "no") reasons.push(`not_for_${vehicleType}`);
  if (c.triggers.includes("never")) reasons.push("never_triggered");
  const allowed = reasons.length === 0 || (reasons.length === 1 && reasons[0] === "entitlement_blocked");
  return {
    key,
    allowed: allowed && applies !== "no",
    requiresTenantOptIn: applies === "optional" || applies === "test",
    triggers: c.triggers,
    ttlHours: applies === "first_seen" ? null : c.ttlHours,
    reasons,
  };
}

/** Public Passport browsing may never cause a paid provider call. Always false. */
export const publicBrowseMayTrigger = (_key: string): false => false;

/** Capabilities that may be bought for a vehicle type without a tenant opt-in. */
export function routineCapabilities(vehicleType: VehicleType): string[] {
  return PROVIDER_CAPABILITIES
    .filter((c) => {
      const p = policyFor(c.key, vehicleType);
      return p.allowed && !p.requiresTenantOptIn && !p.reasons.includes("entitlement_blocked");
    })
    .map((c) => c.key);
}
