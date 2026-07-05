import { describe, it, expect } from "vitest";
import { resolveBuyersGuideForm, usesStateBuyersGuide } from "./buyersGuideForms";

describe("resolveBuyersGuideForm — which official form per state", () => {
  it("routes Wisconsin to its own MV2872 state form with the official PDF asset", () => {
    const f = resolveBuyersGuideForm("WI");
    expect(f.authority).toBe("state");
    expect(f.formId).toBe("wi-mv2872");
    expect(f.spanishAvailable).toBe(false);
    expect(f.citation).toMatch(/TRANS 139/);
    expect(f.assetUrl).toBe("/buyers-guides/wi-mv2872.pdf");
  });

  it("routes Maine to its own 250-C104 state form with the official PDF asset", () => {
    const f = resolveBuyersGuideForm("me"); // case-insensitive
    expect(f.authority).toBe("state");
    expect(f.formId).toBe("me-250c104");
    expect(f.spanishAvailable).toBe(false);
    expect(f.citation).toMatch(/10 MRSA/);
    expect(f.assetUrl).toBe("/buyers-guides/me-250c104.pdf");
  });

  it("uses the federal FTC form everywhere else, with the official Spanish option and no state PDF", () => {
    for (const st of ["CA", "TX", "NY", "FL", "CT", "", null, undefined, "ZZ"]) {
      const f = resolveBuyersGuideForm(st);
      expect(f.authority, String(st)).toBe("ftc");
      expect(f.formId, String(st)).toBe("ftc");
      expect(f.spanishAvailable, String(st)).toBe(true);
      expect(f.assetUrl, String(st)).toBeNull();
    }
  });

  it("usesStateBuyersGuide flags only the two exempt states", () => {
    expect(usesStateBuyersGuide("WI")).toBe(true);
    expect(usesStateBuyersGuide("ME")).toBe(true);
    expect(usesStateBuyersGuide("CA")).toBe(false);
    expect(usesStateBuyersGuide("TX")).toBe(false);
  });
});
