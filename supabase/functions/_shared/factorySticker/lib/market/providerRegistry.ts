// GENERATED — do not edit.
// Mirror of src/lib/market/providerRegistry.ts, copied so the edge runtime can
// bundle the engine (Supabase ships only supabase/functions/). Edit the
// source file and run `bun run sync:edge-sticker`.
// ── The provider contract registry ─────────────────────────────────────────
//
// One place that says, for every MarketCheck capability this product touches:
// which endpoint, what it bills under, which vehicles it applies to, what may
// trigger it, how long an answer is good for, what the call may cost, what the
// account must be entitled to, which conclusions it may influence, and whether
// a customer page may ever cause it.
//
// Until now every edge function decided those things for itself. The sweep
// re-bought the lot twice a day because nothing said "once a day"; the comps
// route can buy a page from an anonymous browser because nothing said "never
// from a public page"; the incentives cron fires nightly into an env gate
// because nothing said "off". This module is the statement. It is pure and
// performs no I/O: an edge function consults it, it does not call anything.
//
// Costs here are DEFAULTS, mirrored from the list in mcCost.ts, and every
// consumer resolves them through `effectiveCost` with the tenant's configured
// overrides first. A business rule that reads the literal is the defect §23
// names; the test suite forbids it. The 2026-10-27 change order revised
// several of them (MDS, Sales Stats, recents down; MarketMatch, auction, FSBO,
// VINData generate and Available Options Packages newly priced).
//
// Contract status is explicit. `documented` means the path is what the
// 2026-10-21 handoff reference documents; `unlocated` means the capability is
// named by the owner's change order but its path has not been read from the
// docs; `legacy` is a path the code still calls that the current contract has
// replaced; `verified` is reserved for a path checked against the live
// OpenAPI document, which this environment cannot reach. Nothing in this file
// is verified yet, and the registry says so rather than implying it.
//
// On 2026-10-27 the owner connected the provider's MCP server, whose tool
// schemas are provider-authored and readable from this environment.
// `contractSource` records which entries were reconciled against them:
// parameter names, required fields, defaults, constraints and, for the Sold
// Vehicles Summary, the path itself. A schema is not a 2xx from this account,
// so `contract` stays `documented` and nothing becomes `verified`.
//
// Influence is declared per capability so the scoring rule (§13 of the change
// order) is executable: market strength, dealer-group behaviour and demand
// may inform Market Context and Market Value, and may never move Vehicle
// Score. The test suite holds every market-evidence, acquisition and
// offer-context capability to `vehicleScore: false`.

export type ProviderName = "marketcheck" | "blackbook";

export type VehicleApplicability = "yes" | "no" | "optional" | "first_seen" | "test";

export type CapabilityStatus =
  | "active"
  | "shadow"
  | "entitlement_blocked"
  | "autocurb_reserved"
  | "not_active"
  | "not_useful"
  | "deprecated_replaced";

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

export type ContractStatus = "documented" | "verified" | "legacy" | "unlocated";

/** Where an entry's contract facts were read. */
export type ContractSource =
  | "handoff-2026-10-21"
  | "mcp-schema-2026-10-27"
  | "owner-change-order-2026-10-27"
  | "code";

/** What a request must or must always carry, and what the provider constrains, as the schema states it. */
export interface RequestContract {
  required: string[];
  /** Parameters whose omission the provider fills with a default that would describe a different car or market. */
  alwaysSend: string[];
  constraints: string[];
}

export type CapabilityOwnership = "autolabels" | "autocurb" | "shared";

/** Which server-side conclusions a capability's evidence may reach. */
export interface CapabilityInfluence {
  identity: boolean;
  vehicleScore: boolean;
  dataConfidence: boolean;
  marketValue: boolean;
  marketValueConfidence: boolean;
  dealRating: boolean;
  buyerRecommendation: boolean;
  marketContext: boolean;
}

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
  /** Where this entry's contract facts were read. The MCP schema settles names and constraints, never entitlement. */
  contractSource: ContractSource;
  /** Where the current contract is documented. */
  reference: string | null;
  appliesTo: { new: VehicleApplicability; used: VehicleApplicability; autocurb: VehicleApplicability };
  ownership: CapabilityOwnership;
  status: CapabilityStatus;
  /** What is allowed to cause a paid call. `never` means the registry forbids it. */
  triggers: CapabilityTrigger[];
  /** Whether the capability belongs to intake, to refresh, or to both. */
  cadence: { intake: boolean; refresh: boolean };
  /** Target freshness in hours; null when the answer is immutable or not cached. */
  ttlHours: number | null;
  /** Dimensions that make two requests the same request. */
  cacheKey: string[];
  /** Default unit cost in USD from the list table; overridable per tenant. */
  defaultCostUsd: number;
  /** What the account must hold for the call to answer. */
  entitlement: string;
  /** The request contract as the provider's schema states it, where it has been read. */
  requestContract?: RequestContract;
  /** Retries the transport may make above a reservation. Zero below it. */
  maxRetries: number;
  rateLimitStrategy: "serial" | "backoff" | "none";
  fallback: string | null;
  rawStore: string | null;
  normalizedDestinations: string[];
  authority: AuthorityClass;
  influences: CapabilityInfluence;
  /** May an anonymous Passport load ever cause this call. Always false when paid. */
  publicBrowseMayTrigger: false;
  notes: string;
}

const MC_DOCS = "https://docs.marketcheck.com/docs/api/cars";

