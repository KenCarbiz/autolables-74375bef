import { describe, expect, it } from "vitest";
import { OEM_REGISTRY, type OemId } from "./identity";
import { getTheme, TEMPLATE_FAMILY_IDS, THEME_REGISTRY, type OemStickerTheme } from "./themes";

const ALL_IDS = Object.keys(OEM_REGISTRY) as OemId[];
const HEX = /^#[0-9a-f]{6}$/;
const SEMVER = /^\d+\.\d+\.\d+$/;

const assertComplete = (t: OemStickerTheme) => {
  expect(t.oemId).toBeTruthy();
  expect(t.version).toMatch(SEMVER);
  expect(TEMPLATE_FAMILY_IDS).toContain(t.templateFamilyId);
  for (const [k, v] of Object.entries(t.colors)) {
    expect(v, `${t.oemId} colors.${k}`).toMatch(HEX);
  }
  expect(t.logo.wordmarkText.trim().length).toBeGreaterThan(0);
  expect(t.logo.wordmarkLetterSpacing).toMatch(/em$/);
  expect(t.logo.maxWidthPx).toBeGreaterThan(0);
  expect(t.logo.maxHeightPx).toBeGreaterThan(0);
  expect(["TOP_LEFT", "TOP_CENTER", "TOP_RIGHT"]).toContain(t.logo.placement);
  expect(["LEFT", "CENTER", "RIGHT"]).toContain(t.logo.alignment);
  for (const font of [t.typography.headingFont, t.typography.bodyFont, t.typography.numericFont]) {
    expect(font, `${t.oemId} font stack`).toMatch(/sans-serif|serif|monospace/);
  }
  for (const w of [t.typography.headingWeight, t.typography.bodyWeight, t.typography.labelWeight]) {
    expect(w).toBeGreaterThanOrEqual(100);
    expect(w).toBeLessThanOrEqual(900);
  }
  expect(t.typography.letterSpacing).toMatch(/em$/);
  expect(t.typography.headingLetterSpacing).toMatch(/em$/);
  expect(typeof t.typography.uppercaseSectionHeadings).toBe("boolean");
  expect(["BANDED", "RULED", "MINIMAL", "BLOCK"]).toContain(t.layout.headerVariant);
  expect(["BOXED", "BANDED", "RIGHT_RAIL", "UNDERLINED"]).toContain(t.layout.pricingVariant);
  expect(["CODE39", "CODE128", "NONE"]).toContain(t.layout.barcodeVariant);
  expect(["SQUARE", "ROUNDED", "BRANDED_FRAME"]).toContain(t.layout.qrVariant);
  expect(["LEGAL_STRIP", "SPLIT", "MINIMAL"]).toContain(t.layout.footerVariant);
  expect(t.layout.columnGap).toMatch(/pt$/);
  expect(t.layout.borderWeight).toMatch(/pt$/);
  expect(["SQUARE", "ROUNDED_SM", "ROUNDED_MD"]).toContain(t.layout.cornerTreatment);
};

describe("theme registry coverage", () => {
  it("has a complete theme for every registry identity", () => {
    for (const id of ALL_IDS) {
      const t = THEME_REGISTRY[id];
      expect(t, id).toBeDefined();
      expect(t.oemId).toBe(id);
      assertComplete(t);
    }
  });

  it("every template family id is a valid family", () => {
    for (const id of ALL_IDS) {
      expect(TEMPLATE_FAMILY_IDS).toContain(THEME_REGISTRY[id].templateFamilyId);
    }
  });

  it("every theme is versioned 1.0.0 for the first release", () => {
    for (const id of ALL_IDS) expect(THEME_REGISTRY[id].version).toBe("1.0.0");
  });

  it("no theme claims logo usage authorization or a logo asset yet", () => {
    for (const id of ALL_IDS) {
      expect(THEME_REGISTRY[id].logo.usageAuthorized, id).toBe(false);
      expect(THEME_REGISTRY[id].logo.assetId, id).toBeUndefined();
    }
  });

  it("themes are visually distinct (headerBackground + accent pairs are unique)", () => {
    const combos = ALL_IDS.map((id) => {
      const c = THEME_REGISTRY[id].colors;
      return `${c.headerBackground}|${c.accent}`;
    });
    expect(new Set(combos).size).toBe(combos.length);
  });
});

// Pinned per the 2026-07-27 Infiniti factory-template directive (v2):
// charcoal band, muted burgundy accent, luxury-factory composition.
describe("INFINITI theme — pinned tokens", () => {
  const t = THEME_REGISTRY.INFINITI;

  it("is LUXURY_FACTORY", () => {
    expect(t.templateFamilyId).toBe("LUXURY_FACTORY");
  });

  it("uses the charcoal / white palette with the muted burgundy accent", () => {
    expect(t.colors.headerBackground).toBe("#171717");
    expect(t.colors.headerText).toBe("#ffffff");
    expect(t.colors.bodyText).toBe("#2b2b2b");
    expect(t.colors.accent).toBe("#8a1538");
    expect(t.colors.sectionHeadingText).toBe("#1a1a1a");
    expect(t.colors.totalMsrpBackground).toBe("#161616");
    expect(t.colors.totalMsrpText).toBe("#ffffff");
  });

  it("uses tracked uppercase section headings", () => {
    expect(t.typography.headingLetterSpacing).toBe("0.1em");
    expect(t.typography.uppercaseSectionHeadings).toBe(true);
    expect(t.logo.wordmarkLetterSpacing).toBe("0.28em");
  });

  it("uses thin rules and square corners", () => {
    expect(t.layout.borderWeight).toBe("0.75pt");
    expect(t.layout.cornerTreatment).toBe("SQUARE");
  });

  it("keeps the governed wordmark treatment until logo assets are approved", () => {
    expect(t.logo.placement).toBe("TOP_LEFT");
    expect(t.logo.wordmarkText).toBe("INFINITI");
    expect(t.logo.usageAuthorized).toBe(false);
  });
});

describe("getTheme", () => {
  it("returns the brand theme for known ids", () => {
    expect(getTheme("TESLA").oemId).toBe("TESLA");
    expect(getTheme("TESLA").templateFamilyId).toBe("EV_TECHNICAL");
  });

  it("falls back to a complete AUTOLABELS_FALLBACK theme for unknown ids", () => {
    const t = getTheme("MINI");
    expect(t.oemId).toBe("AUTOLABELS_FALLBACK");
    expect(t.templateFamilyId).toBe("AUTOLABELS_FALLBACK");
    assertComplete(t);
  });

  it("fallback theme is premium neutral, not a brand palette", () => {
    const t = getTheme("AUTOLABELS_FALLBACK");
    expect(t.logo.wordmarkText).toBe("AUTOLABELS");
    assertComplete(t);
  });

  it("all ten template families are exercised by the registry", () => {
    const used = new Set(ALL_IDS.map((id) => THEME_REGISTRY[id].templateFamilyId));
    for (const fam of TEMPLATE_FAMILY_IDS) expect([...used], fam).toContain(fam);
  });
});
