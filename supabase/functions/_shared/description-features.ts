// ─────────────────────────────────────────────────────────────────────
// Canonical feature layer for Description V3.
//
// Two problems this solves, both of which produce dishonest copy when
// left to raw feed strings:
//
//   1. The same physical feature arrives under several names. "Around
//      View Monitor", "360-Degree Camera" and "Surround View Camera" are
//      one canonical feature; listing all three reads as three features
//      the vehicle does not have.
//   2. A dealer-installed product and a factory option are indistinguishable
//      as strings. Describing an aftermarket item as factory equipment is a
//      material misstatement, so origin travels with the feature forever.
//
// Nothing here decides WHETHER the vehicle has a feature — that is the
// truth snapshot's job. This layer only normalizes, classifies and ranks
// what the snapshot already established.
// ─────────────────────────────────────────────────────────────────────

export type FeatureCategory =
  | "performance" | "drivetrain" | "safety" | "driver_assistance" | "technology"
  | "audio" | "comfort" | "seating" | "climate" | "exterior" | "interior"
  | "utility" | "towing" | "charging" | "packages" | "dealer_added" | "other";

export type FeatureOrigin =
  | "factory_standard" | "factory_option" | "factory_package" | "dealer_added";

export interface CanonicalFeatureDef {
  id: string;
  display: string;
  category: FeatureCategory;
  /** Lowercased synonyms. The raw string is normalized before matching. */
  aliases: string[];
  /** Customer relevance, 0-100. Drives prioritization, never inclusion. */
  relevance: number;
  /** Lens weights — how much this feature matters under each tone. */
  lenses?: Partial<Record<"luxury" | "sporty" | "family" | "value" | "professional", number>>;
  /** Rare equipment differentiates a listing more than universal equipment. */
  rarity?: number;
  /** Canonical package this feature is normally delivered inside. */
  package?: string;
}

