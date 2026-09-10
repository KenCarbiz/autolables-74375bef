import { describe, it, expect } from "vitest";
import {
  trueMedian, weightedQuantile, weightedMedian, weightedMean,
  weightedStdDev, weightedMad, effectiveSampleSize,
} from "./statistics.ts";

const equal = (values: number[]) => values.map((value) => ({ value, weight: 1 }));

describe("trueMedian", () => {
  it("averages the two middle values of an even-length list", () => {
    expect(trueMedian([38431, 43876])).toBe(41153.5);
  });

  it("is the QX50 regression the old helper failed", () => {
    // sorted[floor(2/2)] === sorted[1] === 43876 — the subject's own price.
    expect(trueMedian([38431, 43876])).not.toBe(43876);
  });

  it("returns the middle value of an odd-length list", () => {
    expect(trueMedian([3, 1, 2])).toBe(2);
  });

  it("returns null for an empty list and ignores non-finite values", () => {
    expect(trueMedian([])).toBeNull();
    expect(trueMedian([NaN, Infinity])).toBeNull();
    expect(trueMedian([NaN, 4, 6])).toBe(5);
  });
});

describe("weightedQuantile", () => {
  it("reduces to trueMedian when every weight is equal", () => {
    for (const set of [[38431, 43876], [1, 2, 3], [10, 20, 30, 40], [5]]) {
      expect(weightedMedian(equal(set))).toBeCloseTo(trueMedian(set)!, 9);
    }
  });

  it("moves toward the heavier side", () => {
    const skewed = [{ value: 38431, weight: 9 }, { value: 43876, weight: 1 }];
    const median = weightedMedian(skewed)!;
    expect(median).toBeLessThan(41153.5);
    expect(median).toBeGreaterThanOrEqual(38431);
  });

  it("ignores zero and negative weights", () => {
    expect(weightedMedian([{ value: 1, weight: 0 }, { value: 100, weight: 2 }])).toBe(100);
    expect(weightedMedian([{ value: 1, weight: -5 }])).toBeNull();
  });

  it("clamps out-of-range quantiles instead of throwing", () => {
    const pts = equal([10, 20, 30]);
    expect(weightedQuantile(pts, -1)).toBe(10);
    expect(weightedQuantile(pts, 2)).toBe(30);
  });

  it("returns null with nothing to measure", () => {
    expect(weightedQuantile([], 0.5)).toBeNull();
  });
});

describe("weightedMean / weightedStdDev / weightedMad", () => {
  it("computes a weighted mean", () => {
    expect(weightedMean([{ value: 10, weight: 3 }, { value: 20, weight: 1 }])).toBe(12.5);
  });

  it("needs two points for a spread", () => {
    expect(weightedStdDev(equal([10]))).toBeNull();
    expect(weightedMad(equal([10]))).toBeNull();
  });

  it("MAD is unmoved by one absurd listing where stdDev is not", () => {
    const sane = equal([39000, 39500, 40000, 40500, 41000]);
    const withOutlier = [...sane, { value: 250000, weight: 1 }];
    const madBefore = weightedMad(sane)!;
    const madAfter = weightedMad(withOutlier)!;
    const sdBefore = weightedStdDev(sane)!;
    const sdAfter = weightedStdDev(withOutlier)!;
    expect(Math.abs(madAfter - madBefore)).toBeLessThan(madBefore);
    expect(sdAfter).toBeGreaterThan(sdBefore * 5);
  });
});

describe("effectiveSampleSize", () => {
  it("equals the count when weights are equal", () => {
    expect(effectiveSampleSize([1, 1, 1, 1])).toBeCloseTo(4, 9);
  });

  it("collapses toward one when a single source dominates", () => {
    expect(effectiveSampleSize([100, 1, 1])).toBeLessThan(1.2);
  });

  it("is zero with no usable weights", () => {
    expect(effectiveSampleSize([])).toBe(0);
    expect(effectiveSampleSize([0, -1])).toBe(0);
  });
});
