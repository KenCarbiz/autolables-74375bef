import { describe, it, expect } from "vitest";
import {
  REPAIR_LABELS, repairChip, custodyLabel, custodyChip, milestoneLabel, laneForMilestone, DECISIONS, DECISION_ORDER, NO_SIDE_EFFECTS,
  restoreBlockedReason, isMissingRelation, countLabel, classifyRpcError, rpcErrorMessage, reasonOk, sourceLabel, openedReasonLabel,
} from "./labels";

describe("repair labels", () => {
  it("uses the six distinct, accurate labels", () => {
    expect(REPAIR_LABELS).toEqual({
      recommended: "Recommended",
      approved: "Customer authorized (not yet performed)",
      declined: "Declined - still open",
      deferred: "Deferred - still open",
      completed: "Completed (not independently verified)",
      completed_verified: "Completed and verified",
    });
    expect(new Set(Object.values(REPAIR_LABELS)).size).toBe(6);
  });

  it("never shows completed as verified or approved as completed", () => {
    expect(repairChip("completed").label).not.toMatch(/^Completed and verified/);
    expect(repairChip("completed").label).toMatch(/not independently verified/);
    expect(repairChip("approved").label).not.toMatch(/^Completed/);
    expect(repairChip("approved").label).toMatch(/not yet performed/);
    expect(repairChip("recommended").label).not.toMatch(/Completed/);
    expect(repairChip("completed_verified").tone).toBe("green");
    expect(repairChip("completed").tone).not.toBe("green");
  });

  it("renders an unrecognized or missing status as unknown, never a healthy label", () => {
    for (const s of [null, undefined, "", "done", "verified"]) {
      const chip = repairChip(s);
      expect(chip.label).toBe("Unknown status");
      expect(chip.tone).toBe("neutral");
    }
  });
});

describe("custody and milestone labels", () => {
  it("maps every custody state and treats unknown as unknown", () => {
    expect(custodyLabel("delivered")).toBe("Delivered");
    expect(custodyLabel("awaiting_delivery")).toBe("Sold, awaiting delivery");
    expect(custodyLabel("bogus")).toBe("Unknown state");
    expect(custodyChip(null).label).toBe("Unknown status");
    expect(custodyChip("archived").tone).toBe("amber");
  });

  it("places milestones in the right lane", () => {
    expect(laneForMilestone("delivered")).toBe("Ownership");
    expect(laneForMilestone("sold")).toBe("Ownership");
    expect(laneForMilestone("archived")).toBe("Inventory");
    expect(laneForMilestone("restored")).toBe("Inventory");
    expect(milestoneLabel("delivered")).toBe("Delivered to customer");
    expect(milestoneLabel("x")).toBe("Unknown event");
    expect(openedReasonLabel("reacquisition")).toBe("Reacquired");
    expect(openedReasonLabel(undefined)).toBe("Unknown reason");
  });
});

describe("reappearance decisions", () => {
  it("offers the five explicit decisions with plain descriptions", () => {
    expect(DECISION_ORDER.map((d) => DECISIONS[d].label)).toEqual([
      "Restore archived episode", "Start new episode (reacquisition)", "Wrong store mapping", "Reject source", "Keep in review",
    ]);
    expect(NO_SIDE_EFFECTS).toBe("No listing is published, merged or deleted. No customer access is granted.");
  });

  it("blocks restore unless the prior episode is archived", () => {
    expect(restoreBlockedReason("archived")).toBeNull();
    expect(restoreBlockedReason("delivered")).toMatch(/delivered/);
    expect(restoreBlockedReason(null)).toMatch(/archived prior episode/);
  });

  it("requires a reason of five characters", () => {
    expect(reasonOk("abcd")).toBe(false);
    expect(reasonOk("  abcd ")).toBe(false);
    expect(reasonOk("abcde")).toBe(true);
  });
});

describe("missing relation detection", () => {
  it("recognizes the not-installed error shapes", () => {
    expect(isMissingRelation({ code: "42P01", message: "x" })).toBe(true);
    expect(isMissingRelation({ code: "PGRST205", message: "x" })).toBe(true);
    expect(isMissingRelation({ code: "PGRST202", message: "x" })).toBe(true);
    expect(isMissingRelation({ message: 'relation "service_visits" does not exist' })).toBe(true);
    expect(isMissingRelation({ code: "42501", message: "permission denied" })).toBe(false);
    expect(isMissingRelation(null)).toBe(false);
  });

  it("renders an unknown count as Unknown, never 0", () => {
    expect(countLabel(null)).toBe("Unknown");
    expect(countLabel(undefined)).toBe("Unknown");
    expect(countLabel(Number.NaN)).toBe("Unknown");
    expect(countLabel(0)).toBe("0");
    expect(countLabel(1234)).toBe("1,234");
  });
});

describe("server error mapping", () => {
  it("maps known errors to plain messages", () => {
    expect(classifyRpcError({ message: "version_conflict: expected 1, current 2" })).toBe("version_conflict");
    expect(rpcErrorMessage({ message: "version_conflict: expected 1, current 2" })).toBe("Someone changed this setting; reload to see the current value.");
    expect(rpcErrorMessage({ message: "exceeds_parent_cap" })).toMatch(/past the platform limit/);
    expect(rpcErrorMessage({ message: "not_authorized" })).toMatch(/not authorized/);
    expect(classifyRpcError({ message: "boom" })).toBe("other");
    expect(sourceLabel("platform+tenant")).toBe("Platform + This account");
    expect(sourceLabel(null)).toBe("Unknown");
  });
});
