// deno-lint-ignore-file no-explicit-any
// ──────────────────────────────────────────────────────────────────────
// Explicit public-field projection for the listing row.
//
// public-listing-view and autofilm-feed both start from `SELECT *` on
// vehicle_listings plus whatever enrichment attached. Both used to ship the row
// minus a deny list, so every new column or JSON key reached an anonymous
// shopper (or a sister app) by default: market_meta shipped price_percentile
// and comp_price_cut_*, mc_attributes shipped fee internals and ref_price, and
// a Black Book block shipped whole.
//
// Here the direction is reversed. A key leaves only if it is named below, with
// the customer surface that reads it in PUBLIC_FIELD_CONSUMERS. The market and
// provider containers are projected key by key; free-form dealer content
// (documents, features, recon, ...) is kept as authored but passes through a
// recursive scrub of dealer-only key names, so a private value stuffed into a
// nested object at any depth does not survive.
// ──────────────────────────────────────────────────────────────────────

type Bag = Record<string, unknown>;
const isBag = (v: unknown): v is Bag => v != null && typeof v === "object" && !Array.isArray(v);

/** top-level key -> the customer surface that reads it. */
export const PUBLIC_FIELD_CONSUMERS: Readonly<Record<string, string>> = {
  id: "Governed/V2Detail: listing identity, engagement events",
  store_id: "Governed: customer engagement and lead events",
  tenant_id: "Governed/V2Detail: lead capture routing",
  vin: "all passport pages: VIN binding",
  slug: "all passport pages: URL and share links",
  ymm: "all passport pages: vehicle title",
  year: "Governed: subject year when a year column is present",
  trim: "all passport pages",
  mileage: "all passport pages",
  condition: "new/used/CPO logic on every page",
  status: "listingDisposition availability",
  published_at: "listingDisposition availability",
  created_at: "PassportPanel: tracked-from-listing check",
  updated_at: "Governed: freshness of listing",
  archived_at: "listingDisposition availability",
  archive_reason: "listingDisposition availability",
  default_locale: "passport locale",
  passport_version: "VehiclePassportRoute version routing",
  effective_passport_version: "VehiclePassportRoute version routing",
  passport_resolution_reason: "VehiclePassportRoute version routing",
  governed_routing_enabled: "VehiclePassportRoute version routing",
  hero_image_url: "gallery hero",
  photos: "gallery",
  description: "Governed description card",
  features: "Features & Equipment",
  key_specs: "Specifications",
  certification: "CPO panel",
  documents: "Documents page",
  videos: "Governed video module",
  dealer_snapshot: "dealer header and contact",
  in_service_date: "Warranty card",
  factory_sticker_url: "documents page",
  oem_sticker_url: "documents page and window sticker link",
  oem_sticker_checked_at: "documents page",
  epa_economy: "Fuel Economy card",
  epa_checked_at: "Fuel Economy card",
  service_records: "service history card",
  available_accessories: "accessories card",
  warranty_info: "Warranty card",
  oem_warranty: "Warranty card",
  cpo_programs: "Warranty card",
  dealer_coverage: "Warranty card",
  recall_status: "recall projection input",
  open_recall_count: "recall projection input",
  recall_checked_at: "recall projection input",
  recall_check: "recall projection input",
  recall_payload: "recall projection input (deriveRecallView)",
  recall: "recall projection output (applyRecallProjection)",
  title_verification: "title check (scrubbed)",
  title_policy_no_branded: "title check dealer statement",
  history_report_url: "history report link",
  history_report: "history report link",
  history_payload: "History & Ownership (projected)",
  packet_modules: "packet curation",
  packet_defaults: "packet curation",
  prep_status: "prep badge",
  payment_estimate: "Today's Price payment estimate (projected)",
  payment_estimator: "payment estimator (already projected upstream)",
  payment_display: "payment display toggles",
  price: "price card",
  advertised_price_before_doc: "price card derivation",
  website_sale_price: "price card derivation",
  doc_fee: "price card derivation",
  dealer_discount: "price card derivation",
  retail_cash: "price card derivation",
  website_price_term: "price label",
  price_label: "price label",
  price_display_mode: "price card derivation",
  advertised_excludes_doc_fee: "price card derivation",
  todays_price_mode: "Today's Price page",
  todays_price_custom: "Today's Price page",
  sticky_bottom_buttons: "sticky action rail",
  price_drop_watch: "Watch Price tile",
  ["market_value"]: "Market Intelligence: provider estimated value",
  ["market_position"]: "Market Intelligence: position label",
  ["market_checked_at"]: "Market Intelligence: our retrieval date",
  ["market_payload"]: "Market Intelligence (projected)",
  market_meta: "Market Intelligence (projected)",
  comparables: "Market Comparison (projected)",
  group_similar: "Similar Vehicles in stock (projected)",
  dealer_similar: "Similar Vehicles in stock (projected)",
  value_history: "price-history chart (projected)",
  mc_attributes: "Specifications, equipment, history flags (projected)",
  recon: "reconditioning module",
  dealer_trust: "Why Buy From dealer",
  iihs_award: "safety card",
  contact_routing: "contact action",
  oem_brochure: "documents page",
  oem_owners_manual: "documents page",
  vin_decode_receipts: "Verified Vehicle Data identity check",
  public_market_flags: "market claim suppression",
  view_count: "Passport page views (labelled as page views)",
  photo_count: "AutoFilm vehicle lookup (photo count on the rep card)",
};

