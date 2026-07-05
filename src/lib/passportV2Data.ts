import type { VehicleListing } from "@/hooks/useVehicleListing";
import { resolveDisplayPrice, getPriceDisplayMode, type PriceDisplayMode } from "@/lib/priceModel";
import { DEFAULT_APR_PERCENT } from "@/lib/affordability";
import type { OemFactoryWarranty } from "@/lib/oemWarranty";

// The OEM coverage breakdown public-listing-view attaches to a new/CPO listing.
export type OemWarrantyView = Partial<OemFactoryWarranty> & { owner?: "original" | "subsequent" };

// ──────────────────────────────────────────────────────────────
// Passport V2 shared derivations
//
// Single source of truth for the values the Passport V2 surface and
// its dedicated detail pages render. Everything here is computed from
// real listing data — no fabricated certainty. Fields are null when
// the backing data is absent so callers can show honest empty states.
// ──────────────────────────────────────────────────────────────

// Equipment strings for a listing: the curated `features` column PLUS the
// MarketCheck `mc_attributes.options`/`.features` (which the feed and the VIN
// decoder populate, and which arrive as arrays OR delimited strings). Without
// this, equipment captured by the API pull never reaches the shopper page,
// which only read the top-level `features` column. De-duplicated and trimmed.
// NeoVIN returns a very large, noisy equipment set (633+ rows for one car):
// US/UK spelling duplicates, raw option codes, available paint colors,
// crash-test ratings, and taxonomy/metadata labels. cleanEquipmentList strips
// that down to real, customer-facing features and de-dupes across spellings.
const UK_US: [RegExp, string][] = [
  [/\blitres?\b/gi, "Liters"], [/\bcentre\b/gi, "Center"], [/\bgrey\b/gi, "Gray"],
  [/\bcolour\b/gi, "Color"], [/\baluminium\b/gi, "Aluminum"], [/\btyres?\b/gi, "Tire"],
  [/\bmetre\b/gi, "Meter"], [/\bkerb\b/gi, "Curb"],
];
const normSpelling = (s: string) => UK_US.reduce((a, [re, t]) => a.replace(re, t), s);
const CODE_RE = /^[A-Z]{1,3}\d{1,4}$/;                                                   // B10, E10, B93
const META_RE = /\b(msrp|warranty|currency|invoice|jato|segment|dimensions?|emission|plant of assembly|country|weights?|charges?|model generation|model year|ramp angle|secondary|delivery charge)\b/i;
const RATING_RE = /\b(iihs|nhtsa)\b|-(good|acceptable|marginal|poor|tsp|updated|[1-5])$|overlap|rollover|frontal crash|side impact-/i;
const PAINT_RE = /\b(metallic|pearl)\b|^paint[- ]/i;                                     // paint-color variants
// Engineering/spec rows that arrive as feature-name strings: parenthesized
// measurements ("Front Wheel Diameter (21 in)"), chassis dimensions, and
// sub-attribute rows ("Activates Brake Lights", "Seat belt warning").
const SPEC_MEASURE_RE = /\(\s*\d+(\.\d+)?\s?(in|mm|cm|cu\.?\s?ft|lbs?|kg|gal|l)\b\.?\s*\)\s*$/i;
const SPEC_DIM_RE = /\b(wheelbase|wheel (diameter|width)|(front|rear) wheel (diameter|width)|track (front|rear)|(front|rear) track|overhang|bore|stroke|axle ratio|compression ratio|approach angle|departure angle)\b/i;
const ACTIVATES_RE = /^activates\b/i;
const WARNING_RE = /\bwarnings?$/i;
// Shopper-meaningful warning systems stay ("Blind Spot Warning"); bare
// engineering rows ("Seat belt warning") go.
const WARNING_KEEP_RE = /\b(blind ?spot|lane departure|forward collision|cross ?traffic|driver attention|tire pressure|low tire|pedestrian)\b/i;
const GENERIC = new Set([
  "engine", "fuel", "fuel tanks", "fuel consumption", "transmission", "electrical system",
  "performance", "tires", "tire", "suspension", "ventilation system", "air conditioning",
  "doors", "door", "powertrain", "wheels", "wheel", "spare wheel", "brakes", "disc brakes",
  "abs", "seating", "console", "paint", "speakers", "vehicle type", "computer",
  "floor covering", "floor mats", "power", "power locks", "power steering", "power windows",
  "head restraints", "blind", "stability control", "garage door opener", "bumpers",
  "glass roof", "telematics", "remote services", "drive", "compressor", "charges",
  "start/stop", "privacy glass", "rear axle", "driver modes", "vanity mirror", "apps control",
  "trip computer", "crash test results", "body style", "over air updates", "windshield wipers",
  "rear window", "rear side windows", "cup holders", "cupholders", "seat upholstery",
  "instrument cluster", "cargo capacity", "underbody protection", "emergency call",
  "ground view", "differential lock", "torque vectoring", "active grille shutter",
  "hill holder", "memorized adjustment", "anti-theft protection", "isofix preparation",
  "voice activating system", "laminated side windows", "electronic hand brake",
  "door sill protector", "accident data recorder", "electronic traction control",
  "multiple user profiles", "emission control level", "load restraint", "model generation id",
  "secondary ventilation controls", "compass", "suspension", "weights", "performance",
]);
const isEquipNoise = (raw: string): boolean => {
  const s = raw.trim();
  if (s.length < 2) return true;
  if (CODE_RE.test(s)) return true;
  if (META_RE.test(s) || RATING_RE.test(s) || PAINT_RE.test(s)) return true;
  if (SPEC_MEASURE_RE.test(s) || SPEC_DIM_RE.test(s) || ACTIVATES_RE.test(s)) return true;
  if (WARNING_RE.test(s) && !WARNING_KEEP_RE.test(s)) return true;
  if (GENERIC.has(s.toLowerCase())) return true;
  return false;
};

// Concept families: the decoder emits every variant of one feature as its own
// row ("Front Sunroof", "Glass Sunroof", "One-Touch Opening Sunroof-Front").
// When two or more rows land in a family, they collapse to one canonical row.
const FAMILY_RULES: { re: RegExp; canon: (members: string[]) => string }[] = [
  { re: /\b(sun ?roofs?|moon ?roofs?)\b/i, canon: (m) => m.some((s) => /panoramic/i.test(s)) ? "Panoramic sunroof" : m.some((s) => /power|electric|one.?touch/i.test(s)) ? "Power sunroof" : "Sunroof" },
  { re: /\bhead ?(light|lamp)s?\b/i, canon: (m) => `${m.some((s) => /\bled\b/i.test(s)) ? "LED headlights" : "Headlights"}${m.some((s) => /high ?beam|auto/i.test(s)) ? " (auto high-beam)" : ""}` },
  { re: /\b(heated|ventilated|cooled|climate.?controlled)\b[^.]*\bseats?\b/i, canon: (m) => {
      const heated = m.some((s) => /heated/i.test(s));
      const vented = m.some((s) => /ventilated|cooled|climate/i.test(s));
      return heated && vented ? "Heated & ventilated seats" : heated ? "Heated seats" : "Ventilated seats";
    } },
  { re: /\b(keyless|proximity key|push.?button start|remote (engine )?start)\b/i, canon: (m) => m.some((s) => /remote (engine )?start/i.test(s)) ? "Keyless entry & remote start" : "Keyless entry & push-button start" },
  { re: /\b(park(ing)? (sensor|assist|aid)s?|surround.?view|360.?(degree)? camera|birds?.?eye)\b/i, canon: (m) => m.some((s) => /surround|360|birds?.?eye/i.test(s)) ? "Surround-view camera & parking sensors" : "Parking sensors" },
  { re: /\bwireless (charging|charger|phone charg)/i, canon: () => "Wireless phone charging" },
];

