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
    expect(scoreTier(42)).toMatchObject({ label: "Proceed With Caution", verdict: "Confirm Key Details Before Moving Forward" });
  });

  it("frames a 60-69 score as a candidate with details to confirm — never excellent, never a warning", () => {
    const t = scoreTier(69);
    expect(t.label).toBe("Worth Reviewing");
    expect(t.headline).toBe("Strong Buy Candidate");
    expect(t.verdict).toBe("Good Candidate — Confirm Final Details");
    expect(t.label).not.toMatch(/excellent/i);
    expect(t.verdict).not.toMatch(/carefully|caution/i);
  });

  it("holds a pending state when the score is null", () => {
    expect(scoreTier(null)).toMatchObject({ label: "Pending Verification", verdict: "Pending Verification" });
  });
});
