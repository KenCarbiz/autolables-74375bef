// GENERATED — do not edit.
// Mirror of src/lib/vehicleTruth/snapshot.ts, copied so the edge runtime can
// bundle the engine (Supabase ships only supabase/functions/). Edit the
// source file and run `bun run sync:edge-sticker`.
import { capConfidence, factAuthority, resolveFact, type CandidateFact, type Confidence, type FactAuthority, type SourceKind, } from "./precedence.ts";
import { contentChecksum, detectMaterialChange, type DocumentFamilyKey, type FieldChange, } from "./materialChange.ts";
import { EMPTY_AUTHORITY, type TenantAuthority } from "./tenantAuthority.ts";
export interface TruthFact<T = unknown> {
    value: T;
    source: SourceKind;
    confidence: Confidence;
    authority: FactAuthority;
    status: FactStatus;
    observedAt: string | null;
    usableInCopy: boolean;
    evidence: {
        sourceRecordId?: string;
        note?: string;
    };
    overriddenBy?: string;
    disputed: boolean;
}
export type FactStatus = "verified" | "dealer_entered" | "feed_provided" | "calculated" | "inferred" | "disputed" | "pending";
export function factStatus(source: SourceKind, confidence: Confidence, disputed: boolean): FactStatus {
    if (disputed)
        return "disputed";
    switch (source) {
        case "oem_authorized":
        case "neovin":
            return confidence === "VERIFIED" ? "verified" : "feed_provided";
        case "dealer_confirmed":
            return "dealer_entered";
        case "marketcheck":
            return "feed_provided";
        case "vin_decode":
        case "other_structured":
            return "calculated";
        case "ai_inference":
            return "inferred";
        default:
            return "pending";
    }
}
export interface VehicleTruthSnapshot {
    vin: string;
    condition: "new" | "used" | "cpo" | null;
    mileage: number | null;
    identity: {
        manufacturer: string | null;
        make: string | null;
        modelYear: number | null;
        model: string | null;
        trim: string | null;
        bodyConfiguration: string | null;
        stockNumber: string | null;
    };
    mechanical: {
        engine: string | null;
        transmission: string | null;
        drivetrain: string | null;
        fuelType: string | null;
    };
    colors: {
        exterior: string | null;
        interior: string | null;
    };
    equipment: {
        standard: string[];
        factoryOptions: string[];
        factoryPackages: string[];
        dealerInstalled: string[];
    };
    pricing: {
        baseMsrp: number | null;
        destinationCharge: number | null;
        totalMsrp: number | null;
        factoryOptionsTotal: number | null;
        advertisedPrice: number | null;
    };
    warranty: {
        selection: string | null;
    };
}
export const SNAPSHOT_FIELDS: Record<string, string> = {
    condition: "condition",
    mileage: "mileage",
    manufacturer: "identity.manufacturer",
    make: "identity.make",
    model_year: "identity.modelYear",
    model: "identity.model",
    trim: "identity.trim",
    body_configuration: "identity.bodyConfiguration",
    stock_number: "identity.stockNumber",
    engine: "mechanical.engine",
    transmission: "mechanical.transmission",
    drivetrain: "mechanical.drivetrain",
    fuel_type: "mechanical.fuelType",
    exterior_color: "colors.exterior",
    interior_color: "colors.interior",
    standard_equipment: "equipment.standard",
    factory_options: "equipment.factoryOptions",
    factory_packages: "equipment.factoryPackages",
    dealer_installed_equipment: "equipment.dealerInstalled",
    base_msrp: "pricing.baseMsrp",
    destination_charge: "pricing.destinationCharge",
    total_msrp: "pricing.totalMsrp",
    factory_options_total: "pricing.factoryOptionsTotal",
    advertised_price: "pricing.advertisedPrice",
    warranty_selection: "warranty.selection",
};
const ARRAY_FIELDS = new Set([
    "standard_equipment",
    "factory_options",
    "factory_packages",
    "dealer_installed_equipment",
]);
export function emptySnapshot(vin: string): VehicleTruthSnapshot {
    return {
        vin: vin.trim().toUpperCase(),
        condition: null,
        mileage: null,
        identity: {
            manufacturer: null,
            make: null,
            modelYear: null,
            model: null,
            trim: null,
            bodyConfiguration: null,
            stockNumber: null,
        },
        mechanical: { engine: null, transmission: null, drivetrain: null, fuelType: null },
        colors: { exterior: null, interior: null },
        equipment: { standard: [], factoryOptions: [], factoryPackages: [], dealerInstalled: [] },
        pricing: {
            baseMsrp: null,
            destinationCharge: null,
            totalMsrp: null,
            factoryOptionsTotal: null,
            advertisedPrice: null,
        },
        warranty: { selection: null },
    };
}
function writePath(target: Record<string, unknown>, path: string, value: unknown): void {
    const parts = path.split(".");
    let node = target;
    for (const part of parts.slice(0, -1)) {
        if (!node[part] || typeof node[part] !== "object")
            node[part] = {};
        node = node[part] as Record<string, unknown>;
    }
    node[parts[parts.length - 1]] = value;
}
export interface FactConflict {
    factKey: string;
    authority: FactAuthority;
    candidates: Array<{
        value: unknown;
        sourceKind: SourceKind;
        confidence: Confidence;
        observedAt: string | null;
    }>;
    blocksGeneration: boolean;
}
export interface BuiltSnapshot {
    snapshot: VehicleTruthSnapshot;
    facts: Record<string, TruthFact>;
    conflicts: FactConflict[];
    sourceKinds: SourceKind[];
    checksum: string;
}
export function buildVehicleSnapshot(vin: string, candidates: Array<CandidateFact & {
    sourceRecordId?: string;
    overriddenBy?: string;
}>, authority: TenantAuthority = EMPTY_AUTHORITY): BuiltSnapshot {
    const snapshot = emptySnapshot(vin);
    const facts: Record<string, TruthFact> = {};
    const conflicts: FactConflict[] = [];
    const byKey = new Map<string, typeof candidates>();
    for (const candidate of candidates) {
        const key = candidate.factKey.trim().toLowerCase();
        if (!SNAPSHOT_FIELDS[key])
            continue;
        const bucket = byKey.get(key);
        if (bucket)
            bucket.push(candidate);
        else
            byKey.set(key, [candidate]);
    }
    for (const [key, bucket] of byKey) {
        const resolved = resolveFact(bucket.map((candidate) => ({ ...candidate, factKey: key })), {
            configuredOrder: authority.orderByFact.get(key) ?? null,
            conflictBehavior: authority.blockingFacts.has(key) ? "block_generation"
                : authority.ignoredFacts.has(key) ? "ignore" : "warn",
        });
        if (!resolved)
            continue;
        if (resolved.value === null || resolved.value === undefined)
            continue;
        const factAuthorityOf = factAuthority(key);
        const winner = bucket.find((candidate) => candidate.source === resolved.source && candidate.value === resolved.value);
        facts[key] = {
            value: resolved.value,
            source: resolved.source,
            confidence: resolved.confidence,
            authority: factAuthorityOf,
            status: factStatus(resolved.source, resolved.confidence, resolved.disputed),
            observedAt: winner?.sourceTimestamp ?? null,
            usableInCopy: resolved.source !== "ai_inference" && !resolved.disputed,
            evidence: winner?.sourceRecordId ? { sourceRecordId: winner.sourceRecordId } : {},
            overriddenBy: winner?.overriddenBy,
            disputed: resolved.disputed,
        };
        writePath(snapshot as unknown as Record<string, unknown>, SNAPSHOT_FIELDS[key], ARRAY_FIELDS.has(key) && !Array.isArray(resolved.value) ? [] : resolved.value);
        if (resolved.disputed) {
            conflicts.push({
                factKey: key,
                authority: factAuthorityOf,
                candidates: bucket.map((candidate) => ({
                    value: candidate.value,
                    sourceKind: candidate.source,
                    confidence: capConfidence(candidate.source, candidate.confidence),
                    observedAt: candidate.sourceTimestamp ?? null,
                })),
                blocksGeneration: factAuthorityOf === "manufacturer" || resolved.blocking,
            });
        }
    }
    return {
        snapshot,
        facts,
        conflicts,
        sourceKinds: [...new Set(candidates.map((candidate) => candidate.source))],
        checksum: contentChecksum(snapshot),
    };
}
export function carryForward(current: VehicleTruthSnapshot, candidate: VehicleTruthSnapshot): VehicleTruthSnapshot {
    const merged = JSON.parse(JSON.stringify(candidate)) as VehicleTruthSnapshot;
    for (const path of Object.values(SNAPSHOT_FIELDS)) {
        const next = readPath(merged, path);
        const held = readPath(current, path);
        const missing = next === null || next === undefined
            || (Array.isArray(next) && next.length === 0);
        if (missing && held !== null && held !== undefined) {
            writePath(merged as unknown as Record<string, unknown>, path, held);
        }
    }
    return merged;
}
function readPath(obj: unknown, path: string): unknown {
    return path.split(".").reduce<unknown>((acc, part) => {
        if (acc && typeof acc === "object")
            return (acc as Record<string, unknown>)[part];
        return undefined;
    }, obj);
}
export interface SnapshotDecision {
    createVersion: boolean;
    nextVersion: number;
    checksum: string;
    changes: FieldChange[];
    affectedFamilies: DocumentFamilyKey[];
    reason: "first_snapshot" | "material_change" | "unchanged";
}
export function decideSnapshotVersion(current: {
    snapshot: VehicleTruthSnapshot;
    version: number;
} | null, candidate: VehicleTruthSnapshot): SnapshotDecision {
    const checksum = contentChecksum(candidate);
    if (!current) {
        return {
            createVersion: true,
            nextVersion: 1,
            checksum,
            changes: [],
            affectedFamilies: [],
            reason: "first_snapshot",
        };
    }
    const merged = carryForward(current.snapshot, candidate);
    const result = detectMaterialChange(current.snapshot, merged);
    return {
        createVersion: result.material,
        nextVersion: result.material ? current.version + 1 : current.version,
        checksum: contentChecksum(merged),
        changes: result.changes,
        affectedFamilies: result.affectedFamilies,
        reason: result.material ? "material_change" : "unchanged",
    };
}