const equipKey = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const equipTokens = (key: string) => key.split(" ").filter(Boolean).map((t) => t.replace(/s$/, ""));

export const cleanEquipmentList = (items: string[]): string[] => {
  const seen = new Set<string>();
  const kept: string[] = [];
  for (const raw of items) {
    if (isEquipNoise(raw)) continue;
    const norm = normSpelling(raw);
    const key = equipKey(norm);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    kept.push(norm);
  }

  // Family merge: collapse each ≥2-member family to one canonical row, at the
  // position of its first member. Single-member families keep their own text.
  const familyOf = (s: string) => FAMILY_RULES.findIndex((f) => f.re.test(s));
  const members = new Map<number, string[]>();
  for (const item of kept) {
    const f = familyOf(item);
    if (f >= 0) members.set(f, [...(members.get(f) || []), item]);
  }
  const merged: string[] = [];
  const emittedFamily = new Set<number>();
  for (const item of kept) {
    const f = familyOf(item);
    if (f < 0) { merged.push(item); continue; }
    const fam = members.get(f)!;
    if (fam.length < 2) { merged.push(item); continue; }
    if (!emittedFamily.has(f)) { emittedFamily.add(f); merged.push(FAMILY_RULES[f].canon(fam)); }
  }

  // Containment dedupe: drop generic losers whose word set is a strict subset
  // of a more specific sibling ("Headlights" ⊂ "LED Headlights", "Heated
  // Seats" ⊂ "Heated Driver Seat"). An inverted token index keeps this linear
  // in practice on decoder-sized lists.
  const tokenSets = merged.map((s) => new Set(equipTokens(equipKey(s))));
  const byToken = new Map<string, number[]>();
  tokenSets.forEach((ts, i) => ts.forEach((t) => byToken.set(t, [...(byToken.get(t) || []), i])));
  const drop = new Set<number>();
  tokenSets.forEach((ts, i) => {
    if (ts.size === 0) return;
    const candidates = new Set<number>();
    ts.forEach((t) => (byToken.get(t) || []).forEach((j) => { if (j !== i) candidates.add(j); }));
    for (const j of candidates) {
      if (drop.has(j)) continue;
      const other = tokenSets[j];
      if (other.size > ts.size && [...ts].every((t) => other.has(t))) { drop.add(i); break; }
    }
  });
  return merged.filter((_, i) => !drop.has(i));
};

// Upholstery color OPTIONS the decoder lists for the trim ("Vermilion Red
// Semi-Aniline Leather", "Graphite Leather") — only the color actually in the
// car belongs on its equipment list, so mismatched color variants are dropped
// against the listing's selected interior color.
const UPHOLSTERY_RE = /\b(leather(ette)?|cloth|upholstery|semi.?aniline|nappa|suede|ultrasuede|vinyl)\b/i;
const COLOR_WORDS = ["black", "white", "red", "blue", "gray", "grey", "brown", "tan", "beige", "ivory", "cream", "charcoal", "graphite", "ebony", "vermilion", "saddle", "camel", "stone", "slate", "espresso", "cocoa", "chestnut", "sand", "linen", "oyster", "parchment", "mocha", "burgundy", "wine", "navy", "titanium", "ash", "walnut", "cognac", "caramel", "terracotta"];

export const listingEquipment = (listing: VehicleListing): string[] => {
  const toList = (v: unknown): string[] => Array.isArray(v)
    ? v.map((x) => typeof x === "string" ? x : String((x as Record<string, unknown>)?.name ?? (x as Record<string, unknown>)?.label ?? (x as Record<string, unknown>)?.description ?? "")).map((s) => s.trim()).filter(Boolean)
    : typeof v === "string" ? v.split(/[,;|]/).map((s) => s.trim()).filter(Boolean) : [];
  const mc = (listing.mc_attributes || {}) as Record<string, unknown>;
  const ksRaw = (listing.key_specs || {}) as Record<string, unknown>;
  const intColor = String(ksRaw.interior_color ?? mc.interior_color ?? "").toLowerCase();
  const fromFeatures = (listing.features || []).map((f) => [f.title, f.subtitle].filter(Boolean).join(" ").trim()).filter(Boolean);
  const all = [...fromFeatures, ...toList(mc.options), ...toList(mc.features)].filter((item) => {
    if (!intColor || !UPHOLSTERY_RE.test(item)) return true;
    const lc = item.toLowerCase();
    const named = COLOR_WORDS.filter((c) => new RegExp(`\\b${c}\\b`).test(lc));
    return named.length === 0 || named.some((c) => intColor.includes(c));
  });
  return cleanEquipmentList(all);
};

export const fmt$ = (n: number | null | undefined) =>
  n == null ? "" : `$${Math.round(n).toLocaleString()}`;

export interface VerifyRow { label: string; done: boolean }
export interface Highlight { key: string; label: string; sub: string }

