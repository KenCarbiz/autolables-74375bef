// GENERATED — do not edit.
// Mirror of src/lib/market/propagation.ts, copied so the edge runtime can
// bundle the engine (Supabase ships only supabase/functions/). Edit the
// source file and run `bun run sync:edge-sticker`.
import type { MarketCohortKey } from "./cohort.ts";
import { marketAwarenessRelationship, mayReceiveMarketAwareness, valuationCompatibility, mayServeAsPrimaryComparable, isContextOnlyEvidence, type ValuationCompatibility, } from "./relationship.ts";
import type { MarketAwarenessState } from "./awareness.ts";
import { MAX_SHADOW_COHORT } from "./shadowPipeline.ts";
export type PropagationDepth = 0 | 1;
export const MAX_PROPAGATION_DEPTH: PropagationDepth = 1;
export const MAX_PLAN_PER_INVOCATION = 25;
export interface InventoryCandidate {
    vin: string;
    tenantId: string;
    cohortKey: MarketCohortKey;
    lastValuationFingerprint?: string | null;
    nextValuationFingerprint: string;
    lastEvaluatedAt?: string | null;
    awareness?: MarketAwarenessState | null;
}
export interface PlannedReevaluation {
    vin: string;
    providerPolicy: "disabled";
    valuationCompatibility: ValuationCompatibility;
    evidenceContextOnly: boolean;
    reasons: string[];
}
export interface RejectedCandidate {
    vin: string;
    reasons: string[];
}
export interface PropagationPlan {
    planned: PlannedReevaluation[];
    rejected: RejectedCandidate[];
    indeterminate: RejectedCandidate[];
    continuationCursor: string | null;
    usedSharedEvidence: true;
    providerCallsCaused: 0;
    providerCostCaused: 0;
    reasons: string[];
}
export const NIGHTLY_CYCLE_HOURS = 20;
const withinNightlyCycle = (lastEvaluatedAt: unknown, now: number): boolean => {
    if (typeof lastEvaluatedAt !== "string")
        return false;
    const t = Date.parse(lastEvaluatedAt);
    if (!Number.isFinite(t))
        return false;
    return (now - t) / 3600000 < NIGHTLY_CYCLE_HOURS;
};
export function planImpactedInventory(input: {
    tenantId: string;
    cohortKey: MarketCohortKey;
    subjectVin: string;
    subjectAlreadyEvaluated: boolean;
    inventory: InventoryCandidate[];
    pilotVins: string[];
    depth: PropagationDepth;
    now?: number;
    cursor?: string | null;
}): PropagationPlan {
    const reasons: string[] = [];
    const now = input.now ?? Date.now();
    const empty = (reason: string): PropagationPlan => ({
        planned: [],
        rejected: [],
        indeterminate: [],
        continuationCursor: null,
        usedSharedEvidence: true,
        providerCallsCaused: 0,
        providerCostCaused: 0,
        reasons: [...reasons, reason],
    });
    if (input.depth >= MAX_PROPAGATION_DEPTH) {
        return empty("propagation_depth_exhausted");
    }
    if (!input.tenantId)
        return empty("propagation_tenant_missing");
    if (!input.cohortKey.usable)
        return empty("propagation_cohort_not_usable");
    const pilot = new Set(input.pilotVins.map((v) => v.trim().toUpperCase()));
    if (pilot.size === 0)
        return empty("propagation_pilot_cohort_empty");
    if (pilot.size > MAX_SHADOW_COHORT)
        return empty("propagation_pilot_cohort_too_large");
    const subject = input.subjectVin.trim().toUpperCase();
    const planned: PlannedReevaluation[] = [];
    const rejected: RejectedCandidate[] = [];
    const indeterminate: RejectedCandidate[] = [];
    const seen = new Set<string>();
    const ordered = [...input.inventory].sort((a, b) => a.vin.toUpperCase() < b.vin.toUpperCase() ? -1 : a.vin.toUpperCase() > b.vin.toUpperCase() ? 1 : 0);
    let started = !input.cursor;
    let cursor: string | null = null;
    for (const candidate of ordered) {
        const vin = candidate.vin.trim().toUpperCase();
        if (!started) {
            if (vin === input.cursor)
                started = true;
            continue;
        }
        if (seen.has(vin))
            continue;
        seen.add(vin);
        const why: string[] = [];
        if (candidate.tenantId !== input.tenantId) {
            rejected.push({ vin, reasons: ["propagation_cross_tenant_refused"] });
            continue;
        }
        if (!pilot.has(vin)) {
            rejected.push({ vin, reasons: ["propagation_outside_pilot_cohort"] });
            continue;
        }
        if (vin === subject && input.subjectAlreadyEvaluated) {
            rejected.push({ vin, reasons: ["propagation_subject_already_evaluated"] });
            continue;
        }
        if (candidate.awareness && !candidate.awareness.safeToCompare) {
            rejected.push({
                vin,
                reasons: ["propagation_identity_conflicted", ...candidate.awareness.conflicts.map((d) => `${d}_conflict`)],
            });
            continue;
        }
        const market = marketAwarenessRelationship(input.cohortKey, candidate.cohortKey);
        if (market.relationship === "indeterminate") {
            indeterminate.push({ vin, reasons: market.reasons });
            continue;
        }
        if (!mayReceiveMarketAwareness(market)) {
            rejected.push({ vin, reasons: market.reasons });
            continue;
        }
        const compatibility = valuationCompatibility(input.cohortKey, candidate.cohortKey);
        why.push(...market.reasons, ...compatibility.reasons);
        if (candidate.lastValuationFingerprint === candidate.nextValuationFingerprint) {
            rejected.push({ vin, reasons: ["propagation_valuation_fingerprint_unchanged"] });
            continue;
        }
        if (withinNightlyCycle(candidate.lastEvaluatedAt, now)) {
            rejected.push({ vin, reasons: ["propagation_nightly_cap_reached"] });
            continue;
        }
        if (planned.length >= MAX_PLAN_PER_INVOCATION) {
            cursor = vin;
            reasons.push("propagation_continuation_required");
            break;
        }
        planned.push({
            vin,
            providerPolicy: "disabled",
            valuationCompatibility: compatibility.compatibility,
            evidenceContextOnly: !mayServeAsPrimaryComparable(compatibility)
                || isContextOnlyEvidence(compatibility),
            reasons: why,
        });
    }
    reasons.push(`propagation_planned_${planned.length}`, `propagation_rejected_${rejected.length}`, `propagation_indeterminate_${indeterminate.length}`, `propagation_exact_comparables_${planned.filter((p) => p.valuationCompatibility === "exact").length}`, `propagation_adjustment_required_${planned.filter((p) => p.valuationCompatibility === "adjustment_required").length}`);
    return {
        planned,
        rejected,
        indeterminate,
        continuationCursor: cursor,
        usedSharedEvidence: true,
        providerCallsCaused: 0,
        providerCostCaused: 0,
        reasons,
    };
}
export const NEVER_PROPAGATED_FIELDS = [
    "providerPrediction",
    "provider_prediction",
    "marketP50",
    "market_p50",
    "confidence",
    "verdict",
    "difference",
    "marketPosition",
    "market_position",
] as const;
