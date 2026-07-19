import { describe, it, expect } from "vitest";
import { Intelligence, describeIntelligence, hasUsableValue } from "./envelope";

describe("IntelligenceResult envelope", () => {
  it("verified source with a calculated conclusion stay distinct", () => {
    const belowMarket = Intelligence.calculated(3687, {
      checkedAt: "2026-07-19", sourceTypes: ["commercial_history"], sourceCount: 61,
      calculationVersion: "v1", explanation: "Below the normalized comparable median",
      limitations: ["Comparables span trims"], confidence: 0.82,
    });
    expect(belowMarket.status).toBe("calculated");
    expect(describeIntelligence(belowMarket).label).toBe("AutoLabels estimate");
    expect(describeIntelligence(belowMarket).showValue).toBe(true);
    expect(describeIntelligence(belowMarket).caption).toContain("61 sources");
    expect(describeIntelligence(belowMarket).caption).toContain("82% confidence");
  });

  it("pending/unavailable never show a value", () => {
    const pending = Intelligence.pending<string>("title", { checkedAt: "2026-07-19", explanation: "Title check in progress" });
    expect(hasUsableValue(pending)).toBe(false);
    expect(describeIntelligence(pending).showValue).toBe(false);
    const na = Intelligence.unavailable({ checkedAt: "2026-07-19", explanation: "No benchmark" });
    expect(na.value).toBeNull();
    expect(describeIntelligence(na).showValue).toBe(false);
  });

  it("conflict surfaces as needs-review", () => {
    const c = Intelligence.conflict(2, { checkedAt: "2026-07-19", explanation: "Sources disagree on trim" });
    expect(describeIntelligence(c).label).toBe("Needs review");
  });
});
