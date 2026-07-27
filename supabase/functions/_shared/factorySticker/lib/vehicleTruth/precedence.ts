// GENERATED — do not edit.
// Mirror of src/lib/vehicleTruth/precedence.ts, copied so the edge runtime can
// bundle the engine (Supabase ships only supabase/functions/). Edit the
// source file and run `bun run sync:edge-sticker`.
// Field-aware source precedence.
//
// One global provider ranking is wrong, because who is authoritative
// depends on the fact. The manufacturer is authoritative about what it
// built and what it charged for it; the dealership is authoritative about
// its own stock number, its current mileage and its advertised price. A
// dealer correction must be able to fix a stock number without being able
// to rewrite the original base MSRP.
//
// AI inference appears in the ordering so that it can be ranked, never so
// that it can win: it is capped below every structured source and can
// never produce a verified fact.

export type SourceKind =
  | "oem_authorized"
  | "neovin"
  | "marketcheck"
  | "dealer_confirmed"
  | "vin_decode"
  | "other_structured"
  | "ai_inference";

export const SOURCE_KINDS: SourceKind[] = [
  "oem_authorized",
  "neovin",
  "marketcheck",
  "dealer_confirmed",
  "vin_decode",
  "other_structured",
  "ai_inference",
];

/** Who controls the fact — which decides whose correction may win. */
export type FactAuthority = "manufacturer" | "dealer" | "shared";

export type Confidence = "VERIFIED" | "HIGH" | "MEDIUM" | "LOW" | "UNVERIFIED";

// Default ordering, best first. Field-specific rules below re-rank it.
const DEFAULT_ORDER: SourceKind[] = [
  "oem_authorized",
  "neovin",
  "marketcheck",
  "dealer_confirmed",
  "vin_decode",
  "other_structured",
  "ai_inference",
];

// Facts the dealership controls. A dealer correction outranks every
// provider here, because the provider is describing a listing the dealer
// owns.
const DEALER_CONTROLLED = new Set([
  "stock_number",
  "mileage",
  "advertised_price",
  "dealer_installed_equipment",
  "dealer_discount",
  "doc_fee",
  "condition_notes",
]);

// Facts the manufacturer controls. A dealer may DISPUTE these — which
// raises a conflict for a human — but a dealer correction never silently
// outranks verified manufacturer data.
const MANUFACTURER_CONTROLLED = new Set([
  "manufacturer",
  "make",
  "model_year",
  "base_msrp",
  "destination_charge",
  "total_msrp",
  "factory_option_price",
  "factory_package",
  "factory_option",
  "standard_equipment",
  "drivetrain",
  "engine",
  "transmission",
  "exterior_color_code",
  "interior_color_code",
  "assembly_plant",
  "parts_content",
]);

export function factAuthority(factKey: string): FactAuthority {
  const key = factKey.trim().toLowerCase();
  if (DEALER_CONTROLLED.has(key)) return "dealer";
  if (MANUFACTURER_CONTROLLED.has(key)) return "manufacturer";
  return "shared";
}

/**
 * Source ranking for one fact, best first.
 *
 * For a dealer-controlled fact the dealer's own confirmation moves to the
 * top. For a manufacturer-controlled fact it drops below every verified
 * provider — present, so it can still fill a gap no provider answered,
 * but never able to overwrite the manufacturer.
 */
export function precedenceFor(factKey: string): SourceKind[] {
  const authority = factAuthority(factKey);
  if (authority === "dealer") {
    return [
      "dealer_confirmed",
      "oem_authorized",
      "neovin",
      "marketcheck",
      "vin_decode",
      "other_structured",
      "ai_inference",
    ];
  }
  if (authority === "manufacturer") {
    return [
      "oem_authorized",
      "neovin",
      "marketcheck",
      "vin_decode",
      "other_structured",
      "dealer_confirmed",
      "ai_inference",
    ];
  }
  return [...DEFAULT_ORDER];
}

export function sourceRank(
  factKey: string,
  source: SourceKind,
  configuredOrder?: SourceKind[] | null,
): number {
  // A dealership that configured "MSRP comes from the VIN decoder" on the
  // Source Authority screen means it. A source the tenant did not rank
  // falls in behind every source it did, rather than jumping the queue on
  // the built-in ordering.
  if (configuredOrder?.length) {
    const idx = configuredOrder.indexOf(source);
    if (idx >= 0) return idx;
    return configuredOrder.length + precedenceFor(factKey).indexOf(source);
  }
  const order = precedenceFor(factKey);
  const idx = order.indexOf(source);
  return idx < 0 ? order.length : idx;
}

