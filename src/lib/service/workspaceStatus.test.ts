import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  deriveWorkspaceStatus,
  clearanceReasonLabel,
  CLEARANCE_REASON_LABELS,
  type WorkspaceStatusInput,
} from "./workspaceStatus";
import { CLEARANCE_REASON_CODES } from "./clearance";

const base: WorkspaceStatusInput = {
  hasSignedNonFail: false,
  hasSignedFail: false,
  certified: false,
  workflowState: null,
  openFailures: 0,
  failuresReadyForReinspection: 0,
  awaitingApproval: false,
  grStarted: false,
  recallStatus: null,
  clearanceState: null,
  clearanceReasons: [],
  canExecute: false,
};

describe("deriveWorkspaceStatus — the 8 banner states (B1)", () => {
  it("nothing recorded is Work Not Started with Start as the one action", () => {
    const s = deriveWorkspaceStatus(base);
    expect(s.key).toBe("not_started");
    expect(s.action.key).toBe("start_work");
    expect(s.tone).toBe("slate"); // ordinary pending is never red
  });

  it("an in_progress workflow state (or started get-ready) is Get Ready in Progress", () => {
    expect(deriveWorkspaceStatus({ ...base, workflowState: "in_progress" }).key).toBe("in_progress");
    expect(deriveWorkspaceStatus({ ...base, grStarted: true }).action.key).toBe("continue_work");
  });

  it("a pending additional-work request outranks everything, including failures", () => {
    const s = deriveWorkspaceStatus({ ...base, awaitingApproval: true, hasSignedFail: true, openFailures: 2 });
    expect(s.key).toBe("awaiting_approval");
    expect(s.action.key).toBe("review_request");
  });

  it("a signed FAIL with open repairs is Failed Items Require Repair", () => {
    const s = deriveWorkspaceStatus({
      ...base, hasSignedFail: true, openFailures: 2, failuresReadyForReinspection: 1,
      workflowState: "repairs_in_progress",
    });
    expect(s.key).toBe("failed_items");
    expect(s.action.key).toBe("resolve_failures");
    expect(s.tone).toBe("red");
  });

  it("every open failure at ready_for_reinspection is Ready for Reinspection — repair complete never reads as passed", () => {
    const s = deriveWorkspaceStatus({
      ...base, hasSignedFail: true, openFailures: 2, failuresReadyForReinspection: 2,
      workflowState: "repairs_in_progress",
    });
    expect(s.key).toBe("ready_for_reinspection");
    expect(s.action.key).toBe("reinspect");
  });

  it("the ready_for_reinspection workflow state alone also lands there", () => {
    const s = deriveWorkspaceStatus({ ...base, hasSignedFail: true, workflowState: "ready_for_reinspection" });
    expect(s.key).toBe("ready_for_reinspection");
  });

  it("every failure PASSED on reinspection while the workflow lags is Ready for Reinspection, not a red dead-end", () => {
    // The exact dead-end sequence: signed fail -> all item failures marked
    // passed_on_reinspection (openFailures 0, resolvedFailures > 0) while
    // inspection_state is still failed_items_open / repairs_in_progress.
    for (const workflowState of ["failed_items_open", "repairs_in_progress"]) {
      const s = deriveWorkspaceStatus({
        ...base, hasSignedFail: true, workflowState,
        openFailures: 0, failuresReadyForReinspection: 0, resolvedFailures: 2,
      });
      expect(s.key).toBe("ready_for_reinspection");
      expect(s.action.key).toBe("reinspect");
      expect(s.tone).toBe("amber");
    }
  });

  it("a signed fail with NO failures filed at all stays red Failed Items — nothing has been repaired", () => {
    const s = deriveWorkspaceStatus({
      ...base, hasSignedFail: true, workflowState: "failed_items_open",
      openFailures: 0, resolvedFailures: 0,
    });
    expect(s.key).toBe("failed_items");
    expect(s.tone).toBe("red");
  });

  it("a signed pass, not certified, is Ready for K-208 — and the action names review vs execute by authority", () => {
    const viewer = deriveWorkspaceStatus({ ...base, hasSignedNonFail: true, workflowState: "passed" });
    expect(viewer.key).toBe("ready_for_k208");
    expect(viewer.action.key).toBe("review_k208");
    const signer = deriveWorkspaceStatus({ ...base, hasSignedNonFail: true, workflowState: "passed", canExecute: true });
    expect(signer.action.key).toBe("execute_k208");
  });

  it("never offers K-208 execution while failures are open — the legal next state wins", () => {
    const s = deriveWorkspaceStatus({
      ...base, hasSignedNonFail: true, canExecute: true, openFailures: 1, workflowState: "repairs_in_progress",
    });
    expect(s.key).toBe("failed_items");
    expect(s.action.key).not.toBe("execute_k208");
  });

  it("a do-not-drive recall is Delivery Blocked even with a passing inspection underway", () => {
    const s = deriveWorkspaceStatus({ ...base, recallStatus: "do_not_drive", workflowState: "in_progress" });
    expect(s.key).toBe("delivery_blocked");
    expect(s.blockerLabel).toContain("recall");
  });

  it("certified + stored clearance cleared_for_delivery is Cleared, with view-record as the only action", () => {
    const s = deriveWorkspaceStatus({
      ...base, hasSignedNonFail: true, certified: true, workflowState: "passed",
      clearanceState: "cleared_for_delivery",
    });
    expect(s.key).toBe("cleared");
    expect(s.action.key).toBe("view_record");
    expect(s.blockerLabel).toBeNull();
  });

  it("certified but NOT cleared says Delivery Blocked and quotes the stored reasons — never claims cleared", () => {
    const s = deriveWorkspaceStatus({
      ...base, hasSignedNonFail: true, certified: true, workflowState: "passed",
      clearanceState: "blocked_k208_not_executed", clearanceReasons: ["FINALIZE_GATE_BLOCKED"],
    });
    expect(s.key).toBe("delivery_blocked");
    expect(s.blockerLabel).toBe(CLEARANCE_REASON_LABELS.FINALIZE_GATE_BLOCKED);
  });
});

describe("clearance reason labels", () => {
  it("every stored reason code has a plain-language rendering", () => {
    for (const code of CLEARANCE_REASON_CODES) {
      expect(CLEARANCE_REASON_LABELS[code]).toBeTruthy();
    }
  });

  it("an unknown code degrades to readable words, never crashes", () => {
    expect(clearanceReasonLabel("SOME_FUTURE_CODE")).toBe("some future code");
  });

  it("the labelled codes are exactly the migration's codes — no invented reasons", () => {
    const sql = readFileSync(
      join(__dirname, "../../../supabase/migrations/20260726104000_delivery_clearance.sql"),
      "utf8",
    );
    for (const code of Object.keys(CLEARANCE_REASON_LABELS)) {
      expect(sql).toContain(`'${code}'`);
    }
  });
});