export interface PassportData {
  // Identity / price
  price: number | null;
  msrp: number | null;
  priceLabel: string;
  estMonthly: number | null;
  paymentAssumptions: string;
  saveVsMsrp: number | null;
  // Used cars are almost always below their original sticker — that's
  // depreciation, not a discount, so it must never render as "You save".
  belowOriginalMsrp: number | null;
  // Doc-fee model. `price` already reflects priceMode; docFee/websiteSalePrice
  // let the surface disclose the fee. priceIncludesDoc = the displayed price is
  // the website sale price (fee already inside) vs advertised-before-doc.
  docFee: number | null;
  websiteSalePrice: number | null;
  priceMode: PriceDisplayMode;
  priceIncludesDoc: boolean;
  // Customer-safe reconditioning & inspection summary (injected by
  // public-listing-view from the dealer's prep/detail/install/inspection
  // sign-offs). Null until the dealership records reconditioning work.
  recon: {
    inspection: { type: string | null; passed: boolean; date: string | null } | null;
    detailed: boolean;
    detailDate: string | null;
    workItems: string[];
    thirdParty: { product: string; company: string }[];
    photos: string[];
  } | null;
  // Market
  marketAvg: number | null;
  marketLow: number | null;
  marketHigh: number | null;
  belowMarket: number | null;
  viewCount: number | null;
  dom: number | null;
  // Enrichment (pulled at ingest by vehicle-enrich)
  marketMeta: {
    percentile: number | null; radius: number | null; similarCount: number | null; avgDom: number | null;
    daysSupply: number | null; inventoryCount: number | null; checkedAt: string | null; trimMatched: boolean | null;
    priceMedian: number | null; priceMean: number | null; milesMean: number | null;
    // market_meta.sold_stats — recently-delisted medians from the enrich pass.
    soldCount: number | null; soldPriceMedian: number | null; soldDomMedian: number | null; soldMilesMedian: number | null;
    soldScope: string | null; soldState: string | null; soldCheckedAt: string | null;
    soldDisplayable: boolean;
  };
  comparables: { vin?: string | null; ymm?: string | null; trim?: string | null; miles?: number | null; price?: number | null; dist?: number | null; dealer?: string | null; dom?: number | null; image?: string | null }[];
  blackbook: { tradeinClean: number | null; retailClean: number | null; wholesaleClean: number | null; available: boolean } | null;
  marketCheckedAt: string | null;
  // VIN listing history (from MarketCheck History-by-VIN, pulled at ingest)
  history: {
    available: boolean;
    entries: { price: number | null; miles: number | null; seller_type: string | null; inventory_type: string | null; dealer: string | null; first_seen: string | null; last_seen: string | null }[];
    owners: number | null;
    inServiceDate: string | null;
    firstSeen: string | null;
  } | null;
  // History
  ownerCount: number | null;
  accidentCount: number | null;
  cleanTitle: boolean;
  titleStatus: "clean" | "branded" | "unknown";
  serviceCount: number;
  recallClear: boolean;
  openRecalls: number | null;
  hasRecallCheck: boolean;
  // Warranty
  warranty: NonNullable<VehicleListing["warranty_info"]>;
  warrantyStr: string | null;
  warrantyExpired: boolean;
  // Full OEM coverage breakdown for new/CPO cars (from the dealer's verified
  // Factory & CPO terms, attached by public-listing-view). Drives the
  // factory-warranty slide-out's full presentation.
  oemWarranty: OemWarrantyView | null;
  // Confidence — confScore is the History & Title factor of deriveRating
  // (the labeled-deduction engine). Kept exported under its old name for
  // surfaces not yet migrated to the unified rating.
  confScore: number | null;
  confLabel: string;
  confDeductions: { label: string; points: number }[];
  verifiedBy: string[];
  dealerVerified: boolean;
  verifyRows: VerifyRow[];
  // Content
  highlights: Highlight[];
  specRows: [string, string | null | undefined][];
  keySpecs: [string, string][];
  // Official EPA fuel economy (fueleconomy.gov) when the epa-fuel-economy
  // function has matched this listing. Public-domain federal data.
  epa: { city: number | null; highway: number | null; combined: number | null; annualFuelCost: number | null; ghgScore: number | null; rangeMiles: number | null; fuelType: string | null } | null;
  overview: string;
  whyBuy: string[];
  // Reviews
  reviewRating: number | null;
  reviewCount: number | null;
  reviewUrl: string;
  // Dealer
  dealer: Record<string, unknown>;
  dealerName: string;
  dealerPhone: string;
  dealerAddress: string;
  // Offers
  offers: { title: string; body: string; exp: string }[];
  // Price history (real captured snapshots from vehicle_value_history)
  valueHistory: { captured_at: string; market_value: number | null; listing_price: number | null; below_market: number | null; position: string | null }[];
  priceChange7d: number | null;   // listing_price delta vs ~7 days ago (negative = drop)
  priceChangeTotal: number | null; // delta since first capture
  // Dealer-entered trust content (from public-listing-view → dealer_trust)
  dealerTrust: {
    yearsInBusiness: string;
    satisfaction: string;
    bbbRating: string;
    googleRating: string;
    googleCount: string;
    certifications: string[];
    storefrontUrl: string;
    reviewSources: { name: string; rating: number | null; quote: string }[];
    advisorName: string;
    advisorTitle: string;
    advisorPhoto: string;
    advisorResponse: string;
    familyOwned: boolean;
    serviceLocation: string;   // "onsite" | "offsite" | ""
    serviceAddress: string;
    delivery: string;          // "none" | "local" | "regional" | "nationwide" | ""
    financing: boolean;
    amenities: string[];
    services: string[];
    hours: string;
    mobileCtaVariant: string;
  };
  // Server-resolved contact routing (public-listing-view). Null on preview /
  // legacy payloads; the CTA dock then falls back to the advisor fields.
  contactRouting: import("@/lib/passportRouting").PassportRoutingResult | null;
  // IIHS award, attached by public-listing-view only when the dealer has
  // IIHS's written permission AND verified this model's award.
  iihsAward: import("@/lib/iihsAwards").MatchedIihsAward | null;
  // Dealer-paid CARFAX/AutoCheck report link (public-listing-view attaches
  // it for used/CPO only). An EXTERNAL handoff — we link, we never read or
  // certify the report's contents.
  historyReport: { url: string; provider: "carfax" | "autocheck"; source?: "dealer" | "vin" } | null;
  // Dealer-branded warranty programs (lifetime powertrain, dealer CPO)
  // flagged for the warranty panel by the dealer, condition-filtered
  // server-side. mode "available" = optional upgrade, not included.
  dealerCoverage: {
    title: string; coverage: string; termYears: number | null; termMiles: number | null;
    lifetime: boolean; mode: "included" | "available"; offer: string; disclosure: string;
  }[];
}

export const historyReportName = (provider: "carfax" | "autocheck"): string =>
  provider === "autocheck" ? "AutoCheck" : "CARFAX";

export interface PricePoint { captured_at: string; market_value: number | null; listing_price: number | null; below_market: number | null; position: string | null }

// Real captured price history (attached to the listing by public-listing-view
// from the vehicle_value_history table). Returns the series plus 7-day and
// total listing-price deltas (negative = price drop).
export const computePriceHistory = (listing: VehicleListing): { valueHistory: PricePoint[]; priceChange7d: number | null; priceChangeTotal: number | null } => {
  const rawHist = (listing as unknown as { value_history?: unknown }).value_history;
  const valueHistory: PricePoint[] = (Array.isArray(rawHist) ? rawHist : []).map((h) => h as Record<string, unknown>).map((h) => ({
    captured_at: String(h.captured_at ?? ""),
    market_value: h.market_value != null ? Number(h.market_value) : null,
    listing_price: h.listing_price != null ? Number(h.listing_price) : null,
    below_market: h.below_market != null ? Number(h.below_market) : null,
    position: (h.position as string) ?? null,
  })).filter((h) => h.captured_at);
  const priced = valueHistory.filter((h) => h.listing_price != null);
  const latestPrice = priced.length ? priced[priced.length - 1].listing_price! : null;
  const priceChangeTotal = priced.length >= 2 && latestPrice != null ? latestPrice - priced[0].listing_price! : null;
  const priceChange7d = (() => {
    if (priced.length < 2 || latestPrice == null) return null;
    const latestT = new Date(priced[priced.length - 1].captured_at).getTime();
    const weekAgo = latestT - 7 * 24 * 60 * 60 * 1000;
    // True 7-day window only — a since-first-capture delta must not be
    // labeled as a 7-day trend, and a prior point older than ~10 days is a
    // stale anchor, not a week-over-week comparison.
    const staleFloor = latestT - 10 * 24 * 60 * 60 * 1000;
    const prior = [...priced].reverse().find((h) => {
      const t = new Date(h.captured_at).getTime();
      return t <= weekAgo && t >= staleFloor;
    });
    if (!prior) return null;
    return latestPrice - prior.listing_price!;
  })();
  return { valueHistory, priceChange7d, priceChangeTotal };
};