// The catalog is intentionally a curated list of features shoppers actually
// search and compare on. Anything not listed still flows through as an
// `other`-category feature — it is never dropped, only ranked lower.
export const FEATURE_CATALOG: CanonicalFeatureDef[] = [
  // ── Driver assistance / safety ─────────────────────────────────────
  { id: "surround_view_camera", display: "360° Around View Monitor", category: "driver_assistance",
    aliases: ["around view monitor", "360 degree camera", "360 camera", "surround view camera",
              "surround vision", "birds eye camera", "bird's eye view camera", "360-degree camera",
              "around view monitor with moving object detection"],
    relevance: 78, rarity: 45, lenses: { family: 85, luxury: 80 } },
  { id: "adaptive_cruise_control", display: "Adaptive Cruise Control", category: "driver_assistance",
    aliases: ["adaptive cruise control", "intelligent cruise control", "dynamic radar cruise control",
              "smart cruise control", "acc"],
    relevance: 80, rarity: 45, lenses: { family: 84, professional: 82 } },
  { id: "propilot_assist", display: "ProPILOT Assist", category: "driver_assistance",
    aliases: ["propilot assist", "pro pilot assist", "propilot", "pro-pilot assist"],
    relevance: 82, rarity: 60, lenses: { family: 86, luxury: 82 } },
  { id: "blind_spot_monitor", display: "Blind Spot Monitoring", category: "safety",
    aliases: ["blind spot monitor", "blind spot monitoring", "blind spot warning",
              "blind spot intervention", "bsm"],
    relevance: 74, rarity: 30, lenses: { family: 84 } },
  { id: "lane_departure_warning", display: "Lane Departure Warning", category: "safety",
    aliases: ["lane departure warning", "lane keep assist", "lane keeping assist", "lane departure prevention"],
    relevance: 66, rarity: 28, lenses: { family: 78 } },
  { id: "auto_emergency_braking", display: "Automatic Emergency Braking", category: "safety",
    aliases: ["automatic emergency braking", "forward collision warning", "forward emergency braking",
              "pre-collision system", "collision mitigation braking", "aeb"],
    relevance: 76, rarity: 25, lenses: { family: 88 } },
  { id: "rear_cross_traffic_alert", display: "Rear Cross Traffic Alert", category: "safety",
    aliases: ["rear cross traffic alert", "rear cross-traffic alert", "cross traffic alert", "rcta"],
    relevance: 62, rarity: 30, lenses: { family: 76 } },
  { id: "head_up_display", display: "Head-Up Display", category: "technology",
    aliases: ["head up display", "head-up display", "hud", "heads up display", "heads-up display"],
    relevance: 70, rarity: 62, lenses: { luxury: 84, sporty: 78 } },
  { id: "night_vision", display: "Night Vision", category: "driver_assistance",
    aliases: ["night vision", "night view assist"], relevance: 60, rarity: 88, lenses: { luxury: 82 } },

  // ── Technology ─────────────────────────────────────────────────────
  { id: "navigation", display: "Navigation System", category: "technology",
    aliases: ["navigation", "navigation system", "nav system", "built-in navigation",
              "gps navigation", "in-dash navigation"],
    relevance: 68, rarity: 30, lenses: { professional: 72, luxury: 74 } },
  { id: "apple_carplay", display: "Wireless Apple CarPlay", category: "technology",
    aliases: ["apple carplay", "wireless apple carplay", "carplay", "wireless carplay"],
    relevance: 79, rarity: 25, lenses: { family: 80, value: 80 } },
  { id: "android_auto", display: "Android Auto", category: "technology",
    aliases: ["android auto", "wireless android auto"], relevance: 76, rarity: 25, lenses: { value: 78 } },
  { id: "wireless_charging", display: "Wireless Device Charging", category: "technology",
    aliases: ["wireless charging", "wireless phone charging", "wireless charging pad", "qi charging"],
    relevance: 58, rarity: 40 },
  { id: "digital_cluster", display: "Digital Instrument Cluster", category: "technology",
    aliases: ["digital instrument cluster", "digital gauge cluster", "virtual cockpit", "digital cockpit"],
    relevance: 60, rarity: 50, lenses: { luxury: 74, sporty: 72 } },
  { id: "rear_entertainment", display: "Rear Seat Entertainment", category: "technology",
    aliases: ["rear seat entertainment", "rear entertainment system", "dvd entertainment system",
              "rear entertainment"],
    relevance: 55, rarity: 66, lenses: { family: 84 } },

  // ── Audio ──────────────────────────────────────────────────────────
  { id: "bose_audio", display: "Bose Premium Audio", category: "audio",
    aliases: ["bose", "bose audio", "bose premium audio", "bose performance series",
              "bose premium sound", "bose sound system"],
    relevance: 72, rarity: 55, lenses: { luxury: 84 }, package: "premium_audio" },
  { id: "harman_kardon_audio", display: "Harman Kardon Audio", category: "audio",
    aliases: ["harman kardon", "harman/kardon", "harman kardon audio", "harman kardon sound system"],
    relevance: 72, rarity: 58, lenses: { luxury: 84 }, package: "premium_audio" },
  { id: "premium_audio", display: "Premium Audio System", category: "audio",
    aliases: ["premium audio", "premium sound system", "premium sound"],
    relevance: 60, rarity: 40, lenses: { luxury: 74 }, package: "premium_audio" },

  // ── Comfort / seating / climate ────────────────────────────────────
  { id: "heated_seats", display: "Heated Front Seats", category: "comfort",
    aliases: ["heated seats", "heated front seats", "front heated seats", "heated driver seat"],
    relevance: 74, rarity: 20, lenses: { family: 78, value: 78 } },
  { id: "ventilated_seats", display: "Ventilated Front Seats", category: "comfort",
    aliases: ["ventilated seats", "cooled seats", "climate controlled seats", "air conditioned seats",
              "ventilated front seats"],
    relevance: 70, rarity: 55, lenses: { luxury: 84 } },
  { id: "heated_rear_seats", display: "Heated Rear Seats", category: "comfort",
    aliases: ["heated rear seats", "rear heated seats", "second row heated seats"],
    relevance: 58, rarity: 58, lenses: { family: 76, luxury: 76 } },
  { id: "heated_steering_wheel", display: "Heated Steering Wheel", category: "comfort",
    aliases: ["heated steering wheel", "heated wheel"], relevance: 60, rarity: 40 },
  { id: "massaging_seats", display: "Massaging Front Seats", category: "comfort",
    aliases: ["massage seats", "massaging seats", "massaging front seats"],
    relevance: 58, rarity: 82, lenses: { luxury: 90 } },
  { id: "leather_seats", display: "Leather Seating", category: "interior",
    aliases: ["leather seats", "leather seating", "leather upholstery", "leather-appointed seating"],
    relevance: 68, rarity: 32, lenses: { luxury: 80 } },
  { id: "nappa_leather", display: "Semi-Aniline Leather", category: "interior",
    aliases: ["nappa leather", "semi-aniline leather", "semi aniline leather", "nappa"],
    relevance: 60, rarity: 78, lenses: { luxury: 88 } },
  { id: "tri_zone_climate", display: "Tri-Zone Climate Control", category: "climate",
    aliases: ["tri-zone climate control", "tri zone climate", "3-zone climate control",
              "three zone climate control"],
    relevance: 62, rarity: 42, lenses: { family: 78 } },
  { id: "dual_zone_climate", display: "Dual-Zone Climate Control", category: "climate",
    aliases: ["dual zone climate control", "dual-zone climate control", "2-zone climate control"],
    relevance: 52, rarity: 18 },
  { id: "third_row_seating", display: "Third-Row Seating", category: "seating",
    aliases: ["third row seating", "3rd row seating", "third row seat", "third-row seating", "7 passenger seating"],
    relevance: 80, rarity: 45, lenses: { family: 92, value: 74 } },
  { id: "captains_chairs", display: "Second-Row Captain's Chairs", category: "seating",
    aliases: ["captains chairs", "captain's chairs", "second row captains chairs", "bucket seats second row"],
    relevance: 62, rarity: 55, lenses: { family: 80, luxury: 76 } },
  { id: "power_liftgate", display: "Power Liftgate", category: "utility",
    aliases: ["power liftgate", "power tailgate", "hands free liftgate", "hands-free liftgate",
              "power rear liftgate"],
    relevance: 64, rarity: 35, lenses: { family: 78 } },
  { id: "panoramic_roof", display: "Panoramic Moonroof", category: "exterior",
    aliases: ["panoramic moonroof", "panoramic sunroof", "panoramic roof", "pano roof", "panoramic glass roof"],
    relevance: 76, rarity: 52, lenses: { luxury: 86, family: 78 } },
  { id: "moonroof", display: "Moonroof", category: "exterior",
    aliases: ["moonroof", "sunroof", "power moonroof", "power sunroof"],
    relevance: 62, rarity: 28 },

  // ── Performance / drivetrain / utility ─────────────────────────────
  { id: "awd", display: "All-Wheel Drive", category: "drivetrain",
    aliases: ["awd", "all wheel drive", "all-wheel drive", "intelligent awd", "quattro", "4matic", "xdrive"],
    relevance: 84, rarity: 35, lenses: { family: 86, value: 82, sporty: 80 } },
  { id: "four_wheel_drive", display: "Four-Wheel Drive", category: "drivetrain",
    aliases: ["4wd", "four wheel drive", "four-wheel drive", "4x4"],
    relevance: 82, rarity: 38, lenses: { value: 80, sporty: 74 } },
  { id: "adaptive_suspension", display: "Adaptive Suspension", category: "performance",
    aliases: ["adaptive suspension", "air suspension", "electronic damping", "adaptive dampers",
              "dynamic digital suspension"],
    relevance: 62, rarity: 70, lenses: { luxury: 82, sporty: 88 } },
  { id: "sport_mode", display: "Selectable Drive Modes", category: "performance",
    aliases: ["drive mode selector", "selectable drive modes", "sport mode", "drive mode select"],
    relevance: 52, rarity: 30, lenses: { sporty: 78 } },
  { id: "tow_package", display: "Tow Package", category: "towing",
    aliases: ["tow package", "towing package", "trailer tow package", "tow hitch receiver", "trailer hitch"],
    relevance: 66, rarity: 48, lenses: { value: 76 }, package: "towing" },
  { id: "roof_rails", display: "Roof Rails", category: "utility",
    aliases: ["roof rails", "roof rack", "roof rack rails"], relevance: 48, rarity: 30 },
  { id: "alloy_wheels", display: "Alloy Wheels", category: "exterior",
    aliases: ["alloy wheels", "aluminum wheels", "alloy rims"], relevance: 42, rarity: 15 },

  // ── Electrification ────────────────────────────────────────────────
  { id: "dc_fast_charging", display: "DC Fast Charging", category: "charging",
    aliases: ["dc fast charging", "dc fast charge", "fast charging capability", "ccs fast charging"],
    relevance: 78, rarity: 45 },
  { id: "onboard_charger_11kw", display: "11 kW Onboard Charger", category: "charging",
    aliases: ["11kw onboard charger", "11 kw onboard charger", "onboard charger 11kw"],
    relevance: 56, rarity: 60 },
  { id: "heat_pump", display: "Heat Pump", category: "charging",
    aliases: ["heat pump", "heat pump system"], relevance: 54, rarity: 65 },
];

