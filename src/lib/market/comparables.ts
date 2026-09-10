// ── Comparable canonicalization, deduplication and tiering ─────────────────
//
// Everything that reaches the market calculation passes through here exactly
// once, so the rules can be read in one place instead of being inferred from
// four query builders.
//
// Three defects this ends:
//
//   • The subject's own rooftop counted as market evidence. Two Harte cars sit
//     in the QX50's stored comparables, one of them priced identically to the
//     subject, which is a car being compared with itself.
//   • One VIN syndicated to three sites counted three times.
//   • The relaxation ladder widened silently. The stored `relaxation_tier` said
//     `trim_year_band`, which sounds tight, while certification — the single
//     attribute that separates a CPO QX50 from an ordinary one — was never in
//     the ladder at all.
//
// The certification rule is what makes the QX50 come out honest. Not one of
// its seven comparables records whether it is certified. Unknown is not a
// match, so none of them can be a primary comparison for a CPO subject; they
// are kept as certification-mismatch CONTEXT and the verdict has to say the
// evidence is limited. That is the correct answer, and the old engine could
// not express it.

import { resolveComparableBasePrice } from "./priceBasis.ts";
import {
  classifyOwnership, groupKey, rooftopKey,
  type ComparableIdentityFields, type IdentityConfidence,
  type OwnershipRelation, type TenantDealerIdentity,
} from "./dealerIdentity.ts";
import type {
  ComparableCandidate, ComparableInclusion, ComparableTier,
  ConditionStatus, HistoryStatus, MarketComparable,
} from "./types.ts";

/** How stale an active listing may be before it stops being primary evidence. */
export const LISTING_FRESH_DAYS = 30;

export const TIER_RADIUS: Partial<Record<ComparableTier, number>> = {
  A: 50, B50: 50, B100: 100, B200: 200,
};

const PRIMARY_TIERS: ComparableTier[] = ["A", "B50", "B100", "B200", "C"];
const CONTEXT_TIERS: ComparableTier[] = ["D", "E", "F"];

export const isPrimaryTier = (t: ComparableTier): boolean => PRIMARY_TIERS.includes(t);
export const isContextTier = (t: ComparableTier): boolean => CONTEXT_TIERS.includes(t);

const str = (v: unknown): string | null => {
  const s = String(v ?? "").trim();
  return s || null;
};
const numOrNull = (v: unknown): number | null => {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    const n = Number(v.replace(/[$,\s]/g, ""));
    return Number.isFinite(n) && v.trim() !== "" ? n : null;
  }
  return null;
};
const norm = (v: unknown): string => String(v ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");
const normDrivetrain = (v: unknown): string => {
  const s = norm(v);
  if (/^(4wd|4x4|fourwheeldrive)$/.test(s)) return "4wd";
  if (/^(awd|allwheeldrive)$/.test(s)) return "awd";
  if (/^(fwd|frontwheeldrive)$/.test(s)) return "fwd";
  if (/^(rwd|rearwheeldrive)$/.test(s)) return "rwd";
  return s;
};

/**
 * A certification flag with three states.
 *
 * `undefined`, `null` and an unrecognised value all mean UNKNOWN. Only an
 * explicit truthy or explicit falsy provider flag decides. A feed that simply
 * omits the field has told us nothing, and "nothing" must never read as "not
 * certified" — that is the same class of error as the recall 404 that became a
 * clean car.
 */
export function readCertified(v: unknown): boolean | null {
  if (typeof v === "boolean") return v;
  if (typeof v === "number" && Number.isFinite(v)) return v !== 0;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    if (["true", "1", "y", "yes", "t", "certified", "cpo"].includes(s)) return true;
    if (["false", "0", "n", "no", "f"].includes(s)) return false;
  }
  return null;
}

const readHistory = (v: unknown): HistoryStatus =>
  v === "clean" || v === "adverse" ? v : "unknown";
