// ── Two fingerprints, because there are two kinds of change ────────────────
//
// The market moves. A car's price moves. These are not the same event and
// collapsing them has a cost in both directions:
//
//   • one fingerprint over everything → a dealer's $500 price drop reads as a
//     new market, so every sibling gets re-evaluated for nothing;
//   • no shared fingerprint at all → a genuinely changed market never reaches
//     the three identical cars sitting beside the one we just looked at.
//
// So:
//
//   MARKET SNAPSHOT FINGERPRINT — the normalized evidence for a COHORT. No
//   VIN, no asking price. One snapshot legitimately informs many vehicles.
//
//   VALUATION FINGERPRINT — one subject vehicle, including its VIN, its price
//   and the snapshot it was judged against. Two VINs can never share one.
//
// The relationship is one-to-many in exactly one direction: a changed snapshot
// produces a new valuation fingerprint for an unchanged car, and a changed car
// never produces a new snapshot.
//
// PROVIDER LICENSING: these observations are MarketCheck's active-listing data,
// retained as normalized evidence for the dealer whose valuation they support.
// The snapshot stores no image, no description, no VDP URL and no provider
// identifier beyond the dealer name the comparison needs. It is evidence for a
// decision we made, not a redistributable copy of a provider's catalogue, and
// it is scoped to one tenant and expires on the freshness window below.

import { digest } from "./hash.ts";
import { cohortKeyHash, type MarketCohortKey } from "./cohort.ts";

/** Bump when the MEANING of a stored snapshot changes. */
export const SNAPSHOT_RULES_VERSION = "snapshot-v1.0.0";

/** How long a stored snapshot may inform a valuation. */
export const SNAPSHOT_FRESH_DAYS = 7;

/**
 * One competing listing, as it arrives. Cosmetic fields are absent by design.
 *
 * Both spellings of the three renamed fields are accepted — `dealerName` as a
 * provider row supplies it, and `dealer` as a STORED snapshot holds it. That
 * is not laxness: `market_cohort_snapshots.observations` persists the
 * normalized shape, so reading a snapshot back and recomputing its fingerprint
 * has to produce the same fingerprint, or the unique index that makes
 * reprocessing free would never match and every reload would look like a new
 * market. A normalized observation must be valid input to its own normalizer.
 */
export interface MarketObservation {
  /** The competitor's VIN. Identifies the observation; never the subject. */
  vin?: unknown;
  dealerName?: unknown;
  /** The stored spelling of `dealerName`. */
  dealer?: unknown;
  dealerId?: unknown;
  price?: unknown;
  mileage?: unknown;
  distanceMiles?: unknown;
  daysOnMarket?: unknown;
  certified?: unknown;
  trim?: unknown;
}

export interface NormalizedObservation {
  vin: string | null;
  dealer: string | null;
  dealerId: string | null;
  price: number | null;
  mileage: number | null;
  distanceMiles: number | null;
  daysOnMarket: number | null;
  certified: boolean | null;
  trim: string | null;
}

const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};
const str = (v: unknown): string | null => {
  const s = typeof v === "string" ? v.trim() : "";
  return s || null;
};
const lower = (v: unknown): string | null => str(v)?.toLowerCase() ?? null;

export function normalizeObservation(o: MarketObservation | NormalizedObservation): NormalizedObservation {
  const raw = o as MarketObservation;
  return {
    vin: str(raw.vin)?.toUpperCase() ?? null,
    // `dealerName` from a provider row, `dealer` from a stored snapshot.
    dealer: lower(raw.dealerName ?? raw.dealer),
    dealerId: str(raw.dealerId),
    price: num(raw.price),
    mileage: num(raw.mileage),
    distanceMiles: num(raw.distanceMiles),
    daysOnMarket: num(raw.daysOnMarket),
    certified: typeof raw.certified === "boolean" ? raw.certified : null,
    trim: lower(raw.trim),
  };
}

/**
 * Deterministic order, so a provider that returns the same cars in a different
 * order does not look like a different market.
 */
const orderObservations = (rows: NormalizedObservation[]): NormalizedObservation[] =>
  [...rows].sort((a, b) => {
    const va = a.vin ?? "", vb = b.vin ?? "";
    if (va !== vb) return va < vb ? -1 : 1;
    return (a.price ?? 0) - (b.price ?? 0);
  });

