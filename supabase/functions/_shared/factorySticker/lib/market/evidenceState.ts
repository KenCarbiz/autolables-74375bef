// GENERATED — do not edit.
// Mirror of src/lib/market/evidenceState.ts, copied so the edge runtime can
// bundle the engine (Supabase ships only supabase/functions/). Edit the
// source file and run `bun run sync:edge-sticker`.
import { SUFFICIENT_COMPARABLES, SUFFICIENT_ROOFTOPS, SNAPSHOT_FRESH_DAYS } from "./marketSnapshot.ts";
import { PUBLIC_MARKET_FRESHNESS_DAYS } from "./publicClaim.ts";
import type { MarketAwarenessState } from "./awareness.ts";
import { COHORT_DEFINING_DIMENSIONS } from "./awareness.ts";
export const STRONG_COMPARABLES = SUFFICIENT_COMPARABLES * 2;
export const STRONG_ROOFTOPS = SUFFICIENT_ROOFTOPS + 1;
export type EvidenceStrength = "strong" | "sufficient" | "thin" | "unavailable";
export interface MarketEvidenceState {
    eligibleComparableCount: number;
    independentRooftopCount: number;
    ownedRooftopCount: number;
    excludedComparableCount: number;
    indeterminateComparableCount: number;
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
        if (Number.isFinite(t))
            freshnessDays = (now - t) / 86400000;
    }
    if (freshnessDays == null)
        reasons.push("evidence_observation_time_unknown");
    const fresh = freshnessDays != null && freshnessDays <= SNAPSHOT_FRESH_DAYS;
    if (!fresh && freshnessDays != null)
        reasons.push("evidence_snapshot_stale");
    const eligible = input.eligibleComparableCount;
    const rooftops = input.independentRooftopCount;
    let strength: EvidenceStrength;
    if (eligible === 0 || rooftops === 0) {
        strength = "unavailable";
        reasons.push("evidence_none");
    }
    else if (eligible < SUFFICIENT_COMPARABLES || rooftops < SUFFICIENT_ROOFTOPS) {
        strength = "thin";
        if (eligible < SUFFICIENT_COMPARABLES)
            reasons.push(`insufficient_comparables_${eligible}_of_${SUFFICIENT_COMPARABLES}`);
        if (rooftops < SUFFICIENT_ROOFTOPS)
            reasons.push(`insufficient_competitor_rooftops_${rooftops}_of_${SUFFICIENT_ROOFTOPS}`);
    }
    else if (eligible >= STRONG_COMPARABLES && rooftops >= STRONG_ROOFTOPS) {
        strength = "strong";
        reasons.push("evidence_strong");
    }
    else {
        strength = "sufficient";
        reasons.push("evidence_sufficient");
    }
    if (input.indeterminateComparableCount) {
        reasons.push(`evidence_indeterminate_comparables_${input.indeterminateComparableCount}`);
    }
    if (input.ownedRooftopCount) {
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
        strength,
        fresh,
        reasons,
    };
}
export type ClaimReadiness = "eligible" | "internal_only" | "context_only" | "stale" | "conflicted" | "unavailable";
export interface MarketClaimReadiness {
    readiness: ClaimReadiness;
    safeForPropagation: boolean;
    usableInternally: boolean;
    reasons: string[];
}
export function decideClaimReadiness(input: {
    awareness: MarketAwarenessState;
    evidence: MarketEvidenceState;
    providerPredictionAvailable?: boolean;
    contextOnlyEvidence?: boolean;
}): MarketClaimReadiness {
    const reasons: string[] = [];
    const { awareness, evidence } = input;
    const usableInternally = evidence.strength !== "unavailable" || awareness.safeToCompare;
    const cohortConflicts = awareness.conflicts.filter((d) => COHORT_DEFINING_DIMENSIONS.includes(d));
    if (cohortConflicts.length > 0) {
        for (const d of cohortConflicts)
            reasons.push(`subject_identity_conflict_${d}`);
        reasons.push("subject_identity_conflict");
        return { readiness: "conflicted", safeForPropagation: false, usableInternally, reasons };
    }
    if (input.contextOnlyEvidence) {
        reasons.push("adjacent_year_context_only");
        return { readiness: "context_only", safeForPropagation: false, usableInternally, reasons };
    }
    if (evidence.strength === "unavailable") {
        reasons.push(...evidence.reasons.filter((r) => r.startsWith("evidence_") || r.startsWith("insufficient_")));
        return { readiness: "unavailable", safeForPropagation: false, usableInternally, reasons };
    }
    if (!evidence.fresh) {
        reasons.push("snapshot_stale", `public_validity_days_${PUBLIC_MARKET_FRESHNESS_DAYS}`);
        return { readiness: "stale", safeForPropagation: false, usableInternally, reasons };
    }
    if (evidence.strength === "thin") {
        reasons.push(...evidence.reasons.filter((r) => r.startsWith("insufficient_")));
        return { readiness: "internal_only", safeForPropagation: false, usableInternally, reasons };
    }
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
        reasons.push("provider_prediction_unavailable");
    }
    reasons.push(`evidence_${evidence.strength}`, "claim_ready");
    return { readiness: "eligible", safeForPropagation: true, usableInternally, reasons };
}
export const MARKET_LANGUAGE = {
    eligible: "Compared with current similar vehicles in your market.",
    internal_only: "Market comparison currently unavailable.",
    context_only: "Market comparison currently unavailable.",
    stale: "Market comparison currently unavailable.",
    unavailable: "Market comparison currently unavailable.",
    conflicted: "Vehicle configuration is being verified.",
} as const satisfies Record<ClaimReadiness, string>;
export const COMPARATIVE_PHRASES = [
    "below market",
    "above market",
    "great price",
    "best deal",
    "great deal",
    "under market",
    "over market",
    "priced to sell",
    "steal",
    "bargain",
] as const;
export const customerMarketLanguage = (readiness: ClaimReadiness): string => MARKET_LANGUAGE[readiness];
export const assertsComparison = (copy: unknown): boolean => typeof copy === "string"
    && COMPARATIVE_PHRASES.some((p) => copy.toLowerCase().includes(p));
