import { describe, it, expect } from "vitest";
import {
  classifyWorkItem, isSystemException, isActionableHumanWork,
  isLiveException, exceptionCopy,
} from "./workClassification";

const ME = "user-1";

describe("system exceptions are not human work (W1)", () => {
  it("classifies a vehicle_exception row as a system exception, never as a task", () => {
    // Every one of production's 883 open rows looks like this.
    const row = { status: "open", source: "vehicle_exception", work_type: "exception_price_change", assigned_to: null };
    expect(isSystemException(row)).toBe(true);
    expect(classifyWorkItem(row, ME)).toBe("system_exception");
  });

  it("catches an exception_ row even when source is unset", () => {
    expect(isSystemException({ work_type: "exception_new_vehicle" })).toBe(true);
  });

  it("keeps system exceptions out of the navigation badge", () => {
    const row = { status: "open", source: "vehicle_exception", work_type: "exception_removed_from_feed" };
    expect(isActionableHumanWork(row)).toBe(false);
  });

  it("counts a real assigned task as actionable", () => {
    expect(isActionableHumanWork({ status: "open", source: "manual", assigned_to: ME })).toBe(true);
  });
});

describe("lanes (W2)", () => {
  it("routes my assigned task to needs_me", () => {
    expect(classifyWorkItem({ status: "open", source: "manual", assigned_to: ME }, ME)).toBe("needs_me");
  });
  it("routes someone else's task to team", () => {
    expect(classifyWorkItem({ status: "open", source: "manual", assigned_to: "user-2" }, ME)).toBe("team");
  });
  it("routes unowned human work to waiting, not to me", () => {
    expect(classifyWorkItem({ status: "open", source: "manual", assigned_to: null }, ME)).toBe("waiting");
  });
  it("treats completed and cancelled as done before anything else", () => {
    expect(classifyWorkItem({ status: "completed", source: "vehicle_exception" }, ME)).toBe("completed");
    expect(classifyWorkItem({ status: "cancelled", source: "manual", assigned_to: ME }, ME)).toBe("completed");
  });
});

describe("exceptions about departed vehicles are excluded (W3)", () => {
  const gone = { status: "open", source: "vehicle_exception", work_type: "exception_removed_from_feed", vehicleActive: false };
  const here = { status: "open", source: "vehicle_exception", work_type: "exception_price_change", vehicleActive: true };

  it("hides an exception whose vehicle has left the lot", () => {
    // 467 of production's 883 are this shape.
    expect(isLiveException(gone)).toBe(false);
  });
  it("keeps an exception on current inventory", () => {
    expect(isLiveException(here)).toBe(true);
  });
});

describe("engineering wording never reaches a screen (W4)", () => {
  it("translates a known type into operational language", () => {
    const c = exceptionCopy("exception_artifact_autogen_failed");
    expect(c.label).toBe("Document could not be generated");
    expect(c.label).not.toContain("_");
    expect(c.nextAction).toBe("Retry document");
  });

  it("gives a departed-vehicle exception no next action, because there is nothing to do", () => {
    expect(exceptionCopy("exception_removed_from_feed").nextAction).toBeNull();
  });

  it("de-slugs an unknown type rather than leaking the raw identifier", () => {
    const c = exceptionCopy("exception_some_new_backend_thing");
    expect(c.label).toBe("Some new backend thing");
    expect(c.label).not.toContain("exception_");
  });

  it("survives a null work_type", () => {
    expect(exceptionCopy(null).label).toBe("System exception");
  });
});