const CATALOG_BY_ALIAS = (() => {
  const m = new Map<string, CanonicalFeatureDef>();
  for (const def of FEATURE_CATALOG) {
    for (const a of [def.display, ...def.aliases]) m.set(normalizeToken(a), def);
  }
  return m;
})();

export const featureById = (id: string) => FEATURE_CATALOG.find((f) => f.id === id);

// Normalization is deliberately aggressive: feeds vary on punctuation, the
// degree sign, trailing "system"/"package", and pluralization. Two strings
// that describe one feature must collapse to one token or the shopper sees
// the same equipment listed twice.
export function normalizeToken(raw: string): string {
  return String(raw || "")
    .toLowerCase()
    .replace(/[°’'"]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(system|systems|package|pkg|feature|features|w|with)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export interface RawFeatureInput {
  name: string;
  origin: FeatureOrigin;
  source: string;
  /** 0-100. Callers pass the truth-snapshot confidence for the source. */
  confidence: number;
  packageName?: string | null;
  conflict?: boolean;
  descriptionEligible?: boolean;
  publicEligible?: boolean;
}

export interface NormalizedFeature {
  canonical_id: string;
  display_name: string;
  category: FeatureCategory;
  origin: FeatureOrigin;
  source: string;
  confidence: number;
  package_id: string | null;
  package_name: string | null;
  conflict: boolean;
  description_eligible: boolean;
  public_eligible: boolean;
  /** Every raw string that collapsed into this canonical feature. */
  aliases_seen: string[];
  in_catalog: boolean;
}

const ORIGIN_RANK: Record<FeatureOrigin, number> = {
  factory_standard: 3, factory_package: 2, factory_option: 2, dealer_added: 1,
};

/**
 * Collapse raw feature strings onto canonical features.
 *
 * Origin precedence matters more than order of arrival: if the factory decode
 * and a dealer-added list both mention "Roof Rails", the factory record wins
 * the origin. The dealer copy is not silently promoted to factory equipment,
 * and a dealer-only feature keeps `dealer_added` forever.
 */
export function normalizeFeatures(inputs: RawFeatureInput[]): NormalizedFeature[] {
  const byId = new Map<string, NormalizedFeature>();

  for (const raw of inputs) {
    const name = String(raw?.name || "").trim();
    if (!name) continue;
    const token = normalizeToken(name);
    if (!token) continue;
    const def = CATALOG_BY_ALIAS.get(token);
    const canonicalId = def ? def.id : `uncataloged:${token.replace(/ /g, "_")}`;

    const candidate: NormalizedFeature = {
      canonical_id: canonicalId,
      display_name: def ? def.display : titleCase(name),
      category: def ? def.category : raw.origin === "dealer_added" ? "dealer_added" : "other",
      origin: raw.origin,
      source: raw.source,
      confidence: clamp(raw.confidence, 0, 100),
      package_id: def?.package ?? null,
      package_name: raw.packageName ?? null,
      conflict: !!raw.conflict,
      description_eligible: raw.descriptionEligible !== false && !raw.conflict,
      public_eligible: raw.publicEligible !== false && !raw.conflict,
      aliases_seen: [name],
      in_catalog: !!def,
    };

    const existing = byId.get(canonicalId);
    if (!existing) { byId.set(canonicalId, candidate); continue; }

    // Merge. The stronger origin owns the record; confidence takes the max of
    // agreeing sources; a conflict anywhere poisons eligibility everywhere.
    const winner = ORIGIN_RANK[candidate.origin] > ORIGIN_RANK[existing.origin] ? candidate : existing;
    const merged: NormalizedFeature = {
      ...winner,
      confidence: Math.max(existing.confidence, candidate.confidence),
      package_id: existing.package_id ?? candidate.package_id,
      package_name: existing.package_name ?? candidate.package_name,
      conflict: existing.conflict || candidate.conflict,
      description_eligible: existing.description_eligible && candidate.description_eligible,
      public_eligible: existing.public_eligible && candidate.public_eligible,
      aliases_seen: dedupe([...existing.aliases_seen, ...candidate.aliases_seen]),
      source: existing.source === candidate.source ? existing.source
        : dedupe([existing.source, candidate.source]).sort().join("+"),
    };
    merged.description_eligible = merged.description_eligible && !merged.conflict;
    merged.public_eligible = merged.public_eligible && !merged.conflict;
    byId.set(canonicalId, merged);
  }

  return [...byId.values()];
}

// ── Prioritization ───────────────────────────────────────────────────
// Deterministic by construction: same inputs, same order, every run. The
// point is to avoid feature dumping — a description that lists forty decoded
// options reads as a spec sheet and buries what the shopper cares about.

export type ToneKey = "professional" | "luxury" | "sporty" | "family" | "value";

export interface PrioritizationContext {
  tone: ToneKey;
  /** Channel feature budget — how many features this destination can carry. */
  featureBudget: number;
  bodyStyle?: string | null;
  fuelType?: string | null;
  /** Categories the dealer wants suppressed for this tenant. */
  suppressedCategories?: FeatureCategory[];
  /**
   * Categories the selected tone leads with, supplied by the caller from the
   * tone profile. Passed in rather than imported so the feature layer stays
   * free of a dependency on the tone layer (which already depends on this one).
   */
  toneEmphasis?: FeatureCategory[];
}

export interface PrioritizedFeature extends NormalizedFeature {
  priority_score: number;
  priority_rank: number;
  selected: boolean;
  selection_reason: string;
}

const SEGMENT_BOOST: Array<{ match: RegExp; categories: FeatureCategory[]; boost: number }> = [
  { match: /suv|crossover|wagon|van/i, categories: ["seating", "utility", "towing"], boost: 12 },
  { match: /truck|pickup/i, categories: ["towing", "utility", "drivetrain"], boost: 16 },
  { match: /coupe|convertible|roadster/i, categories: ["performance", "exterior"], boost: 12 },
  { match: /sedan/i, categories: ["comfort", "technology"], boost: 8 },
];

export function prioritizeFeatures(
  features: NormalizedFeature[], ctx: PrioritizationContext,
): PrioritizedFeature[] {
  const suppressed = new Set(ctx.suppressedCategories || []);
  const emphasized = new Set(ctx.toneEmphasis || []);
  const electrified = /electric|hybrid|plug|phev|bev/i.test(String(ctx.fuelType || ""));

  const scored = features.map((f) => {
    const def = featureById(f.canonical_id);
    let score = def?.relevance ?? 30;

    // Tone shifts EMPHASIS only. It can move a verified feature up or down the
    // list; it can never add one or change what the feature is.
    const lens = def?.lenses?.[ctx.tone];
    if (typeof lens === "number") score = (score + lens) / 2;

    // Confidence is a hard multiplier: a low-confidence feature never leads.
    score *= 0.5 + (f.confidence / 200);

    // Rare equipment differentiates the listing.
    score += (def?.rarity ?? 20) * 0.15;

    // The tone's declared emphasis has to outweigh the segment boost, or a
    // body-style rule silently overrides the tone the user chose — an SUV
    // would lead with seating even under the sporty tone.
    if (emphasized.has(f.category)) score += 18;

    for (const seg of SEGMENT_BOOST) {
      if (seg.match.test(String(ctx.bodyStyle || "")) && seg.categories.includes(f.category)) score += seg.boost;
    }
    if (electrified && f.category === "charging") score += 20;
    if (!electrified && f.category === "charging") score -= 25;

    // Dealer-added products are real and may be described, but they are not
    // what a shopper is shopping the model for.
    if (f.origin === "dealer_added") score -= 12;
    if (!f.in_catalog) score -= 8;
    if (suppressed.has(f.category)) score -= 60;
    if (!f.description_eligible) score -= 1000;

    return { ...f, priority_score: Math.round(score * 100) / 100 };
  });

  // Stable ordering: score desc, then canonical id asc. Never insertion order —
  // the feed reshuffling its option array must not reshuffle the copy.
  scored.sort((a, b) =>
    b.priority_score - a.priority_score || a.canonical_id.localeCompare(b.canonical_id));

  const budget = Math.max(0, ctx.featureBudget);
  const seenCategories = new Map<FeatureCategory, number>();
  const out: PrioritizedFeature[] = [];
  let taken = 0;

  for (const f of scored) {
    const rank = out.length + 1;
    if (!f.description_eligible) {
      out.push({ ...f, priority_rank: rank, selected: false,
        selection_reason: f.conflict ? "excluded: unresolved source conflict" : "excluded: not description-eligible" });
      continue;
    }
    // Category saturation guard: three heated/ventilated/heated-rear entries in
    // a row is the synonym problem wearing a different hat.
    const used = seenCategories.get(f.category) ?? 0;
    if (taken >= budget) {
      out.push({ ...f, priority_rank: rank, selected: false, selection_reason: "below the channel feature budget" });
      continue;
    }
    if (used >= 3) {
      out.push({ ...f, priority_rank: rank, selected: false, selection_reason: `category limit reached (${f.category})` });
      continue;
    }
    seenCategories.set(f.category, used + 1);
    taken++;
    out.push({ ...f, priority_rank: rank, selected: true, selection_reason: "prioritized for this channel and tone" });
  }
  return out;
}

/** Stable identity for the selected feature set — feeds the idempotency key. */
export async function featureChecksum(ids: string[]): Promise<string> {
  const material = [...ids].map((s) => String(s).trim().toLowerCase()).sort().join("|");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(material));
  return "feat_" + Array.from(new Uint8Array(digest)).slice(0, 8)
    .map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Features grouped for the description packet. Factory and dealer-added are
 * returned in separate buckets so a prompt physically cannot merge them.
 */
export function splitByOrigin(features: PrioritizedFeature[]): {
  factory: PrioritizedFeature[]; dealerAdded: PrioritizedFeature[]; excluded: PrioritizedFeature[];
} {
  const selected = features.filter((f) => f.selected);
  return {
    factory: selected.filter((f) => f.origin !== "dealer_added"),
    dealerAdded: selected.filter((f) => f.origin === "dealer_added"),
    excluded: features.filter((f) => !f.selected),
  };
}

const clamp = (n: number, lo: number, hi: number) =>
  Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : lo;
const dedupe = (a: string[]) => [...new Set(a.filter(Boolean))];
const titleCase = (s: string) =>
  s.replace(/\s+/g, " ").trim().replace(/\b([a-z])(\w*)/g, (_, a: string, b: string) => a.toUpperCase() + b);
