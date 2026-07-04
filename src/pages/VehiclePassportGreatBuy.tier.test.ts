import { describe, expect, it } from "vitest";
import { scoreTier } from "./VehiclePassportGreatBuy";

describe("scoreTier", () => {
  it("maps each band to its label and verdict", () => {
    expect(scoreTier(97)).toMatchObject({ label: "Excellent Buy", verdict: "Excellent Candidate — Move Forward with Confidence" });
    expect(scoreTier(90)).toMatchObject({ label: "Excellent Buy" });
    expect(scoreTier(85)).toMatchObject({ label: "Strong Buy", verdict: "Strong Candidate — Move Forward with Confidence" });
    expect(scoreTier(79)).toMatchObject({ label: "Good Buy", verdict: "Good Candidate — Confirm Final Details" });
    expect(scoreTier(70)).toMatchObject({ label: "Good Buy" });
    expect(scoreTier(55)).toMatchObject({ label: "Needs Review", verdict: "Needs Review — Confirm Key Details" });
    expect(scoreTier(42)).toMatchObject({ label: "Worth a Closer Look", verdict: "Worth a Closer Look — Talk to the Dealer About This Vehicle", color: "#2563EB" });
  });

  it("frames a 60-69 score as a candidate with details to confirm — never excellent, never a warning", () => {
    const t = scoreTier(69);
    expect(t.label).toBe("Worth Reviewing");
    expect(t.headline).toBe("Worth Reviewing");
    expect(t.verdict).toBe("Good Candidate — Confirm Final Details");
    expect(t.label).not.toMatch(/excellent/i);
    expect(t.verdict).not.toMatch(/carefully|caution/i);
  });

  it("never renders red for any tier", () => {
    for (const s of [95, 85, 75, 65, 55, 42, 10]) expect(scoreTier(s).color).not.toBe("#DC2626");
  });

  it("holds a pending state when the score is null", () => {
    expect(scoreTier(null)).toMatchObject({ label: "Pending Verification", verdict: "Pending Verification" });
  });
});
