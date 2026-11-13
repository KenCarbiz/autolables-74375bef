// GENERATED — do not edit.
// Mirror of src/lib/market/cohort.ts, copied so the edge runtime can
// bundle the engine (Supabase ships only supabase/functions/). Edit the
// source file and run `bun run sync:edge-sticker`.
import { digest } from "./hash.ts";
import { classifyEquipment } from "./equipmentClass.ts";
export const COHORT_RULES_VERSION = "cohort-v1.0.0";
export type VehicleClass = "new" | "used" | "cpo";
export type Drivetrain = "awd" | "fwd" | "rwd" | "4wd" | "unknown";
export interface CohortSubject {
    year?: unknown;
    make?: unknown;
    model?: unknown;
    trim?: unknown;
    drivetrain?: unknown;
    powertrain?: unknown;
    bodyType?: unknown;
    condition?: unknown;
    certified?: unknown;
    equipment?: unknown;
    zip?: unknown;
    radiusMiles?: unknown;
}
export interface MarketCohortKey {
    cohortRulesVersion: string;
    year: number | null;
    make: string | null;
    model: string | null;
    trim: string | null;
    drivetrain: Drivetrain;
    powertrain: string | null;
    bodyType: string | null;
    vehicleClass: VehicleClass | null;
    certifiedClass: "certified" | "not_certified" | "unknown";
    equipmentSignature: string;
    zip: string | null;
    radiusMiles: number | null;
    usable: boolean;
    reasons: string[];
}
export const EQUIPMENT_UNKNOWN = "equipment_unknown";
const text = (v: unknown): string | null => {
    if (typeof v !== "string")
        return null;
    const s = v.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
    return s || null;
};
const year = (v: unknown): number | null => {
    const n = typeof v === "number" ? v : typeof v === "string" ? Number(v.trim()) : NaN;
    return Number.isInteger(n) && n >= 1900 && n <= 2100 ? n : null;
};
export function normalizeDrivetrain(v: unknown): Drivetrain {
    const s = text(v);
    if (!s)
        return "unknown";
    const c = s.replace(/\s/g, "");
    if (/^(awd|allwheeldrive|all)$/.test(c))
        return "awd";
    if (/^(fwd|frontwheeldrive|front)$/.test(c))
        return "fwd";
    if (/^(rwd|rearwheeldrive|rear)$/.test(c))
        return "rwd";
    if (/^(4wd|4x4|fourwheeldrive|four)$/.test(c))
        return "4wd";
    return "unknown";
}
export function normalizeTrim(v: unknown): string | null {
    return text(v);
}
export function equipmentSignature(v: unknown): string {
    const classified = classifyEquipment(v);
    if (classified.unknown)
        return EQUIPMENT_UNKNOWN;
    return digest({ kind: "equipment", items: classified.cohortDefining });
}
export function equipmentDifference(a: unknown, b: unknown): {
    known: boolean;
    onlyInA: string[];
    onlyInB: string[];
    shared: string[];
} {
    const ca = classifyEquipment(a);
    const cb = classifyEquipment(b);
    if (ca.unknown || cb.unknown)
        return { known: false, onlyInA: [], onlyInB: [], shared: [] };
    const setA = new Set(ca.cohortDefining);
    const setB = new Set(cb.cohortDefining);
    return {
        known: true,
        onlyInA: ca.cohortDefining.filter((i) => !setB.has(i)),
        onlyInB: cb.cohortDefining.filter((i) => !setA.has(i)),
        shared: ca.cohortDefining.filter((i) => setB.has(i)),
    };
}
const vehicleClass = (condition: unknown, certified: unknown): VehicleClass | null => {
    const c = text(condition);
    if (c === "new")
        return "new";
    if (certified === true || c === "cpo")
        return "cpo";
    if (c === "used")
        return "used";
    return null;
};
export function buildCohortKey(subject: CohortSubject): MarketCohortKey {
    const reasons: string[] = [];
    const y = year(subject.year);
    const make = text(subject.make);
    const model = text(subject.model);
    const trim = normalizeTrim(subject.trim);
    const drivetrain = normalizeDrivetrain(subject.drivetrain);
    const cls = vehicleClass(subject.condition, subject.certified);
    const equipment = equipmentSignature(subject.equipment);
    const zip = typeof subject.zip === "string" && /^\d{5}$/.test(subject.zip.trim())
        ? subject.zip.trim() : null;
    const radius = typeof subject.radiusMiles === "number" && Number.isFinite(subject.radiusMiles)
        && subject.radiusMiles > 0 ? subject.radiusMiles : null;
    const certifiedClass = subject.certified === true ? "certified"
        : subject.certified === false ? "not_certified" : "unknown";
    if (y == null)
        reasons.push("cohort_year_unknown");
    if (!make)
        reasons.push("cohort_make_unknown");
    if (!model)
        reasons.push("cohort_model_unknown");
    if (!trim)
        reasons.push("cohort_trim_unknown");
    if (drivetrain === "unknown")
        reasons.push("cohort_drivetrain_unknown");
    if (!cls)
        reasons.push("cohort_class_unknown");
    if (equipment === EQUIPMENT_UNKNOWN)
        reasons.push("cohort_equipment_unknown");
    if (!zip)
        reasons.push("cohort_zip_unknown");
    if (radius == null)
        reasons.push("cohort_radius_unknown");
    const usable = y != null && !!make && !!model && !!trim
        && drivetrain !== "unknown" && !!cls && !!zip && radius != null;
    if (usable)
        reasons.push("cohort_key_usable");
    return {
        cohortRulesVersion: COHORT_RULES_VERSION,
        year: y,
        make,
        model,
        trim,
        drivetrain,
        powertrain: text(subject.powertrain),
        bodyType: text(subject.bodyType),
        vehicleClass: cls,
        certifiedClass,
        equipmentSignature: equipment,
        zip,
        radiusMiles: radius,
        usable,
        reasons,
    };
}
export function marketCohortHash(key: MarketCohortKey): string {
    return digest({
        kind: "market_cohort",
        rules: key.cohortRulesVersion,
        year: key.year,
        make: key.make,
        model: key.model,
        trim: key.trim,
        drivetrain: key.drivetrain,
        powertrain: key.powertrain,
        body: key.bodyType,
        class: key.vehicleClass,
        certified: key.certifiedClass,
        zip: key.zip,
        radius: key.radiusMiles,
    });
}
export function cohortKeyHash(key: MarketCohortKey): string {
    return digest({
        kind: "market_cohort",
        rules: key.cohortRulesVersion,
        year: key.year,
        make: key.make,
        model: key.model,
        trim: key.trim,
        drivetrain: key.drivetrain,
        powertrain: key.powertrain,
        body: key.bodyType,
        class: key.vehicleClass,
        certified: key.certifiedClass,
        equipment: key.equipmentSignature,
        zip: key.zip,
        radius: key.radiusMiles,
    });
}
export type CohortRelation = "exact" | "context_only" | "indeterminate" | "incompatible";
export interface CohortMatch {
    relation: CohortRelation;
    reasons: string[];
}
const EXACT_DIMENSIONS = [
    ["year", "cohort_year_differs"],
    ["make", "cohort_make_differs"],
    ["model", "cohort_model_differs"],
    ["trim", "cohort_trim_differs"],
    ["drivetrain", "cohort_drivetrain_differs"],
    ["powertrain", "cohort_powertrain_differs"],
    ["bodyType", "cohort_body_differs"],
    ["vehicleClass", "cohort_class_differs"],
    ["certifiedClass", "cohort_certification_differs"],
    ["zip", "cohort_zip_differs"],
    ["radiusMiles", "cohort_radius_differs"],
] as const;
export function cohortsMatch(a: MarketCohortKey, b: MarketCohortKey): CohortMatch {
    const reasons: string[] = [];
    if (a.cohortRulesVersion !== b.cohortRulesVersion) {
        return { relation: "incompatible", reasons: ["cohort_rules_version_differs"] };
    }
    if (!a.usable || !b.usable) {
        return { relation: "incompatible", reasons: ["cohort_key_not_usable"] };
    }
    for (const [dimension, reason] of EXACT_DIMENSIONS) {
        if (a[dimension] !== b[dimension]) {
            if (dimension === "year" && a.year != null && b.year != null
                && Math.abs(a.year - b.year) === 1) {
                const rest = EXACT_DIMENSIONS.filter(([d]) => d !== "year")
                    .every(([d]) => a[d] === b[d]);
                if (rest && a.equipmentSignature === b.equipmentSignature
                    && a.equipmentSignature !== EQUIPMENT_UNKNOWN) {
                    return {
                        relation: "context_only",
                        reasons: ["cohort_adjacent_model_year", "cohort_same_generation_not_approved"],
                    };
                }
            }
            reasons.push(reason);
            return { relation: "incompatible", reasons };
        }
    }
    const aUnknown = a.equipmentSignature === EQUIPMENT_UNKNOWN;
    const bUnknown = b.equipmentSignature === EQUIPMENT_UNKNOWN;
    if (aUnknown || bUnknown) {
        return {
            relation: "indeterminate",
            reasons: [
                "cohort_equipment_indeterminate",
                aUnknown && bUnknown ? "cohort_equipment_unknown_both"
                    : aUnknown ? "cohort_equipment_unknown_subject" : "cohort_equipment_unknown_candidate",
                "cohort_equipment_enrichment_would_resolve",
            ],
        };
    }
    if (a.equipmentSignature !== b.equipmentSignature) {
        return { relation: "incompatible", reasons: ["cohort_equipment_differs"] };
    }
    return { relation: "exact", reasons: ["cohort_exact_match"] };
}
export const mayShareMarketEvidence = (m: CohortMatch): boolean => m.relation === "exact";
export const needsEnrichmentToDecide = (m: CohortMatch): boolean => m.relation === "indeterminate";
export const isContextOnly = (m: CohortMatch): boolean => m.relation === "context_only" || m.relation === "indeterminate";
