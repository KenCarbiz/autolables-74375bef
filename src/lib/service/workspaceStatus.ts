// The ONE derivation of a vehicle's workspace banner — the 8 owner-approved
// states (SERVICE_DESK_SPEC addendum) computed from the controlled facts the
// foundation stores: inspection_state (20260726102000), the newest signed row
// under isExecutedSignoff semantics, open item failures (20260726103000), the
// stored delivery clearance (20260726104000), and a pending service_request.
// The queue drawer and the /service/vehicle workspace both read this, so the
// two surfaces can never disagree about the state or the single next action.

import type { Tone } from "@/lib/service/serviceStatus";

export const WORKSPACE_BANNER_KEYS = [
  "not_started",
  "in_progress",
  "awaiting_approval",
  "failed_items",
  "ready_for_reinspection",
  "ready_for_k208",
  "delivery_blocked",
  "cleared",
] as const;

export type WorkspaceBannerKey = (typeof WORKSPACE_BANNER_KEYS)[number];

export type WorkspaceActionKey =
  | "start_work"
  | "continue_work"
  | "review_request"
  | "resolve_failures"
  | "reinspect"
  | "review_k208"
  | "execute_k208"
  | "review_blockers"
  | "record_recall"
  | "view_record";

export interface WorkspaceStatusInput {
  /** Newest SIGNED row is signed AND result != 'fail' (isExecutedSignoff). */
  hasSignedNonFail: boolean;
  /** Newest SIGNED row is an explicit fail. */
  hasSignedFail: boolean;
  /** licensee_certified_at set on the executed row. */
  certified: boolean;
  /** Newest non-voided safety_inspections.inspection_state; null = no row. */
  workflowState: string | null;
  /** Item failures with repair_state != passed_on_reinspection. */
  openFailures: number;
  /** Of those, how many sit at ready_for_reinspection. */
  failuresReadyForReinspection: number;
  /** Item failures already at passed_on_reinspection (resolved). */
  resolvedFailures?: number;
  awaitingApproval: boolean;
  grStarted: boolean;
  recallStatus?: string | null;
  /** Stored vehicle_delivery_clearance.state, when read. */
  clearanceState?: string | null;
  clearanceReasons?: string[];
  /** Whether the CURRENT user may execute (client mirror + capability). */
  canExecute: boolean;
}

export interface WorkspaceStatus {
  key: WorkspaceBannerKey;
  label: string;
  tone: Tone;
  action: { key: WorkspaceActionKey; label: string };
  /** Plain-language delivery blocker line, when delivery is blocked. */
  blockerLabel: string | null;
}

// Plain-language renderings of the stored clearance reason codes
// (CLEARANCE_REASON_CODES, clearance.ts). Rendered, never invented: only codes
// the recompute RPC actually wrote reach the screen.
export const CLEARANCE_REASON_LABELS: Record<string, string> = {
  SIGNED_INSPECTION_FAILED: "The signed inspection recorded failed items",
  FAILED_ITEMS_OPEN: "Failed items are still open",
  RECALL_DO_NOT_DRIVE: "An open do-not-drive recall blocks delivery",
  INSPECTION_NOT_STARTED: "The safety inspection has not started",
  INSPECTION_IN_PROGRESS: "The safety inspection is still in progress",
  REINSPECTION_REQUIRED: "Repaired items are waiting for reinspection",
  K208_READY_NOT_EXECUTED: "The K-208 has not been executed",
  FINALIZE_GATE_BLOCKED: "The store's finalize gate is not yet satisfied",
  NOT_APPLICABLE_NEW_VEHICLE: "New vehicle: no K-208 requirement",
};

export const clearanceReasonLabel = (code: string): string =>
  CLEARANCE_REASON_LABELS[code] ?? code.replace(/_/g, " ").toLowerCase();

const isDoNotDrive = (recall?: string | null): boolean => {
  const r = String(recall || "").toLowerCase();
  return r.includes("do_not_drive") || r.includes("do-not-drive");
};

