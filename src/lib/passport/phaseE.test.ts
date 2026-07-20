import { describe, it, expect } from "vitest";
import { resolveMarketComparison, NORMALIZED_MARKET_VALUE_LABEL } from "./marketComparison";
import { normalizeComparables } from "./comparables";
import { resolveFuelEconomy } from "./fuelEconomy";
import type { PricePoint } from "@/lib/passportV2Data";

const pt = (at: string, lp: number | null, mv: number | null): PricePoint =>
  ({ captured_at: at, listing_price: lp, market_value: mv, below_market: null, position: null });

describe("Market Comparison — history + labeling governance", () => {
  it("labels the provider VIN-level predicted value 'Normalized market value', never 'market average'", () => {
    const v = resolveMarketComparison({ valueHistory: [], advertisedPrice: 58140, normalizedMarketValue: 61300 });
    expect(v.marketValueLabel).toBe(NORMALIZED_MARKET_VALUE_LABEL);
    expect(v.marketValueLabel.toLowerCase()).not.toContain("average");
    expect(v.diff).toBe(-3160); // 58140 − 61300 (below)
  });

  it("two time-separated snapshots render a trend and disclose the period", () => {
    const v = resolveMarketComparison({
      valueHistory: [pt("2026-06-01", 60000, 61000), pt("2026-07-01", 58140, 61300)],
      advertisedPrice: 58140, normalizedMarketValue: 61300,
    });
    expect(v.mode).toBe("trend");
    expect(v.listingSeries).toHaveLength(2);
    expect(v.periodLabel).toContain("Price history since");
  });

  it("a single snapshot renders a static comparison, not a fabricated line", () => {
    const v = resolveMarketComparison({ valueHistory: [pt("2026-07-01", 58140, 61300)], advertisedPrice: 58140, normalizedMarketValue: 61300 });
    expect(v.mode).toBe("static");
    expect(v.periodLabel).toBeNull();
    expect(v.limitations.some((l) => /one recorded snapshot/i.test(l))).toBe(true);
  });

  it("missing market-value history does not fabricate a market series", () => {
    const v = resolveMarketComparison({
      valueHistory: [pt("2026-06-01", 60000, null), pt("2026-07-01", 58140, null)],
      advertisedPrice: 58140, normalizedMarketValue: 61300,
    });
    expect(v.hasMarketSeries).toBe(false);
    expect(v.marketSeries).toHaveLength(0);
    expect(v.mode).toBe("trend"); // listing series still trends
  });

  it("no price data at all → unavailable", () => {
    const v = resolveMarketComparison({ valueHistory: [], advertisedPrice: null, normalizedMarketValue: null });
    expect(v.mode).toBe("unavailable");
  });
});

describe("Similar Vehicles — normalization governance", () => {
  const subject = { vin: "SUBJECTVIN0000001", year: 2026, trim: "LUXE", advertisedPrice: 58140 };
  const comps = [
    { vin: "SUBJECTVIN0000001", ymm: "2026 INFINITI QX60 LUXE", trim: "LUXE", price: 58140 }, // subject — excluded
    { vin: "A1", ymm: "2026 INFINITI QX60 LUXE", trim: "LUXE", miles: 12, price: 59642, dist: 8 },
    { vin: "A1", ymm: "2026 INFINITI QX60 LUXE", trim: "LUXE", price: 59642 },                 // dup VIN — excluded
    { vin: "B2", ymm: "2025 INFINITI QX60 PURE", trim: "PURE", price: 55490, dist: 20 },
    { vin: "C3", ymm: "2022 INFINITI QX60", trim: "PURE", price: 40000 },                       // 4y gap — excluded
    { vin: "D4", ymm: "2026 INFINITI QX60 SENSORY", trim: "SENSORY", price: 0 },                // invalid price — excluded
  ];

  it("excludes subject VIN, duplicate VINs, invalid prices, and out-of-range years", () => {
    const out = normalizeComparables(subject, comps);
    const vins = out.map((c) => c.vin);
    expect(vins).toEqual(["A1", "B2"]); // only the two valid, in-range comps
  });

  it("reports condition as unavailable (feed has no condition field) — never inferred", () => {
    const out = normalizeComparables(subject, comps);
    expect(out.every((c) => c.condition === "unavailable")).toBe(true);
  });

  it("uses a RAW plain-language price delta — never 'adjusted' or 'savings'", () => {
    const out = normalizeComparables(subject, comps);
    const a1 = out.find((c) => c.vin === "A1")!;
    expect(a1.priceDelta).toBe(1502);
    expect(a1.priceDeltaLabel).toBe("$1,502 more than this vehicle");
    const b2 = out.find((c) => c.vin === "B2")!;
    expect(b2.priceDeltaLabel).toBe("$2,650 less than this vehicle");
    for (const c of out) expect(c.priceDeltaLabel.toLowerCase()).not.toMatch(/adjust|savings|value difference/);
  });

  it("ranks the closest match (same year + trim) first and explains it", () => {
    const out = normalizeComparables(subject, comps);
    expect(out[0].vin).toBe("A1");
    expect(out[0].matchLabel).toMatch(/closest match/i);
  });

  it("returns an empty array (honest) when nothing qualifies — never padded", () => {
    const out = normalizeComparables(subject, [{ vin: "Z", ymm: "2010 HONDA CIVIC", price: 9000 }]);
    expect(out).toEqual([]);
  });
});

describe("Fuel Economy — EPA-only governance", () => {
  it("attributes an EPA-sourced annual fuel cost correctly", () => {
    const v = resolveFuelEconomy({ city: 20, highway: 25, combined: 22, annualFuelCost: 2650, ghgScore: 5, rangeMiles: 480, fuelType: "Gasoline" });
    expect(v.available).toBe(true);
    expect(v.annualFuelCost).toBe(2650);
    expect(v.annualFuelCostLabel).toBe("EPA estimated annual fuel cost");
    expect(v.source).toContain("EPA");
  });

  it("shows MPG but NO manufactured cost when annual fuel cost is missing", () => {
    const v = resolveFuelEconomy({ city: 20, highway: 25, combined: 22, annualFuelCost: null, ghgScore: null, rangeMiles: null, fuelType: "Gasoline" });
    expect(v.combinedMpg).toBe(22);
    expect(v.annualFuelCost).toBeNull();
    expect(v.annualFuelCostLabel).toBeNull();
    expect(v.note).toMatch(/unavailable/i);
  });

  it("no EPA data → honest unavailable state", () => {
    expect(resolveFuelEconomy(null).available).toBe(false);
    expect(resolveFuelEconomy({ city: null, highway: null, combined: null, annualFuelCost: null, ghgScore: null, rangeMiles: null, fuelType: null }).available).toBe(false);
  });
});
