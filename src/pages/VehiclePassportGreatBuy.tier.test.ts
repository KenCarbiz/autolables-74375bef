import { describe, expect, it } from "vitest";
import { scoreTier } from "./VehiclePassportGreatBuy";

describe("scoreTier", () => {
  it("maps each band to its label and verdict", () => {
    expect(scoreTier(97)).toMatchObject({ label: "Excellent Buy", verdict: "YES" });
    expect(scoreTier(90)).toMatchObject({ label: "Excellent Buy", verdict: "YES" });
    expect(scoreTier(85)).toMatchObject({ label: "Strong Buy", verdict: "YES" });
    expect(scoreTier(79)).toMatchObject({ label: "Good Buy", verdict: "WORTH A LOOK" });
    expect(scoreTier(70)).toMatchObject({ label: "Good Buy", verdict: "WORTH A LOOK" });
    expect(scoreTier(55)).toMatchObject({ label: "Needs Review", verdict: "REVIEW CAREFULLY" });
    expect(scoreTier(42)).toMatchObject({ label: "Proceed With Caution", verdict: "PROCEED WITH CAUTION" });
  });

  it("never calls a 60-69 score excellent or a hard yes", () => {
    const t = scoreTier(69);
    expect(t.label).toBe("Fair Buy");
    expect(t.verdict).toBe("REVIEW CAREFULLY");
    expect(t.headline).toBe("A Vehicle Worth Reviewing.");
    expect(t.label).not.toMatch(/excellent/i);
  });

  it("holds a pending state when the score is null", () => {
    expect(scoreTier(null)).toMatchObject({ label: "Pending Verification", verdict: "PENDING" });
  });
});