const readCondition = (v: unknown): ConditionStatus => (v === "verified" ? "verified" : "unknown");

export interface SubjectIdentity {
  vin: string;
  year: number | null;
  make: string | null;
  model: string | null;
  trim: string | null;
  drivetrain: string | null;
  powertrain: string | null;
  mileage: number | null;
  /** The subject's certification, from `vehicle_listings.condition`. */
  certified: boolean | null;
}

/** A canonicalized row still carrying who owns it and how sure we are of that. */
export type CanonicalComparable = MarketComparable & {
  ownership: OwnershipRelation;
  identityConfidence: IdentityConfidence;
};

/** Canonicalize one raw candidate. No eligibility decisions are made here. */
export function canonicalizeComparable(
  candidate: ComparableCandidate,
  identity: TenantDealerIdentity,
): CanonicalComparable {
  const idFields: ComparableIdentityFields = {
    dealerId: str(candidate.dealerId),
    rooftopId: str(candidate.rooftopId),
    dealerGroupId: str(candidate.dealerGroupId),
    dealerDomain: str(candidate.dealerDomain),
    dealerName: str(candidate.dealerName),
    distanceMiles: numOrNull(candidate.distanceMiles),
  };
  const ownership = classifyOwnership(idFields, identity);
  const price = resolveComparableBasePrice({
    advertisedPrice: numOrNull(candidate.price),
    docFeeIncluded: typeof candidate.docFeeIncluded === "boolean" ? candidate.docFeeIncluded : null,
    docFee: numOrNull(candidate.docFee),
  });

  return {
    vin: String(candidate.vin ?? "").trim().toUpperCase(),
    listingId: str(candidate.listingId),
    year: numOrNull(candidate.year),
    make: str(candidate.make),
    model: str(candidate.model),
    trim: str(candidate.trim),
    drivetrain: str(candidate.drivetrain),
    powertrain: str(candidate.powertrain),
    transmission: str(candidate.transmission),
    mileage: numOrNull(candidate.mileage),
    advertisedPrice: numOrNull(candidate.price),
    normalizedVehiclePrice: price.normalizedVehiclePrice,
    priceBasisStatus: price.priceBasisStatus,
    certified: readCertified(candidate.certified),
    certificationProgram: str(candidate.certificationProgram),
    dealerName: idFields.dealerName ?? null,
    dealerId: idFields.dealerId ?? null,
    rooftopId: idFields.rooftopId ?? null,
    dealerGroupId: idFields.dealerGroupId ?? null,
    dealerDomain: idFields.dealerDomain ?? null,
    dealerType: str(candidate.dealerType),
    distanceMiles: idFields.distanceMiles ?? null,
    daysOnMarket: numOrNull(candidate.daysOnMarket),
    listingObservedAt: str(candidate.observedAt),
    equipmentCodes: Array.isArray(candidate.equipmentCodes)
      ? candidate.equipmentCodes.map((c) => String(c)).filter(Boolean)
      : [],
    historyStatus: readHistory(candidate.historyStatus),
    conditionStatus: readCondition(candidate.conditionStatus),
    inclusionStatus: "excluded",
    exclusionReasons: [...price.reasons, ...ownership.cautions],
    similarityComponents: {},
    rawWeight: 0,
    cappedWeight: 0,
    adjustedPrice: null,
    ownership: ownership.relation,
    identityConfidence: ownership.identityConfidence,
  };
}

export interface DedupeResult<T extends MarketComparable> {
  kept: T[];
  dropped: T[];
}

/**
 * One VIN, one vote.
 *
 * The same car syndicated to a dealer site, a marketplace and an aggregator
 * arrives as three rows. Counted three times it triples one seller's influence
 * on the median and inflates every count the confidence rules read. The
 * survivor is the most recently observed row, then the one carrying a stable
 * dealer identity (the canonical dealer listing rather than a syndication
 * copy), then the one with a resolvable price. Losers are kept, marked
 * `duplicate_vin`, so the ledger can show what was set aside.
 */
