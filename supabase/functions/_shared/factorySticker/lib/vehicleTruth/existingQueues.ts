// GENERATED — do not edit.
// Mirror of src/lib/vehicleTruth/existingQueues.ts, copied so the edge runtime can
// bundle the engine (Supabase ships only supabase/functions/). Edit the
// source file and run `bun run sync:edge-sticker`.
import { DOCUMENT_FAMILIES, DOCUMENT_FAMILY_IDS, type DocumentFamilyId, } from "../documents/families.ts";
import type { FieldChange } from "./materialChange.ts";
import type { FactConflict } from "./snapshot.ts";
export type StaleSeverity = "info" | "warning" | "compliance_block";
export interface StaleFlagRow {
    changed_field: string;
    reason: string;
    severity: StaleSeverity;
    old_value: unknown;
    new_value: unknown;
}
export function documentTypesForFamily(family: DocumentFamilyId): string[] {
    const def = DOCUMENT_FAMILIES[family];
    return [...new Set([def.documentType, ...def.legacyTypes])];
}
export function familiesForDocumentType(documentType: string): DocumentFamilyId[] {
    const type = String(documentType ?? "").trim().toLowerCase();
    if (!type)
        return [];
    return DOCUMENT_FAMILY_IDS.filter((id) => documentTypesForFamily(id).includes(type));
}
const COMPLIANCE_FIELDS = new Set(["vin", "identity.model", "identity.modelYear", "condition"]);
const readable = (v: unknown): unknown => Array.isArray(v) ? `${v.length} item${v.length === 1 ? "" : "s"}` : v ?? null;
export function staleFlagsForFamily(family: DocumentFamilyId, changes: FieldChange[], snapshotVersion: number): StaleFlagRow[] {
    return changes
        .filter((change) => change.affects.includes(family))
        .map((change) => ({
        changed_field: change.field,
        reason: `${change.label} changed in vehicle snapshot v${snapshotVersion}, after this document was generated.`,
        severity: (COMPLIANCE_FIELDS.has(change.field) ? "compliance_block" : "warning") as StaleSeverity,
        old_value: readable(change.previous),
        new_value: readable(change.next),
    }));
}
export const TRUTH_CONFLICT_EXCEPTION_TYPE = "vehicle_truth_conflict";
export interface VehicleExceptionRow {
    exception_type: string;
    severity: "info" | "low" | "medium" | "high" | "critical";
    title: string;
    explanation: string;
    source_values: Record<string, unknown>;
    recommended_action: string;
    requires_new_document: boolean;
}
export function conflictException(conflicts: FactConflict[], snapshotVersion: number): VehicleExceptionRow | null {
    if (!conflicts.length)
        return null;
    const blocking = conflicts.filter((c) => c.blocksGeneration);
    const fields = conflicts.map((c) => c.factKey);
    return {
        exception_type: TRUTH_CONFLICT_EXCEPTION_TYPE,
        severity: blocking.length ? "high" : "medium",
        title: blocking.length
            ? `${blocking.length} vehicle fact${blocking.length === 1 ? "" : "s"} in dispute — document generation is blocked`
            : `${conflicts.length} vehicle fact${conflicts.length === 1 ? "" : "s"} in dispute`,
        explanation: conflicts
            .map((c) => {
            const values = c.candidates
                .map((cand) => `${JSON.stringify(cand.value)} (${cand.sourceKind})`)
                .join(" vs ");
            return `${c.factKey}: ${values}`;
        })
            .join("; "),
        source_values: {
            snapshot_version: snapshotVersion,
            fields,
            conflicts: conflicts.map((c) => ({
                fact_key: c.factKey,
                authority: c.authority,
                blocks_generation: c.blocksGeneration,
                candidates: c.candidates,
            })),
        },
        recommended_action: blocking.length
            ? "Two sources that may both verify these facts disagree. Confirm the correct value on the vehicle record, then regenerate."
            : "Review the disagreeing sources and confirm the correct value on the vehicle record.",
        requires_new_document: false,
    };
}
