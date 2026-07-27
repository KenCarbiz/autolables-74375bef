// Feeding the queues staff already watch.
//
// The truth layer arrived after two working surfaces: `stale_document_flags`
// (per generated document, behind the nav badges and Vehicle Compliance)
// and `vehicle_exceptions` (per vehicle, behind the Command Center). It
// shipped its own `affected_families` routing and its own conflict table,
// which meant a snapshot could know a document was out of date while the
// queue a manager actually looks at said nothing.
//
// So the truth layer does not own a second staleness surface. It converts
// what it knows into rows on the surfaces that already exist.

import {
  DOCUMENT_FAMILIES,
  DOCUMENT_FAMILY_IDS,
  type DocumentFamilyId,
} from "../documents/families.ts";
import type { FieldChange } from "./materialChange.ts";
import type { FactConflict } from "./snapshot.ts";

/** Severity vocabulary `stale_document_flags` already uses. */
export type StaleSeverity = "info" | "warning" | "compliance_block";

export interface StaleFlagRow {
  changed_field: string;
  reason: string;
  severity: StaleSeverity;
  old_value: unknown;
  new_value: unknown;
}

/**
 * Which stored `document_type` values belong to a family.
 *
 * Production still holds the legacy short names — `buyers_guide`, `window`,
 * `k208` — so matching only the canonical `documentType` would flag nothing.
 */
export function documentTypesForFamily(family: DocumentFamilyId): string[] {
  const def = DOCUMENT_FAMILIES[family];
  return [...new Set([def.documentType, ...def.legacyTypes])];
}

/** Reverse lookup: stored document_type -> the families it could belong to. */
export function familiesForDocumentType(documentType: string): DocumentFamilyId[] {
  const type = String(documentType ?? "").trim().toLowerCase();
  if (!type) return [];
  return DOCUMENT_FAMILY_IDS.filter((id) => documentTypesForFamily(id).includes(type));
}

// A changed field that invalidates a printed document is not merely
// informational, but only an identity break is a compliance problem — a
// price move is a reprint, a VIN mismatch is a document that describes the
// wrong car.
const COMPLIANCE_FIELDS = new Set(["vin", "identity.model", "identity.modelYear", "condition"]);

const readable = (v: unknown): unknown =>
  Array.isArray(v) ? `${v.length} item${v.length === 1 ? "" : "s"}` : v ?? null;

/**
 * Convert a snapshot's material changes into stale-flag rows for one
 * document family.
 *
 * Returns [] when nothing in this change set touches the family, which is
 * what stops a warranty correction from flagging the OEM reproduction.
 */
export function staleFlagsForFamily(
  family: DocumentFamilyId,
  changes: FieldChange[],
  snapshotVersion: number,
): StaleFlagRow[] {
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

/** `vehicle_exceptions.exception_type` for a truth-layer conflict. */
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

/**
 * Convert unresolved fact conflicts into ONE exception row.
 *
 * One row per vehicle, not one per fact: the Command Center already
 * accumulates related failures under a single open row per VIN
 * (`artifact_autogen_failed` does exactly this), and a dealership with a
 * disputed trim and a disputed MSRP has one problem to sit down with, not
 * two queue entries.
 */
export function conflictException(
  conflicts: FactConflict[],
  snapshotVersion: number,
): VehicleExceptionRow | null {
  if (!conflicts.length) return null;
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
    // A disputed fact does not by itself invalidate an already-printed
    // document; the stale flags decide that from what actually changed.
    requires_new_document: false,
  };
}