export const derivePassport = (listing: VehicleListing): PassportData => {
  const dealer = (listing.dealer_snapshot || {}) as Record<string, unknown>;
  const mc = (listing.mc_attributes || {}) as Record<string, unknown>;
  // The MarketCheck pull writes specs into mc_attributes, but key_specs is the
  // column the passport historically read — empty on synced cars. Merge so the
  // shopper page shows engine/drivetrain/MPG/colors from whichever is present.
  const ksRaw = (listing.key_specs || {}) as Record<string, unknown>;
  const ks = {
    ...ksRaw,
    engine: (ksRaw.engine ?? mc.engine ?? undefined) as string | undefined,
    drivetrain: (ksRaw.drivetrain ?? mc.drivetrain ?? undefined) as string | undefined,
    transmission: (ksRaw.transmission ?? mc.transmission ?? undefined) as string | undefined,
    fuel: (ksRaw.fuel ?? mc.fuel_type ?? undefined) as string | undefined,
    mpg_city: (ksRaw.mpg_city ?? mc.city_mpg ?? undefined) as number | undefined,
    mpg_hwy: (ksRaw.mpg_hwy ?? mc.highway_mpg ?? undefined) as number | undefined,
    exterior_color: (ksRaw.exterior_color ?? mc.exterior_color ?? undefined) as string | undefined,
    interior_color: (ksRaw.interior_color ?? mc.interior_color ?? undefined) as string | undefined,
  };
  const mp = listing.market_payload || {};

  const mm = ((listing as unknown as { market_meta?: Record<string, unknown> }).market_meta || {}) as Record<string, unknown>;
  const n = (v: unknown): number | null => (v != null && Number.isFinite(Number(v)) ? Number(v) : null);
  const ps = (mm.price_stats || {}) as Record<string, unknown>;
  const ss = (mm.sold_stats || {}) as Record<string, unknown>;
  const soldCount = n(ss.count);
  const soldScope = (ss.scope as string) || null;
  const soldCheckedAt = (ss.checked_at as string) || null;
  const marketMeta = {
    percentile: n(mm.price_percentile), radius: n(mm.search_radius), similarCount: n(mm.similar_count),
    avgDom: n(mm.avg_dom), daysSupply: n(mm.market_days_supply), inventoryCount: n(mm.inventory_count),
    checkedAt: (mm.checked_at as string) || null,
    trimMatched: typeof mm.trim_matched === "boolean" ? mm.trim_matched : null,
    priceMedian: n(ps.median), priceMean: n(ps.mean), milesMean: n(mm.miles_mean),
    soldCount, soldPriceMedian: n(ss.price_median), soldDomMedian: n(ss.dom_median), soldMilesMedian: n(ss.miles_median),
    soldScope, soldState: (ss.state as string) || null, soldCheckedAt,
    // Make-level scope is too loose for a customer claim, and stale sold data
    // must age out rather than keep asserting "last 90 days".
    soldDisplayable: soldScope != null && soldScope !== "make_state" && soldCount != null && soldCount >= 5
      && soldCheckedAt != null && Date.now() - new Date(soldCheckedAt).getTime() <= 45 * 86400000,
  };
  const comparables = Array.isArray((listing as unknown as { comparables?: unknown }).comparables)
    ? ((listing as unknown as { comparables: PassportData["comparables"] }).comparables) : [];
  const bbRaw = (listing as unknown as { blackbook?: Record<string, unknown> }).blackbook || null;
  const blackbook = bbRaw ? {
    tradeinClean: n((bbRaw.tradein as Record<string, unknown>)?.clean),
    retailClean: n((bbRaw.retail as Record<string, unknown>)?.clean),
    wholesaleClean: n((bbRaw.wholesale as Record<string, unknown>)?.clean),
    available: !!bbRaw.available,
  } : null;
  const marketCheckedAt = (listing as unknown as { market_checked_at?: string }).market_checked_at || marketMeta.checkedAt || null;

  const histRaw = (listing as unknown as { history_payload?: Record<string, unknown> }).history_payload || null;
  type HistEntries = NonNullable<PassportData["history"]>["entries"];
  const history: PassportData["history"] = histRaw && histRaw.available ? {
    available: true,
    entries: (Array.isArray(histRaw.entries) ? histRaw.entries : []) as HistEntries,
    owners: n(histRaw.owners),
    inServiceDate: (histRaw.inServiceDate as string) || null,
    firstSeen: (histRaw.firstSeen as string) || null,
  } : null;

  // Price / doc-fee model. The customer-facing price follows the tenant's
  // price_display_mode (default advertised_before_doc — Harte INFINITI's
  // default, which keeps the historic behavior of showing listing.price). The
  // doc fee is disclosed separately by the surface; market math compares on the
  // same value the dealer displays.
  const lp = listing as unknown as {
    advertised_price_before_doc?: number | null; doc_fee?: number | null; website_sale_price?: number | null; price_display_mode?: unknown; price_label?: string | null;
  };
  const priceMode: PriceDisplayMode = getPriceDisplayMode({ price_display_mode: lp.price_display_mode });
  const advBeforeDoc = lp.advertised_price_before_doc ?? listing.price ?? null;
  const docFee = lp.doc_fee ?? null;
  const websiteSalePrice = lp.website_sale_price ?? (advBeforeDoc != null ? advBeforeDoc + (docFee ?? 0) : null);
  const price = resolveDisplayPrice(
    { advertised_price_before_doc: advBeforeDoc, doc_fee: docFee, website_sale_price: websiteSalePrice, price: listing.price },
    priceMode,
  );
  const priceIncludesDoc = priceMode === "website_sale_price";
  const isNew = String((listing as { condition?: string }).condition || "").toLowerCase() === "new";
  const msrp = (mc.msrp as number) ?? null;
  const marketAvg = listing.market_value ?? null;
  const marketHigh = (mp.high as number) ?? null;
  const marketLow = (mp.low as number) ?? null;
  // market_value is the freshest VIN-level predict; the stored
  // market_payload.belowMarket was frozen at enrich time against a price that
  // may since have changed, so it only serves as a fallback.
  const belowMarket = marketAvg != null
    ? (price != null && price < marketAvg ? marketAvg - price : null)
    : (mp.belowMarket as number) ?? null;
  // Server-resolved price label (public-listing-view resolves the dealer's
  // price_label setting + dealership name into a string). Legacy snapshots may
  // carry it on dealer_snapshot; default is "Our Price".
  const priceLabel = (lp.price_label as string) || (dealer.price_label as string) || "Our Price";
  // "You save" vs MSRP is only true for a new car; a used car below its
  // original sticker is depreciation, exposed separately as belowOriginalMsrp.
  const saveVsMsrp = isNew && msrp != null && price != null && msrp > price ? msrp - price : null;
  const belowOriginalMsrp = !isNew && msrp != null && price != null && msrp > price ? msrp - price : null;
  const estMonthly = (() => {
    if (price == null) return null;
    const r = DEFAULT_APR_PERCENT / 100 / 12, n = 72, principal = price * 0.9;
    const m = Math.round((principal * r) / (1 - Math.pow(1 + r, -n)));
    return isFinite(m) ? m : null;
  })();
  const paymentAssumptions = `72 mo · 10% down · ${DEFAULT_APR_PERCENT}% APR example`;

  // A brand-new car has had no prior owners. For everything else, only trust a
  // real owner signal (MarketCheck owner_count or a CARFAX one-owner flag) —
  // never the listing-history "owners" estimate, which counts distinct dealer
  // listing spells (a car relisted by 12 dealers is NOT a 12-owner car).
  const ownerCount = isNew ? 0 : ((mc.owner_count as number) ?? (mc.carfax_1_owner === true ? 1 : null));
  const accidentCount = (mc.accident_count as number) ?? null;
  const cleanTitle = mc.carfax_clean_title === true;
  const titleBrand = String((mc.title_brand ?? mc.title_status ?? "") as string).trim();
  const titleStatus: PassportData["titleStatus"] = cleanTitle
    ? "clean"
    : mc.carfax_clean_title === false || (titleBrand !== "" && !/^clean/i.test(titleBrand)) ? "branded" : "unknown";
  const serviceCount = listing.service_records?.length ?? 0;
  const recallClear = listing.recall_status === "clear";
  const openRecalls = listing.open_recall_count ?? null;
  const hasRecallCheck = !!listing.recall_status;
  const verificationChecks =
    (listingEquipment(listing).length > 0 ? 1 : 0) +
    (marketAvg != null || marketMeta.similarCount != null ? 1 : 0) +
    (hasRecallCheck ? 1 : 0) +
    ((listing.photos?.length ?? 0) > 0 || listing.hero_image_url ? 1 : 0);
  const dealerVerified = verificationChecks >= 2;

  const warranty = listing.warranty_info || {};
  const warrantyStr = (() => {
    const yrs = warranty.factory_months ? Math.round(warranty.factory_months / 12) : null;
    const mi = warranty.factory_miles ? `${(warranty.factory_miles / 1000).toFixed(0)},000 mi` : null;
    return [yrs ? `${yrs} yr` : null, mi].filter(Boolean).join(" / ") || null;
  })();
  // Factory terms are whichever-comes-first: coverage is alive only while
  // EVERY known limit has remainder. A single known limit governs alone; when
  // neither signal is computable (no real in-service date, no finite mileage
  // cap) the status is unknown, never expired, so terms still render without a
  // fabricated countdown. Time uses the raw end-date comparison — rounding to
  // months would call 1-15 days of real coverage "expired".
  const warrantyExpired = (() => {
    if (isNew) return false;
    const timeRemains = (() => {
      if (!warranty.in_service_date || !warranty.factory_months) return null;
      const end = new Date(warranty.in_service_date);
      end.setMonth(end.getMonth() + warranty.factory_months);
      return end.getTime() - Date.now() > 0;
    })();
    const milesRemain = warranty.factory_miles && warranty.factory_miles > 0 && listing.mileage != null
      ? warranty.factory_miles - listing.mileage > 0 : null;
    if (timeRemains == null && milesRemain == null) return false;
    return timeRemains === false || milesRemain === false;
  })();

  // Falsifiable confidence score: start high and subtract LABELED deductions
  // for negative or unknown signals. The old formula had a 60-point floor and
  // only counted positives — every car scored 80-something, which reads as
  // marketing. A score that can visibly go down (and shows why) is evidence.
  const knownSignals =
    (typeof mc.carfax_clean_title === "boolean" ? 1 : 0) + (accidentCount != null ? 1 : 0) +
    (ownerCount != null ? 1 : 0) + (listing.recall_status ? 1 : 0) +
    (serviceCount > 0 ? 1 : 0) + (warrantyStr ? 1 : 0);
  const confDeductions: { label: string; points: number }[] = [];
  const ded = (cond: boolean, label: string, points: number) => { if (cond) confDeductions.push({ label, points }); };
  ded(typeof mc.carfax_clean_title === "boolean" && !cleanTitle, "Title not confirmed clean", 14);
  ded(accidentCount != null && accidentCount > 0, `${accidentCount} reported accident${accidentCount === 1 ? "" : "s"}`, Math.min(18, (accidentCount ?? 0) * 9));
  ded(!isNew && ownerCount != null && ownerCount > 1, `${ownerCount} previous owners`, 6);
  ded(!!listing.recall_status && !recallClear, "Open recall — needs remedy", 12);
  ded(!isNew && serviceCount === 0 && knownSignals >= 2, "No service records on file", 4);
  ded(!warrantyStr && knownSignals >= 2, "No factory warranty remaining", 5);
  ded(!isNew && typeof mc.carfax_clean_title !== "boolean" && accidentCount == null, "History report not yet attached", 7);
  const confScore = knownSignals >= 2
    ? Math.max(35, 97 - confDeductions.reduce((s, x) => s + x.points, 0))
    : null;
  const confLabel = confScore == null ? "" : confScore >= 90 ? "Excellent" : confScore >= 80 ? "Very Good" : confScore >= 70 ? "Good" : "Fair";

  const verifiedBy = [
    { label: "Vehicle History", on: typeof mc.carfax_clean_title === "boolean" || ownerCount != null },
    { label: "Live Market Data", on: marketAvg != null || Object.keys(mc).length > 0 },
    { label: "NHTSA", on: !!listing.recall_status },
  ].filter((x) => x.on).map((x) => x.label);

  const verifyRows: VerifyRow[] = [
    { label: "VIN Verified", done: !!listing.vin },
    { label: "Vehicle History", done: typeof mc.carfax_clean_title === "boolean" || ownerCount != null || accidentCount != null },
    { label: "Recall Verification", done: !!listing.recall_status },
    { label: "Market Data", done: marketAvg != null || verifiedBy.includes("Live Market Data") },
    { label: "Title & Brand", done: cleanTitle },
    { label: "Warranty Checked", done: !!warrantyStr },
    { label: "Service History", done: serviceCount > 0 },
  ].filter((r) => r.done);

  const highlights: Highlight[] = [];
  if (ks.engine) highlights.push({ key: "engine", label: ks.engine, sub: "Engine" });
  if (mc.horsepower) highlights.push({ key: "hp", label: `${mc.horsepower} HP`, sub: "Horsepower" });
  if (ks.drivetrain) highlights.push({ key: "drive", label: ks.drivetrain, sub: "Drivetrain" });
  if (ks.transmission) highlights.push({ key: "trans", label: ks.transmission, sub: "Transmission" });
  if (ks.mpg_city && ks.mpg_hwy) highlights.push({ key: "mpg", label: `${ks.mpg_city}/${ks.mpg_hwy} MPG`, sub: "Fuel economy" });
  else if (ks.mpg_city) highlights.push({ key: "mpg", label: `${ks.mpg_city} MPG`, sub: "City" });
  else if (ks.fuel) highlights.push({ key: "fuel", label: ks.fuel, sub: "Fuel" });
  if (ks.exterior_color) highlights.push({ key: "ext", label: ks.exterior_color, sub: "Exterior" });
  listingEquipment(listing).forEach((label, i) => { if (highlights.length < 8) highlights.push({ key: `f${i}`, label, sub: "Feature" }); });

  const overview = listing.description ||
    (ks.engine || ks.drivetrain
      ? `The ${listing.ymm}${listing.trim ? " " + listing.trim : ""} pairs a ${ks.engine || "capable"} powertrain with ${ks.drivetrain || "a refined drivetrain"} and a well-equipped cabin.`
      : "");

  const specRows: [string, string | null | undefined][] = [
    ["Exterior Color", ks.exterior_color as string | undefined],
    ["Interior Color", ks.interior_color as string | undefined],
    ["Transmission", ks.transmission],
    ["Drivetrain", ks.drivetrain],
    ["Engine", ks.engine],
    ["Fuel Type", ks.fuel],
    ks.mpg_city && ks.mpg_hwy ? ["MPG (est.)", `${ks.mpg_city} city / ${ks.mpg_hwy} hwy`] : ["", null],
  ];

  // Structured key specs (goal's "Key Specifications" card) — real values only.
  const epaRaw = (listing as unknown as { epa_economy?: Record<string, unknown> | null }).epa_economy || null;
  const epa = epaRaw && (epaRaw.combined != null || epaRaw.city != null) ? {
    city: (epaRaw.city as number) ?? null,
    highway: (epaRaw.highway as number) ?? null,
    combined: (epaRaw.combined as number) ?? null,
    annualFuelCost: (epaRaw.annualFuelCost as number) ?? null,
    ghgScore: (epaRaw.ghgScore as number) ?? null,
    rangeMiles: (epaRaw.rangeMiles as number) ?? null,
    fuelType: (epaRaw.fuelType as string) ?? null,
  } : null;

  const keySpecs = ([
    ["Engine", ks.engine],
    ["Horsepower", mc.horsepower ? `${mc.horsepower} HP` : null],
    ["Transmission", ks.transmission],
    ["Drivetrain", ks.drivetrain],
    // Official EPA figures win over feed-provided MPG when available.
    ["Fuel Economy", epa && epa.city && epa.highway
      ? `${epa.city}/${epa.highway} MPG (EPA)`
      : ks.mpg_city && ks.mpg_hwy ? `${ks.mpg_city}/${ks.mpg_hwy} MPG` : ks.fuel || null],
    ["EPA Range", epa?.rangeMiles ? `${epa.rangeMiles} mi` : null],
    ["Exterior Color", ks.exterior_color],
    ["Interior Color", ks.interior_color],
    ["Seats", (mc.seating as string | number) ? `${mc.seating}-Passenger` : null],
  ] as [string, unknown][]).filter(([, v]) => v).map(([k, v]) => [k, String(v)] as [string, string]);

  const whyBuy: string[] = [];
  if (saveVsMsrp) whyBuy.push(`Priced ${fmt$(saveVsMsrp)} below MSRP`);
  else if (belowOriginalMsrp) whyBuy.push(`Priced ${fmt$(belowOriginalMsrp)} below original MSRP`);
  if (belowMarket && belowMarket > 0) whyBuy.push(`${fmt$(belowMarket)} below market average`);
  if (warrantyStr && !warrantyExpired) whyBuy.push("Factory warranty remaining");
  if (recallClear) whyBuy.push("No open recalls");
  if (dealerVerified) whyBuy.push("Dealer-verified listing");
  if (ownerCount === 1) whyBuy.push("One owner — personal use");
  if (listing.mileage != null && listing.mileage < 30000) whyBuy.push(`Low mileage — ${listing.mileage.toLocaleString()} mi`);
  if (listing.trim && /luxe|autograph|limited|platinum|premium|touring|sport|signature|reserve|titanium|sensory|denali/i.test(listing.trim)) whyBuy.push(`Premium trim — ${listing.trim}`);
  if (cleanTitle && accidentCount === 0) whyBuy.push("Clean vehicle history");
  else if (accidentCount === 0) whyBuy.push("No accidents reported");
  if (/awd|4wd|4x4/i.test(String(ks.drivetrain || ""))) whyBuy.push(`${ks.drivetrain} — all-weather confidence`);

  const rawOffers = (listing as unknown as { incentives?: unknown }).incentives ?? (mc as { incentives?: unknown }).incentives;
  const offers = (Array.isArray(rawOffers) ? rawOffers : []).map((o) => o as Record<string, unknown>).map((o) => ({
    title: (o.title as string) || (o.program as string) || "Offer",
    body: (o.summary as string) || (o.description as string) || (o.amount ? `$${Number(o.amount).toLocaleString()}` : ""),
    exp: o.valid_through ? `Expires ${new Date(o.valid_through as string).toLocaleDateString()}` : "",
  })).filter((o) => o.body).slice(0, 6);

  const { valueHistory, priceChange7d, priceChangeTotal } = computePriceHistory(listing);

  const t = (listing as unknown as { dealer_trust?: Record<string, string> }).dealer_trust ?? {};
  const dealerTrust = {
    yearsInBusiness: t.years_in_business || "",
    satisfaction: t.satisfaction || "",
    bbbRating: t.bbb_rating || "",
    googleRating: t.google_rating || "",
    googleCount: t.google_count || "",
    certifications: (t.certifications || "").split(",").map((c) => c.trim()).filter(Boolean),
    storefrontUrl: t.storefront_url || "",
    reviewSources: (t.review_sources || "").split("\n").map((line) => {
      const [name, rating, ...rest] = line.split("|").map((p) => p.trim());
      return { name: name || "", rating: rating ? Number(rating) : null, quote: rest.join(" | ") };
    }).filter((r) => r.name),
    advisorName: t.advisor_name || "",
    advisorTitle: t.advisor_title || "",
    advisorPhoto: t.advisor_photo || "",
    advisorResponse: t.advisor_response || "",
    familyOwned: t.family_owned === "yes",
    serviceLocation: t.service_location || "",
    serviceAddress: t.service_address || "",
    delivery: t.delivery || "",
    financing: t.financing === "yes",
    amenities: (t.amenities || "").split(",").map((a) => a.trim()).filter(Boolean),
    services: (t.services || "").split(",").map((a) => a.trim()).filter(Boolean),
    hours: t.hours || "",
    mobileCtaVariant: t.mobile_cta_variant || "dealer_availability",
  };

  return {
    price, msrp, priceLabel, estMonthly, paymentAssumptions, saveVsMsrp, belowOriginalMsrp,
    docFee, websiteSalePrice, priceMode, priceIncludesDoc,
    recon: (listing as unknown as { recon?: PassportData["recon"] }).recon ?? null,
    marketAvg, marketLow, marketHigh, belowMarket,
    marketMeta, comparables, blackbook, marketCheckedAt, history,
    viewCount: listing.view_count ?? null, dom: (mc.dom as number) ?? null,
    ownerCount, accidentCount, cleanTitle, titleStatus, serviceCount, recallClear, openRecalls, hasRecallCheck,
    warranty, warrantyStr, warrantyExpired,
    oemWarranty: ((listing as unknown as { oem_warranty?: OemWarrantyView }).oem_warranty) || null,
    confScore, confLabel, confDeductions, verifiedBy, dealerVerified, verifyRows,
    highlights, specRows, keySpecs, epa, overview, whyBuy,
    reviewRating: (dealer.review_rating as number) ?? null,
    reviewCount: (dealer.review_count as number) ?? null,
    reviewUrl: (dealer.review_url as string) || (dealer.google_url as string) || (dealer.reviews_url as string) || "",
    dealer,
    dealerName: (dealer.name as string) || "the dealership",
    dealerPhone: (dealer.phone as string) || "",
    dealerAddress: [dealer.address, dealer.city, dealer.state, dealer.zip].filter(Boolean).join(", "),
    offers,
    valueHistory, priceChange7d, priceChangeTotal,
    dealerTrust,
    dealerCoverage: (Array.isArray((listing as { dealer_coverage?: unknown[] }).dealer_coverage) ? (listing as unknown as { dealer_coverage: Record<string, unknown>[] }).dealer_coverage : []).map((c) => ({
      title: String(c.title || ""),
      coverage: String(c.coverage || ""),
      termYears: typeof c.term_years === "number" ? c.term_years : null,
      termMiles: typeof c.term_miles === "number" ? c.term_miles : null,
      lifetime: c.lifetime === true,
      mode: c.mode === "available" ? "available" as const : "included" as const,
      offer: String(c.offer || ""),
      disclosure: String(c.disclosure || ""),
    })),
    contactRouting: ((listing as unknown as { contact_routing?: PassportData["contactRouting"] }).contact_routing) ?? null,
    iihsAward: ((listing as unknown as { iihs_award?: PassportData["iihsAward"] }).iihs_award) ?? null,
    historyReport: ((listing as unknown as { history_report?: PassportData["historyReport"] }).history_report) ?? null,
  };
};

