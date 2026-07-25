// The Service Desk inspection state machine — client mirror of
// transition_safety_inspection (20260726102000_inspection_state.sql). The SQL
// jsonb literal and this map are compared verbatim by transitions.test.ts, so
// the two can never drift. safety_inspections.status stays the legal signature
// record; these are the OPERATIONAL states beside it.

export const INSPECTION_STATES = [
  "not_started",
  "in_progress",
  "failed_items_open",
  "repairs_in_progress",
  "ready_for_reinspection",
  "passed",
  "voided",
] as const;

export type InspectionState = (typeof INSPECTION_STATES)[number];

// RPC-performable moves only. 'passed' and 'failed_items_open' are entered by
// SIGNING (the status trigger), never by a workflow call — a transition RPC
// that could enter "passed" would let workflow claim a result no one signed.
export const INSPECTION_TRANSITIONS: Record<InspectionState, InspectionState[]> = {
  not_started: ["in_progress", "voided"],
  in_progress: ["voided"],
  failed_items_open: ["repairs_in_progress", "voided"],
  repairs_in_progress: ["ready_for_reinspection", "failed_items_open", "voided"],
  ready_for_reinspection: ["repairs_in_progress", "voided"],
  passed: ["voided"],
  voided: [],
};

export const canTransitionInspection = (from: InspectionState, to: InspectionState): boolean =>
  (INSPECTION_TRANSITIONS[from] || []).includes(to);

/**
 * 'passed' is entered ONLY by a signature (the status sync trigger) — no
 * workflow move reaches it. 'failed_items_open' is also signature-entered, but
 * once in the failure loop the workflow may step back to it from
 * repairs_in_progress; it is never reachable from outside the loop.
 */
export const SIGNATURE_ONLY_STATE: InspectionState = "passed";

/** Voiding retires a legal record: requires void authority and a reason. */
export const VOID_REQUIRES_REASON = true;

// Failed-item repair states (safety_inspection_item_failures.repair_state,
// 20260726103000). Repair-complete does NOT flip the inspection result;
// passed_on_reinspection requires a recorded reinspector.
export const REPAIR_STATES = [
  "repair_needed",
  "parts_ordered",
  "repair_in_progress",
  "repair_completed",
  "ready_for_reinspection",
  "passed_on_reinspection",
] as const;

export type RepairState = (typeof REPAIR_STATES)[number];

export const isFailureResolved = (state: RepairState | string | null | undefined): boolean =>
  String(state || "") === "passed_on_reinspection";
