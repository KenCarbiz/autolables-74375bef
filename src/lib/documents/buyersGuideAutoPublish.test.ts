import { describe, expect, it } from "vitest";
import {
  evaluateBuyersGuideAutoPublish,
  isBuyersGuideBox,
  type BuyersGuideSnapshot,
} from "./buyersGuideAutoPublish";

// The snapshots below are the shapes create_draft_buyers_guide actually writes
// (migration 20260727192153), not invented fixtures.
const ctOver5k: BuyersGuideSnapshot = {
  box: "warranty", forced: true, citation: "Conn. Gen. Stat. §42-221",
  min_pct: 100, min_duration_days: 60, min_miles: 3000,
  operating_state: "CT", default_ftc_warranty: "",
};
const ctAgeExempt: BuyersGuideSnapshot = {
  box: "as-is", forced: false, citation: "Conn. Gen. Stat. §42-221",
  min_pct: 0, min_duration_days: 0, min_miles: 0,
  operating_state: "CT", default_ftc_warranty: "",
};
const ctUnder3k: BuyersGuideSnapshot = {
  box: "as-is", forced: false, citation: "",
  min_pct: 0, min_duration_days: 0, min_miles: 0,
  operating_state: "CT", default_ftc_warranty: "",
};

const used = { condition: "used" };

describe("Buyers Guide auto-publish", () => {
  it("publishes a statute-forced box with no human step", () => {
    const d = evaluateBuyersGuideAutoPublish(ctOver5k, used);
    expect(d.publish).toBe(true);
    expect(d.basis).toBe("statute");
    expect(d.box).toBe("warranty");
  });

  it("publishes a box a named statute selected even when not forced", () => {
    // CT §42-221 exempts a vehicle seven or more model years old; the box is
    // decided by law, so there is nothing for a human to confirm.
    const d = evaluateBuyersGuideAutoPublish(ctAgeExempt, used);
    expect(d.publish).toBe(true);
    expect(d.basis).toBe("statute");
  });

  it("publishes on the dealership's configured default where no statute decides", () => {
    const d = evaluateBuyersGuideAutoPublish(
      { ...ctUnder3k, default_ftc_warranty: "implied", box: "implied" }, used,
    );
    expect(d.publish).toBe(true);
    expect(d.basis).toBe("dealer_default");
  });

  it("HOLDS the one case nobody configured, and says what to set", () => {
    const d = evaluateBuyersGuideAutoPublish(ctUnder3k, used);
    expect(d.publish).toBe(false);
    expect(d.basis).toBe("undetermined");
    expect(d.holds).toContain("BOX_NOT_DETERMINED");
    expect(d.reasons.join(" ")).toMatch(/Default FTC Warranty/);
  });

  it("refuses a Dealer Warranty box with no coverage or term", () => {
    // The form prints a percentage of parts and labour and a term. Publishing
    // with either blank promises coverage without saying how much or how long.
    const noTerms = evaluateBuyersGuideAutoPublish(
      { ...ctOver5k, min_pct: 0 }, used,
    );
    expect(noTerms.holds).toContain("WARRANTY_TERMS_MISSING");
    const noDuration = evaluateBuyersGuideAutoPublish(
      { ...ctOver5k, min_duration_days: 0, min_miles: 0 }, used,
    );
    expect(noDuration.holds).toContain("WARRANTY_TERMS_MISSING");
  });

  it("refuses a new vehicle — 16 CFR 455 governs used vehicles", () => {
    const d = evaluateBuyersGuideAutoPublish(ctOver5k, { condition: "new" });
    expect(d.publish).toBe(false);
    expect(d.holds).toContain("NOT_A_USED_VEHICLE");
  });

  it("treats cpo and the pre-owned spellings as used", () => {
    for (const condition of ["cpo", "certified", "pre-owned", "preowned", "Certified Pre-Owned"]) {
      expect(evaluateBuyersGuideAutoPublish(ctOver5k, { condition }).publish, condition).toBe(true);
    }
  });

  it("never overrides a manager rejection", () => {
    const d = evaluateBuyersGuideAutoPublish(ctOver5k, { ...used, humanRejected: true });
    expect(d.publish).toBe(false);
    expect(d.holds).toContain("HUMAN_REJECTED");
  });

  it("holds on a missing or unrecognised box rather than picking one", () => {
    expect(evaluateBuyersGuideAutoPublish({}, used).holds).toContain("UNKNOWN_BOX");
    expect(evaluateBuyersGuideAutoPublish({ box: "maybe" }, used).holds).toContain("UNKNOWN_BOX");
  });

  it("every hold carries a dealer-actionable reason", () => {
    const d = evaluateBuyersGuideAutoPublish({}, { condition: "new" });
    expect(d.reasons).toHaveLength(d.holds.length);
    for (const r of d.reasons) expect(r.length).toBeGreaterThan(30);
  });
});

describe("isBuyersGuideBox", () => {
  it("accepts exactly the three federal boxes", () => {
    expect(["as-is", "implied", "warranty"].every(isBuyersGuideBox)).toBe(true);
    expect(isBuyersGuideBox("dealer")).toBe(false);
    expect(isBuyersGuideBox(null)).toBe(false);
  });
});
