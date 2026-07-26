import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  INSPECTION_STATES,
  INSPECTION_TRANSITIONS,
  canTransitionInspection,
  SIGNATURE_ONLY_STATE,
  REPAIR_STATES,
  isFailureResolved,
  failuresForInspection,
} from "./transitions";
import { deriveWorkspaceStatus } from "./workspaceStatus";
import { deriveServiceStatus } from "./serviceStatus";

const MIGRATIONS = join(__dirname, "../../../supabase/migrations");

describe("inspection state machine (S2)", () => {
  it("matches the SQL transition map literal exactly — one machine, two runtimes", () => {
    const sql = readFileSync(join(MIGRATIONS, "20260726102000_inspection_state.sql"), "utf8");
    const m = sql.match(/v_allowed jsonb := '(\{[\s\S]*?\})'::jsonb/);
    expect(m).toBeTruthy();
    expect(JSON.parse((m as RegExpMatchArray)[1])).toEqual(INSPECTION_TRANSITIONS);
  });

  it("every state is covered and every target is a known state", () => {
    for (const s of INSPECTION_STATES) expect(INSPECTION_TRANSITIONS[s]).toBeDefined();
    for (const targets of Object.values(INSPECTION_TRANSITIONS)) {
      for (const t of targets) expect(INSPECTION_STATES).toContain(t);
    }
  });

  it("'passed' is unreachable through the workflow RPC — only a signature enters it", () => {
    for (const from of INSPECTION_STATES) {
      expect(canTransitionInspection(from, SIGNATURE_ONLY_STATE)).toBe(false);
    }
  });

  it("failed_items_open is only re-enterable from inside the failure loop", () => {
    for (const from of INSPECTION_STATES) {
      expect(canTransitionInspection(from, "failed_items_open")).toBe(from === "repairs_in_progress");
    }
  });

  it("voided is terminal", () => {
    expect(INSPECTION_TRANSITIONS.voided).toEqual([]);
  });

  it("the repair loop routes failed items to reinspection, never straight to passed", () => {
    expect(canTransitionInspection("failed_items_open", "repairs_in_progress")).toBe(true);
    expect(canTransitionInspection("repairs_in_progress", "ready_for_reinspection")).toBe(true);
    expect(canTransitionInspection("ready_for_reinspection", "repairs_in_progress")).toBe(true);
    expect(canTransitionInspection("failed_items_open", "passed")).toBe(false);
  });

  it("the CHECK constraint enumerates the same states", () => {
    const sql = readFileSync(join(MIGRATIONS, "20260726102000_inspection_state.sql"), "utf8");
    for (const s of INSPECTION_STATES) expect(sql).toContain(`'${s}'`);
  });
});

describe("failed-item repair states (S3)", () => {
  it("only passed_on_reinspection resolves a failure — repair complete is not passed", () => {
    expect(isFailureResolved("repair_completed")).toBe(false);
    expect(isFailureResolved("ready_for_reinspection")).toBe(false);
    expect(isFailureResolved("passed_on_reinspection")).toBe(true);
    expect(isFailureResolved(null)).toBe(false);
  });

  it("the item-failures migration CHECK carries the same six states", () => {
    const sql = readFileSync(join(MIGRATIONS, "20260726103000_inspection_item_failures.sql"), "utf8");
    for (const s of REPAIR_STATES) expect(sql).toContain(`'${s}'`);
  });
});

// The double-fault sequence: inspection A signed FAIL, its items repaired and
// passed on reinspection; inspection B (the new newest signed) signs FAIL but
// its per-item failure insert errors, leaving B with zero rows. A VIN-wide
// aggregate reads A's resolved rows and turns B amber "ready for
// reinspection" while hiding the file-failed-items recovery — scoping to the
// newest signed inspection's id keeps B red with the recovery reachable.
describe("failure scoping to the newest signed inspection (double fault)", () => {
  const rows = [
    { inspection_id: "insp-A", repair_state: "passed_on_reinspection" },
    { inspection_id: "insp-A", repair_state: "passed_on_reinspection" },
    // inspection B signed FAIL — its insert errored, so it has NO rows.
  ];

  it("failuresForInspection returns only the named inspection's rows (none for B, none for null)", () => {
    expect(failuresForInspection(rows, "insp-A")).toHaveLength(2);
    expect(failuresForInspection(rows, "insp-B")).toHaveLength(0);
    expect(failuresForInspection(rows, null)).toHaveLength(0);
  });

  it("workspace banner: the new signed FAIL derives red failed_items, not amber reinspection", () => {
    const scoped = failuresForInspection(rows, "insp-B");
    const open = scoped.filter((f) => !isFailureResolved(f.repair_state));
    const s = deriveWorkspaceStatus({
      hasSignedNonFail: false,
      hasSignedFail: true,
      certified: false,
      workflowState: "failed_items_open",
      openFailures: open.length,
      failuresReadyForReinspection: 0,
      resolvedFailures: scoped.length - open.length,
      awaitingApproval: false,
      grStarted: true,
      recallStatus: null,
      clearanceState: "blocked",
      clearanceReasons: ["SIGNED_INSPECTION_FAILED"],
      canExecute: true,
    });
    expect(s.key).toBe("failed_items");
    expect(s.tone).toBe("red");
    expect(s.action.key).toBe("resolve_failures");
  });

  it("workspace banner: the VIN-wide aggregate would have read amber — the bug this scoping fixes", () => {
    const open = rows.filter((f) => !isFailureResolved(f.repair_state));
    const s = deriveWorkspaceStatus({
      hasSignedNonFail: false,
      hasSignedFail: true,
      certified: false,
      workflowState: "failed_items_open",
      openFailures: open.length,
      failuresReadyForReinspection: 0,
      resolvedFailures: rows.length - open.length,
      awaitingApproval: false,
      grStarted: true,
      recallStatus: null,
      clearanceState: "blocked",
      clearanceReasons: ["SIGNED_INSPECTION_FAILED"],
      canExecute: true,
    });
    expect(s.key).toBe("ready_for_reinspection");
  });

  it("queue row: the new signed FAIL lands in the red failed state, not ready-for-reinspection", () => {
    const scoped = failuresForInspection(rows, "insp-B");
    const open = scoped.filter((f) => !isFailureResolved(f.repair_state));
    const s = deriveServiceStatus(
      { recall_status: null },
      { items: [], status: "in_progress" },
      { result: "fail", licensee_certified_at: null, signed_at: "2026-07-26T12:00:00Z" },
      false,
      {
        clearanceState: "blocked",
        openFailures: open.length,
        failuresReadyForReinspection: 0,
        resolvedFailures: scoped.length - open.length,
        inspectionState: "failed_items_open",
      },
    );
    expect(s.grState).toBe("failed");
    expect(s.bannerKey).toBe("failed");
    expect(s.tone).toBe("red");
  });

  it("the no-rows recovery fires for the newest signed inspection even when an older inspection has rows", () => {
    const signedFailNoRows = failuresForInspection(rows, "insp-B").length === 0;
    expect(signedFailNoRows).toBe(true);
    // Older resolved rows must not enable Send to reinspection for B either.
    const allItemsReady = failuresForInspection(rows, "insp-B").some((f) => isFailureResolved(f.repair_state));
    expect(allItemsReady).toBe(false);
  });
});