// Confidence a source can produce at best. AI inference is capped at LOW
// and can never be VERIFIED, whatever the caller claims.
const MAX_CONFIDENCE: Record<SourceKind, Confidence> = {
  oem_authorized: "VERIFIED",
  neovin: "VERIFIED",
  marketcheck: "HIGH",
  dealer_confirmed: "VERIFIED",
  vin_decode: "MEDIUM",
  other_structured: "MEDIUM",
  ai_inference: "LOW",
};

const CONFIDENCE_ORDER: Confidence[] = ["VERIFIED", "HIGH", "MEDIUM", "LOW", "UNVERIFIED"];

export function capConfidence(source: SourceKind, claimed: Confidence): Confidence {
  const ceiling = MAX_CONFIDENCE[source] ?? "UNVERIFIED";
  const claimedIdx = CONFIDENCE_ORDER.indexOf(claimed);
  const ceilingIdx = CONFIDENCE_ORDER.indexOf(ceiling);
  // Larger index means weaker, so the weaker of the two wins.
  return CONFIDENCE_ORDER[Math.max(claimedIdx < 0 ? CONFIDENCE_ORDER.length - 1 : claimedIdx, ceilingIdx)];
}

/** A fact is verified only when a source allowed to verify it says so. */
export function isVerified(source: SourceKind, claimed: Confidence): boolean {
  return capConfidence(source, claimed) === "VERIFIED";
}

/** AI may suggest and flag. It may never be treated as fact. */
export function canProduceVerifiedFact(source: SourceKind): boolean {
  return MAX_CONFIDENCE[source] === "VERIFIED";
}

export interface CandidateFact<T = unknown> {
  factKey: string;
  value: T;
  source: SourceKind;
  confidence: Confidence;
  sourceTimestamp?: string | null;
}

export interface ResolvedFact<T = unknown> {
  factKey: string;
  value: T;
  source: SourceKind;
  confidence: Confidence;
  /** Candidates that disagreed with the winner. */
  conflicting: Array<CandidateFact<T>>;
  /** True when a disagreement needs a human, not just a ranking. */
  disputed: boolean;
  /** The tenant configured this disagreement to stop generation. */
  blocking: boolean;
}

export interface ResolveOptions {
  /**
   * Source order the tenant configured for this fact, best first, from
   * `source_authority_rules` via `compileTenantAuthority`.
   */
  configuredOrder?: SourceKind[] | null;
  /** The tenant's configured behaviour when sources disagree. */
  conflictBehavior?: "warn" | "block_generation" | "ignore";
}

const sameValue = (a: unknown, b: unknown): boolean =>
  JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * Resolve competing candidates for one fact.
 *
 * Ranking picks the winner. A disagreement between two sources that are
 * BOTH allowed to verify the fact is not settled by ranking alone — that
 * is a real conflict and is marked disputed so a person decides.
 */
export function resolveFact<T>(
  candidates: Array<CandidateFact<T>>,
  options: ResolveOptions = {},
): ResolvedFact<T> | null {
  if (!candidates.length) return null;
  const factKey = candidates[0].factKey;
  const configuredOrder = options.configuredOrder ?? null;

  const ranked = [...candidates].sort((a, b) => {
    const byRank = sourceRank(factKey, a.source, configuredOrder)
      - sourceRank(factKey, b.source, configuredOrder);
    if (byRank !== 0) return byRank;
    // Same source rank: prefer the stronger confidence, then the newer.
    const byConf = CONFIDENCE_ORDER.indexOf(capConfidence(a.source, a.confidence))
      - CONFIDENCE_ORDER.indexOf(capConfidence(b.source, b.confidence));
    if (byConf !== 0) return byConf;
    return String(b.sourceTimestamp ?? "").localeCompare(String(a.sourceTimestamp ?? ""));
  });

  const winner = ranked[0];
  const conflicting = ranked.slice(1).filter((c) => !sameValue(c.value, winner.value));

  // Two sources that may both verify this fact, disagreeing, is a dispute
  // rather than a ranking outcome. A tenant may raise that to a blocker or
  // silence it entirely through the Source Authority screen, but may never
  // turn a non-disagreement into one.
  const naturallyDisputed = conflicting.some((c) =>
    canProduceVerifiedFact(c.source)
    && canProduceVerifiedFact(winner.source)
    && capConfidence(c.source, c.confidence) === "VERIFIED"
    && capConfidence(winner.source, winner.confidence) === "VERIFIED");
  const disputed = options.conflictBehavior === "ignore" ? false : naturallyDisputed;

  return {
    factKey,
    value: winner.value,
    source: winner.source,
    confidence: capConfidence(winner.source, winner.confidence),
    conflicting,
    disputed,
    // "block_generation" only bites on a fact that is actually disputed;
    // configuring it does not stop a vehicle whose sources agree.
    blocking: disputed && options.conflictBehavior === "block_generation",
  };
}
