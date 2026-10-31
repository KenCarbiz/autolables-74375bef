import { describe, it, expect } from "vitest";
import { summarizeSoldPage, SOLD_MIN_SAMPLE } from "./soldSample.ts";

const row = (i: number, price: number, over: Record<string, unknown> = {}) => ({
  id: `R${i}`, vin: `VIN${String(i).padStart(14, "0")}`, price, dom: 20 + i, miles: 10000 + i * 100,
  last_seen_at_date: "2026-10-20T00:00:00.000Z", ...over,
});
const page = (n: number) => Array.from({ length: n }, (_, i) => row(i + 1, 30000 + i * 1000));

describe("inferred-sold sample", () => {
  it("counts the sample separately from the provider's cohort size", () => {
    const s = summarizeSoldPage(page(50), 312, "SUBJECT");
    expect(s.count).toBe(312);
    expect(s.sample_size).toBe(50);
    expect(s.truncated).toBe(true);
  });

  it("is the same whatever order the page arrived in", () => {
    const a = summarizeSoldPage(page(12), 12, "SUBJECT");
    const b = summarizeSoldPage([...page(12)].reverse(), 12, "SUBJECT");
    expect(b).toEqual(a);
    expect(a.truncated).toBe(false);
  });

  it("removes the subject and duplicate VINs, keeping the latest copy", () => {
    const rows = [...page(6), row(99, 1, { vin: "SUBJECT" }), row(1, 99999, { id: "R1-old", last_seen_at_date: "2026-09-01T00:00:00.000Z" })];
    const s = summarizeSoldPage(rows, 8, "subject");
    expect(s.sample_size).toBe(6);
    expect(s.price_median).toBe(32500);
  });

  it("withholds medians below the minimum sample", () => {
    const s = summarizeSoldPage(page(SOLD_MIN_SAMPLE - 1), 4, "SUBJECT");
    expect(s.price_median).toBeNull();
    expect(s.dom_median).toBeNull();
    expect(s.sample_size).toBe(SOLD_MIN_SAMPLE - 1);
  });
});

import { deriveSoldClaims, type PassportData } from "../passportV2Data";

describe("the sold-price claim needs its own sample", () => {
  const data = (meta: Record<string, unknown>) => ({
    price: 30000, marketAvg: 34000,
    marketMeta: {
      soldDisplayable: true, soldCount: 300, soldState: "CT", soldScope: "model_year_state",
      soldPriceMedian: 33000, soldMilesMedian: 40000, soldDomMedian: 30, ...meta,
    },
  }) as unknown as PassportData;

  it("a row written before sold-sample-v1 prints no dollar figure", () => {
    expect(deriveSoldClaims(data({ soldSampleSize: null, soldTruncated: null }), 30000).soldPrice).toBeNull();
  });

  it("a truncated page prints no dollar figure", () => {
    expect(deriveSoldClaims(data({ soldSampleSize: 50, soldTruncated: true }), 30000).soldPrice).toBeNull();
  });

  it("a whole cohort of at least ten prints the figure and names the sample it came from", () => {
    const c = deriveSoldClaims(data({ soldCount: 12, soldSampleSize: 12, soldTruncated: false }), 30000);
    expect(c.soldPrice?.sub).toContain("of 12 inferred sold listings");
    expect(c.velocity).toContain("12 ");
  });
});