export interface SnapshotInput {
  cohortKey: MarketCohortKey;
  observations: Array<MarketObservation | NormalizedObservation>;
  /** Own-rooftop listings, already excluded. Counted, never treated as market. */
  ownRooftopExcluded?: number;
  /** The sanitized query dimensions. Never an API key. */
  query?: { zip?: string | null; radiusMiles?: number | null; carType?: string | null; milesBand?: string | null };
  algorithmVersion: string;
}

export interface MarketSnapshot {
  fingerprint: string;
  cohortHash: string;
  observations: NormalizedObservation[];
  eligibleCount: number;
  independentRooftopCount: number;
  ownRooftopExcluded: number;
  p25: number | null;
  p50: number | null;
  p75: number | null;
  certifiedShare: number | null;
  algorithmVersion: string;
  snapshotRulesVersion: string;
  reasons: string[];
}

const quantile = (sorted: number[], q: number): number | null => {
  if (!sorted.length) return null;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
};

/**
 * Build the shared snapshot.
 *
 * Excluded from the fingerprint on purpose: the subject VIN (never present),
 * any asking price of ours, credentials, images, descriptions, wall-clock
 * timestamps and row ordering. What remains is the market.
 */
export function buildMarketSnapshot(input: SnapshotInput): MarketSnapshot {
  const reasons: string[] = [];
  const observations = orderObservations(input.observations.map(normalizeObservation));
  const priced = observations.map((o) => o.price).filter((n): n is number => n != null && n > 0)
    .sort((a, b) => a - b);
  const rooftops = new Set(observations.map((o) => o.dealerId ?? o.dealer).filter(Boolean));
  const certifiedKnown = observations.filter((o) => o.certified !== null);

  if (!observations.length) reasons.push("snapshot_empty");
  if (input.ownRooftopExcluded) reasons.push(`snapshot_own_rooftop_excluded_${input.ownRooftopExcluded}`);

  const fingerprint = digest({
    kind: "market_snapshot",
    rules: SNAPSHOT_RULES_VERSION,
    algorithm: input.algorithmVersion,
    cohort: cohortKeyHash(input.cohortKey),
    query: {
      zip: input.query?.zip ?? null,
      radius: input.query?.radiusMiles ?? null,
      car_type: input.query?.carType ?? null,
      miles_band: input.query?.milesBand ?? null,
    },
    // The evidence itself, ordered and stripped of cosmetics.
    observations: observations.map((o) => ({
      vin: o.vin, dealer: o.dealer, dealer_id: o.dealerId, price: o.price,
      mileage: o.mileage, dist: o.distanceMiles, dom: o.daysOnMarket,
      certified: o.certified, trim: o.trim,
    })),
  });

  return {
    fingerprint,
    cohortHash: cohortKeyHash(input.cohortKey),
    observations,
    eligibleCount: priced.length,
    independentRooftopCount: rooftops.size,
    ownRooftopExcluded: input.ownRooftopExcluded ?? 0,
    p25: quantile(priced, 0.25),
    p50: quantile(priced, 0.5),
    p75: quantile(priced, 0.75),
    certifiedShare: certifiedKnown.length
      ? certifiedKnown.filter((o) => o.certified === true).length / certifiedKnown.length
      : null,
    algorithmVersion: input.algorithmVersion,
    snapshotRulesVersion: SNAPSHOT_RULES_VERSION,
    reasons,
  };
}

// ── The vehicle's own fingerprint ──────────────────────────────────────────

export interface VehicleValuationFingerprintInput {
  vin: string;
  mileage?: unknown;
  condition?: unknown;
  /** Resolved certification truth, not a provider echo. */
  certified?: unknown;
  advertisedPrice?: unknown;
  internalComparisonPrice?: unknown;
  equipmentSignature: string;
  /** Tenant configuration that changes the answer: fee treatment, add-ons, identity. */
  tenantConfig?: unknown;
  marketSnapshotFingerprint: string;
  algorithmVersion: string;
}

/**
 * One subject vehicle's fingerprint.
 *
 * The VIN is in here and NOT in the snapshot, which is the whole separation:
 * two vehicles judged against one snapshot get two fingerprints, and they
 * cannot collide because the VIN differs.
 */
export function vehicleValuationFingerprint(input: VehicleValuationFingerprintInput): string {
  return digest({
    kind: "vehicle_valuation",
    algorithm: input.algorithmVersion,
    vin: input.vin.trim().toUpperCase(),
    mileage: num(input.mileage),
    condition: lower(input.condition),
    certified: typeof input.certified === "boolean" ? input.certified : null,
    advertised_price: num(input.advertisedPrice),
    internal_comparison_price: num(input.internalComparisonPrice),
    equipment: input.equipmentSignature,
    tenant_config: input.tenantConfig == null ? null : digest(input.tenantConfig),
    market_snapshot: input.marketSnapshotFingerprint,
  });
}

