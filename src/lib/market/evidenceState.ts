// ── How much the engine actually has, and what it may say with it ──────────
//
// Three questions that are routinely treated as one, and are not:
//
//   A. may I CALCULATE with this?          almost always yes
//   B. may I spread it to sibling cars?    only on exact cohort evidence
//   C. may I tell a CUSTOMER?              a much higher bar
//
// Collapsing them is how "we have some comparables" becomes "$4,718 above
// market" on a public page. They are answered separately here, and the
// customer-facing answer is the one that defaults to refusal.
//
// No scoring formula. Every label below is reached by a rule you can read, and
// the two thresholds are the engine's existing ones — three eligible
// comparables and two independent rooftops — not new numbers chosen to make a
// label come out nicely.

import { SUFFICIENT_COMPARABLES, SUFFICIENT_ROOFTOPS, SNAPSHOT_FRESH_DAYS } from "./marketSnapshot.ts";
import { PUBLIC_MARKET_FRESHNESS_DAYS } from "./publicClaim.ts";
import type { MarketAwarenessState } from "./awareness.ts";
import { COHORT_DEFINING_DIMENSIONS } from "./awareness.ts";

/** Comfortably above the minimum, not a new threshold — twice the minimum. */
export const STRONG_COMPARABLES = SUFFICIENT_COMPARABLES * 2;
export const STRONG_ROOFTOPS = SUFFICIENT_ROOFTOPS + 1;

export type EvidenceStrength = "strong" | "sufficient" | "thin" | "unavailable";

export interface MarketEvidenceState {
  eligibleComparableCount: number;
  independentRooftopCount: number;
  ownedRooftopCount: number;
  excludedComparableCount: number;
  indeterminateComparableCount: number;
  /** Age of the observations, in days. Null when unknown. */
  comparableFreshnessDays: number | null;
  radiusMiles: number | null;
  cohortHash: string | null;
  snapshotFingerprint: string | null;
  observationSources: string[];
  materialChangeReasons: string[];
  strength: EvidenceStrength;
  fresh: boolean;
  reasons: string[];
}

export interface EvidenceInput {
  eligibleComparableCount: number;
  independentRooftopCount: number;
  ownedRooftopCount?: number;
  excludedComparableCount?: number;
  indeterminateComparableCount?: number;
  observedAt?: unknown;
  radiusMiles?: number | null;
  cohortHash?: string | null;
  snapshotFingerprint?: string | null;
  observationSources?: string[];
  materialChangeReasons?: string[];
  now?: number;
}

export function buildEvidenceState(input: EvidenceInput): MarketEvidenceState {
  const reasons: string[] = [];
  const now = input.now ?? Date.now();

  let freshnessDays: number | null = null;
  if (typeof input.observedAt === "string") {
    const t = Date.parse(input.observedAt);
    if (Number.isFinite(t)) freshnessDays = (now - t) / 86_400_000;
  }
  if (freshnessDays == null) reasons.push("evidence_observation_time_unknown");

  // The canonical rule already in the repository, not a new one.
  const fresh = freshnessDays != null && freshnessDays <= SNAPSHOT_FRESH_DAYS;
  if (!fresh && freshnessDays != null) reasons.push("evidence_snapshot_stale");

  const eligible = input.eligibleComparableCount;
  const rooftops = input.independentRooftopCount;

  let strength: EvidenceStrength;
  if (eligible === 0 || rooftops === 0) {
    strength = "unavailable";
    reasons.push("evidence_none");
  } else if (eligible < SUFFICIENT_COMPARABLES || rooftops < SUFFICIENT_ROOFTOPS) {
    strength = "thin";
    if (eligible < SUFFICIENT_COMPARABLES) reasons.push(`insufficient_comparables_${eligible}_of_${SUFFICIENT_COMPARABLES}`);
    if (rooftops < SUFFICIENT_ROOFTOPS) reasons.push(`insufficient_competitor_rooftops_${rooftops}_of_${SUFFICIENT_ROOFTOPS}`);
  } else if (eligible >= STRONG_COMPARABLES && rooftops >= STRONG_ROOFTOPS) {
    strength = "strong";
    reasons.push("evidence_strong");
  } else {
    strength = "sufficient";
    reasons.push("evidence_sufficient");
  }

  if (input.indeterminateComparableCount) {
    reasons.push(`evidence_indeterminate_comparables_${input.indeterminateComparableCount}`);
  }
  if (input.ownedRooftopCount) {
    // Recorded as provenance. Own inventory is never market evidence.
    reasons.push(`evidence_owned_rooftop_excluded_${input.ownedRooftopCount}`);
  }

  return {
    eligibleComparableCount: eligible,
    independentRooftopCount: rooftops,
    ownedRooftopCount: input.ownedRooftopCount ?? 0,
    excludedComparableCount: input.excludedComparableCount ?? 0,
    indeterminateComparableCount: input.indeterminateComparableCount ?? 0,
    comparableFreshnessDays: freshnessDays,
    radiusMiles: input.radiusMiles ?? null,
    cohortHash: input.cohortHash ?? null,
    snapshotFingerprint: input.snapshotFingerprint ?? null,
    observationSources: input.observationSources ?? [],
    materialChangeReasons: input.materialChangeReasons ?? [],
    strength, fresh, reasons,
  };
}

// ── May we say it out loud? ────────────────────────────────────────────────