export function dedupeByVin<T extends MarketComparable>(comps: T[]): DedupeResult<T> {
  const best = new Map<string, T>();
  const dropped: T[] = [];

  const score = (c: T): [number, number, number] => [
    Date.parse(c.listingObservedAt ?? "") || 0,
    c.rooftopId || c.dealerId || c.dealerDomain ? 1 : 0,
    c.normalizedVehiclePrice != null ? 1 : 0,
  ];
  const better = (a: T, b: T): boolean => {
    const [a0, a1, a2] = score(a); const [b0, b1, b2] = score(b);
    if (a0 !== b0) return a0 > b0;
    if (a1 !== b1) return a1 > b1;
    return a2 > b2;
  };

  for (const c of comps) {
    if (!c.vin) { dropped.push({ ...c, exclusionReasons: [...c.exclusionReasons, "missing_vin"] }); continue; }
    const incumbent = best.get(c.vin);
    if (!incumbent) { best.set(c.vin, c); continue; }
    const loser = better(c, incumbent) ? incumbent : c;
    const winner = loser === incumbent ? c : incumbent;
    best.set(c.vin, winner);
    dropped.push({ ...loser, inclusionStatus: "excluded", exclusionReasons: [...loser.exclusionReasons, "duplicate_vin"] });
  }

  return { kept: [...best.values()], dropped };
}

export interface TierAssignment {
  tier: ComparableTier;
  reasons: string[];
}

const withinBand = (subject: number | null, comp: number | null, pct: number, floor: number): boolean => {
  if (subject == null || comp == null || subject <= 0) return false;
  return Math.abs(comp - subject) <= Math.max(subject * pct, floor);
};

/**
 * Place one comparable on the relaxation ladder.
 *
 * Order matters. Vehicle identity is checked before certification, and
 * certification before mileage, because a different model is not rescued by
 * matching odometers and a CPO mismatch is not rescued by matching trim.
 */
export function assignTier(
  subject: SubjectIdentity,
  comp: MarketComparable,
  nowMs: number,
): TierAssignment {
  const reasons: string[] = [];

  if (norm(subject.make) !== norm(comp.make) || norm(subject.model) !== norm(comp.model)) {
    return { tier: "F", reasons: ["different_make_or_model"] };
  }
  const trimMatches = norm(subject.trim) !== "" && norm(subject.trim) === norm(comp.trim);
  const driveMatches = normDrivetrain(subject.drivetrain) === normDrivetrain(comp.drivetrain)
    || !normDrivetrain(subject.drivetrain) || !normDrivetrain(comp.drivetrain);

  if (!trimMatches || !driveMatches) {
    return { tier: "F", reasons: [!trimMatches ? "different_trim" : "different_drivetrain"] };
  }

  const yearGap = subject.year != null && comp.year != null ? Math.abs(subject.year - comp.year) : null;
  if (yearGap == null) return { tier: "F", reasons: ["model_year_unknown"] };
  if (yearGap > 1) return { tier: "F", reasons: ["model_year_outside_one"] };

  // Certification, the QX50's actual problem. Unknown is not a match.
  if (subject.certified != null && comp.certified == null) {
    return { tier: "E", reasons: ["comparable_certification_unknown"] };
  }
  if (subject.certified != null && comp.certified != null && subject.certified !== comp.certified) {
    return { tier: "E", reasons: ["certification_class_mismatch"] };
  }

  if (yearGap === 1) return { tier: "D", reasons: ["adjacent_model_year"] };

  if (comp.normalizedVehiclePrice == null) return { tier: "F", reasons: ["no_normalized_price"] };

  const observed = Date.parse(comp.listingObservedAt ?? "");
  const staleListing = Number.isFinite(observed)
    ? (nowMs - observed) / 86_400_000 > LISTING_FRESH_DAYS
    : false;
  if (staleListing) reasons.push("listing_not_recently_observed");

  const tightMileage = withinBand(subject.mileage, comp.mileage, 0.2, 5000);
  const wideMileage = withinBand(subject.mileage, comp.mileage, 0.35, 10000);

  if (!tightMileage && !wideMileage) return { tier: "F", reasons: [...reasons, "mileage_outside_expansion_band"] };
  if (!tightMileage) return { tier: "C", reasons: [...reasons, "mileage_expansion_band"] };
  if (staleListing) return { tier: "C", reasons };

  const d = comp.distanceMiles;
  if (d == null) return { tier: "B200", reasons: [...reasons, "distance_unknown"] };
  if (d <= 50) return { tier: "A", reasons };
  if (d <= 100) return { tier: "B100", reasons: [...reasons, "radius_expanded_to_100"] };
  if (d <= 200) return { tier: "B200", reasons: [...reasons, "radius_expanded_to_200"] };
  return { tier: "C", reasons: [...reasons, "beyond_200_miles"] };
}

