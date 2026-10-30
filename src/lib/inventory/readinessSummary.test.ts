import { describe, it, expect } from "vitest";
import { summarizeReadiness } from "./readinessSummary";

describe("summarizeReadiness (F04)", () => {
  it("keeps mean completeness separate from the complete rate", () => {
    // 130 vehicles: 2 fully complete, the rest part-way. Mean is high, rate is low.
    const scores = [...Array(2).fill(100), ...Array(128).fill(71)];
    const s = summarizeReadiness(scores);
    expect(s.total).toBe(130);
    expect(s.complete).toBe(2);
    expect(s.completeRatePct).toBe(2);
    expect(s.meanCompletenessPct).toBe(72);
  });

  it("reconciles numerator, denominator and percentage", () => {
    const s = summarizeReadiness([100, 100, 60, 20]);
    expect(s.completeRatePct).toBe(Math.round((s.complete / s.total) * 100));
    expect(s.complete).toBe(2);
    expect(s.meanCompletenessPct).toBe(70);
  });

  it("is unknown rather than zero with no vehicles", () => {
    expect(summarizeReadiness([])).toEqual({ total: 0, complete: 0, completeRatePct: null, meanCompletenessPct: null });
  });
});
