import { describe, it, expect } from "vitest";
import { resolveBuyingCandidate } from "./buyingCandidate";

describe("resolveBuyingCandidate — conditioned recommendation", () => {
  it("above normalized market value + pending title => Candidate With Questions with BOTH reasons (the QX50 case)", () => {
    const r = resolveBuyingCandidate({ advertisedPrice: 30876, normalizedMarketValue: 28449, pendingMaterialLabels: ["Title & Brand"] });
    expect(r.headline).toBe("Candidate With Questions");
    expect(r.hasQuestions).toBe(true);
    expect(r.aboveMarket).toBe(2427);
    expect(r.aboveMarketPct).toBe(8.5);
    expect(r.concerns.some((c) => /Title & Brand check is still pending/.test(c))).toBe(true);
    expect(r.concerns.some((c) => /\$2,427 above normalized market value \(8\.5%\)/.test(c))).toBe(true);
    expect(r.primaryCtaLabel).toBe("Ask Dealer About This Vehicle");
  });

  it("below market + all checks complete => Strong Buying Candidate, Reserve", () => {
    const r = resolveBuyingCandidate({ advertisedPrice: 58140, normalizedMarketValue: 61300, pendingMaterialLabels: [] });
    expect(r.headline).toBe("Strong Buying Candidate");
    expect(r.hasQuestions).toBe(false);
    expect(r.aboveMarket).toBeNull();
    expect(r.primaryCtaLabel).toBe("Reserve This Vehicle");
  });

  it("at/near market with no pending checks stays strong (within tolerance)", () => {
    const r = resolveBuyingCandidate({ advertisedPrice: 28500, normalizedMarketValue: 28449, pendingMaterialLabels: [] });
    expect(r.hasQuestions).toBe(false); // +51 is within the 250 tolerance
  });

  it("a pending check alone (fairly priced) still raises a question", () => {
    const r = resolveBuyingCandidate({ advertisedPrice: 28000, normalizedMarketValue: 28449, pendingMaterialLabels: ["Recall"] });
    expect(r.headline).toBe("Candidate With Questions");
    expect(r.concerns).toHaveLength(1);
    expect(r.aboveMarket).toBeNull();
  });
});