// ── Did the market actually move? ──────────────────────────────────────────
//
// Reuses the engine's own sufficiency thresholds rather than inventing a
// second opinion about what "enough evidence" means.

/** The engine's existing thresholds. Not new numbers — the ones already in use. */
export const SUFFICIENT_COMPARABLES = 3;
export const SUFFICIENT_ROOFTOPS = 2;

export type EvidenceSufficiency = "sufficient" | "insufficient";

export const evidenceSufficiency = (s: Pick<MarketSnapshot, "eligibleCount" | "independentRooftopCount">): EvidenceSufficiency =>
  s.eligibleCount >= SUFFICIENT_COMPARABLES && s.independentRooftopCount >= SUFFICIENT_ROOFTOPS
    ? "sufficient" : "insufficient";

export interface MarketChangeDecision {
  material: boolean;
  reasons: string[];
  priorSufficiency: EvidenceSufficiency | null;
  currentSufficiency: EvidenceSufficiency;
  percentileMovement: number | null;
}

/**
 * Whether an updated snapshot should reach existing inventory.
 *
 * The conservative pilot rule: ANY change to the normalized evidence set is
 * material. That is deliberate — deduplication by fingerprint and the nightly
 * cap are what bound the work, not a cleverness threshold nobody can audit.
 * The finer signals below are recorded as REASONS so an operator can see which
 * kind of change it was, and so a later gate can narrow the rule with data
 * rather than with a guess.
 */
export function decideMarketChange(
  prior: MarketSnapshot | null | undefined,
  current: MarketSnapshot,
): MarketChangeDecision {
  const reasons: string[] = [];
  const currentSufficiency = evidenceSufficiency(current);

  if (!prior) {
    return {
      material: true,
      reasons: ["market_first_snapshot"],
      priorSufficiency: null,
      currentSufficiency,
      percentileMovement: null,
    };
  }

  const priorSufficiency = evidenceSufficiency(prior);
  const movement = prior.p50 != null && current.p50 != null ? current.p50 - prior.p50 : null;

  if (prior.fingerprint === current.fingerprint) {
    // Ordering, images and descriptions cannot reach the fingerprint, so an
    // identical fingerprint means the market genuinely did not move.
    reasons.push("market_snapshot_unchanged");
    return { material: false, reasons, priorSufficiency, currentSufficiency, percentileMovement: movement };
  }

  const priorVins = new Set(prior.observations.map((o) => o.vin).filter(Boolean));
  const currentVins = new Set(current.observations.map((o) => o.vin).filter(Boolean));
  const entered = [...currentVins].filter((v) => !priorVins.has(v)).length;
  const left = [...priorVins].filter((v) => !currentVins.has(v)).length;

  if (entered) reasons.push(`market_competitors_entered_${entered}`);
  if (left) reasons.push(`market_competitors_left_${left}`);
  if (prior.eligibleCount !== current.eligibleCount) {
    reasons.push(`market_eligible_count_${prior.eligibleCount}_to_${current.eligibleCount}`);
  }
  if (prior.independentRooftopCount !== current.independentRooftopCount) {
    reasons.push(`market_rooftops_${prior.independentRooftopCount}_to_${current.independentRooftopCount}`);
  }
  if (priorSufficiency !== currentSufficiency) {
    reasons.push(`market_sufficiency_${priorSufficiency}_to_${currentSufficiency}`);
  }
  if (movement != null && Math.round(movement) !== 0) {
    reasons.push(`market_p50_moved_${Math.round(movement)}`);
  }
  if (prior.certifiedShare !== current.certifiedShare) {
    reasons.push("market_certification_composition_changed");
  }
  if (prior.algorithmVersion !== current.algorithmVersion) {
    reasons.push("market_algorithm_version_changed");
  }
  if (reasons.length === 0) reasons.push("market_evidence_set_changed");

  return { material: true, reasons, priorSufficiency, currentSufficiency, percentileMovement: movement };
}

/** A snapshot too old to inform a valuation. */
export const snapshotExpired = (observedAt: unknown, now: number): boolean => {
  if (typeof observedAt !== "string") return true;
  const t = Date.parse(observedAt);
  if (!Number.isFinite(t)) return true;
  return (now - t) / 86_400_000 > SNAPSHOT_FRESH_DAYS;
};