export const PUBLIC_LISTING_FIELDS: ReadonlySet<string> = new Set(Object.keys(PUBLIC_FIELD_CONSUMERS));

/** Fields public-listing-view ships that a sister app feed must not. */
export const FEED_WITHHELD_FIELDS: ReadonlySet<string> = new Set(["market_payload", "comparables"]);

export const MC_ATTRIBUTE_PUBLIC_KEYS: readonly string[] = [
  "year", "make", "model", "trim", "version", "body_type", "body_style", "vehicle_type", "doors",
  "std_seating", "seating", "seats", "seating_capacity", "engine", "engine_block", "engine_size", "engine_displacement",
  "cylinders", "powertrain_type", "fuel_type", "fuel", "transmission", "transmission_description",
  "drivetrain", "drive_type", "city_mpg", "highway_mpg", "combined_mpg", "mpg", "horsepower", "torque",
  "overall_length", "overall_width", "overall_height", "length", "width", "height", "wheelbase",
  "ground_clearance", "turning_radius", "curb_weight", "weight", "made_in", "plant",
  "max_towing", "towing", "towing_capacity", "payload", "payload_capacity", "cargo", "cargo_capacity",
  "cargo_volume", "passenger_volume", "fuel_capacity", "fuel_tank", "tank_capacity", "battery",
  "battery_capacity", "ev_battery", "charging", "charge_time", "hybrid_system", "electric_range",
  "brakes", "steering", "front_suspension", "rear_suspension", "tires", "tire_size", "wheels",
  "wheel_size", "wheel_material", "spare", "spare_tire", "top_speed", "0_60", "zero_sixty", "zero_to_sixty",
  "exterior_color", "interior_color", "base_ext_color", "base_int_color",
  "inventory_type", "listing_type", "is_certified", "stock_no", "stock", "stock_number", "dom",
  "carfax_1_owner", "carfax_clean_title", "one_owner_source", "owner_count", "accident_count",
  "title_brand", "title_status", "msrp", "base_msrp", "total_msrp", "destination_charge",
  "specs_decoded_at", "specs_attempted_at", "specs_attempts",
  "options", "features", "build_sheet",
];

const MARKET_META_PUBLIC_KEYS: readonly string[] = [
  "similar_count", "search_radius", "trim_matched", "like_count", "like_median", "avg_dom",
  "market_days_supply", "inventory_count", "miles_mean", "dom_median", "trim_count",
  "sold_45d_estimate", "inventory_change_pct", "checked_at", "search_checked_at", "mds_checked_at",
];