// ── Unified vehicle rating ─────────────────────────────────────
// One rating object every passport surface projects from. Each factor scores
// only when it has a real input — never a presence-triggered baseline — and
// carries the evidence lines that justify its score. The overall is a weighted
// mean over measured factors only.

export type RatingFactorKey = "price" | "history" | "demand" | "equipment" | "coverage";

export interface RatingFactor {
  key: RatingFactorKey;
  label: string;
  score: number | null;
  weight: number;
  evidence: string[];
}

export interface RatingTier {
  id: "exceptional" | "strong" | "solid" | "fair" | "closer-look" | "pending";
  label: string;
  // Buy-framed variant of the same band, for surfaces that speak in verdicts
  // (GreatBuy). The bands are identical — only the framing differs.
  buyLabel: string;
}

// The single tier table. Every surface that labels a rating band must read it
// from here so a given score can never carry two different names.
export const ratingTier = (s: number | null): RatingTier =>
  s == null ? { id: "pending", label: "Pending", buyLabel: "Pending Verification" }
  : s >= 90 ? { id: "exceptional", label: "Exceptional", buyLabel: "Exceptional Buy" }
  : s >= 80 ? { id: "strong", label: "Strong", buyLabel: "Strong Buy" }
  : s >= 70 ? { id: "solid", label: "Solid", buyLabel: "Solid Buy" }
  : s >= 60 ? { id: "fair", label: "Fair", buyLabel: "Fair" }
  : { id: "closer-look", label: "Worth a Closer Look", buyLabel: "Worth a Closer Look" };

