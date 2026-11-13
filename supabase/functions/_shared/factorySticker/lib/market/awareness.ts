// GENERATED — do not edit.
// Mirror of src/lib/market/awareness.ts, copied so the edge runtime can
// bundle the engine (Supabase ships only supabase/functions/). Edit the
// source file and run `bun run sync:edge-sticker`.
import { classifyEquipment, isMarketingCopy, type EquipmentClassification } from "./equipmentClass.ts";
import { digest } from "./hash.ts";
export const AWARENESS_RULES_VERSION = "awareness-v1.0.0";
export type IdentitySource = "window_sticker" | "build_sheet" | "dealer_confirmed" | "listing_feed" | "derived" | "marketing_description" | "none";
export const AUTHORITATIVE_SOURCES: IdentitySource[] = [
    "window_sticker",
    "build_sheet",
    "dealer_confirmed",
];
export const NON_EQUIPMENT_SOURCES: IdentitySource[] = [
    "listing_feed",
    "derived",
    "marketing_description",
    "none",
];
export type IdentityStatus = "verified" | "derived" | "conflicting" | "missing" | "stale";
export interface IdentityField<T = string> {
    value: T | null;
    normalized: string | null;
    source: IdentitySource;
    sourceTimestamp: string | null;
    status: IdentityStatus;
    candidates: Array<{
        value: string;
        source: IdentitySource;
    }>;
    reasons: string[];
}
export interface IdentityClaim {
    value?: unknown;
    source?: IdentitySource;
    timestamp?: unknown;
}
const norm = (v: unknown): string | null => {
    if (v === null || v === undefined)
        return null;
    const s = String(v).trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
    return s || null;
};
const rank = (s: IdentitySource): number => s === "window_sticker" ? 5 : s === "build_sheet" ? 4 : s === "dealer_confirmed" ? 3
    : s === "listing_feed" ? 2 : s === "derived" ? 1 : 0;
