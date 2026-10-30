import { describe, it, expect } from "vitest";
import { normalizeSoldSummary } from "./soldSummary";

const requested = { inventory_type: "used", summary_by: "state", state: "IL", make: "Toyota", model: "RAV4", date_from: "2026-04-01", date_to: "2026-09-30" };
const body = {
  result_count: 2,
  truncated: true,
  warnings: ["date_to moved to last complete month"],
  notices: "inferred sales; advertised asking prices",
  applied: { inventory_type: "used", summary_by: "state", state: "IL", date_from: "2026-04-01", date_to: "2026-08-31" },
  data: [
    { month: "2026-07", state: "IL", sold_count: 412, stats: { price: { mean: 29100, median: 28750, min: 18000, max: 41000, p25: 26000, p75: 31500 }, miles: { median: 31000 }, dom_active: { median: 34 } } },
    { month: "2026-08", state: "IL", sold_count: 398, stats: { price: { median: 28400, percentiles: { "10": 22000, "90": 35000 } } } },
  ],
};

describe("Sold Vehicles Summary normalization", () => {
  it("persists requested and applied filters, warnings, notices, count, truncation, period, scope and statistics", () => {
    const e = normalizeSoldSummary({ requestedFilters: requested, body, fetchedAt: "2026-10-30T00:00:00Z", outcome: "succeeded", httpStatus: 200 });
    expect(e.envelope.requestedFilters).toEqual(requested);
    expect(e.envelope.appliedFilters).toEqual(body.applied);
    expect(e.envelope.filtersDiverged).toBe(true);
    expect(e.envelope.warnings).toEqual(expect.arrayContaining(["date_to moved to last complete month", "provider_applied_filters_differ_from_request"]));
    expect(e.envelope.notices).toEqual(expect.arrayContaining(["inferred sales; advertised asking prices", "provider_truncated_result"]));
    expect(e.resultCount).toBe(2);
    expect(e.truncated).toBe(true);
    expect(e.period).toEqual({ from: "2026-04-01", to: "2026-08-31", source: "applied" });
    expect(e.scope).toBe("state");
    expect(e.envelope.geography).toMatchObject({ summary_by: "state", state: "IL" });
    expect(e.inventoryType).toBe("used");
    expect(e.rows).toHaveLength(2);
    expect(e.rows[0].inferredSoldCount).toBe(412);
    expect(e.rows[0].dimensions).toMatchObject({ month: "2026-07", state: "IL" });
    expect(e.rows[0].statistics.price).toMatchObject({ median: 28750, mean: 29100, percentiles: { p25: 26000, p75: 31500 } });
    expect(e.rows[0].statistics.dom_active?.median).toBe(34);
    expect(e.rows[1].statistics.price?.percentiles).toEqual({ p10: 22000, p90: 35000 });
    expect(e.envelope.sampleSize).toBe(2);
    expect(e.envelope.expiresAt).not.toBeNull();
  });

  it("labels every price as last advertised before an inferred sale, never a transaction", () => {
    const e = normalizeSoldSummary({ requestedFilters: requested, body, fetchedAt: "2026-10-30T00:00:00Z", outcome: "succeeded" });
    expect(e.saleBasis).toBe("inferred_listing_exit");
    expect(e.priceBasis).toBe("last_advertised_price");
    expect(JSON.stringify(e)).not.toMatch(/transaction_price|sold_price/);
  });

  it("falls back to the requested window when the provider did not echo one", () => {
    const e = normalizeSoldSummary({ requestedFilters: requested, body: { result_count: 0, data: [] }, fetchedAt: "2026-10-30T00:00:00Z", outcome: "succeeded" });
    expect(e.period).toEqual({ from: "2026-04-01", to: "2026-09-30", source: "requested" });
    expect(e.envelope.outcomeClass).toBe("no_result");
  });

  it("an entitlement refusal or 429 keeps its class and yields no trend rows", () => {
    for (const [outcome, cls] of [["not_entitled", "entitlement_failure"], ["rate_limited", "rate_limited"]] as const) {
      const e = normalizeSoldSummary({ requestedFilters: requested, body, fetchedAt: "2026-10-30T00:00:00Z", outcome, httpStatus: outcome === "rate_limited" ? 429 : 403 });
      expect(e.envelope.outcomeClass).toBe(cls);
      expect(e.rows).toEqual([]);
      expect(e.resultCount).toBeNull();
      expect(e.truncated).toBeNull();
    }
  });
});