export interface VehicleRating {
  overall: number | null;
  tier: RatingTier;
  factors: RatingFactor[];
  coverage: { measured: number; total: number; sources: number };
}

// Minimal build-sheet value read (sum of known package/option MSRPs).
// Duplicated from buildSheet.ts because that module imports from this one —
// importing it back would create a cycle.
const buildSheetValue = (listing: VehicleListing): number | null => {
  const mc = (listing.mc_attributes || {}) as Record<string, unknown>;
  const raw = mc.build_sheet as Record<string, unknown> | null | undefined;
  if (!raw || typeof raw !== "object") return null;
  const rows = [
    ...(Array.isArray(raw.packages) ? raw.packages : []),
    ...(Array.isArray(raw.options) ? raw.options : []),
  ] as Record<string, unknown>[];
  const msrps = rows.map((r) => Number(r?.msrp)).filter((n) => Number.isFinite(n) && n > 0);
  return msrps.length ? msrps.reduce((a, b) => a + b, 0) : null;
};

const clampScore = (lo: number, hi: number, v: number) => Math.max(lo, Math.min(hi, Math.round(v)));

export const deriveRating = (listing: VehicleListing, d: PassportData): VehicleRating => {
  const isNew = String((listing as { condition?: string }).condition || "").toLowerCase() === "new";
  const m = d.marketMeta;

  // Price vs Market — continuous around a real anchor. Anchor preference:
  // recently-sold median (strict gate), full-market median/mean from the same
  // enrich pass, live market average, MSRP for a new car. No anchor, no score.
  const soldAnchor = m.soldDisplayable && m.soldCount != null && m.soldCount >= 8
    && m.soldScope === "model_year_state" && m.soldPriceMedian != null ? m.soldPriceMedian : null;
  const statsAnchor = m.priceMedian ?? m.priceMean;
  const anchor = soldAnchor ?? statsAnchor ?? d.marketAvg ?? (isNew ? d.msrp : null);
  const priceEvidence: string[] = [];
  let priceScore: number | null = null;
  if (anchor != null && anchor > 0 && d.price != null) {
    const pct = ((d.price - anchor) / anchor) * 100;
    // 80 at the anchor, +2 per percent below (cap 98), -2 per percent above
    // (floor 55) — continuous, so a $200 move can never flip a whole band.
    priceScore = clampScore(55, 98, 80 - pct * 2);
    if (soldAnchor != null) {
      priceEvidence.push(`Median of ${m.soldCount!.toLocaleString()} recently sold in ${m.soldState ?? "your state"}, 90 days`);
    } else if (statsAnchor != null || d.marketAvg != null) {
      priceEvidence.push(m.similarCount != null
        ? `Checked against ${m.similarCount.toLocaleString()} similar listings${m.radius != null ? ` within ${m.radius} miles` : ""}`
        : "Checked against live local market data");
    } else {
      priceEvidence.push(d.msrp != null && d.price <= d.msrp
        ? `Compared against the ${fmt$(d.msrp)} factory sticker for this build`
        : "Compared against the factory sticker for this build");
    }
    // A dollar anchor is printable only when it sits at or above our price;
    // above the anchor the evidence speaks in bands, never a cheaper figure.
    if (d.price <= anchor) {
      priceEvidence.push(pct <= -1
        ? `Priced ${fmt$(anchor - d.price)} under the market benchmark`
        : "Priced right at the market benchmark");
    } else {
      priceEvidence.push(pct < 3
        ? `Within ${Math.max(1, Math.round(pct))}% of the market benchmark`
        : "Priced above the market benchmark for the model line");
    }
  }

  // Demand & Velocity — null unless at least one real input exists.
  const demandInputs: { score: number; line: string }[] = [];
  if (m.soldDisplayable && m.soldDomMedian != null && m.soldDomMedian >= 1) {
    const sd = Math.round(m.soldDomMedian);
    demandInputs.push({ score: sd <= 30 ? 90 : sd <= 45 ? 80 : sd <= 60 ? 68 : 55, line: `Similar vehicles typically sell in ~${sd} days here` });
  }
  if (d.dom != null && m.avgDom != null && m.avgDom > 0) {
    const r = d.dom / m.avgDom;
    demandInputs.push({ score: r <= 0.5 ? 90 : r <= 1 ? 78 : r <= 1.5 ? 60 : 48, line: `${d.dom} days listed vs a ${m.avgDom}-day market average` });
  }
  if (m.daysSupply != null) {
    demandInputs.push({ score: m.daysSupply < 30 ? 88 : m.daysSupply < 60 ? 72 : 55, line: `${Math.round(m.daysSupply)}-day local supply of similar vehicles` });
  }
  if (d.viewCount != null && d.viewCount >= 5) {
    demandInputs.push({ score: clampScore(40, 95, 40 + d.viewCount), line: `${d.viewCount.toLocaleString()} shoppers have viewed this vehicle` });
  }
  const demandScore = demandInputs.length
    ? clampScore(5, 95, demandInputs.reduce((a, b) => a + b.score, 0) / demandInputs.length)
    : null;

  // History & Title — this IS the labeled-deduction engine (confScore); the
  // deduction receipt is its evidence. Excluded for new cars (no history to
  // grade), which redistributes its weight across the measured factors.
  const historyEvidence = d.confScore == null ? [] : d.confDeductions.length
    ? d.confDeductions.map((x) => `${x.label} (−${x.points} pts)`)
    : ["Every known history signal on this vehicle is clean"];

  // Equipment & Build — continuous on the decoded count plus known factory
  // option value. Null when nothing was decoded from the VIN.
  const equipCount = listingEquipment(listing).length;
  const optValue = buildSheetValue(listing);
  const equipEvidence: string[] = [];
  let equipScore: number | null = null;
  if (equipCount > 0 || optValue != null) {
    const base = equipCount > 0 ? clampScore(55, 90, 55 + equipCount * 2.5) : 60;
    equipScore = Math.min(96, Math.round(base + (optValue ? Math.min(8, optValue / 1500) : 0)));
    if (equipCount > 0) equipEvidence.push(`${equipCount} options decoded from VIN`);
    if (optValue) equipEvidence.push(`${fmt$(optValue)} in factory packages`);
  }

  // Coverage & Care — warranty remainder, dealer-included coverage, service
  // records, dated recon sign-off. Condition credit requires a dated sign-off
  // or real service records; there is no default.
  const covInputs: { score: number; line: string }[] = [];
  const dealerCov = d.dealerCoverage.find((c) => c.mode === "included") || null;
  const factoryScore = (() => {
    if (!d.warrantyStr || d.warrantyExpired) return null;
    const w = d.warranty;
    if (w.in_service_date && w.factory_months) {
      const end = new Date(w.in_service_date);
      end.setMonth(end.getMonth() + w.factory_months);
      const monthsLeft = Math.max(0, end.getTime() - Date.now()) / (1000 * 60 * 60 * 24 * 30.4);
      return clampScore(55, 98, 55 + (monthsLeft / w.factory_months) * 43);
    }
    return 80;
  })();
  if (factoryScore != null) {
    covInputs.push({
      score: factoryScore,
      line: isNew ? `Full factory coverage — ${d.warrantyStr}` : `${d.warrantyStr} factory coverage on the books`,
    });
  }
  if (dealerCov) {
    covInputs.push({
      score: dealerCov.lifetime ? 96 : 90,
      line: dealerCov.lifetime
        ? `Lifetime ${dealerCov.coverage || "powertrain"} coverage included by the dealer`
        : `Dealer ${dealerCov.coverage || "coverage"} included`,
    });
  }
  if (d.serviceCount > 0) {
    covInputs.push({ score: clampScore(70, 92, 70 + d.serviceCount * 4), line: `${d.serviceCount} service record${d.serviceCount === 1 ? "" : "s"} on file` });
  }
  const signedAt = listing.prep_status?.foreman_signed_at || null;
  if (signedAt) {
    covInputs.push({ score: 90, line: `Reconditioning signed off ${new Date(signedAt).toLocaleDateString()}` });
  }
  const covScore = covInputs.length
    ? Math.round(covInputs.reduce((a, b) => a + b.score, 0) / covInputs.length)
    : null;
  const covEvidence = covInputs.map((c) => c.line);
  if (covScore != null && d.warrantyStr && d.warrantyExpired) {
    covEvidence.push("Factory term has ended — ask the dealer about available coverage");
  }

  const factors: RatingFactor[] = [
    { key: "price", label: "Price vs Market", score: priceScore, weight: 30, evidence: priceEvidence },
    ...(isNew ? [] : [{ key: "history" as const, label: "History & Title", score: d.confScore, weight: 25, evidence: historyEvidence }]),
    { key: "demand", label: "Demand & Velocity", score: demandScore, weight: 15, evidence: demandInputs.map((x) => x.line) },
    { key: "equipment", label: "Equipment & Build", score: equipScore, weight: 15, evidence: equipEvidence },
    { key: "coverage", label: "Coverage & Care", score: covScore, weight: 15, evidence: covEvidence },
  ];

  // Overall: weighted mean over measured factors only. It needs at least two
  // measured factors, one of which must be Price or History — a car scored on
  // demand and equipment alone would be a rating without a spine.
  const measured = factors.filter((f) => f.score != null);
  const anchored = measured.some((f) => f.key === "price" || f.key === "history");
  const overall = measured.length >= 2 && anchored
    ? Math.min(97, Math.round(
        measured.reduce((s, f) => s + (f.score as number) * f.weight, 0) /
        measured.reduce((s, f) => s + f.weight, 0),
      ))
    : null;

  const mc = (listing.mc_attributes || {}) as Record<string, unknown>;
  const sources = [
    anchor != null || m.similarCount != null,
    typeof mc.carfax_clean_title === "boolean" || d.ownerCount != null || d.accidentCount != null,
    d.hasRecallCheck,
    equipCount > 0 || optValue != null,
    !!d.warrantyStr || dealerCov != null,
    d.serviceCount > 0 || !!signedAt,
  ].filter(Boolean).length;

  return {
    overall,
    tier: ratingTier(overall),
    factors,
    coverage: { measured: measured.length, total: factors.length, sources },
  };
};

