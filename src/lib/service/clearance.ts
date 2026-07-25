// Delivery clearance — client mirror of recompute_delivery_clearance
// (20260726104000_delivery_clearance.sql). Same inputs, same decision order,
// so a surface can explain a stored state (or preview one) without drifting
// from the SQL that writes it. clearance.test.ts cross-checks the enums
// against the migration text.

export const CLEARANCE_STATES = [
  "blocked_inspection_not_started",
  "blocked_inspection_in_progress",
  "blocked_failed_items",
  "blocked_k208_not_executed",
  "cleared_for_delivery",
] as const;

export type ClearanceState = (typeof CLEARANCE_STATES)[number];

export const CLEARANCE_REASON_CODES = [
  "SIGNED_INSPECTION_FAILED",
  "FAILED_ITEMS_OPEN",
  "RECALL_DO_NOT_DRIVE",
  "INSPECTION_NOT_STARTED",
  "INSPECTION_IN_PROGRESS",
  "REINSPECTION_REQUIRED",
  "K208_READY_NOT_EXECUTED",
  "FINALIZE_GATE_BLOCKED",
  "NOT_APPLICABLE_NEW_VEHICLE",
] as const;

export type ClearanceReasonCode = (typeof CLEARANCE_REASON_CODES)[number];

export interface ClearanceInput {
  condition?: string | null;
  /** Newest signed safety_inspections row's result (null = legacy pass). */
  latestSignedResult?: string | null;
  /** Whether ANY signed row exists at all. */
  hasSignedInspection: boolean;
  /** Newest non-voided row's inspection_state ('not_started' when absent). */
  workflowState?: string | null;
  hasAnyInspectionRow: boolean;
  /** Any item failure whose repair_state != passed_on_reinspection. */
  hasOpenItemFailures: boolean;
  recallStatus?: string | null;
  /** get_ready_blocks_finalize(tenant, vin). */
  finalizeGateBlocked: boolean;
}

export interface ClearanceResult {
  state: ClearanceState;
  reasonCodes: ClearanceReasonCode[];
}

export function deriveClearance(i: ClearanceInput): ClearanceResult {
  const codes: ClearanceReasonCode[] = [];
  const condition = String(i.condition || "used").toLowerCase();
  const recall = String(i.recallStatus || "").toLowerCase();
  const recallBlock = recall.includes("do_not_drive") || recall.includes("do-not-drive");
  const signedFail = i.hasSignedInspection && i.latestSignedResult === "fail";
  const wf = String(i.workflowState || "not_started");

  if (i.condition && !["used", "cpo", "certified"].includes(condition)) {
    if (i.finalizeGateBlocked) {
      return { state: "blocked_k208_not_executed", reasonCodes: ["FINALIZE_GATE_BLOCKED"] };
    }
    return { state: "cleared_for_delivery", reasonCodes: ["NOT_APPLICABLE_NEW_VEHICLE"] };
  }
  if (signedFail || i.hasOpenItemFailures) {
    if (signedFail) codes.push("SIGNED_INSPECTION_FAILED");
    if (i.hasOpenItemFailures) codes.push("FAILED_ITEMS_OPEN");
    return { state: "blocked_failed_items", reasonCodes: codes };
  }
  if (recallBlock) {
    return { state: "blocked_failed_items", reasonCodes: ["RECALL_DO_NOT_DRIVE"] };
  }
  if (!i.hasAnyInspectionRow || wf === "not_started") {
    return { state: "blocked_inspection_not_started", reasonCodes: ["INSPECTION_NOT_STARTED"] };
  }
  if (["in_progress", "repairs_in_progress", "ready_for_reinspection"].includes(wf)) {
    return {
      state: "blocked_inspection_in_progress",
      reasonCodes: [wf === "ready_for_reinspection" ? "REINSPECTION_REQUIRED" : "INSPECTION_IN_PROGRESS"],
    };
  }
  if (i.finalizeGateBlocked || !i.hasSignedInspection) {
    return { state: "blocked_k208_not_executed", reasonCodes: ["K208_READY_NOT_EXECUTED"] };
  }
  return { state: "cleared_for_delivery", reasonCodes: [] };
}
