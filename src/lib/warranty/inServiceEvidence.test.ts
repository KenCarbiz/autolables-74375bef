import { describe, it, expect } from "vitest";
import { listingHistoryProxyDates, verifiedInServiceDate } from "./inServiceEvidence";

const history = {
  available: true,
  firstSeen: "2023-02-10T08:00:00Z",
  firstNewListingSeen: "2023-02-10T08:00:00Z",
  inServiceDate: "2023-02-10T08:00:00Z",
  entries: [{ first_seen: "2023-02-10T08:00:00Z" }, { first_seen: "2025-06-01" }],
};

describe("in-service evidence", () => {
  it("collects every listing-history date that could stand in for delivery", () => {
    expect([...listingHistoryProxyDates(history)].sort()).toEqual(["2023-02-10", "2025-06-01"]);
  });

  it("a first-advertised or first-seen date never starts the warranty", () => {
    expect(verifiedInServiceDate("2023-02-10", history)).toBeNull();
    expect(verifiedInServiceDate("2025-06-01T00:00:00Z", history)).toBeNull();
  });

  it("a recorded date that is not a listing date is kept", () => {
    expect(verifiedInServiceDate("2023-03-04", history)).toBe("2023-03-04");
    expect(verifiedInServiceDate("2023-03-04", null)).toBe("2023-03-04");
  });

  it("nothing stored is nothing verified", () => {
    expect(verifiedInServiceDate(null, history)).toBeNull();
    expect(verifiedInServiceDate("  ", history)).toBeNull();
  });
});