// ── Sold-data claim gates ──────────────────────────────────────
// Every customer-facing claim built on market_meta.sold_stats passes through
// one of these gates; a claim is null unless its evidence bar is met, and the
// sold-price gate is the strictest — it may print a dollar figure, which by
// construction is above our price, never below it.
export interface SoldClaims {
  velocity: string | null;
  soldPrice: { headline: string; sub: string; amount: number } | null;
  sellTime: string | null;
  milesAdv: string | null;
}

export const deriveSoldClaims = (d: PassportData, mileage: number | null, condition?: string | null): SoldClaims => {
  const m = d.marketMeta;
  const none: SoldClaims = { velocity: null, soldPrice: null, sellTime: null, milesAdv: null };
  if (!m.soldDisplayable || m.soldCount == null || !m.soldState) return none;
  const isNewCar = String(condition || "").toLowerCase() === "new";
  const noun = isNewCar ? "same-model vehicles" : "similar vehicles";
  const velocity = `${m.soldCount.toLocaleString()} ${noun} sold in ${m.soldState} in the last 90 days`;
  const aboveMarket = d.marketAvg != null && d.price != null && d.price > d.marketAvg;
  const soldPrice = m.soldCount >= 10 && m.soldScope === "model_year_state" && m.soldPriceMedian != null
    && d.price != null && d.price <= m.soldPriceMedian * 0.97
    && (mileage == null || m.soldMilesMedian == null || mileage <= m.soldMilesMedian * 1.25)
    && !aboveMarket
    ? {
        headline: `Priced ${fmt$(m.soldPriceMedian - d.price)} below the typical sold price`,
        sub: `Median of ${m.soldCount.toLocaleString()} recently sold in ${m.soldState}, last 90 days`,
        amount: m.soldPriceMedian - d.price,
      }
    : null;
  const sellTime = m.soldDomMedian != null && m.soldDomMedian >= 1 && m.soldDomMedian <= 60
    ? `Similar vehicles typically sell within ~${Math.round(m.soldDomMedian)} days here`
    : null;
  const milesAdv = mileage != null && m.soldMilesMedian != null && m.soldMilesMedian >= mileage * 1.15
    ? `${mileage.toLocaleString()} miles — under the ${Math.round(m.soldMilesMedian).toLocaleString()}-mile median of recently sold vehicles`
    : null;
  return { velocity, soldPrice, sellTime, milesAdv };
};
