import { describe, it, expect } from "vitest";
import { resolveBuyersGuideForm, usesStateBuyersGuide } from "./buyersGuideForms";

describe("resolveBuyersGuideForm — which official form per state", () => {
  it("routes Wisconsin to its own MV2872 state form", () => {
    const f = resolveBuyersGuideForm("WI");
    expect(f.authority).toBe("state");
    expect(f.formId).toBe("wi-mv2872");
    expect(f.spanishAvailable).toBe(false);
    expect(f.citation).toMatch(/TRANS 139/);
  });

  it("routes Maine to its own 250-C104 state form", () => {
    const f = resolveBuyersGuideForm("me"); // case-insensitive
    expect(f.authority).toBe("state");
    expect(f.formId).toBe("me-250c104");
    expect(f.spanishAvailable).toBe(false);
    expect(f.citation).toMatch(/10 MRSA/);
  });

  it("uses the federal FTC form everywhere else, with the official Spanish option", () => {
    for (const st of ["CA", "TX", "NY", "FL", "CT", "", null, undefined, "ZZ"]) {
      const f = resolveBuyersGuideForm(st);
      expect(f.authority, String(st)).toBe("ftc");
      expect(f.formId, String(st)).toBe("ftc");
      expect(f.spanishAvailable, String(st)).toBe(true);
    }
  });

  it("usesStateBuyersGuide flags only the two exempt states", () => {
    expect(usesStateBuyersGuide("WI")).toBe(true);
    expect(usesStateBuyersGuide("ME")).toBe(true);
    expect(usesStateBuyersGuide("CA")).toBe(false);
    expect(usesStateBuyersGuide("TX")).toBe(false);
  });
});
