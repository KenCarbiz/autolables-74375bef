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
