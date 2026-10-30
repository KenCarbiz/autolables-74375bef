import { describe, expect, it } from "vitest";
import { proposedServiceLines, proposedServiceTotal } from "./proposedService";

describe("proposedServiceLines", () => {
  const lines = proposedServiceLines([
    { id: "a", category: "mechanical", description: "Front brake pads", line_total: "795", approval_status: "pending" },
    { id: "b", category: "cosmetic", description: "Full detail", line_total: 299, approval_status: "approved" },
    { id: "c", category: null, description: "Tire replace", line_total: 450, approval_status: "declined" },
    { id: "d", category: "x", description: null, line_total: 10, approval_status: "pending" },
  ]);
  it("maps type, status and numeric cost and skips lines with no description", () => {
    expect(lines.map((l) => [l.type, l.status, l.cost])).toEqual([
      ["Service", "proposed", 795], ["Detail", "approved", 299], ["Other", "declined", 450],
    ]);
  });
  it("totals everything except declined lines", () => {
    expect(proposedServiceTotal(lines)).toBe(1094);
  });
});