export const TIER_ORDER: ComparableTier[] = ["A", "B50", "B100", "B200", "C", "D", "E", "F"];

export interface TierSelection {
  winningTier: ComparableTier | null;
  relaxationSteps: string[];
  /** Tiers at or tighter than the winner; these become primary evidence. */
  acceptedTiers: ComparableTier[];
}

/**
 * Stop relaxing as soon as there is enough primary evidence.
 *
 * "Enough" is the confidence engine's medium threshold — three — because
 * widening past the point where a real answer exists is how a tight market
 * gets diluted with cars nobody would cross-shop.
 */
export function selectTier(
  tiers: ComparableTier[],
  minimumPrimary = 3,
): TierSelection {
  const relaxationSteps: string[] = [];
  const accepted: ComparableTier[] = [];
  for (const tier of TIER_ORDER) {
    if (!isPrimaryTier(tier)) break;
    accepted.push(tier);
    const count = tiers.filter((t) => accepted.includes(t)).length;
    relaxationSteps.push(`${tier}: ${count} qualified`);
    if (count >= minimumPrimary) {
      return { winningTier: tier, relaxationSteps, acceptedTiers: [...accepted] };
    }
  }
  const anyPrimary = tiers.filter(isPrimaryTier);
  if (anyPrimary.length) {
    const widest = TIER_ORDER.filter((t) => anyPrimary.includes(t)).pop() ?? null;
    relaxationSteps.push(`exhausted primary ladder with ${anyPrimary.length} qualified`);
    return { winningTier: widest, relaxationSteps, acceptedTiers: [...accepted] };
  }
  relaxationSteps.push("no primary comparable at any tier");
  return { winningTier: null, relaxationSteps, acceptedTiers: [] };
}

/** How a comparable is presented once its tier and ownership are known. */
export function inclusionFor(
  tier: ComparableTier,
  ownership: OwnershipRelation,
  acceptedTiers: ComparableTier[],
): { inclusionStatus: ComparableInclusion; reasons: string[] } {
  if (ownership === "own_rooftop") {
    return { inclusionStatus: "excluded", reasons: ["internal_inventory_own_rooftop"] };
  }
  if (ownership === "own_group") {
    return { inclusionStatus: "excluded", reasons: ["internal_inventory_own_group"] };
  }
  if (isContextTier(tier)) return { inclusionStatus: "context_only", reasons: [`context_tier_${tier}`] };
  if (acceptedTiers.includes(tier)) return { inclusionStatus: "primary", reasons: [] };
  return { inclusionStatus: "secondary", reasons: [`outside_winning_tier_${tier}`] };
}

/** True when a comparable is the dealer's own stock, shown as Internal Inventory Context. */
export const isInternalInventory = (comp: MarketComparable): boolean =>
  comp.exclusionReasons.some((r) => r.startsWith("internal_inventory_"));
