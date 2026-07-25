import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CLEARANCE_STATES, CLEARANCE_REASON_CODES, deriveClearance } from "./clearance";

const MIGRATION = readFileSync(
  join(__dirname, "../../../supabase/migrations/20260726104000_delivery_clearance.sql"),
  "utf8",
);

const base = {
  condition: "used",
  latestSignedResult: null as string | null,
  hasSignedInspection: false,
  workflowState: "not_started",
  hasAnyInspectionRow: false,
  hasOpenItemFailures: false,
  recallStatus: null as string | null,
  finalizeGateBlocked: false,
};

describe("deriveClearance (S4)", () => {
  it("SQL CHECK and TS enum carry the same states", () => {
    for (const s of CLEARANCE_STATES) expect(MIGRATION).toContain(`'${s}'`);
  });

  it("every TS reason code exists in the SQL", () => {
    for (const c of CLEARANCE_REASON_CODES) expect(MIGRATION).toContain(`'${c}'`);
  });

  it("nothing on file blocks as not started", () => {
    expect(deriveClearance(base)).toEqual({
      state: "blocked_inspection_not_started",
      reasonCodes: ["INSPECTION_NOT_STARTED"],
    });
  });

  it("a signed FAIL blocks with failed items even when the workflow moved on", () => {
    const r = deriveClearance({
      ...base, hasSignedInspection: true, latestSignedResult: "fail",
      hasAnyInspectionRow: true, workflowState: "repairs_in_progress",
    });
    expect(r.state).toBe("blocked_failed_items");
    expect(r.reasonCodes).toContain("SIGNED_INSPECTION_FAILED");
  });

  it("open item failures block even after a later signed pass", () => {
    const r = deriveClearance({
      ...base, hasSignedInspection: true, latestSignedResult: "pass",
      hasAnyInspectionRow: true, workflowState: "passed", hasOpenItemFailures: true,
    });
    expect(r.state).toBe("blocked_failed_items");
    expect(r.reasonCodes).toEqual(["FAILED_ITEMS_OPEN"]);
  });

  it("ready_for_reinspection reads as in progress with the reinspection code", () => {
    const r = deriveClearance({
      ...base, hasAnyInspectionRow: true, workflowState: "ready_for_reinspection",
    });
    expect(r.state).toBe("blocked_inspection_in_progress");
    expect(r.reasonCodes).toEqual(["REINSPECTION_REQUIRED"]);
  });

  it("a passed inspection behind a blocked finalize gate is K-208 not executed", () => {
    const r = deriveClearance({
      ...base, hasSignedInspection: true, latestSignedResult: "pass",
      hasAnyInspectionRow: true, workflowState: "passed", finalizeGateBlocked: true,
    });
    expect(r.state).toBe("blocked_k208_not_executed");
  });

  it("cleared only when passed, no failures, no recall, gate satisfied", () => {
    const r = deriveClearance({
      ...base, hasSignedInspection: true, latestSignedResult: "pass",
      hasAnyInspectionRow: true, workflowState: "passed",
    });
    expect(r).toEqual({ state: "cleared_for_delivery", reasonCodes: [] });
  });

  it("a do-not-drive recall blocks a fully passed vehicle", () => {
    const r = deriveClearance({
      ...base, hasSignedInspection: true, latestSignedResult: "pass",
      hasAnyInspectionRow: true, workflowState: "passed", recallStatus: "do_not_drive",
    });
    expect(r.state).toBe("blocked_failed_items");
    expect(r.reasonCodes).toEqual(["RECALL_DO_NOT_DRIVE"]);
  });

  it("a new vehicle needs no K-208 but still honours the installs gate", () => {
    expect(deriveClearance({ ...base, condition: "new" })).toEqual({
      state: "cleared_for_delivery", reasonCodes: ["NOT_APPLICABLE_NEW_VEHICLE"],
    });
    expect(deriveClearance({ ...base, condition: "new", finalizeGateBlocked: true }).state)
      .toBe("blocked_k208_not_executed");
  });

  it("a legacy signed row with NULL result is executed, not failed", () => {
    const r = deriveClearance({
      ...base, hasSignedInspection: true, latestSignedResult: null,
      hasAnyInspectionRow: true, workflowState: "passed",
    });
    expect(r.state).toBe("cleared_for_delivery");
  });
});
