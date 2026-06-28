import { describe, it, expect } from "vitest";
import { rewriteForState, renderDisclosurePack } from "./stateRewriter";

const ids = (pack: ReturnType<typeof rewriteForState>) => pack.blocks.map((b) => b.id);
const phrases = (pack: ReturnType<typeof rewriteForState>) => pack.prohibited.map((p) => p.phrase);

describe("rewriteForState — universal rules", () => {
  it("always prohibits the vacated CARS Rule language", () => {
    // The FTC CARS Rule was vacated (5th Cir., Jan 27 2025) — never cite it.
    for (const st of [null, "CA", "NY", "TX"]) {
      const p = rewriteForState(st, { vehicleCondition: "used" });
      expect(phrases(p)).toContain("CARS Act");
      expect(phrases(p)).toContain("CARS Rule");
    }
  });
});

describe("rewriteForState — unknown state (FTC baseline)", () => {
  it("falls back to the FTC baseline with a warning", () => {
    const p = rewriteForState(null, { vehicleCondition: "used" });
    expect(p.state).toBeNull();
    expect(p.warnings.join(" ")).toMatch(/No state rule loaded/i);
    expect(ids(p)).toEqual(expect.arrayContaining(["esign-consent", "ftc-voluntary-addon-consent"]));
  });

  it("includes the FTC Buyers Guide for used but not for new", () => {
    expect(ids(rewriteForState(null, { vehicleCondition: "used" }))).toContain("ftc-buyers-guide-en");
    expect(ids(rewriteForState(null, { vehicleCondition: "new" }))).not.toContain("ftc-buyers-guide-en");
  });
});

describe("rewriteForState — California", () => {
  it("resolves the CA rule and adds the per-item add-on sign-off blocks", () => {
    const p = rewriteForState("CA", { vehicleCondition: "used" });
    expect(p.state).toBe("CA");
    expect(ids(p)).toEqual(expect.arrayContaining([
      "ftc-buyers-guide-en", "esign-consent", "ftc-voluntary-addon-consent",
      "ca-addon-signoff", "ca-voluntary-addons",
    ]));
  });

  it("requires Spanish and adds the Spanish Buyers Guide", () => {
    const p = rewriteForState("CA", { vehicleCondition: "used" });
    expect(p.requiresSpanish).toBe(true);
    expect(ids(p)).toContain("ftc-buyers-guide-es");
  });

  it("adds CA's extra prohibited phrase", () => {
    expect(phrases(rewriteForState("CA", {}))).toContain("mandatory add-on");
  });

  it("warns when the doc fee exceeds the $85 statutory cap", () => {
    const p = rewriteForState("CA", { docFeeAmount: 500 });
    expect(p.warnings.join(" ")).toMatch(/cap of \$85/);
  });

  it("does not warn when the doc fee is within the cap", () => {
    const p = rewriteForState("CA", { vehicleCondition: "used", docFeeAmount: 50 });
    expect(p.warnings).toHaveLength(0);
  });

  it("omits the English Buyers Guide for a new vehicle", () => {
    expect(ids(rewriteForState("CA", { vehicleCondition: "new" }))).not.toContain("ftc-buyers-guide-en");
  });
});

describe("rewriteForState — New York", () => {
  it("adds the NY statutory doc-fee block and prohibits 'dealer fee'", () => {
    const p = rewriteForState("NY", { vehicleCondition: "used" });
    expect(p.state).toBe("NY");
    expect(ids(p)).toContain("ny-doc-fee");
    expect(phrases(p)).toContain("dealer fee");
  });

  it("warns when the doc fee exceeds the $175 cap", () => {
    expect(rewriteForState("NY", { docFeeAmount: 999 }).warnings.join(" ")).toMatch(/cap of \$175/);
  });
});

describe("renderDisclosurePack", () => {
  it("renders a deterministic, human-readable pack", () => {
    const text = renderDisclosurePack(rewriteForState("CA", { vehicleCondition: "used", docFeeAmount: 500 }));
    expect(text).toContain("=== California Disclosure Pack ===");
    expect(text).toContain("REVIEW WARNINGS:");
    expect(text).toContain("DO NOT USE:");
    expect(text).toContain("CARS Act");
  });

  it("omits the warnings section when there are none", () => {
    const text = renderDisclosurePack(rewriteForState("CA", { vehicleCondition: "used", docFeeAmount: 50 }));
    expect(text).not.toContain("REVIEW WARNINGS:");
  });
});
