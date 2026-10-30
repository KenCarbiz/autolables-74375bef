import { describe, expect, it } from "vitest";
import { buildFindings, countFindings } from "./inspectionFindings";

describe("inspection findings", () => {
  it("maps checklist results to finding results", () => {
    const f = buildFindings([
      { id: "a", label: "Brakes", result: "fail", explanation: " Pads worn " },
      { id: "b", label: "Tires", result: "pass" },
      { id: "c", label: "Battery", result: "na" },
    ]);
    expect(f.map((x) => x.result)).toEqual(["failed", "passed", "attention"]);
    expect(f[0].notes).toBe("Pads worn");
    expect(countFindings(f)).toEqual({ all: 3, passed: 1, failed: 1, attention: 1 });
  });
  it("returns nothing for an empty or missing checklist", () => {
    expect(buildFindings(null)).toEqual([]);
  });
  it("carries a recorded measurement and defaults to empty", () => {
    const f = buildFindings([
      { id: "a", label: "Brakes", result: "fail", measurement: "3 mm" },
      { id: "b", label: "Tires", result: "pass", measurement: 7 },
      { id: "c", label: "Battery", result: "pass" },
    ]);
    expect(f.map((x) => x.measurement)).toEqual(["3 mm", "7", ""]);
  });
});
