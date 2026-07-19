import { describe, it, expect } from "vitest";
import { computeBuyingConfidence, BUYING_WEIGHTS, type BuyingConfidenceInput } from "./buyingConfidence";

const clean: BuyingConfidenceInput = {
  subscores: { priceMarketFit: 92, verification: 95, equipmentValue: 90, demandAvailability: 77, coverage: 85 },
  verification: { materialPending: false, materialConflict: false, completedChecks: 8, applicableChecks: 8, sourcesConsulted: 5, pendingLabels: [] },
  normalizedComparableCount: 61,
  updatedAt: "2026-07-19",
};

describe("computeBuyingConfidence — governed composite", () => {
  it("weights sum to 1 and verification is a first-class 30% factor", () => {
    const sum = Object.values(BUYING_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(Math.round(sum * 100)).toBe(100);
    expect(BUYING_WEIGHTS.verification).toBe(0.30);
  });

  it("score is the weighted composite (0..100), never a percentage of probability", () => {
    const r = computeBuyingConfidence(clean);
    // 92*.35 + 95*.30 + 90*.20 + 77*.10 + 85*.05 = 90.65 -> 91
    expect(r.score).toBe(91);
    expect(r.band).toBe("exceptional");
    expect(r.subscores.find((s) => s.key === "verification")?.weightPct).toBe(30);
  });

  it("NEVER declares 'exceptional' while a material check is pending — caps to strong + notes pending", () => {
    const r = computeBuyingConfidence({
      ...clean,
      verification: { materialPending: true, materialConflict: false, completedChecks: 7, applicableChecks: 8, sourcesConsulted: 5, pendingLabels: ["Title and brand verification"] },
    });
    expect(r.band).toBe("strong");            // downgraded from exceptional
    expect(r.conditional).toBe(true);
    expect(r.headline).toBe("Strong Buying Candidate — One Check Pending");
    expect(r.subcopy).toContain("7 of 8 verification checks");
    expect(r.subcopy).toContain("Pending: Title and brand verification");
    expect(r.subcopy).toContain("61 normalized market listings");
  });

  it("a material conflict forces caution and a review message", () => {
    const r = computeBuyingConfidence({
      ...clean,
      verification: { materialPending: false, materialConflict: true, completedChecks: 8, applicableChecks: 8, sourcesConsulted: 5, pendingLabels: ["Odometer verification"] },
    });
    expect(r.band).toBe("caution");
    expect(r.subcopy.toLowerCase()).toContain("conflicting");
  });

  it("limitations always list out-the-door price + add the pending check", () => {
    const r = computeBuyingConfidence({
      ...clean,
      verification: { materialPending: true, materialConflict: false, completedChecks: 7, applicableChecks: 8, sourcesConsulted: 5, pendingLabels: ["Title and brand verification"] },
    });
    expect(r.limitations.some((l) => /out-the-door/i.test(l))).toBe(true);
    expect(r.limitations.some((l) => /title and brand/i.test(l))).toBe(true);
    expect(r.limitations.some((l) => /warranty in-service/i.test(l))).toBe(true);
  });

  it("clean high score with all checks complete stays exceptional", () => {
    const r = computeBuyingConfidence(clean);
    expect(r.conditional).toBe(false);
    expect(r.headline).toBe("Exceptional Buying Candidate");
  });
});
