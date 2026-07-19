import { describe, it, expect } from "vitest";
import { resolveMarketDaysDisplay, type MarketDaysMetrics } from "./daysMetrics";

const base: MarketDaysMetrics = {
  subjectVehicle: { firstSeenAt: "2026-07-02", dealerInventoryStartAt: "2026-07-02", currentListingAgeDays: 17, source: "dealer_feed" },
  activeComparables: {
    averageListingAgeDays: 154, medianListingAgeDays: 54, sampleSize: 61, radiusMiles: 100,
    filters: { condition: "new", make: "INFINITI", model: "QX60", modelYears: [2026], trims: ["LUXE"], drivetrains: ["AWD"] },
  },
  checkedAt: "2026-07-19",
  provider: "MarketCheck",
  methodologyVersion: "v1",
};

describe("resolveMarketDaysDisplay — 154-days governance", () => {
  it("subject vehicle shows its OWN inventory age, not the market average", () => {
    const d = resolveMarketDaysDisplay(base);
    expect(d.subjectHeadline).toBe("17 days at this dealership");
    expect(d.subjectSubcopy).toBe("First listed Jul 2, 2026");
  });

  it("uses MEDIAN active listing age as the benchmark (not the skewed 154 average)", () => {
    const d = resolveMarketDaysDisplay(base);
    expect(d.benchmarkKind).toBe("active_listing_age");
    expect(d.benchmarkHeadline).toBe("54 days median local listing age");
    expect(d.benchmarkSubcopy).toContain("currently listed within 100 miles");
    expect(d.benchmarkSubcopy).toContain("not time to sell");
    expect(d.benchmarkHeadline).not.toContain("154");
  });

  it("only claims 'time to sell' when confirmed/likely sale data exists", () => {
    const withSales: MarketDaysMetrics = {
      ...base,
      historicalComparables: { medianObservedListingDurationDays: 42, sampleSize: 38, lookbackDays: 90, outcomeConfidence: "confirmed_sale" },
    };
    const d = resolveMarketDaysDisplay(withSales);
    expect(d.benchmarkKind).toBe("time_to_sell");
    expect(d.benchmarkHeadline).toBe("42 days median time to sell");
    expect(d.benchmarkSubcopy).toContain("38 confirmed comparable new QX60 sales");
  });

  it("delisted_only data is NOT treated as a sale — falls back to active listing age", () => {
    const delisted: MarketDaysMetrics = {
      ...base,
      historicalComparables: { medianObservedListingDurationDays: 33, sampleSize: 20, lookbackDays: 90, outcomeConfidence: "delisted_only" },
    };
    const d = resolveMarketDaysDisplay(delisted);
    expect(d.benchmarkKind).toBe("active_listing_age");
  });

  it("no trustworthy benchmark => 'Market timing unavailable', never a fabricated number", () => {
    const empty: MarketDaysMetrics = {
      ...base,
      activeComparables: { ...base.activeComparables, medianListingAgeDays: null, sampleSize: 0 },
    };
    const d = resolveMarketDaysDisplay(empty);
    expect(d.benchmarkKind).toBe("unavailable");
    expect(d.benchmarkHeadline).toBe("Market timing unavailable");
    // subject age still shows independently
    expect(d.subjectHeadline).toBe("17 days at this dealership");
  });
});
