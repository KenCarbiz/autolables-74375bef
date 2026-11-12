import { describe, expect, it } from "vitest";
import {
  describeCohort, properMedian, splitCohortRows, trimCohortOutliers,
} from "../../../supabase/functions/_shared/compCohort.ts";

// Eight priced rows around an asking price of 25,000, some above and some below.
const rows = [
  { vin: "A1", price: 21000, dist: 4, seller_name: "Alpha Motors" },
  { vin: "A2", price: 22000, dist: 9, seller_name: "Beta Cars" },
  { vin: "A3", price: 23000, dist: 11, seller_name: "Gamma Auto" },
  { vin: "A4", price: 24000, dist: 14, seller_name: "Delta Auto" },
  { vin: "A5", price: 26000, dist: 20, seller_name: "Echo Auto" },
  { vin: "A6", price: 27000, dist: 31, seller_name: "Foxtrot Auto" },
  { vin: "A7", price: 28000, dist: 40, seller_name: "Golf Auto" },
  { vin: "A8", price: 29000, dist: 55, seller_name: "Hotel Auto" },
];

describe("cohort statistics are independent of the subject's asking price", () => {
  it("analyzes rows above AND below the subject, whatever the subject asks", () => {
    // Even count 8: median is the mean of the 4th and 5th sorted prices,
    // (24000 + 26000) / 2 = 25000. Nothing here reads the subject price.
    const t = trimCohortOutliers(rows);
    const sorted = t.analysed.map((r) => r.price as number).sort((a, b) => a - b);
    expect(sorted).toEqual([21000, 22000, 23000, 24000, 26000, 27000, 28000, 29000]);
    expect(properMedian(sorted)).toBe(25000);
    expect(sorted.some((p) => p < 25000)).toBe(true);
    expect(sorted.some((p) => p > 25000)).toBe(true);
  });

  it("uses a true median for an even count (old code took floor(n/2), the upper middle)", () => {
    // [20000, 21000, 22000, 23000] -> (21000 + 22000) / 2 = 21500, not 22000.
    expect(properMedian([20000, 21000, 22000, 23000])).toBe(21500);
    expect(properMedian([20000, 21000, 22000])).toBe(21000);
    expect(properMedian([])).toBeNull();
  });
});

describe("outlier trimming uses the cohort's own quartiles", () => {
  it("drops a 200,000 listing from nine rows", () => {
    // Sorted 20..27 thousand plus 200 thousand. Quartile positions (n-1)*q:
    // Q1 at 2.0 -> 22000, Q3 at 6.0 -> 26000, IQR 4000, upper fence
    // 26000 + 1.5*4000 = 32000, so 200000 is trimmed; lower fence 16000.
    const nine = [20, 21, 22, 23, 24, 25, 26, 27, 200].map((k, i) => ({ vin: `V${i}`, price: k * 1000 }));
    const t = trimCohortOutliers(nine);
    expect(t.outliers).toBe(1);
    expect(t.analysed).toHaveLength(8);
    expect(t.analysed.some((r) => r.price === 200000)).toBe(false);
  });

  it("does not trim when fewer than eight priced rows", () => {
    const t = trimCohortOutliers([{ price: 10000 }, { price: 90000 }, { price: 12000 }]);
    expect(t.outliers).toBe(0);
    expect(t.analysed).toHaveLength(3);
  });

  it("counts unpriced rows separately", () => {
    const t = trimCohortOutliers([{ price: 0 }, { price: null }, { price: 15000 }]);
    expect(t.unpriced).toBe(2);
    expect(t.analysed).toHaveLength(1);
  });
});

describe("exclusions", () => {
  it("separates the subject VIN and the dealer's own rooftop, case-insensitively", () => {
    const all = [
      { vin: "subj1", price: 25000, dist: 3 },
      { vin: "OWN1", price: 24000, dist: 0 },
      { vin: "OWN2", price: 26000, dist: 2, seller_name: "Harte Infiniti of Hartford" },
      { vin: "COMP1", price: 25500, dist: 8, seller_name: "Other Motors" },
    ];
    const s = splitCohortRows(all, "SUBJ1", "Harte INFINITI");
    expect(s.subjectCount).toBe(1);
    expect(s.ownRows.map((r) => r.vin).sort()).toEqual(["OWN1", "OWN2"]);
    expect(s.rows.map((r) => r.vin)).toEqual(["COMP1"]);
  });
});

describe("cohort descriptor", () => {
  it("records sample size, geography, trim, mileage band and exclusions", () => {
    const c = describeCohort({
      totalMatches: 140, returned: 50, analysed: 44, sortBasis: "distance", radius: 100,
      year: "2023", trim: "Sensory", milesBand: { percent: 25, range: "9000-15000" },
      subject: 1, own: 3, unpriced: 1, mismatch: 0, outliers: 1, outlierRule: "1.5x IQR of the cohort's own prices",
    });
    expect(c.selection).toBe("price_independent_cohort");
    expect(c.analyzed_count).toBe(44);
    expect(c.total_matches).toBe(140);
    expect(c.sampled).toBe(true);
    expect(c.radius_miles).toBe(100);
    expect(c.miles_band).toEqual({ percent: 25, range: "9000-15000" });
    expect(c.excluded).toEqual({ subject_vin: 1, dealer_own_listings: 3, unpriced: 1, trim_or_drivetrain_mismatch: 0, outliers: 1 });
  });

  it("is not marked sampled when every match was returned", () => {
    const c = describeCohort({
      totalMatches: 20, returned: 20, analysed: 18, sortBasis: "provider_default", radius: null,
      year: null, trim: null, milesBand: null, subject: 0, own: 0, unpriced: 0, outliers: 2, outlierRule: "x",
    });
    expect(c.sampled).toBe(false);
  });
});