const COHORT_PUBLIC_KEYS: readonly string[] = [
  "selection", "total_matches", "returned_count", "analyzed_count", "sampled", "sort_basis",
  "radius_miles", "year", "trim", "miles_band", "excluded", "outlier_rule", "median_method",
];

const SOLD_STATS_PUBLIC_KEYS: readonly string[] = [
  "count", "price_median", "dom_median", "miles_median", "scope", "state", "checked_at", "source",
];

const pick = (src: Bag, keys: readonly string[]): Bag => {
  const out: Bag = {};
  for (const k of keys) if (src[k] !== undefined) out[k] = src[k];
  return out;
};

// Names that never leave, at any depth, whatever object carries them.
const PRIVATE_KEY_EXACT = new Set([
  "install_token", "created_by", "assigned_agent_id", "recall_override_by", "recall_override_at",
  "recall_override_notes", "price_parse_notes", "mc_raw", "blackbook", "black_book",
  "tradein", "trade_in", "trade_in_value", "wholesale", "wholesale_value", "acv", "actual_cash_value",
  "cost", "vehicle_cost", "invoice", "invoice_price", "holdback", "floorplan", "floor_plan",
  "price_percentile", "cheaper_count", "rank_basis", "rank_miles_banded", "comp_price_cut_count",
  "comp_price_cut_total", "last_visit_plan", "ref_price", "ref_price_dt", "ref_miles",
  "price_change_percent", "neovin_confidence", "msrp_variants", "taxonomy", "price_includes_fees",
  "fee_basis", "fees", "vdp_url", "relaxation_tier", "miles_band_percent", "market_payload_raw",
  "provider_valuation", "rawResponseSanitized", "view_plan",
]);
const PRIVATE_KEY_PATTERN = /^(market_desirability|desirability|data_confidence|dealer_only|internal_)/i;
const isPrivateKey = (k: string): boolean => PRIVATE_KEY_EXACT.has(k) || PRIVATE_KEY_PATTERN.test(k);

/** Recursively drop dealer-only keys from content that is kept as authored. */
export function scrubPrivateKeys<T>(value: T, depth = 0): T {
  if (depth > 10) return null as T;
  if (Array.isArray(value)) return value.map((v) => scrubPrivateKeys(v, depth + 1)) as T;
  if (isBag(value)) {
    const out: Bag = {};
    for (const [k, v] of Object.entries(value)) {
      if (isPrivateKey(k)) continue;
      out[k] = scrubPrivateKeys(v, depth + 1);
    }
    return out as T;
  }
  return value;
}

const buildSheetOf = (v: unknown): unknown => {
  if (!isBag(v)) return null;
  const arr = (x: unknown) => (Array.isArray(x) ? x : []);
  const groups = (x: unknown) => {
    if (!isBag(x)) return {};
    const out: Bag = {};
    for (const [k, items] of Object.entries(x)) if (Array.isArray(items)) out[k] = items.map((i) => String(i ?? ""));
    return out;
  };
  return {
    packages: arr(v.packages).filter(isBag).map((p) => ({
      name: p.name ?? null, msrp: p.msrp ?? null,
      contents: arr(p.contents).map((c) => String(c ?? "")),
    })),
    options: arr(v.options).map((o) => (isBag(o) ? { name: o.name ?? null, msrp: o.msrp ?? null } : String(o ?? ""))),
    key_features: groups(v.key_features),
    standard: groups(v.standard),
    generic: v.generic === true,
    source: typeof v.source === "string" ? v.source : null,
  };
};

export function projectMcAttributes(v: unknown): Bag | null {
  if (!isBag(v)) return null;
  const out = pick(v, MC_ATTRIBUTE_PUBLIC_KEYS);
  if ("build_sheet" in out) out.build_sheet = buildSheetOf(out.build_sheet);
  return out;
}