export type ClaimReadiness =
  | "eligible"        // safe for a customer-facing market statement
  | "internal_only"   // usable for calculation; not for a customer, not for siblings
  | "context_only"    // may inform diagnostics; never a claim
  | "stale"
  | "conflicted"
  | "unavailable";

export interface MarketClaimReadiness {
  /** May a customer be told anything at all about this car's market. */
  readiness: ClaimReadiness;
  /** May this vehicle's evidence be shared with exact-cohort siblings. */
  safeForPropagation: boolean;
  /** May the engine compute with it internally. */
  usableInternally: boolean;
  reasons: string[];
}

export function decideClaimReadiness(input: {
  awareness: MarketAwarenessState;
  evidence: MarketEvidenceState;
  /** Whether a provider prediction was obtained. Absent is not disqualifying. */
  providerPredictionAvailable?: boolean;
  /** True when the only relationship to the market is an adjacent model year. */
  contextOnlyEvidence?: boolean;
}): MarketClaimReadiness {
  const reasons: string[] = [];
  const { awareness, evidence } = input;

  // Internal calculation is almost always permitted — refusing to compute
  // teaches nothing. What it may be USED for is the question.
  const usableInternally = evidence.strength !== "unavailable" || awareness.safeToCompare;

  // 1. Identity conflicts disqualify everything downstream. A cohort built
  //    from a value we have reason to disbelieve is worse than no cohort.
  const cohortConflicts = awareness.conflicts.filter((d) => COHORT_DEFINING_DIMENSIONS.includes(d));
  if (cohortConflicts.length > 0) {
    for (const d of cohortConflicts) reasons.push(`subject_identity_conflict_${d}`);
    reasons.push("subject_identity_conflict");
    return { readiness: "conflicted", safeForPropagation: false, usableInternally, reasons };
  }

  // 2. Context-only evidence is diagnostics. It never becomes a claim.
  if (input.contextOnlyEvidence) {
    reasons.push("adjacent_year_context_only");
    return { readiness: "context_only", safeForPropagation: false, usableInternally, reasons };
  }

  // 3. Nothing to say.
  if (evidence.strength === "unavailable") {
    reasons.push(...evidence.reasons.filter((r) => r.startsWith("evidence_") || r.startsWith("insufficient_")));
    return { readiness: "unavailable", safeForPropagation: false, usableInternally, reasons };
  }

  // 4. Old evidence is not current evidence, whatever its quality was.
  if (!evidence.fresh) {
    reasons.push("snapshot_stale", `public_validity_days_${PUBLIC_MARKET_FRESHNESS_DAYS}`);
    return { readiness: "stale", safeForPropagation: false, usableInternally, reasons };
  }

  // 5. Below the engine's own minimum.
  if (evidence.strength === "thin") {
    reasons.push(...evidence.reasons.filter((r) => r.startsWith("insufficient_")));
    return { readiness: "internal_only", safeForPropagation: false, usableInternally, reasons };
  }

  // 6. Identity gaps that stop short of conflict. Equipment is the common one:
  //    without it the car cannot be placed in an exact cohort, so its evidence
  //    may not travel and it may not speak publicly.
  const missingCohortDimensions = awareness.unknown.filter((d) => COHORT_DEFINING_DIMENSIONS.includes(d));
  if (missingCohortDimensions.length > 0) {
    for (const d of missingCohortDimensions) {
      reasons.push(d === "equipment" ? "equipment_indeterminate"
        : d === "certification" ? "certification_unknown"
        : `subject_${d}_unknown`);
    }
    return { readiness: "internal_only", safeForPropagation: false, usableInternally, reasons };
  }

  if (input.providerPredictionAvailable === false) {
    // Recorded, not disqualifying: the comparable set is the evidence, and a
    // prediction is corroboration we may not have paid for.
    reasons.push("provider_prediction_unavailable");
  }

  reasons.push(`evidence_${evidence.strength}`, "claim_ready");
  return { readiness: "eligible", safeForPropagation: true, usableInternally, reasons };
}

// ── What a customer may be told ────────────────────────────────────────────
//
// The deterministic engine is the authority. There is no generation step here
// and no model in the loop: a readiness state maps to one of four fixed
// sentences, and nothing else is permitted to reach a page.

export const MARKET_LANGUAGE = {
  eligible: "Compared with current similar vehicles in your market.",
  internal_only: "Market comparison currently unavailable.",
  context_only: "Market comparison currently unavailable.",
  stale: "Market comparison currently unavailable.",
  unavailable: "Market comparison currently unavailable.",
  conflicted: "Vehicle configuration is being verified.",
} as const satisfies Record<ClaimReadiness, string>;

/**
 * Comparative phrases that require an explicit, supported market claim.
 *
 * Listed so the guard can be executed rather than intended: none of these may
 * appear for any readiness state other than `eligible`, and even then only
 * when the deterministic claim itself says so.
 */
export const COMPARATIVE_PHRASES = [
  "below market", "above market", "great price", "best deal", "great deal",
  "under market", "over market", "priced to sell", "steal", "bargain",
] as const;

export const customerMarketLanguage = (readiness: ClaimReadiness): string =>
  MARKET_LANGUAGE[readiness];

/** Does this copy assert a comparison? The tamper surface for generated text. */
export const assertsComparison = (copy: unknown): boolean =>
  typeof copy === "string"
  && COMPARATIVE_PHRASES.some((p) => copy.toLowerCase().includes(p));