/**
 * Decision order (first match wins), mirroring the addendum's flow:
 *   1. a pending additional-work request parks the vehicle on approval;
 *   2. the failure loop (signed fail / open item failures), split between
 *      "repair" and "ready for reinspection" by the workflow + item states;
 *   3. a do-not-drive recall blocks delivery outright;
 *   4. an executed sign-off resolves against the stored clearance:
 *      cleared -> cleared; uncertified -> ready for K-208; otherwise the
 *      clearance reasons name what still blocks;
 *   5. otherwise the work is either in progress or not started.
 */
export function deriveWorkspaceStatus(i: WorkspaceStatusInput): WorkspaceStatus {
  const reasons = i.clearanceReasons ?? [];
  const blockerLabel = reasons.length
    ? reasons.filter((r) => r !== "NOT_APPLICABLE_NEW_VEHICLE").map(clearanceReasonLabel).join(". ")
    : null;

  if (i.awaitingApproval) {
    return {
      key: "awaiting_approval",
      label: "Additional work awaiting approval",
      tone: "amber",
      action: { key: "review_request", label: "Review request" },
      blockerLabel,
    };
  }

  if (i.hasSignedFail || i.openFailures > 0) {
    // Every FILED failure passing reinspection while the workflow state still
    // reads failed_items_open/repairs_in_progress must land here too —
    // otherwise the banner stays red with no enabled control left (the
    // reinspection dead-end: openFailures is 0, so resolve_failures has
    // nothing to resolve and the reinspection checklist never renders).
    const allReady =
      i.workflowState === "ready_for_reinspection" ||
      (i.openFailures > 0 && i.failuresReadyForReinspection === i.openFailures) ||
      (i.openFailures === 0 && (i.resolvedFailures ?? 0) > 0);
    if (allReady) {
      return {
        key: "ready_for_reinspection",
        label: "Ready for reinspection",
        tone: "amber",
        action: { key: "reinspect", label: "Reinspect repaired items" },
        blockerLabel,
      };
    }
    return {
      key: "failed_items",
      label: "Failed items require repair",
      tone: "red",
      action: { key: "resolve_failures", label: "Resolve failed items" },
      blockerLabel,
    };
  }

  if (isDoNotDrive(i.recallStatus)) {
    return {
      key: "delivery_blocked",
      label: "Delivery blocked: open recall",
      tone: "red",
      action: { key: "record_recall", label: "Record recall outcome" },
      blockerLabel: blockerLabel ?? CLEARANCE_REASON_LABELS.RECALL_DO_NOT_DRIVE,
    };
  }

  if (i.hasSignedNonFail) {
    if (i.clearanceState === "cleared_for_delivery") {
      return {
        key: "cleared",
        label: "Cleared for delivery",
        tone: "emerald",
        action: { key: "view_record", label: "View completed record" },
        blockerLabel: null,
      };
    }
    if (!i.certified) {
      return {
        key: "ready_for_k208",
        label: "Ready for K-208",
        tone: "blue",
        action: i.canExecute
          ? { key: "execute_k208", label: "Review & execute K-208" }
          : { key: "review_k208", label: "Review K-208" },
        blockerLabel,
      };
    }
    return {
      key: "delivery_blocked",
      label: "Delivery blocked",
      tone: "red",
      action: { key: "review_blockers", label: "Review delivery blockers" },
      blockerLabel,
    };
  }

  if (i.workflowState === "in_progress" || i.grStarted) {
    return {
      key: "in_progress",
      label: "Get Ready in progress",
      tone: "blue",
      action: { key: "continue_work", label: "Continue work" },
      blockerLabel,
    };
  }

  return {
    key: "not_started",
    label: "Work not started",
    tone: "slate",
    action: { key: "start_work", label: "Start Get Ready" },
    blockerLabel,
  };
}