export function projectMarketMeta(v: unknown): Bag | null {
  if (!isBag(v)) return null;
  const out = pick(v, MARKET_META_PUBLIC_KEYS);
  if (isBag(v.price_stats)) out.price_stats = pick(v.price_stats, ["mean", "median"]);
  if (isBag(v.cohort)) {
    const c = pick(v.cohort, COHORT_PUBLIC_KEYS);
    if (isBag(c.excluded)) c.excluded = pick(c.excluded, ["subject_vin", "dealer_own_listings", "unpriced", "trim_or_drivetrain_mismatch", "outliers"]);
    if (isBag(c.miles_band)) c.miles_band = pick(c.miles_band, ["percent", "range"]);
    out.cohort = c;
  }
  if (isBag(v.sold_stats)) out.sold_stats = pick(v.sold_stats, SOLD_STATS_PUBLIC_KEYS);
  return out;
}

export function projectMarketPayload(v: unknown): Bag | null {
  if (!isBag(v)) return null;
  return pick(v, ["marketValue", "low", "high", "belowMarket", "position", "source", "checked_at"]);
}

export function projectHistoryPayload(v: unknown): Bag | null {
  if (!isBag(v)) return null;
  const entries = Array.isArray(v.entries) ? v.entries.filter(isBag) : [];
  return {
    available: v.available === true,
    entries: entries.map((e) => pick(e, ["miles", "seller_type", "inventory_type", "first_seen", "last_seen"])),
    owners: v.owners ?? null,
    inServiceDate: null,
    firstSeen: v.firstSeen ?? null,
    checked_at: v.checked_at ?? null,
    source: v.source ?? null,
  };
}

const COMP_KEYS = ["price", "miles", "ymm", "trim", "dist", "dom", "image"] as const;
const OWN_STOCK_FEED_KEYS = ["vin", "dealer"] as const;
export const projectComparables = (v: unknown, extra: readonly string[] = []): Bag[] | null =>
  Array.isArray(v)
    ? v.filter(isBag)
      .filter((c) => { const p = Number(c.price); return Number.isFinite(p) && p > 0; })
      .map((c) => pick(c, [...COMP_KEYS, ...extra]))
    : null;

export const projectValueHistory = (v: unknown): Bag[] | null =>
  Array.isArray(v)
    ? v.filter(isBag).map((p) => pick(p, ["captured_at", "market_value", "listing_price", "below_market", "position"]))
    : null;

export const projectDealerSimilar = (v: unknown): Bag[] | null =>
  Array.isArray(v)
    ? v.filter(isBag).map((s) => pick(s, [
      "slug", "ymm", "trim", "price", "mileage", "condition", "image", "same_model", "tier",
      "package_count", "option_value", "top_packages",
    ]))
    : null;

const projectPaymentEstimate = (v: unknown): Bag | null =>
  isBag(v) ? pick(v, ["default_apr", "default_down", "default_term_months"]) : null;

/**
 * The listing row a shopper (or a sister app, with `forFeed`) may receive.
 * Returns a NEW object; unnamed top-level keys are never copied.
 */
export function projectPublicListing(row: unknown, opts?: { forFeed?: boolean }): Bag {
  const src = isBag(row) ? row : {};
  const out: Bag = {};
  for (const k of PUBLIC_LISTING_FIELDS) {
    if (opts?.forFeed && FEED_WITHHELD_FIELDS.has(k)) continue;
    if (src[k] === undefined) continue;
    out[k] = src[k];
  }
  if ("mc_attributes" in out) out.mc_attributes = projectMcAttributes(out.mc_attributes);
  if ("market_meta" in out) out.market_meta = projectMarketMeta(out.market_meta);
  if ("market_payload" in out) out.market_payload = projectMarketPayload(out.market_payload);
  if ("history_payload" in out) out.history_payload = projectHistoryPayload(out.history_payload);
  if ("comparables" in out) out.comparables = projectComparables(out.comparables);
  if ("group_similar" in out) out.group_similar = projectComparables(out.group_similar, opts?.forFeed ? OWN_STOCK_FEED_KEYS : []);
  if ("dealer_similar" in out) out.dealer_similar = projectDealerSimilar(out.dealer_similar);
  if ("value_history" in out) out.value_history = projectValueHistory(out.value_history);
  if ("payment_estimate" in out) out.payment_estimate = projectPaymentEstimate(out.payment_estimate);
  return scrubPrivateKeys(out);
}
