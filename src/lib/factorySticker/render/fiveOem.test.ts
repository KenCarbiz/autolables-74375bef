import { describe, expect, it } from "vitest";
import { buildRenderLayout } from "./contract";
import { resolveThemeProfile } from "../oem/profiles";
import {
  bmwFixture,
  chevroletFixture,
  genesisEvFixture,
  genesisG90LongFixture,
  genesisGv80Fixture,
  jeep4xeFixture,
  jeepFixture,
  lexusFixture,
  themeFor,
  toyotaFixture,
} from "./__fixtures__/renderData";
import { expectMinFontRespected, expectWithinBounds, pageStrings } from "./__fixtures__/layoutAsserts";

// Five-OEM design system: one engine, versioned profiles, distinct output.
const CASES = [
  { name: "JEEP", fixture: jeepFixture, vin: "1C4HJXFG5SW551234", total: "$56,205.00", version: "jeep-us-2025-v1" },
  { name: "JEEP", fixture: jeep4xeFixture, vin: "1C4RJYB65SC663421", total: "$72,950.00", version: "jeep-us-2025-v1" },
  { name: "TOYOTA", fixture: toyotaFixture, vin: "5TDAAAB52SS091877", total: "$48,420.00", version: "toyota-us-2025-v1" },
  { name: "LEXUS", fixture: lexusFixture, vin: "JTJAM7BX4S5334120", total: "$85,790.00", version: "lexus-us-2025-v1" },
  { name: "CHEVROLET", fixture: chevroletFixture, vin: "3GCUDDED5SG412209", total: "$55,720.00", version: "chevrolet-us-2025-v1" },
  { name: "BMW", fixture: bmwFixture, vin: "WBA53FJ05SCT44821", total: "$67,725.00", version: "bmw-us-2025-v1" },
];

describe("five-OEM design system", () => {
  for (const c of CASES) {
    it(`${c.name} (${c.vin}) renders with reconciled total and identity`, () => {
      const data = c.fixture();
      const model = buildRenderLayout(data, themeFor(null));
      const page1 = pageStrings(model, 0);
      expect(model.pages.length).toBe(1);
      expect(model.drawnStrings).toContain(c.vin);
      expect(page1).toContain(c.total);
      const barcode = model.pages[0].primitives.find((p) => p.kind === "barcode");
      expect(barcode && barcode.kind === "barcode" ? barcode.payload : null).toBe(c.vin);
      const qrs = model.pages[0].primitives.filter((p) => p.kind === "qr");
      expect(qrs.some((q) => q.kind === "qr" && q.payload === data.passportUrl)).toBe(true);
      const profile = resolveThemeProfile(data.identity.make, Number(data.identity.year));
      expect(profile.profile.themeVersion).toBe(c.version);
      expectWithinBounds(model);
      expectMinFontRespected(model);
    });
  }

  it("Jeep 4xe uses the PHEV regulatory module, never gasoline or EV-only language", () => {
    const model = buildRenderLayout(jeep4xeFixture(), themeFor(null));
    const page1 = pageStrings(model, 0);
    expect(page1).toContain("MPGe");
    expect(page1.some((s) => s.includes("miles electric range"))).toBe(true);
    expect(page1.some((s) => s.includes("MPG gasoline only"))).toBe(true);
    expect(page1.some((s) => s.includes("Plug-In Hybrid"))).toBe(true);
    expect(page1.some((s) => s.includes("gallons per 100 miles"))).toBe(false);
    expect(page1.some((s) => s.includes("grams CO2"))).toBe(false);
  });

  it("BMW keeps option codes secondary to normalized descriptions", () => {
    const model = buildRenderLayout(bmwFixture(), themeFor(null));
    const page1 = pageStrings(model, 0);
    expect(page1).toContain("ZPP");
    expect(page1.some((s) => s.includes("Premium Package"))).toBe(true);
  });

  it("outputs are visibly distinct: band fills differ across profiles", () => {
    const fills = (fixture: () => ReturnType<typeof jeepFixture>): Set<string> => {
      const model = buildRenderLayout(fixture(), themeFor(null));
      return new Set(
        model.pages[0].primitives
          .filter((p) => p.kind === "rect" && p.fill !== null && p.fill !== "#ffffff")
          .map((p) => (p.kind === "rect" ? String(p.fill) : "")),
      );
    };
    const jeep = fills(jeepFixture);
    const toyota = fills(toyotaFixture);
    const chevy = fills(chevroletFixture);
    expect(jeep.has("#565b33")).toBe(true);      // olive total band
    expect(toyota.has("#d3121a")).toBe(true);    // red identity band
    expect(chevy.has("#c9daea")).toBe(true);     // steel-blue identity band
    expect(toyota.has("#565b33")).toBe(false);
    expect(chevy.has("#d3121a")).toBe(false);
  });
});

describe("Genesis profile (genesis-us-2025-v1)", () => {
  it("resolves Genesis distinctly from Hyundai, model-year aware", () => {
    const g = resolveThemeProfile("Genesis", 2025);
    const h = resolveThemeProfile("Hyundai", 2025);
    expect(g.profile.themeVersion).toBe("genesis-us-2025-v1");
    expect(g.profile.layoutFamily).toBe("korean-premium-factory");
    expect(g.profile.status).toBe("draft");
    expect(h.profile.themeVersion).toBe("hyundai-us-2025-v1");
    expect(g.theme.templateFamilyId).not.toBe(h.theme.templateFamilyId);
    // Outside the approved 2023-2026 range: honest fallback, generation preserved.
    expect(resolveThemeProfile("Genesis", 2021).profile.status).toBe("fallback");
  });

  it("GV80 gasoline benchmark renders reconciled on one page", () => {
    const model = buildRenderLayout(genesisGv80Fixture(), themeFor(null));
    const page1 = pageStrings(model, 0);
    expect(model.pages.length).toBe(1);
    expect(page1).toContain("$79,145.00");
    expect(model.drawnStrings).toContain("KMUHCESC5SU301992");
    expectWithinBounds(model);
    expectMinFontRespected(model);
  });

  it("Electrified GV70 uses the EV module with no gasoline content", () => {
    const model = buildRenderLayout(genesisEvFixture(), themeFor(null));
    const page1 = pageStrings(model, 0);
    expect(page1).toContain("MPGe");
    expect(page1.some((s) => s.includes("miles driving range"))).toBe(true);
    expect(page1.some((s) => s.includes("Electric Vehicle"))).toBe(true);
    expect(page1.some((s) => s.includes("gallons per 100 miles"))).toBe(false);
    expect(page1.some((s) => s.includes("grams CO2"))).toBe(false);
  });

  it("G90 long-equipment produces a deliberate continuation page", () => {
    const model = buildRenderLayout(genesisG90LongFixture(), themeFor(null));
    expect(model.pages.length).toBe(2);
    const page1 = pageStrings(model, 0);
    expect(page1).toContain("$97,545.00");
    const page2 = pageStrings(model, 1);
    expect(page2).toContain("FACTORY EQUIPMENT CONTINUATION");
    expect(page2).toContain("PAGE 2 OF 2");
    expectMinFontRespected(model);
  });
});
