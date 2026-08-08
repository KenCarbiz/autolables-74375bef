import { describe, it, expect } from "vitest";
import { cleanEquipmentList, computePriceHistory, derivePassport, deriveRating, CREDIBLE_AVG_DOM_MAX } from "./passportV2Data";
import type { VehicleListing } from "@/hooks/useVehicleListing";

// dom is read from mc_attributes; avg_dom from market_meta.
const demandEvidence = ({ dom, avg_dom }: { dom: number; avg_dom: number }): string[] => {
  const l = { mc_attributes: { dom }, market_meta: { avg_dom } } as unknown as VehicleListing;
  return deriveRating(l, derivePassport(l)).factors.find((f) => f.key === "demand")?.evidence ?? [];
};

const listingWithHistory = (points: { at: string; price: number | null }[]): VehicleListing =>
  ({ value_history: points.map((p) => ({ captured_at: p.at, listing_price: p.price, market_value: null })) } as unknown as VehicleListing);

describe("computePriceHistory", () => {
  it("drops a transient single-capture up-spike from the series", () => {
    // Flat at 55598, a one-capture spike up to 60598, back to 55598 — the spike
    // is a scrape artifact and must be removed from the chart/highest/events.
    const r = computePriceHistory(listingWithHistory([
      { at: "2026-06-01", price: 56895 },
      { at: "2026-06-28", price: 55598 },
      { at: "2026-07-03", price: 60598 }, // artifact
      { at: "2026-07-05", price: 55598 },
    ]));
    const prices = r.valueHistory.map((h) => h.listing_price);
    expect(prices).not.toContain(60598);
    expect(Math.max(...(prices.filter((p): p is number => p != null)))).toBe(56895);
  });

  it("reports the latest REAL reduction, not the phantom created by the spike", () => {
    const r = computePriceHistory(listingWithHistory([
      { at: "2026-06-01", price: 56895 },
      { at: "2026-06-28", price: 55598 },
      { at: "2026-07-03", price: 60598 }, // artifact — would fake a -5000 "latest change"
      { at: "2026-07-05", price: 55598 },
    ]));
    // After removing the spike the last real movement is 56895 -> 55598 = -1297.
    expect(r.priceChangeLatest).toBe(-1297);
  });

  it("returns null latest-change when the price never moved", () => {
    const r = computePriceHistory(listingWithHistory([
      { at: "2026-06-01", price: 55598 },
      { at: "2026-06-15", price: 55598 },
    ]));
    expect(r.priceChangeLatest).toBeNull();
  });

  it("keeps a genuine sustained higher earlier price (not a lone spike)", () => {
    const r = computePriceHistory(listingWithHistory([
      { at: "2026-05-01", price: 61895 },
      { at: "2026-06-01", price: 61895 },
      { at: "2026-07-01", price: 55598 },
    ]));
    expect(r.valueHistory.map((h) => h.listing_price)).toContain(61895);
    expect(r.priceChangeLatest).toBe(-6297);
  });
});

describe("Demand & Velocity — skewed avg_dom governance", () => {
  it("never cites a stale-skewed active-listing average as the market benchmark", () => {
    const lines = demandEvidence({ dom: 17, avg_dom: 154 });
    expect(lines.some((l) => l.includes("154"))).toBe(false);
    expect(lines.some((l) => /market average/.test(l))).toBe(false);
    // A fresh listing still gets an honest, benchmark-free freshness line.
    expect(lines.some((l) => /Listed 17 days — fresh to market/.test(l))).toBe(true);
  });

  it("still cites the average when it sits in a credible band", () => {
    const lines = demandEvidence({ dom: 17, avg_dom: 40 });
    expect(lines.some((l) => l.includes("17 days listed vs a 40-day market average"))).toBe(true);
  });

  it("boundary: an average exactly at the credibility ceiling is usable", () => {
    const lines = demandEvidence({ dom: 20, avg_dom: CREDIBLE_AVG_DOM_MAX });
    expect(lines.some((l) => l.includes(`${CREDIBLE_AVG_DOM_MAX}-day market average`))).toBe(true);
  });

  it("skewed average with a not-fresh listing yields no fabricated benchmark line", () => {
    const lines = demandEvidence({ dom: 95, avg_dom: 154 });
    expect(lines.some((l) => l.includes("154") || /market average/.test(l))).toBe(false);
    expect(lines.some((l) => /fresh to market/.test(l))).toBe(false);
  });
});

