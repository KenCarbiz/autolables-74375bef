// GENERATED — do not edit.
// Mirror of src/lib/market/shadowReview.ts, copied so the edge runtime can
// bundle the engine (Supabase ships only supabase/functions/). Edit the
// source file and run `bun run sync:edge-sticker`.
export interface ShadowEvidenceRow {
    id?: unknown;
    tenant_id?: unknown;
    vin?: unknown;
    created_at?: unknown;
    checked_at?: unknown;
    status?: unknown;
    algorithm_version?: unknown;
    displayed_total_price?: unknown;
    vehicle_comparison_price?: unknown;
    doc_fee?: unknown;
    price_basis_status?: unknown;
    price_basis_reasons?: unknown;
    certification_match?: unknown;
    provider?: unknown;
    provider_attempt_status?: unknown;
    provider_prediction?: unknown;
    raw_candidate_count?: unknown;
    eligible_primary_count?: unknown;
    effective_sample_size?: unknown;
    independent_rooftop_count?: unknown;
    confidence_tier?: unknown;
    verdict?: unknown;
    confidence_reasons?: unknown;
    insufficient_market_diversity?: unknown;
    data_provenance?: unknown;
}
export interface ShadowComparableRow {
    comparable_vin?: unknown;
    dealer_name?: unknown;
    inclusion_status?: unknown;
    exclusion_reasons?: unknown;
}
export interface ShadowReviewRow {
    id: string;
    vin: string;
    evaluatedAt: string | null;
    shadow: boolean;
    invocationSource: string | null;
    algorithmVersion: string | null;
    status: string | null;
    verdict: string | null;
    confidence: string | null;
    advertisedPrice: number | null;
    internalComparisonPrice: number | null;
    docFee: number | null;
    priceBasisStatus: string | null;
    certificationConflict: boolean;
    rawComparableCount: number | null;
    eligibleComparableCount: number | null;
    effectiveSampleSize: number | null;
    independentRooftopCount: number | null;
    providerAttemptStatus: string | null;
    providerPrediction: number | null;
    providerCostUsd: number;
    abstentionReasons: string[];
    ownRooftopExclusions: string[];
    legacyVersusV2: number | null;
    freshnessDays: number | null;
    audience: "internal_only";
}
export const SHADOW_REVIEW_AUDIENCE_NOTICE = "Internal only \u2014 shadow evaluation. Not shown to customers.";
const num = (v: unknown): number | null => {
    if (typeof v === "number")
        return Number.isFinite(v) ? v : null;
    if (typeof v === "string" && v.trim() !== "") {
        const n = Number(v);
        return Number.isFinite(n) ? n : null;
    }
    return null;
};
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v : null);
const strings = (v: unknown): string[] => Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
const provenance = (v: unknown): Record<string, unknown> => v != null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
export const OWN_ROOFTOP_REASONS = [
    "internal_inventory_own_rooftop",
    "own_rooftop_matched_by_name_only",
] as const;
export function buildShadowReviewRow(input: {
    evaluation: ShadowEvidenceRow;
    comparables?: ShadowComparableRow[];
    viewerTenantId: string;
    legacyMarketValue?: unknown;
    providerCostUsd?: unknown;
    now?: number;
}): ShadowReviewRow | null {
    const e = input.evaluation;
    const tenantId = str(e.tenant_id);
    const id = str(e.id);
    const vin = str(e.vin);
    if (!tenantId || !id || !vin || tenantId !== input.viewerTenantId)
        return null;
    const prov = provenance(e.data_provenance);
    const evaluatedAt = str(e.checked_at) ?? str(e.created_at);
    const now = input.now ?? Date.now();
    const parsed = evaluatedAt ? Date.parse(evaluatedAt) : NaN;
    const ownRooftop = (input.comparables ?? [])
        .filter((c) => strings(c.exclusion_reasons)
        .some((r) => (OWN_ROOFTOP_REASONS as readonly string[]).includes(r)))
        .map((c) => str(c.dealer_name) ?? str(c.comparable_vin) ?? "unknown");
    const legacy = num(input.legacyMarketValue);
    const v2 = num(e.provider_prediction);
    return {
        id,
        vin,
        evaluatedAt,
        shadow: prov.shadow === true,
        invocationSource: str(prov.invocation_source),
        algorithmVersion: str(e.algorithm_version),
        status: str(e.status),
        verdict: str(e.verdict),
        confidence: str(e.confidence_tier),
        advertisedPrice: num(e.displayed_total_price),
        internalComparisonPrice: num(e.vehicle_comparison_price),
        docFee: num(e.doc_fee),
        priceBasisStatus: str(e.price_basis_status),
        certificationConflict: e.certification_match === false,
        rawComparableCount: num(e.raw_candidate_count),
        eligibleComparableCount: num(e.eligible_primary_count),
        effectiveSampleSize: num(e.effective_sample_size),
        independentRooftopCount: num(e.independent_rooftop_count),
        providerAttemptStatus: str(e.provider_attempt_status),
        providerPrediction: v2,
        providerCostUsd: num(input.providerCostUsd) ?? 0,
        abstentionReasons: strings(e.confidence_reasons),
        ownRooftopExclusions: ownRooftop,
        legacyVersusV2: legacy != null && v2 != null ? legacy - v2 : null,
        freshnessDays: Number.isFinite(parsed) ? (now - parsed) / 86400000 : null,
        audience: "internal_only",
    };
}
export const SHADOW_REVIEW_FORBIDDEN_FIELDS = [
    "provider_request_params",
    "provider_response_hash",
    "subject_inputs",
    "api_key",
    "raw",
] as const;
export interface PropagationReviewRow {
    cohortHash: string;
    cohortLabel: string;
    snapshotFingerprint: string;
    observedAt: string | null;
    affectedCount: number;
    materialChangeReasons: string[];
    priorSufficiency: string | null;
    currentSufficiency: string;
    priorP50: number | null;
    currentP50: number | null;
    percentileMovement: number | null;
    priorEligibleCount: number | null;
    currentEligibleCount: number;
    priorRooftopCount: number | null;
    currentRooftopCount: number;
    ownRooftopExcluded: number;
    reevaluatedVins: string[];
    rejected: Array<{
        vin: string;
        reasons: string[];
    }>;
    usedSharedEvidence: boolean;
    providerCallsCaused: number;
    providerCostCaused: number;
    audience: "internal_only";
}
export interface PropagationReviewInput {
    cohort: {
        hash: string;
        year?: number | null;
        make?: string | null;
        model?: string | null;
        trim?: string | null;
        drivetrain?: string | null;
        vehicleClass?: string | null;
    };
    snapshot: {
        fingerprint: string;
        observedAt?: string | null;
        eligibleCount: number;
        independentRooftopCount: number;
        ownRooftopExcluded: number;
        p50: number | null;
    };
    prior?: {
        eligibleCount: number;
        independentRooftopCount: number;
        p50: number | null;
        sufficiency: string;
    } | null;
    change: {
        reasons: string[];
        currentSufficiency: string;
        percentileMovement: number | null;
    };
    plan: {
        planned: Array<{
            vin: string;
        }>;
        rejected: Array<{
            vin: string;
            reasons: string[];
        }>;
        providerCallsCaused: number;
        providerCostCaused: number;
        usedSharedEvidence: boolean;
    };
}
export const cohortLabel = (c: PropagationReviewInput["cohort"]): string => [c.year, c.make, c.model, c.trim, c.drivetrain?.toUpperCase(), c.vehicleClass?.toUpperCase()]
    .filter((p) => p != null && p !== "")
    .join(" ") || "unknown cohort";
