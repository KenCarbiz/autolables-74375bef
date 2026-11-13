// GENERATED — do not edit.
// Mirror of src/lib/market/relationship.ts, copied so the edge runtime can
// bundle the engine (Supabase ships only supabase/functions/). Edit the
// source file and run `bun run sync:edge-sticker`.
import { cohortsMatch, equipmentDifference, EQUIPMENT_UNKNOWN, type MarketCohortKey, } from "./cohort.ts";
export const RELATIONSHIP_RULES_VERSION = "relationship-v1.0.0";
export type MarketAwarenessRelationship = "same_market" | "related_market" | "indeterminate" | "different_market";
export interface AwarenessMatch {
    relationship: MarketAwarenessRelationship;
    reasons: string[];
}
const MARKET_DEFINING = [
    ["year", "market_year_differs"],
    ["make", "market_make_differs"],
    ["model", "market_model_differs"],
    ["trim", "market_trim_differs"],
    ["drivetrain", "market_drivetrain_differs"],
    ["powertrain", "market_powertrain_differs"],
    ["bodyType", "market_body_differs"],
    ["vehicleClass", "market_class_differs"],
    ["certifiedClass", "market_certification_differs"],
    ["zip", "market_geography_differs"],
    ["radiusMiles", "market_radius_differs"],
] as const;
export function marketAwarenessRelationship(a: MarketCohortKey, b: MarketCohortKey): AwarenessMatch {
    const reasons: string[] = [];
    if (a.cohortRulesVersion !== b.cohortRulesVersion) {
        return { relationship: "different_market", reasons: ["market_rules_version_differs"] };
    }
    if (!a.usable || !b.usable) {
        return {
            relationship: "indeterminate",
            reasons: ["market_identity_incomplete", ...a.reasons.filter((r) => r.endsWith("_unknown")), ...b.reasons.filter((r) => r.endsWith("_unknown"))],
        };
    }
    for (const [dimension, reason] of MARKET_DEFINING) {
        if (a[dimension] === b[dimension])
            continue;
        if (dimension === "year" && a.year != null && b.year != null
            && Math.abs(a.year - b.year) === 1) {
            const restMatch = MARKET_DEFINING.filter(([d]) => d !== "year")
                .every(([d]) => a[d] === b[d]);
            if (restMatch) {
                return {
                    relationship: "related_market",
                    reasons: ["market_adjacent_model_year", "market_same_generation_not_approved"],
                };
            }
        }
        reasons.push(reason);
        return { relationship: "different_market", reasons };
    }
    reasons.push("market_same");
    if (a.equipmentSignature !== b.equipmentSignature) {
        reasons.push("market_equipment_differs_but_market_is_shared");
    }
    return { relationship: "same_market", reasons };
}
export const mayReceiveMarketAwareness = (m: AwarenessMatch): boolean => m.relationship === "same_market";
export type ValuationCompatibility = "exact" | "adjustment_required" | "context_only" | "indeterminate" | "incompatible";
export interface CompatibilityMatch {
    compatibility: ValuationCompatibility;
    awareness: MarketAwarenessRelationship;
    equipmentOnlyInSubject: string[];
    equipmentOnlyInCandidate: string[];
    reasons: string[];
}
export function valuationCompatibility(subject: MarketCohortKey, candidate: MarketCohortKey): CompatibilityMatch {
    const awareness = marketAwarenessRelationship(subject, candidate);
    const base = {
        awareness: awareness.relationship,
        equipmentOnlyInSubject: [] as string[],
        equipmentOnlyInCandidate: [] as string[],
    };
    if (awareness.relationship === "different_market") {
        return { ...base, compatibility: "incompatible", reasons: awareness.reasons };
    }
    if (awareness.relationship === "indeterminate") {
        return { ...base, compatibility: "indeterminate", reasons: awareness.reasons };
    }
    if (awareness.relationship === "related_market") {
        return {
            ...base,
            compatibility: "context_only",
            reasons: [...awareness.reasons, "comparable_adjacent_year_context_only"],
        };
    }
    const subjectUnknown = subject.equipmentSignature === EQUIPMENT_UNKNOWN;
    const candidateUnknown = candidate.equipmentSignature === EQUIPMENT_UNKNOWN;
    if (subjectUnknown || candidateUnknown) {
        return {
            ...base,
            compatibility: "indeterminate",
            reasons: [
                "comparable_equipment_indeterminate",
                subjectUnknown && candidateUnknown ? "comparable_equipment_unknown_both"
                    : subjectUnknown ? "comparable_equipment_unknown_subject"
                        : "comparable_equipment_unknown_candidate",
                "comparable_equipment_enrichment_would_resolve",
            ],
        };
    }
    if (subject.equipmentSignature === candidate.equipmentSignature) {
        return { ...base, compatibility: "exact", reasons: [...awareness.reasons, "comparable_exact"] };
    }
    return {
        ...base,
        compatibility: "adjustment_required",
        reasons: [
            ...awareness.reasons,
            "comparable_material_equipment_differs",
            "comparable_adjustment_method_not_approved",
            "comparable_context_only_until_adjustment_approved",
        ],
    };
}
export interface EquipmentGap {
    known: boolean;
    onlyInSubject: string[];
    onlyInCandidate: string[];
    shared: string[];
    reasons: string[];
}
export function describeEquipmentGap(subjectEquipment: unknown, candidateEquipment: unknown): EquipmentGap {
    const diff = equipmentDifference(subjectEquipment, candidateEquipment);
    const reasons: string[] = [];
    if (!diff.known)
        reasons.push("equipment_gap_indeterminate");
    else {
        if (diff.onlyInA.length)
            reasons.push(`equipment_only_in_subject_${diff.onlyInA.length}`);
        if (diff.onlyInB.length)
            reasons.push(`equipment_only_in_candidate_${diff.onlyInB.length}`);
        if (!diff.onlyInA.length && !diff.onlyInB.length)
            reasons.push("equipment_identical");
    }
    return {
        known: diff.known,
        onlyInSubject: diff.onlyInA,
        onlyInCandidate: diff.onlyInB,
        shared: diff.shared,
        reasons,
    };
}
export const mayServeAsPrimaryComparable = (m: CompatibilityMatch): boolean => m.compatibility === "exact";
export const isContextOnlyEvidence = (m: CompatibilityMatch): boolean => m.compatibility === "adjustment_required" || m.compatibility === "context_only";
export const needsEquipmentEvidence = (m: CompatibilityMatch): boolean => m.compatibility === "indeterminate";
export const COMPATIBILITY_LABEL: Record<ValuationCompatibility, string> = {
    exact: "Exact comparable",
    adjustment_required: "Same market \u2014 equipment differs, not price-adjusted",
    context_only: "Context only",
    indeterminate: "Equipment unknown \u2014 cannot determine",
    incompatible: "Different market",
};
export const VALUE_BEARING_COMPATIBILITIES: ValuationCompatibility[] = ["exact"];
export const mayContributeToMarketValue = (c: ValuationCompatibility): boolean => VALUE_BEARING_COMPATIBILITIES.includes(c);
