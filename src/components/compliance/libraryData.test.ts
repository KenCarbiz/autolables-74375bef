import { describe, it, expect } from "vitest";
import { ALL, filterLibrary, libraryRows } from "./libraryData";

describe("libraryRows", () => {
  it("lists federal rows first and never invents a review date", () => {
    const rows = libraryRows("CT");
    expect(rows[0].jurisdiction).toBe("Federal");
    expect(rows.every((r) => r.reviewed === null)).toBe(true);
  });

  it("adds the dealer's state rows", () => {
    expect(libraryRows("CT").some((r) => r.jurisdiction === "Connecticut" && r.requirement.includes("Conveyance Fee"))).toBe(true);
    expect(libraryRows(null).some((r) => r.id.startsWith("state-"))).toBe(false);
  });

  it("records the CARS Rule as vacated and carries no fixed penalty", () => {
    const rows = libraryRows("CA");
    expect(rows.find((r) => r.id === "fed-cars-rule")?.requirement).toMatch(/vacated/i);
    expect(JSON.stringify(rows)).not.toMatch(/\$16,000/);
  });
});

describe("filterLibrary", () => {
  const rows = libraryRows("CT");
  it("filters by jurisdiction, type and text", () => {
    expect(filterLibrary(rows, { jurisdiction: "Federal", type: ALL, query: "" }).every((r) => r.jurisdiction === "Federal")).toBe(true);
    expect(filterLibrary(rows, { jurisdiction: ALL, type: "Product check", query: "" }).every((r) => r.type === "Product check")).toBe(true);
    expect(filterLibrary(rows, { jurisdiction: ALL, type: ALL, query: "monroney" }).length).toBe(1);
  });
});