describe("cleanEquipmentList", () => {
  it("drops raw option codes", () => {
    expect(cleanEquipmentList(["B10", "E10", "Heated Seats"])).toEqual(["Heated Seats"]);
  });

  it("drops metadata, ratings, and paint noise", () => {
    const out = cleanEquipmentList([
      "MSRP",
      "IIHS Top Safety Pick",
      "Frontal Crash",
      "Metallic Paint",
      "Panoramic Moonroof",
    ]);
    expect(out).toEqual(["Panoramic Moonroof"]);
  });

  it("removes generic category filler", () => {
    expect(cleanEquipmentList(["Engine", "Transmission", "Power Windows", "Apple CarPlay"]))
      .toEqual(["Apple CarPlay"]);
  });

  it("de-dupes across US/UK spelling and casing", () => {
    const out = cleanEquipmentList(["Alloy Wheels", "alloy wheels", "Colour Display", "Color Display"]);
    expect(out).toEqual(["Alloy Wheels", "Color Display"]);
  });

  it("keeps real features and preserves order", () => {
    const input = ["Navigation System", "Bose Audio", "Blind Spot Warning"];
    expect(cleanEquipmentList(input)).toEqual(input);
  });

  it("returns an empty list when everything is noise", () => {
    expect(cleanEquipmentList(["B10", "MSRP", "Engine", ""])).toEqual([]);
  });
});

describe("Market verdict basis governance", () => {
  const listing = (over: Record<string, unknown>): VehicleListing => over as unknown as VehicleListing;

  it("weak basis (legacy model-wide comps median) nulls belowMarket and flags the basis", () => {
    const d = derivePassport(listing({
      price: 58000, market_value: 62000,
      market_payload: { source: "comps_median", marketValue: 62000 },
    }));
    expect(d.marketBasisWeak).toBe(true);
    expect(d.belowMarket).toBeNull();
  });

  it("VIN-level predict stays a strong basis", () => {
    const d = derivePassport(listing({
      price: 58000, market_value: 62000,
      market_payload: { marketValue: 62000, low: 55000, high: 68000 },
    }));
    expect(d.marketBasisWeak).toBe(false);
    expect(d.belowMarket).toBe(4000);
  });

  it("like-for-like comps median is a strong basis", () => {
    const d = derivePassport(listing({
      price: 58000, market_value: 62000,
      market_payload: { source: "comps_median_like", like_count: 5, marketValue: 62000 },
    }));
    expect(d.marketBasisWeak).toBe(false);
    expect(d.belowMarket).toBe(4000);
  });

  it("model-wide stats never punish when the comp blend's mileage is far from ours", () => {
    // 12k-mile car at 75k vs a 58k median built from ~55k-mile cars: the
    // blend demonstrably misrepresents this car -> no price score at all,
    // never a low one.
    const l = listing({
      price: 75000, mileage: 12000,
      market_meta: { price_stats: { median: 58000 }, miles_mean: 55000 },
    });
    const price = deriveRating(l, derivePassport(l)).factors.find((f) => f.key === "price");
    expect(price?.score ?? null).toBeNull();
  });

  it("model-wide stats never punish a known trim the comp search could not match", () => {
    const l = listing({
      price: 75000, mileage: 12000, trim: "Autograph",
      market_meta: { price_stats: { median: 58000 }, trim_matched: false },
    });
    const price = deriveRating(l, derivePassport(l)).factors.find((f) => f.key === "price");
    expect(price?.score ?? null).toBeNull();
  });

  it("model-wide stats still anchor when nothing distinguishes the car from the blend", () => {
    // No trim, no odometer mismatch evidence: the blended median is the best
    // available comparison and keeps the monotone score contract.
    const l = listing({
      price: 46000,
      market_meta: { price_stats: { median: 40000 }, similar_count: 30 },
    });
    const price = deriveRating(l, derivePassport(l)).factors.find((f) => f.key === "price");
    expect(price?.score ?? null).not.toBeNull();
  });

  it("a like-for-like median outranks the model-wide median as the price anchor", () => {
    const l = listing({
      price: 75000, mileage: 12000,
      market_meta: { price_stats: { median: 58000 }, like_count: 6, like_median: 76000 },
    });
    const rating = deriveRating(l, derivePassport(l));
    const price = rating.factors.find((f) => f.key === "price");
    // Anchored at the like median (76k) our 75k price scores at/above the
    // 80-point anchor line, not floored by the blended 58k median.
    expect(price?.score ?? 0).toBeGreaterThanOrEqual(80);
    expect((price?.evidence ?? []).some((e) => e.includes("closely matched"))).toBe(true);
  });

  it("a sold median from far-higher-mileage sales is not the price anchor", () => {
    const l = listing({
      price: 75000, mileage: 12000,
      market_meta: {
        sold_stats: { count: 20, scope: "model_year_state", price_median: 58000, miles_median: 55000, dom_median: 30, state: "CT", checked_at: new Date().toISOString() },
      },
    });
    const price = deriveRating(l, derivePassport(l)).factors.find((f) => f.key === "price");
    expect((price?.evidence ?? []).some((e) => e.includes("recently sold"))).toBe(false);
  });
});