const NONE: CapabilityInfluence = {
  identity: false, vehicleScore: false, dataConfidence: false, marketValue: false,
  marketValueConfidence: false, dealRating: false, buyerRecommendation: false, marketContext: false,
};
const influence = (over: Partial<CapabilityInfluence>): CapabilityInfluence => ({ ...NONE, ...over });

/** Market evidence reaches value, its confidence, the deal rating and context. Never the score. */
const MARKET: CapabilityInfluence = influence({ marketValue: true, marketValueConfidence: true, dealRating: true, buyerRecommendation: true, marketContext: true });
/** Liquidity, velocity and trend are context and a confidence input. Never the score. */
const CONTEXT: CapabilityInfluence = influence({ marketValueConfidence: true, marketContext: true });

export const PROVIDER_CAPABILITIES: readonly ProviderCapability[] = [
  {
    key: "syndication",
    provider: "marketcheck",
    product: "Dealer Inventory Syndication",
    path: "/v2/dealerships/inventory",
    billingProduct: "dealer_inventory_syndication",
    contract: "documented",
    contractSource: "mcp-schema-2026-10-27",
    reference: `${MC_DOCS}/inventory/introduction`,
    appliesTo: { new: "yes", used: "yes", autocurb: "optional" },
    ownership: "shared",
    status: "active",
    triggers: ["scheduled", "operator"],
    cadence: { intake: true, refresh: true },
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
    influences: influence({ identity: true, dataConfidence: true }),
    publicBrowseMayTrigger: false,
    requestContract: {
      required: ["one dealer identifier: dealer_id, source, mc_website_id, mc_dealer_id, mc_location_id, mc_rooftop_id or a dealership-group id"],
      alwaysSend: ["owned=true for the physically owned segment", "rows (default and maximum 1,500)"],
      constraints: ["any dealer identifier on the active search is routed to this product by the provider", "include_non_vin_listings=false keeps VIN-less rows out"],
    },
    notes: "A refusal must be reported as a refusal and may never retire inventory. Carries fees, price_includes_fees, vehicle_status, in_transit and the dealership-group ids. MCP schema: any dealer identifier on the active search routes here; rows up to 1,500 a page.",
  },
  {
    key: "dealership_directory",
    provider: "marketcheck",
    product: "Dealership Directory",
    path: "/v2/dealerships/car",
    billingProduct: "dealer_api",
    contract: "documented",
    contractSource: "mcp-schema-2026-10-27",
    reference: `${MC_DOCS}/inventory/introduction`,
    appliesTo: { new: "yes", used: "yes", autocurb: "optional" },
    ownership: "shared",
    status: "active",
    triggers: ["operator"],
    cadence: { intake: true, refresh: false },
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
    influences: influence({ marketContext: true }),
    publicBrowseMayTrigger: false,
    requestContract: {
      required: ["country"],
      alwaysSend: [],
      constraints: ["geospatial: latitude and longitude or zip, plus radius up to 7,000 miles", "rows default 10, max 50; start * rows at most 10,000", "facets on city, state, country, dealer_type, mc_* ids, mc_category, mc_dealership_group_id/name, mc_sub_dealership_group_id/name"],
    },
    notes: "Resolves a rooftop once to its canonical mc_* ids; the pin is re-validated from the feed, not re-resolved. MCP schema: group-aware (mc_dealership_group_id/name, sub-group ids) and recommended over the legacy dealers search.",
  },
  {
    key: "dealership_groups_reference",
    provider: "marketcheck",
    product: "Dealership Groups reference",
    path: "/v2/dealerships/car",
    billingProduct: "dealer_api",
    contract: "documented",
    contractSource: "mcp-schema-2026-10-27",
    reference: `${MC_DOCS}/inventory/introduction`,
    appliesTo: { new: "optional", used: "optional", autocurb: "yes" },
    ownership: "shared",
    status: "not_active",
    triggers: ["operator", "scheduled"],
    cadence: { intake: false, refresh: true },
    ttlHours: 24 * 30,
    cacheKey: ["facets", "mc_dealership_group_id"],
    defaultCostUsd: 0.0025,
    entitlement: "dealer_api",
    maxRetries: 0,
    rateLimitStrategy: "none",
    fallback: "syndication mc_dealership.* ids",
    rawStore: "dealership_groups",
    normalizedDestinations: ["dealership_groups"],
    authority: "inventory_state",
    influences: influence({ marketContext: true }),
    publicBrowseMayTrigger: false,
    requestContract: {
      required: ["country"],
      alwaysSend: ["facets=mc_dealership_group_id,mc_dealership_group_name,mc_sub_dealership_group_id,mc_sub_dealership_group_name"],
      constraints: ["no separate groups path exists: the reference is the directory's group facets, filtered by mc_dealership_group_name to list a group's rooftops"],
    },
    notes: "Resolved against the MCP schema on 2026-10-27: there is no separate groups endpoint; the dealership directory's facets on the group and sub-group ids and names are the reference, and get_sold_summary takes mc_dealership_group_name from it. The feed's mc_dealership_group_id / _name already give an authoritative identity per listing.",
  },
  {
    key: "dealers_search_legacy",
    provider: "marketcheck",
    product: "Dealers Search (legacy id space)",
    path: "/v2/dealers/car",
    billingProduct: "dealer_api",
    contract: "legacy",
    contractSource: "mcp-schema-2026-10-27",
    reference: null,
    appliesTo: { new: "optional", used: "optional", autocurb: "optional" },
    ownership: "shared",
    status: "active",
    triggers: ["operator"],
    cadence: { intake: true, refresh: false },
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
    influences: NONE,
    publicBrowseMayTrigger: false,
    notes: "Geography-only search whose ids collide with other rooftops in the syndication id space; kept for the manual dealer_id override only. The provider's MCP schema says this endpoint is being phased out; listing_count_range is the one filter the directory lacks.",
  },
  {
    key: "dealer_details_legacy",
    provider: "marketcheck",
    product: "Dealer details (legacy)",
    path: "/v2/dealer/car",
    billingProduct: "dealer_api",
    contract: "legacy",
    contractSource: "code",
    reference: null,
    appliesTo: { new: "optional", used: "optional", autocurb: "optional" },
    ownership: "shared",
    status: "active",
    triggers: ["operator"],
    cadence: { intake: true, refresh: false },
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
    influences: NONE,
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
    contractSource: "mcp-schema-2026-10-27",
    reference: `${MC_DOCS}/inventory/introduction`,
    appliesTo: { new: "yes", used: "yes", autocurb: "optional" },
    ownership: "shared",
    status: "active",
    triggers: ["intake", "scheduled", "material_event", "operator"],
    cadence: { intake: true, refresh: true },
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
    influences: MARKET,
    publicBrowseMayTrigger: false,
    requestContract: {
      required: [],
      alwaysSend: ["car_type", "zip and radius for a market-bounded cohort"],
      constraints: ["vins at most 10 per request", "taxonomy_vins, ymmt and match address a cohort by build", "dos_active is days on site at the current dealer; dom_active is cumulative days across dealers", "options_packages and high_value_features filter only with values discovered through facets", "include_mc_dealership_object carries mc_dealership_group_id/name, mc_sub_dealership_group_id/name, mc_category and mc_rooftop_id", "seller_type is dealer, fsbo or auction; AutoLabels sends dealer only", "any dealer identifier routes the call to Dealer Inventory Syndication", "carfax_* fields are incomplete and not filters, facets or stats"],
    },
    notes: "Active-market comparables and cross-channel listing intelligence. fees and price_includes_fees on each row feed the comparable basis. One cohort informs many vehicles. MCP schema read 2026-10-27: 80+ filters, the dos_active / dom_active distinction, price_change and in_transit filters.",
  },
  {
    key: "recents",
    provider: "marketcheck",
    product: "Past Inventory Search (recents)",
    path: "/v2/search/car/recents",
    billingProduct: "recent_inventory",
    contract: "documented",
    contractSource: "mcp-schema-2026-10-27",
    reference: `${MC_DOCS}/inventory/introduction`,
    appliesTo: { new: "optional", used: "yes", autocurb: "yes" },
    ownership: "shared",
    status: "active",
    triggers: ["scheduled", "operator"],
    cadence: { intake: false, refresh: true },
    ttlHours: 24 * 30,
    cacheKey: ["cohort", "state", "window"],
    defaultCostUsd: 0.0025,
    entitlement: "recent_inventory",
    maxRetries: 2,
    rateLimitStrategy: "serial",
    fallback: null,
    rawStore: null,
    normalizedDestinations: ["market_meta.sold_stats"],
    authority: "market_evidence",
    influences: CONTEXT,
    publicBrowseMayTrigger: false,
    requestContract: {
      required: ["one of: city, state, zip, latitude+longitude+radius, source, dealer_id"],
      alwaysSend: [],
      constraints: ["radius at most 100 miles", "facets, stats and range_facets cannot be combined in one call", "charged at a higher rate than the active search", "expired is a VIN-level filter; sold=true selects sold listings", "a VIN can carry several listing ids; the id changes with price or miles", "carfax_* fields are incomplete and not filters, facets or stats"],
    },
    notes: "Listing-level recent market exits and supporting evidence (expired, inferred sold, owned, date windows, stats, facets where supported). Not the primary aggregate: that is Sales Stats; trend is Sold Vehicles Summary. Medians only leave the function. Constraints per the MCP schema read 2026-10-27.",
  },
  {
    key: "neovin",
    provider: "marketcheck",
    product: "NeoVIN decode",
    path: "/v2/decode/car/neovin/{vin}/specs",
    billingProduct: "neovin",
    contract: "documented",
    contractSource: "mcp-schema-2026-10-27",
    reference: `${MC_DOCS}/vehicle-specs/neovin`,
    appliesTo: { new: "first_seen", used: "first_seen", autocurb: "optional" },
    ownership: "shared",
    status: "active",
    triggers: ["intake", "operator"],
    cadence: { intake: true, refresh: false },
    ttlHours: null,
    cacheKey: ["vin"],
    defaultCostUsd: 0.08,
    entitlement: "neovin",
    maxRetries: 0,
    rateLimitStrategy: "serial",
    fallback: "basic_decode",
    rawStore: "neovin_snapshots",
    normalizedDestinations: ["mc_attributes.build_sheet", "mc_attributes.base_msrp", "mc_attributes.factory_warranty", "mc_attributes.neovin_confidence", "vehicle_facts"],
    authority: "factory_build",
    influences: influence({ identity: true, vehicleScore: true, dataConfidence: true, marketValue: true }),
    publicBrowseMayTrigger: false,
    requestContract: {
      required: ["vin"],
      alwaysSend: [],
      constraints: ["include_generic=true is the generic switch; sent only on the second, fallback request, and its answer is GENERIC_CANDIDATE identity, never exact"],
    },
    notes: "Immutable; never rebought once a real sheet exists. Three attempts, strict first, refusals uncounted. The preferred source for installed equipment. The MCP schema names the generic switch include_generic, which marketcheck-specs already sends on its fallback call.",
  },
  {
    key: "basic_decode",
    provider: "marketcheck",
    product: "Basic VIN decode",
    path: "/v2/decode/car/{vin}/specs",
    billingProduct: "basic_vin_decode",
    contract: "documented",
    contractSource: "handoff-2026-10-21",
    reference: `${MC_DOCS}/vehicle-specs/neovin`,
    appliesTo: { new: "optional", used: "optional", autocurb: "optional" },
    ownership: "shared",
    status: "active",
    triggers: ["intake"],
    cadence: { intake: true, refresh: false },
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
    influences: influence({ identity: true, dataConfidence: true }),
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
    contractSource: "handoff-2026-10-21",
    reference: `${MC_DOCS}/vehicle-specs/neovin`,
    appliesTo: { new: "optional", used: "optional", autocurb: "optional" },
    ownership: "shared",
    status: "active",
    triggers: ["intake"],
    cadence: { intake: true, refresh: false },
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
    influences: influence({ identity: true, dataConfidence: true }),
    publicBrowseMayTrigger: false,
    notes: "Last decode fallback; core specs only.",
  },
  {
    key: "available_options_packages",
    provider: "marketcheck",
    product: "Available Options Packages",
    path: "/v2/options/packages",
    billingProduct: "available_options_packages",
    contract: "unlocated",
    contractSource: "owner-change-order-2026-10-27",
    reference: `${MC_DOCS}/vehicle-specs/neovin`,
    appliesTo: { new: "optional", used: "optional", autocurb: "no" },
    ownership: "autolabels",
    status: "not_active",
    triggers: ["intake", "operator"],
    cadence: { intake: true, refresh: false },
    ttlHours: 24 * 90,
    cacheKey: ["year", "make", "model", "trim"],
    defaultCostUsd: 0.002,
    entitlement: "available_options_packages",
    maxRetries: 0,
    rateLimitStrategy: "none",
    fallback: null,
    rawStore: "available_options_catalog",
    normalizedDestinations: ["equipment.factory_available_options"],
    authority: "factory_build",
    influences: influence({ marketContext: true }),
    publicBrowseMayTrigger: false,
    notes: "Named by the 2026-10-27 change order; path not yet read from the docs. AVAILABLE is never INSTALLED: this feeds configuration comparison, package explanation and missing-build investigation, and may never verify equipment on the subject VIN.",
  },
  {
    key: "price_base",
    provider: "marketcheck",
    product: "MarketCheck Price (Base)",
    path: "/v2/predict/car/us/marketcheck_price",
    billingProduct: "price_prediction",
    contract: "documented",
    contractSource: "handoff-2026-10-21",
    reference: `${MC_DOCS}/market-insights/marketcheck-price`,
    appliesTo: { new: "optional", used: "yes", autocurb: "optional" },
    ownership: "shared",
    status: "shadow",
    triggers: ["valuation_writer"],
    cadence: { intake: true, refresh: true },
    ttlHours: 24 * 7,
    cacheKey: ["vin", "miles", "dealer_type", "is_certified", "zip", "fallback_to_generic"],
    defaultCostUsd: 0.07,
    entitlement: "price_prediction",
    maxRetries: 0,
    rateLimitStrategy: "none",
    fallback: null,
    rawStore: "vehicle_market_valuations",
    normalizedDestinations: ["vehicle_market_valuations.provider_prediction", "market_payload.provider_valuation"],
    authority: "market_evidence",
    influences: MARKET,
    publicBrowseMayTrigger: false,
    notes: "Reserved under the tenant budget; one live reservation per request fingerprint; is_certified always sent. fallback_to_generic is a separate request (different fingerprint) and its answer is a GENERIC_CANDIDATE identity, never exact.",
  },
  {
    key: "price_premium",
    provider: "marketcheck",
    product: "MarketCheck Price (Premium, comparables)",
    path: "/v2/predict/car/us/marketcheck_price/comparables",
    billingProduct: "price_prediction",
    contract: "documented",
    contractSource: "mcp-schema-2026-10-27",
    reference: `${MC_DOCS}/market-insights/marketcheck-price`,
    appliesTo: { new: "optional", used: "yes", autocurb: "optional" },
    ownership: "shared",
    status: "entitlement_blocked",
    triggers: ["valuation_writer"],
    cadence: { intake: false, refresh: true },
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
    influences: MARKET,
    publicBrowseMayTrigger: false,
    requestContract: {
      required: ["vin"],
      alwaysSend: ["miles", "zip", "dealer_type", "is_certified"],
      constraints: ["schema defaults when omitted: miles 50,000, zip 50501, dealer_type franchise, is_certified false; a request that omits them prices a different car in a different market", "city and state are optional when zip is sent"],
    },
    notes: "The Premium Comparables tier: prediction plus the comparable set. Untested on this account; cost is the Base placeholder until one authorized call reports it. The used REFRESH tier once the build is cached. Every call sends and the envelope records miles, zip, dealer_type and is_certified, because the provider's defaults would silently describe another car.",
  },
  {
    key: "price_premium_plus",
    provider: "marketcheck",
    product: "MarketCheck Price (Premium Plus)",
    path: "/v2/predict/car/us/marketcheck_price/comparables/decode",
    billingProduct: "price_prediction",
    contract: "documented",
    contractSource: "handoff-2026-10-21",
    reference: `${MC_DOCS}/market-insights/marketcheck-price`,
    appliesTo: { new: "test", used: "yes", autocurb: "optional" },
    ownership: "shared",
    status: "entitlement_blocked",
    triggers: ["intake"],
    cadence: { intake: true, refresh: false },
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
    influences: influence({ ...MARKET, identity: true, dataConfidence: true }),
    publicBrowseMayTrigger: false,
    notes: "Used-intake candidate: prediction + comparables + NeoVIN in one call. The decode half is immutable and cached; the market half expires. Records provider tier, match tier, comp count, decode source and both checked_at stamps.",
  },
  {
    key: "vin_history",
    provider: "marketcheck",
    product: "History by VIN",
    path: "/v2/history/car/{vin}",
    billingProduct: "vin_history",
    contract: "documented",
    contractSource: "mcp-schema-2026-10-27",
    reference: `${MC_DOCS}/inventory/introduction`,
    appliesTo: { new: "no", used: "yes", autocurb: "yes" },
    ownership: "shared",
    status: "active",
    triggers: ["intake", "material_event", "operator"],
    cadence: { intake: true, refresh: true },
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
    influences: influence({ vehicleScore: true, dataConfidence: true, buyerRecommendation: true, marketContext: true }),
    publicBrowseMayTrigger: false,
    requestContract: {
      required: ["vin"],
      alwaysSend: [],
      constraints: ["fields, page and sort_order are the only other parameters; episodes come newest first by default"],
    },
    notes: "Mileage chronology and prior exposure feed Vehicle Integrity and the odometer hard gate. Never an owner count, never an accident history. Not routine for new vehicles. Parameters per the MCP schema read 2026-10-27.",
  },
  {
    key: "mds",
    provider: "marketcheck",
    product: "Market Days Supply",
    path: "/v2/mds/car",
    billingProduct: "market_days_supply",
    contract: "documented",
    contractSource: "handoff-2026-10-21",
    reference: `${MC_DOCS}/market-insights/market-days-supply`,
    appliesTo: { new: "optional", used: "yes", autocurb: "yes" },
    ownership: "shared",
    status: "active",
    triggers: ["intake", "scheduled", "material_event", "operator"],
    cadence: { intake: true, refresh: true },
    ttlHours: 24 * 7,
    cacheKey: ["match_level", "vin_or_ymmt", "zip", "radius", "car_type"],
    defaultCostUsd: 0.002,
    entitlement: "market_days_supply",
    maxRetries: 2,
    rateLimitStrategy: "serial",
    fallback: "ymmt_then_ymm_then_model_then_national",
    rawStore: null,
    normalizedDestinations: ["market_meta.market_days_supply", "market_meta.mds_match_level", "market_meta.inventory_count"],
    authority: "market_evidence",
    influences: CONTEXT,
    publicBrowseMayTrigger: false,
    notes: "Cohort order: vin exact=true, YMMT local, YMM local, model local, national; match_level, geography, sample size and checked_at recorded. Liquidity and holding-risk context, never quality. Refresh aligns to the provider's regeneration, not to the lower price.",
  },
  {
    key: "sales_stats",
    provider: "marketcheck",
    product: "Inferred Sales Stats",
    path: "/v2/sales/car",
    billingProduct: "sales_stats",
    contract: "documented",
    contractSource: "handoff-2026-10-21",
    reference: `${MC_DOCS}/market-insights/inferred-sales-stats`,
    appliesTo: { new: "optional", used: "yes", autocurb: "yes" },
    ownership: "shared",
    status: "active",
    triggers: ["intake", "scheduled", "operator"],
    cadence: { intake: true, refresh: true },
    ttlHours: 24 * 30,
    cacheKey: ["match_level", "cohort", "geography", "period"],
    defaultCostUsd: 0.002,
    entitlement: "sales_stats",
    maxRetries: 2,
    rateLimitStrategy: "serial",
    fallback: "recents",
    rawStore: null,
    normalizedDestinations: ["market_meta.sold_stats"],
    authority: "market_evidence",
    influences: CONTEXT,
    publicBrowseMayTrigger: false,
    notes: "The primary velocity source: inferred sold count, price, mileage, DOM/DOS statistics, CPO split, match tier, geography, period. Provider regenerates monthly; buying it nightly buys the same number. Sold is inferred from inventory disappearance, never a transaction price.",
  },
  {
    key: "sold_summary",
    provider: "marketcheck",
    product: "Sold Vehicles Summary",
    path: "/v2/sold-vehicles/summary",
    billingProduct: "sales_stats",
    contract: "documented",
    contractSource: "mcp-schema-2026-10-27",
    reference: `${MC_DOCS}/market-insights/sold-vehicles-summary`,
    appliesTo: { new: "optional", used: "yes", autocurb: "yes" },
    ownership: "shared",
    status: "entitlement_blocked",
    triggers: ["scheduled"],
    cadence: { intake: false, refresh: true },
    ttlHours: 24 * 30,
    cacheKey: ["inventory_type", "summary_by", "geography", "cohort_filters", "ranking", "date_from", "date_to"],
    defaultCostUsd: 0.002,
    entitlement: "sold_vehicles_summary",
    maxRetries: 2,
    rateLimitStrategy: "serial",
    fallback: null,
    rawStore: "market_trend_evidence",
    normalizedDestinations: ["market_meta.trend"],
    authority: "market_evidence",
    influences: CONTEXT,
    publicBrowseMayTrigger: false,
    requestContract: {
      required: ["inventory_type: new, used, certified or all"],
      alwaysSend: ["date_from and date_to together, or neither for the last complete month"],
      constraints: ["dates are month-aligned (first day to last day) and at most a year apart", "summary_by is national, state or city_state; per-state rankings must never be summed", "dealership_group_name is exact and comes from the dealership directory", "source is a rooftop inventory_url; comma lists allowed", "ranking_dimensions, ranking_measure, ranking_order, top_n, limit, measure filters and rank_after_filters shape the answer", "response carries result_count, truncated, warnings and applied (the defaults and window actually used)", "sales are inferred and prices are advertised asking prices, never transaction prices", "the service scales to zero: the first call after idle can take about nine seconds", "history starts January 2021 and runs through the last complete month; US franchise and independent dealers only; no auction, private-party, UK or Canada data", "no ZIP or metro filter: geography is summary_by plus state and city lists", "ranking_dimensions may be year, make, model, trim, body_type, body_subtype, drivetrain, transmission, powertrain_type, fuel_type_category, base colours, msrp_label, dealership_group_name, source or inventory_type; state is never a dimension", "top_n is rows kept per group per month and geography, not per response; limit caps the response at 1 to 20,000", "measure filters apply after rank and top_n unless rank_after_filters=true", "enterprise-gated per the provider's server info"],
    },
    notes: "Market trend and direction over 3 / 6 / 12 months: inferred sold volume, price, mileage, DOM/DOS statistics and percentiles, CPO segmentation, drivetrain, powertrain, colours, make/model/trim/version, geography, MSRP dimensions. Requested filters, provider-applied filters, warnings, notices and population size are stored verbatim. Path and parameter contract from the MCP schema read 2026-10-27 (the server also lists it as /v2/sold/summary); still untested from this account.",
  },
  {
    key: "sold_summary_dealership_groups",
    provider: "marketcheck",
    product: "Sold Vehicles Summary by dealership group",
    path: "/v2/sold-vehicles/summary",
    billingProduct: "sales_stats",
    contract: "documented",
    contractSource: "mcp-schema-2026-10-27",
    reference: `${MC_DOCS}/market-insights/sold-vehicles-summary`,
    appliesTo: { new: "optional", used: "optional", autocurb: "yes" },
    ownership: "shared",
    status: "not_active",
    triggers: ["scheduled"],
    cadence: { intake: false, refresh: true },
    ttlHours: 24 * 30,
    cacheKey: ["inventory_type", "summary_by", "geography", "dealership_group_name", "ranking", "date_from", "date_to"],
    defaultCostUsd: 0.002,
    entitlement: "sold_vehicles_summary",
    requestContract: {
      required: ["inventory_type: new, used, certified or all"],
      alwaysSend: ["ranking_dimensions including dealership_group_name, or dealership_group_name as an exact filter"],
      constraints: ["the same endpoint as sold_summary: the group is a ranking dimension or an exact filter, never a separate path", "dealership_group_name must be the directory's mc_dealership_group_name; an unknown name is a 422; a name containing a comma is sent alone", "only about 38% of inferred sales carry a group, so a group ranking leaves the rest out", "a single rooftop is addressed by source=inventory_url instead"],
    },
    maxRetries: 2,
    rateLimitStrategy: "serial",
    fallback: null,
    rawStore: "market_trend_evidence",
    normalizedDestinations: ["dealership_group_context"],
    authority: "market_evidence",
    influences: CONTEXT,
    publicBrowseMayTrigger: false,
    notes: "Dealer-group velocity and stocking comparison for management analytics and future AutoCurb fit. Resolved against the MCP schema on 2026-10-27: the same Sold Vehicles Summary endpoint with dealership_group_name as a ranking dimension or exact filter. May never inflate or reduce Vehicle Score.",
  },
  {
    key: "vindata_access",
    provider: "marketcheck",
    product: "VINData NMVTIS access report",
    path: "/v2/vindata/access-report/aamva/{vin}",
    billingProduct: "vindata_access",
    contract: "documented",
    contractSource: "handoff-2026-10-21",
    reference: `${MC_DOCS}/third-party/vindata`,
    appliesTo: { new: "no", used: "yes", autocurb: "yes" },
    ownership: "shared",
    status: "active",
    triggers: ["operator", "material_event"],
    cadence: { intake: true, refresh: true },
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
    influences: influence({ vehicleScore: true, dataConfidence: true, buyerRecommendation: true }),
    publicBrowseMayTrigger: false,
    notes: "Access first; the provider keeps a generated report 90 days. Terms: no persistence beyond a session. Not priced separately in the change order; recorded as unpriced.",
  },
  {
    key: "vindata_generate",
    provider: "marketcheck",
    product: "VINData NMVTIS generate report",
    path: "/v2/vindata/generate-report/aamva/{vin}",
    billingProduct: "vindata_generate",
    contract: "documented",
    contractSource: "handoff-2026-10-21",
    reference: `${MC_DOCS}/third-party/vindata`,
    appliesTo: { new: "no", used: "yes", autocurb: "yes" },
    ownership: "shared",
    status: "active",
    triggers: ["operator"],
    cadence: { intake: true, refresh: false },
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
    influences: influence({ vehicleScore: true, dataConfidence: true, buyerRecommendation: true }),
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
    contractSource: "handoff-2026-10-21",
    reference: `${MC_DOCS}/third-party/autorecalls`,
    appliesTo: { new: "yes", used: "yes", autocurb: "yes" },
    ownership: "shared",
    status: "entitlement_blocked",
    triggers: ["intake", "scheduled", "material_event", "operator"],
    cadence: { intake: true, refresh: true },
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
    influences: influence({ vehicleScore: true, dataConfidence: true, buyerRecommendation: true }),
    publicBrowseMayTrigger: false,
    notes: "Only a VIN answer can clear a VIN. The legacy /v2/recall/car/{vin} family is replaced by this entry.",
  },
  {
    key: "autorecalls_legacy",
    provider: "marketcheck",
    product: "AutoRecalls (legacy path)",
    path: "/v2/recall/car/{vin}",
    billingProduct: "auto_recalls",
    contract: "legacy",
    contractSource: "code",
    reference: null,
    appliesTo: { new: "no", used: "no", autocurb: "no" },
    ownership: "shared",
    status: "deprecated_replaced",
    triggers: ["never"],
    cadence: { intake: false, refresh: false },
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
    influences: NONE,
    publicBrowseMayTrigger: false,
    notes: "Still called by marketcheck-recalls and vehicle-enrich; answered 404 or empty on every variant. Replaced by /v2/car/autorecalls/{vin}.",
  },
  {
    key: "incentives_oem",
    provider: "marketcheck",
    product: "OEM incentives (search)",
    path: "/v2/search/car/incentive/oem",
    billingProduct: "oem_incentive",
    contract: "documented",
    contractSource: "mcp-schema-2026-10-27",
    reference: `${MC_DOCS}/incentives/incentive-search-api`,
    appliesTo: { new: "yes", used: "no", autocurb: "no" },
    ownership: "autolabels",
    status: "not_active",
    triggers: ["scheduled"],
    cadence: { intake: false, refresh: true },
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
    influences: NONE,
    publicBrowseMayTrigger: false,
    requestContract: {
      required: ["country"],
      alwaysSend: [],
      constraints: ["rows at most 10 per request; start up to 10,000", "msa_code is the market dimension; radius default 50", "facets and stats on monthly, apr, cashback_amount"],
    },
    notes: "Owner-disabled 2026-07-28. Cache by program and market, never per VIN. Offer context for the New Passport, never a Vehicle Score input. Parameters per the MCP schema read 2026-10-27.",
  },
  {
    key: "incentives_make_zip",
    provider: "marketcheck",
    product: "OEM incentives by make and ZIP",
    path: "/v2/search/car/incentive/{make}/{zip}",
    billingProduct: "oem_incentive",
    contract: "documented",
    contractSource: "mcp-schema-2026-10-27",
    reference: `${MC_DOCS}/incentives/incentive-search-api`,
    appliesTo: { new: "yes", used: "no", autocurb: "no" },
    ownership: "autolabels",
    status: "entitlement_blocked",
    triggers: ["scheduled"],
    cadence: { intake: false, refresh: true },
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
    influences: NONE,
    publicBrowseMayTrigger: false,
    requestContract: {
      required: ["oem", "zip"],
      alwaysSend: [],
      constraints: ["the provider converts the ZIP to an MSA for regional relevance", "rows at most 10 per request"],
    },
    notes: "Preferred cache dimension once incentives return. MCP schema: OEM identifier plus a five-character ZIP, converted to an MSA by the provider.",
  },
  {
    key: "cached_images",
    provider: "marketcheck",
    product: "Cached images",
    path: "/v2/image/cache/car/{id}",
    billingProduct: "cached_images",
    contract: "documented",
    contractSource: "handoff-2026-10-21",
    reference: `${MC_DOCS}/inventory/introduction`,
    appliesTo: { new: "optional", used: "optional", autocurb: "no" },
    ownership: "autolabels",
    status: "active",
    triggers: ["never"],
    cadence: { intake: false, refresh: false },
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
    influences: NONE,
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
    contractSource: "handoff-2026-10-21",
    reference: `${MC_DOCS}/inventory/introduction`,
    appliesTo: { new: "optional", used: "optional", autocurb: "optional" },
    ownership: "shared",
    status: "not_active",
    triggers: ["operator"],
    cadence: { intake: true, refresh: false },
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
    influences: influence({ identity: true, dataConfidence: true }),
    publicBrowseMayTrigger: false,
    notes: "mc_listing_id is captured for it; the only source of per-listing options and seller comments when the feed omits them.",
  },
  {
    key: "fsbo",
    provider: "marketcheck",
    product: "Private-party active inventory",
    path: "/v2/search/car/fsbo/active",
    billingProduct: "fsbo",
    contract: "documented",
    contractSource: "handoff-2026-10-21",
    reference: `${MC_DOCS}/inventory/introduction`,
    appliesTo: { new: "no", used: "no", autocurb: "yes" },
    ownership: "autocurb",
    status: "autocurb_reserved",
    triggers: ["never"],
    cadence: { intake: false, refresh: false },
    ttlHours: 24,
    cacheKey: ["cohort", "zip"],
    defaultCostUsd: 0.01,
    entitlement: "fsbo",
    maxRetries: 0,
    rateLimitStrategy: "none",
    fallback: null,
    rawStore: null,
    normalizedDestinations: [],
    authority: "acquisition",
    influences: NONE,
    publicBrowseMayTrigger: false,
    requestContract: {
      required: [],
      alwaysSend: [],
      constraints: ["the provider's MCP exposes private-party inventory as seller_type=fsbo on the active search; the documented REST surface keeps this separate path. Both forms are AutoCurb-reserved and refused by policyFor for AutoLabels vehicles"],
    },
    notes: "Acquisition context only; never a Vehicle Score input. seller_type=fsbo on the active search is the same product in the MCP.",
  },
  {
    key: "auction",
    provider: "marketcheck",
    product: "Auction active inventory",
    path: "/v2/search/car/auction/active",
    billingProduct: "auction",
    contract: "documented",
    contractSource: "handoff-2026-10-21",
    reference: `${MC_DOCS}/inventory/auction-search`,
    appliesTo: { new: "no", used: "no", autocurb: "yes" },
    ownership: "autocurb",
    status: "autocurb_reserved",
    triggers: ["never"],
    cadence: { intake: false, refresh: false },
    ttlHours: 24,
    cacheKey: ["cohort", "zip"],
    defaultCostUsd: 0.008,
    entitlement: "auction",
    maxRetries: 0,
    rateLimitStrategy: "none",
    fallback: null,
    rawStore: null,
    normalizedDestinations: [],
    authority: "acquisition",
    influences: NONE,
    publicBrowseMayTrigger: false,
    requestContract: {
      required: [],
      alwaysSend: [],
      constraints: ["the provider's MCP exposes auction inventory as seller_type=auction on the active search; the documented REST surface keeps this separate path. Both forms are AutoCurb-reserved and refused by policyFor for AutoLabels vehicles"],
    },
    notes: "Wholesale context only. seller_type=auction on the active search is the same product in the MCP.",
  },
  {
    key: "marketmatch_dealers",
    provider: "marketcheck",
    product: "MarketMatch dealer rank",
    path: "/v2/marketmatch/dealers/rank",
    billingProduct: "marketmatch",
    contract: "documented",
    contractSource: "handoff-2026-10-21",
    reference: `${MC_DOCS}/market-insights/marketmatch`,
    appliesTo: { new: "no", used: "no", autocurb: "yes" },
    ownership: "autocurb",
    status: "autocurb_reserved",
    triggers: ["never"],
    cadence: { intake: false, refresh: false },
    ttlHours: 24,
    cacheKey: ["vin", "geography"],
    defaultCostUsd: 0.35,
    entitlement: "marketmatch",
    maxRetries: 0,
    rateLimitStrategy: "none",
    fallback: null,
    rawStore: null,
    normalizedDestinations: [],
    authority: "acquisition",
    influences: NONE,
    publicBrowseMayTrigger: false,
    notes: "Which dealers a vehicle fits; acquisition placement, never quality.",
  },
  {
    key: "marketmatch",
    provider: "marketcheck",
    product: "MarketMatch VIN rank",
    path: "/v2/marketmatch/vins/rank",
    billingProduct: "marketmatch",
    contract: "documented",
    contractSource: "handoff-2026-10-21",
    reference: `${MC_DOCS}/market-insights/marketmatch`,
    appliesTo: { new: "no", used: "no", autocurb: "yes" },
    ownership: "autocurb",
    status: "autocurb_reserved",
    triggers: ["never"],
    cadence: { intake: false, refresh: false },
    ttlHours: 24,
    cacheKey: ["dealer", "vins"],
    defaultCostUsd: 0.35,
    entitlement: "marketmatch",
    maxRetries: 0,
    rateLimitStrategy: "none",
    fallback: null,
    rawStore: null,
    normalizedDestinations: [],
    authority: "acquisition",
    influences: NONE,
    publicBrowseMayTrigger: false,
    notes: "Dealer/vehicle fit, not vehicle quality. 1-20 VIN candidates per dealer per synchronous request per the current docs.",
  },
  {
    key: "webhooks",
    provider: "marketcheck",
    product: "Refresh webhooks",
    path: "/webhooks/marketcheck",
    billingProduct: "unknown",
    contract: "documented",
    contractSource: "handoff-2026-10-21",
    reference: "https://docs.marketcheck.com/docs/get-started/api/webhook-integration",
    appliesTo: { new: "yes", used: "yes", autocurb: "optional" },
    ownership: "shared",
    status: "entitlement_blocked",
    triggers: ["never"],
    cadence: { intake: false, refresh: true },
    ttlHours: null,
    cacheKey: ["delivery_id"],
    defaultCostUsd: 0,
    entitlement: "webhook_portal_configuration",
    maxRetries: 0,
    rateLimitStrategy: "none",
    fallback: null,
    rawStore: "provider_webhook_events",
    normalizedDestinations: ["stale_marks"],
    authority: "inventory_state",
    influences: influence({ dataConfidence: true }),
    publicBrowseMayTrigger: false,
    notes: "Inbound, not a paid call: HMAC-SHA256 signature, timestamp replay window, delivery-id dedup; an invalidation signal that never authorises spend. Needs portal configuration by the owner.",
  },
  {
    key: "blackbook_used_vin",
    provider: "blackbook",
    product: "Black Book UsedCar VIN values",
    path: "/UsedCarWS/UsedCarVin/{vin}/{mileage}",
    billingProduct: "unknown",
    contract: "legacy",
    contractSource: "code",
    reference: null,
    appliesTo: { new: "no", used: "yes", autocurb: "yes" },
    ownership: "shared",
    status: "entitlement_blocked",
    triggers: ["intake", "scheduled"],
    cadence: { intake: true, refresh: true },
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
    influences: influence({ marketValue: true, marketValueConfidence: true }),
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
  if (c.status === "deprecated_replaced") reasons.push("deprecated_replaced");
  if (c.status === "autocurb_reserved") reasons.push("autocurb_reserved");
  if (c.status === "not_active") reasons.push("not_active");
  if (c.status === "not_useful") reasons.push("not_useful");
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

/** Authorities whose evidence describes a market or a buyer, never the vehicle's own quality. */
export const NON_SCORE_AUTHORITIES: AuthorityClass[] = ["market_evidence", "acquisition", "offer_context", "inventory_state"];

/** The executable form of the scoring rule: can this capability reach Vehicle Score. */
export const mayInfluenceVehicleScore = (key: string): boolean => {
  const c = BY_KEY.get(key);
  return !!c && c.influences.vehicleScore && !NON_SCORE_AUTHORITIES.includes(c.authority);
};
