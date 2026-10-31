import { describe, expect, it } from "vitest";
import { isoToZonedInput, zonedInputToIso } from "./prepDueInput";

describe("prep due input in the dealership zone", () => {
  it("reads a wall-clock value as the dealership zone, summer and winter", () => {
    expect(zonedInputToIso("2026-07-01T17:00", "America/New_York")).toBe("2026-07-01T21:00:00.000Z");
    expect(zonedInputToIso("2026-01-15T17:00", "America/New_York")).toBe("2026-01-15T22:00:00.000Z");
  });

  it("round-trips through the zone", () => {
    const iso = zonedInputToIso("2026-11-02T08:30", "America/Los_Angeles");
    expect(isoToZonedInput(iso, "America/Los_Angeles")).toBe("2026-11-02T08:30");
  });

  it("rejects malformed input and blank instants", () => {
    expect(zonedInputToIso("tomorrow", "UTC")).toBeNull();
    expect(isoToZonedInput(null, "UTC")).toBe("");
  });
});