export function buildPropagationReviewRow(input: PropagationReviewInput): PropagationReviewRow {
    return {
        cohortHash: input.cohort.hash,
        cohortLabel: cohortLabel(input.cohort),
        snapshotFingerprint: input.snapshot.fingerprint,
        observedAt: input.snapshot.observedAt ?? null,
        affectedCount: input.plan.planned.length,
        materialChangeReasons: input.change.reasons,
        priorSufficiency: input.prior?.sufficiency ?? null,
        currentSufficiency: input.change.currentSufficiency,
        priorP50: input.prior?.p50 ?? null,
        currentP50: input.snapshot.p50,
        percentileMovement: input.change.percentileMovement,
        priorEligibleCount: input.prior?.eligibleCount ?? null,
        currentEligibleCount: input.snapshot.eligibleCount,
        priorRooftopCount: input.prior?.independentRooftopCount ?? null,
        currentRooftopCount: input.snapshot.independentRooftopCount,
        ownRooftopExcluded: input.snapshot.ownRooftopExcluded,
        reevaluatedVins: input.plan.planned.map((p) => p.vin),
        rejected: input.plan.rejected,
        usedSharedEvidence: input.plan.usedSharedEvidence,
        providerCallsCaused: input.plan.providerCallsCaused,
        providerCostCaused: input.plan.providerCostCaused,
        audience: "internal_only",
    };
}
import type { MarketAwarenessState, IdentityDimension } from "./awareness.ts";
import type { MarketEvidenceState, MarketClaimReadiness } from "./evidenceState.ts";
export interface VehicleAwarenessReviewRow {
    vin: string;
    cohortLabel: string;
    cohortHash: string | null;
    identity: Array<{
        dimension: IdentityDimension;
        value: string | null;
        source: string;
        status: string;
    }>;
    verified: IdentityDimension[];
    unknown: IdentityDimension[];
    conflicts: IdentityDimension[];
    stale: IdentityDimension[];
    safeToCompare: boolean;
    compatibleSiblings: string[];
    rejectedSiblings: Array<{
        vin: string;
        reasons: string[];
    }>;
    indeterminateSiblings: Array<{
        vin: string;
        reasons: string[];
    }>;
    snapshotFingerprint: string | null;
    snapshotAgeDays: number | null;
    eligibleComparableCount: number;
    independentRooftopCount: number;
    ownedRooftopCount: number;
    evidenceStrength: string;
    marketChanged: boolean;
    materialChangeReasons: string[];
    triggeredReevaluation: boolean;
    propagationProviderCalls: number;
    propagationCostUsd: number;
    publicClaimReady: boolean;
    claimReadiness: string;
    claimReasons: string[];
    audience: "internal_only";
}
export function buildVehicleAwarenessReviewRow(input: {
    vin: string;
    cohortLabel: string;
    cohortHash?: string | null;
    awareness: MarketAwarenessState;
    evidence: MarketEvidenceState;
    readiness: MarketClaimReadiness;
    siblings?: {
        compatible?: string[];
        rejected?: Array<{
            vin: string;
            reasons: string[];
        }>;
        indeterminate?: Array<{
            vin: string;
            reasons: string[];
        }>;
    };
    marketChanged?: boolean;
    triggeredReevaluation?: boolean;
}): VehicleAwarenessReviewRow {
    const a = input.awareness;
    const dimensions = Object.keys(a.fields) as IdentityDimension[];
    return {
        vin: input.vin,
        cohortLabel: input.cohortLabel,
        cohortHash: input.cohortHash ?? input.evidence.cohortHash,
        identity: dimensions.map((d) => ({
            dimension: d,
            value: a.fields[d].normalized,
            source: a.fields[d].source,
            status: a.fields[d].status,
        })),
        verified: dimensions.filter((d) => a.fields[d].status === "verified"),
        unknown: a.unknown,
        conflicts: a.conflicts,
        stale: a.stale,
        safeToCompare: a.safeToCompare,
        compatibleSiblings: input.siblings?.compatible ?? [],
        rejectedSiblings: input.siblings?.rejected ?? [],
        indeterminateSiblings: input.siblings?.indeterminate ?? [],
        snapshotFingerprint: input.evidence.snapshotFingerprint,
        snapshotAgeDays: input.evidence.comparableFreshnessDays,
        eligibleComparableCount: input.evidence.eligibleComparableCount,
        independentRooftopCount: input.evidence.independentRooftopCount,
        ownedRooftopCount: input.evidence.ownedRooftopCount,
        evidenceStrength: input.evidence.strength,
        marketChanged: input.marketChanged ?? false,
        materialChangeReasons: input.evidence.materialChangeReasons,
        triggeredReevaluation: input.triggeredReevaluation ?? false,
        propagationProviderCalls: 0,
        propagationCostUsd: 0,
        publicClaimReady: input.readiness.readiness === "eligible",
        claimReadiness: input.readiness.readiness,
        claimReasons: input.readiness.reasons,
        audience: "internal_only",
    };
}