export const IDENTITY_STALE_DAYS = 30;
export function resolveIdentityField(claims: IdentityClaim[], options: {
    now?: number;
    allowedSources?: IdentitySource[];
} = {}): IdentityField {
    const reasons: string[] = [];
    const now = options.now ?? Date.now();
    const usable = claims
        .map((c) => ({
        raw: c.value,
        normalized: norm(c.value),
        source: c.source ?? "none",
        timestamp: typeof c.timestamp === "string" ? c.timestamp : null,
    }))
        .filter((c) => {
        if (c.normalized == null)
            return false;
        if (options.allowedSources && !options.allowedSources.includes(c.source)) {
            reasons.push(`identity_source_not_allowed_${c.source}`);
            return false;
        }
        if (c.source === "marketing_description" || isMarketingCopy(c.raw)) {
            reasons.push("identity_marketing_copy_refused");
            return false;
        }
        return true;
    });
    const candidates = usable.map((c) => ({ value: c.normalized as string, source: c.source }));
    if (usable.length === 0) {
        return {
            value: null,
            normalized: null,
            source: "none",
            sourceTimestamp: null,
            status: "missing",
            candidates,
            reasons: [...reasons, "identity_missing"],
        };
    }
    const distinct = [...new Set(usable.map((c) => c.normalized))];
    const authoritative = usable.filter((c) => AUTHORITATIVE_SOURCES.includes(c.source));
    const authoritativeDistinct = [...new Set(authoritative.map((c) => c.normalized))];
    if (authoritativeDistinct.length > 1) {
        return {
            value: null,
            normalized: null,
            source: "none",
            sourceTimestamp: null,
            status: "conflicting",
            candidates,
            reasons: [...reasons, "identity_conflict_between_authoritative_sources"],
        };
    }
    const winner = [...usable].sort((a, b) => rank(b.source) - rank(a.source))[0];
    if (authoritativeDistinct.length === 0 && distinct.length > 1) {
        return {
            value: null,
            normalized: null,
            source: "none",
            sourceTimestamp: null,
            status: "conflicting",
            candidates,
            reasons: [...reasons, "identity_conflict_between_non_authoritative_sources"],
        };
    }
    if (distinct.length > 1)
        reasons.push("identity_non_authoritative_source_disagrees");
    const isAuthoritative = AUTHORITATIVE_SOURCES.includes(winner.source);
    let status: IdentityStatus = isAuthoritative ? "verified" : "derived";
    if (winner.timestamp) {
        const t = Date.parse(winner.timestamp);
        if (Number.isFinite(t) && (now - t) / 86400000 > IDENTITY_STALE_DAYS) {
            status = "stale";
            reasons.push("identity_source_stale");
        }
    }
    reasons.push(`identity_from_${winner.source}`);
    return {
        value: winner.normalized,
        normalized: winner.normalized,
        source: winner.source,
        sourceTimestamp: winner.timestamp,
        status,
        candidates,
        reasons,
    };
}
export type IdentityDimension = "year" | "make" | "model" | "trim" | "drivetrain" | "powertrain" | "bodyType" | "vehicleClass" | "certification" | "mileage" | "equipment" | "zip";
export const COHORT_DEFINING_DIMENSIONS: IdentityDimension[] = [
    "year",
    "make",
    "model",
    "trim",
    "drivetrain",
    "powertrain",
    "bodyType",
    "vehicleClass",
    "certification",
    "equipment",
];
export interface MarketAwarenessState {
    awarenessRulesVersion: string;
    fields: Record<IdentityDimension, IdentityField>;
    equipment: EquipmentClassification;
    equipmentSignature: string | null;
    geography: {
        zip: string | null;
        radiusMiles: number | null;
        source: IdentitySource;
    };
    known: IdentityDimension[];
    unknown: IdentityDimension[];
    conflicts: IdentityDimension[];
    stale: IdentityDimension[];
    safeToCompare: boolean;
    reasons: string[];
}
export interface AwarenessInput {
    claims: Partial<Record<IdentityDimension, IdentityClaim[]>>;
    equipment?: {
        entries?: unknown;
        source?: IdentitySource;
        timestamp?: unknown;
    };
    radiusMiles?: unknown;
    now?: number;
}
export function buildAwarenessState(input: AwarenessInput): MarketAwarenessState {
    const now = input.now ?? Date.now();
    const reasons: string[] = [];
    const fields = {} as Record<IdentityDimension, IdentityField>;
    const dimensions: IdentityDimension[] = [
        "year",
        "make",
        "model",
        "trim",
        "drivetrain",
        "powertrain",
        "bodyType",
        "vehicleClass",
        "certification",
        "mileage",
        "equipment",
        "zip",
    ];
    for (const dimension of dimensions) {
        if (dimension === "equipment")
            continue;
        fields[dimension] = resolveIdentityField(input.claims[dimension] ?? [], { now });
    }
    const equipmentSource = input.equipment?.source ?? "none";
    const equipmentAuthoritative = AUTHORITATIVE_SOURCES.includes(equipmentSource);
    const equipment = equipmentAuthoritative
        ? classifyEquipment(input.equipment?.entries)
        : { cohortDefining: [], descriptive: [], unknown: true, reasons: [`equipment_source_${equipmentSource}_not_authoritative`] };
    fields.equipment = {
        value: equipment.unknown ? null : equipment.cohortDefining.join(","),
        normalized: equipment.unknown ? null : equipment.cohortDefining.join(","),
        source: equipmentAuthoritative ? equipmentSource : "none",
        sourceTimestamp: typeof input.equipment?.timestamp === "string" ? input.equipment.timestamp : null,
        status: equipment.unknown ? "missing" : "verified",
        candidates: [],
        reasons: equipment.reasons,
    };
    const equipmentSignature = equipment.unknown
        ? null
        : digest({ kind: "equipment_cohort", items: equipment.cohortDefining });
    const known = dimensions.filter((d) => fields[d].status === "verified" || fields[d].status === "derived");
    const unknown = dimensions.filter((d) => fields[d].status === "missing");
    const conflicts = dimensions.filter((d) => fields[d].status === "conflicting");
    const stale = dimensions.filter((d) => fields[d].status === "stale");
    const conflictedCohortDimension = conflicts.some((d) => COHORT_DEFINING_DIMENSIONS.includes(d));
    if (conflictedCohortDimension)
        reasons.push("awareness_cohort_dimension_conflicted");
    for (const d of conflicts)
        reasons.push(`${d}_conflict`);
    for (const d of unknown)
        reasons.push(`${d}_unknown`);
    const safeToCompare = !conflictedCohortDimension;
    if (safeToCompare)
        reasons.push("awareness_safe_to_compare");
    return {
        awarenessRulesVersion: AWARENESS_RULES_VERSION,
        fields,
        equipment,
        equipmentSignature,
        geography: {
            zip: fields.zip.normalized,
            radiusMiles: typeof input.radiusMiles === "number" && input.radiusMiles > 0 ? input.radiusMiles : null,
            source: fields.zip.source,
        },
        known,
        unknown,
        conflicts,
        stale,
        safeToCompare,
        reasons,
    };
}
