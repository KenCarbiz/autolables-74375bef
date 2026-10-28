import { describe, it, expect } from "vitest";
import { formatDateTime, formatTime, zoneLabel } from "./format";

const ISO = "2026-10-24T06:07:04Z";

describe("formatDateTime", () => {
  it("formats in the requested zone", () => {
    expect(formatDateTime(ISO, { timeZone: "UTC" })).toBe("Oct 24, 6:07 AM");
    expect(formatDateTime(ISO, { timeZone: "America/New_York" })).toBe("Oct 24, 2:07 AM");
    expect(formatDateTime(ISO, { timeZone: "UTC", withYear: true, withZone: true })).toBe("Oct 24, 2026 at 6:07 AM UTC");
  });

  it("falls back without throwing on a bad zone or value", () => {
    expect(formatDateTime(ISO, { timeZone: "Not/AZone" })).toMatch(/Oct 2[34], \d{1,2}:\d{2} [AP]M/);
    expect(formatDateTime(null)).toBe("—");
    expect(formatDateTime("not a date")).toBe("—");
    expect(formatTime(null)).toBe("—");
  });

  it("names the zone for a column heading", () => {
    expect(zoneLabel("UTC", Date.parse(ISO))).toBe("UTC");
    expect(zoneLabel("Not/AZone", Date.parse(ISO))).toBe("");
  });
});
