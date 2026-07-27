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
  kiaEvFixture,
  kiaHybridFixture,
  kiaPhevFixture,
  kiaTellurideFixture,
  kiaTellurideLongFixture,
  lexusFixture,
  mazdaCx90Fixture,
  mazdaLongFixture,
  mazdaMiataFixture,
  mazdaPhevFixture,
  subaruAscentLongFixture,
  subaruOutbackFixture,
  subaruSolterraFixture,
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

describe("Kia profile (kia-us-2026-v1)", () => {
  it("resolves Kia distinctly from Hyundai and Genesis, model-year aware", () => {
    const k = resolveThemeProfile("Kia", 2026);
    const h = resolveThemeProfile("Hyundai", 2026);
    const g = resolveThemeProfile("Genesis", 2026);
    expect(k.profile.themeVersion).toBe("kia-us-2026-v1");
    expect(k.profile.layoutFamily).toBe("korean-mainstream-factory");
    expect(k.profile.status).toBe("draft");
    expect(k.theme.templateFamilyId).not.toBe(h.theme.templateFamilyId);
    expect(k.theme.templateFamilyId).not.toBe(g.theme.templateFamilyId);
    expect(k.profile.themeVersion).not.toBe(h.profile.themeVersion);
    expect(k.profile.themeVersion).not.toBe(g.profile.themeVersion);
    // Outside the approved 2022-2027 range: honest fallback.
    expect(resolveThemeProfile("Kia", 2021).profile.status).toBe("fallback");
    expect(resolveThemeProfile("Kia", 2027).profile.themeVersion).toBe("kia-us-2026-v1");
  });

  const RECONCILED = [
    { name: "Telluride SX AWD", fixture: kiaTellurideFixture, vin: "5XYP5DGC0TG482915", total: "$48,870.00" },
    { name: "Sportage Hybrid", fixture: kiaHybridFixture, vin: "KNDPUDDF3T7420117", total: "$40,740.00" },
    { name: "Sportage PHEV", fixture: kiaPhevFixture, vin: "KNDPVEDF6T7355208", total: "$46,825.00" },
    { name: "EV9 Land AWD", fixture: kiaEvFixture, vin: "KNDADFS56T6104472", total: "$71,840.00" },
  ];
  for (const c of RECONCILED) {
    it(`${c.name} renders reconciled on one page with identity payloads`, () => {
      const data = c.fixture();
      const model = buildRenderLayout(data, themeFor(null));
      const page1 = pageStrings(model, 0);
      expect(model.pages.length).toBe(1);
      expect(page1).toContain(c.total);
      expect(model.drawnStrings).toContain(c.vin);
      const barcode = model.pages[0].primitives.find((p) => p.kind === "barcode");
      expect(barcode && barcode.kind === "barcode" ? barcode.payload : null).toBe(c.vin);
      const qrs = model.pages[0].primitives.filter((p) => p.kind === "qr");
      expect(qrs.some((q) => q.kind === "qr" && q.payload === data.passportUrl)).toBe(true);
      expectWithinBounds(model);
      expectMinFontRespected(model);
    });
  }

  it("Sportage Hybrid keeps the gasoline regulatory shape under the Hybrid Vehicle tag", () => {
    const model = buildRenderLayout(kiaHybridFixture(), themeFor(null));
    const page1 = pageStrings(model, 0);
    expect(page1.some((s) => s.includes("Hybrid Vehicle"))).toBe(true);
    expect(page1).toContain("MPG");
    expect(page1.some((s) => s.includes("MPGe"))).toBe(false);
    expect(page1.some((s) => s.includes("gallons per 100 miles"))).toBe(true);
    expect(page1.some((s) => s.includes("grams CO2"))).toBe(true);
  });

  it("Sportage PHEV uses the plug-in module, never gasoline-only or EV-only language", () => {
    const model = buildRenderLayout(kiaPhevFixture(), themeFor(null));
    const page1 = pageStrings(model, 0);
    expect(page1).toContain("MPGe");
    expect(page1.some((s) => s.includes("miles electric range"))).toBe(true);
    expect(page1.some((s) => s.includes("MPG gasoline only"))).toBe(true);
    expect(page1.some((s) => s.includes("Plug-In Hybrid"))).toBe(true);
    expect(page1.some((s) => s.includes("gallons per 100 miles"))).toBe(false);
    expect(page1.some((s) => s.includes("grams CO2"))).toBe(false);
  });

  it("EV9 uses the EV module with no gasoline content", () => {
    const model = buildRenderLayout(kiaEvFixture(), themeFor(null));
    const page1 = pageStrings(model, 0);
    expect(page1).toContain("MPGe");
    expect(page1.some((s) => s.includes("miles driving range"))).toBe(true);
    expect(page1.some((s) => s.includes("Electric Vehicle"))).toBe(true);
    expect(page1.some((s) => s.includes("gallons per 100 miles"))).toBe(false);
    expect(page1.some((s) => s.includes("grams CO2"))).toBe(false);
  });

  it("Telluride X-Pro long-equipment produces a deliberate continuation page", () => {
    const model = buildRenderLayout(kiaTellurideLongFixture(), themeFor(null));
    expect(model.pages.length).toBe(2);
    expect(pageStrings(model, 0)).toContain("$57,180.00");
    const page2 = pageStrings(model, 1);
    expect(page2).toContain("FACTORY EQUIPMENT CONTINUATION");
    expect(page2).toContain("PAGE 2 OF 2");
    expectMinFontRespected(model);
  });

  it("renders the white-header treatment: no dark header band, ink total band, subtle heading fills", () => {
    const model = buildRenderLayout(kiaTellurideFixture(), themeFor(null));
    const rects = model.pages[0].primitives.filter((p) => p.kind === "rect" && p.fill !== null);
    const fills = new Set(rects.map((r) => (r.kind === "rect" ? String(r.fill) : "")));
    expect(fills.has("#111111")).toBe(true);   // ink total band
    expect(fills.has("#f1f1f1")).toBe(true);   // subtle heading fills
    expect(fills.has("#05141f")).toBe(false);  // retired dark Kia header
    expect(fills.has("#002c5f")).toBe(false);  // never Hyundai navy
    expect(fills.has("#9a7448")).toBe(false);  // never Genesis bronze
  });
});

describe("Mazda profile (mazda-us-2026-v1)", () => {
  it("resolves Mazda into the japanese-factory-technical family, model-year aware", () => {
    const m = resolveThemeProfile("Mazda", 2026);
    expect(m.profile.themeVersion).toBe("mazda-us-2026-v1");
    expect(m.profile.layoutFamily).toBe("japanese-factory-technical");
    expect(m.profile.status).toBe("draft");
    expect(m.theme.templateFamilyId).toBe("JAPANESE_FACTORY");
    expect(resolveThemeProfile("Mazda", 2021).profile.status).toBe("fallback");
  });

  it("CX-90 benchmark reconciles base + options + port + destination on one page", () => {
    const data = mazdaCx90Fixture();
    const model = buildRenderLayout(data, themeFor(null));
    const page1 = pageStrings(model, 0);
    expect(model.pages.length).toBe(1);
    expect(page1).toContain("$60,595.00");
    expect(model.drawnStrings).toContain("JM3KKEHC7T1234567");
    expect(page1.some((s) => s.includes("PORT OF ENTRY OPTIONS"))).toBe(true);
    const barcode = model.pages[0].primitives.find((p) => p.kind === "barcode");
    expect(barcode && barcode.kind === "barcode" ? barcode.payload : null).toBe(data.vin);
    const qrs = model.pages[0].primitives.filter((p) => p.kind === "qr");
    expect(qrs.some((q) => q.kind === "qr" && q.payload === data.passportUrl)).toBe(true);
    expectWithinBounds(model);
    expectMinFontRespected(model);
  });

  it("renders parts content, warranty, ship-to and the MSRP footnote from verified data", () => {
    const model = buildRenderLayout(mazdaCx90Fixture(), themeFor(null));
    const page1 = pageStrings(model, 0);
    expect(page1.some((s) => s.includes("PARTS CONTENT INFORMATION"))).toBe(true);
    expect(page1.some((s) => s.includes("HIROSHIMA, JAPAN"))).toBe(true);
    expect(page1.some((s) => s.includes("NEW VEHICLE LIMITED WARRANTY"))).toBe(true);
    expect(page1.some((s) => s.includes("3-YEAR/36,000-MILE BASIC LIMITED WARRANTY"))).toBe(true);
    expect(page1.some((s) => s.includes("SHIP TO: 00000"))).toBe(true);
    expect(page1.some((s) => s.includes("MAZDA NORTH AMERICAN OPERATIONS"))).toBe(true);
    expect(page1.some((s) => s.includes("MSRP does not include taxes"))).toBe(true);
    expect(page1.some((s) => s.includes("Digitally prepared by AutoLabels.io"))).toBe(true);
  });

  it("uses factory red for rules only, never as a background fill", () => {
    const model = buildRenderLayout(mazdaCx90Fixture(), themeFor(null));
    const prims = model.pages[0].primitives;
    const redRules = prims.filter((p) => p.kind === "rule" && p.color === "#c8102e");
    const redRects = prims.filter((p) => p.kind === "rect" && p.fill === "#c8102e");
    expect(redRules.length).toBeGreaterThan(0);
    expect(redRects.length).toBe(0);
    const rects = new Set(prims.filter((p) => p.kind === "rect" && p.fill !== null).map((p) => (p.kind === "rect" ? String(p.fill) : "")));
    expect(rects.has("#0d0d0d")).toBe(true); // black header band
  });

  it("CX-90 PHEV uses the plug-in module, never gasoline-only or EV-only language", () => {
    const model = buildRenderLayout(mazdaPhevFixture(), themeFor(null));
    const page1 = pageStrings(model, 0);
    expect(page1).toContain("MPGe");
    expect(page1.some((s) => s.includes("miles electric range"))).toBe(true);
    expect(page1.some((s) => s.includes("MPG gasoline only"))).toBe(true);
    expect(page1.some((s) => s.includes("Plug-In Hybrid"))).toBe(true);
    expect(page1.some((s) => s.includes("gallons per 100 miles"))).toBe(false);
    expect(page1.some((s) => s.includes("grams CO2"))).toBe(false);
  });

  it("MX-5 short-content build keeps the factory structure on one page", () => {
    const data = mazdaMiataFixture();
    const model = buildRenderLayout(data, themeFor(null));
    expect(model.pages.length).toBe(1);
    expect(pageStrings(model, 0)).toContain("$41,430.00");
    expect(model.drawnStrings).toContain("JM1NDAM75T0612345");
    expectWithinBounds(model);
    expectMinFontRespected(model);
  });

  it("long-equipment CX-90 produces a deliberate continuation page", () => {
    const model = buildRenderLayout(mazdaLongFixture(), themeFor(null));
    expect(model.pages.length).toBe(2);
    expect(pageStrings(model, 0)).toContain("$67,520.00");
    const page2 = pageStrings(model, 1);
    expect(page2).toContain("FACTORY EQUIPMENT CONTINUATION");
    expect(page2).toContain("PAGE 2 OF 2");
    expectMinFontRespected(model);
  });
});

describe("Subaru profile (subaru-us-2026-v1)", () => {
  it("resolves Subaru into the japanese-factory-technical family with its own version", () => {
    const s = resolveThemeProfile("Subaru", 2026);
    const m = resolveThemeProfile("Mazda", 2026);
    expect(s.profile.themeVersion).toBe("subaru-us-2026-v1");
    expect(s.profile.layoutFamily).toBe("japanese-factory-technical");
    expect(s.profile.status).toBe("draft");
    expect(s.profile.themeVersion).not.toBe(m.profile.themeVersion);
    expect(resolveThemeProfile("Subaru", 2021).profile.status).toBe("fallback");
  });

  it("Outback Touring XT reconciles 42,795 + 3,101 + 1,420 with coded options", () => {
    const data = subaruOutbackFixture();
    const model = buildRenderLayout(data, themeFor(null));
    const page1 = pageStrings(model, 0);
    expect(model.pages.length).toBe(1);
    expect(page1).toContain("$47,316.00");
    expect(model.drawnStrings).toContain("4S4BTGPD0T3456789");
    expect(page1).toContain("32");
    expect(page1).toContain("0H1");
    expect(page1.some((s) => s.includes("SHIP TO: S4102"))).toBe(true);
    expect(page1.some((s) => s.includes("SUBARU DISTRIBUTORS CORP."))).toBe(true);
    expect(page1.some((s) => s.includes("LAFAYETTE, INDIANA, USA"))).toBe(true);
    const barcode = model.pages[0].primitives.find((p) => p.kind === "barcode");
    expect(barcode && barcode.kind === "barcode" ? barcode.payload : null).toBe(data.vin);
    expectWithinBounds(model);
    expectMinFontRespected(model);
  });

  it("Solterra uses the EV module with no gasoline content", () => {
    const model = buildRenderLayout(subaruSolterraFixture(), themeFor(null));
    const page1 = pageStrings(model, 0);
    expect(page1).toContain("MPGe");
    expect(page1.some((s) => s.includes("miles driving range"))).toBe(true);
    expect(page1.some((s) => s.includes("Electric Vehicle"))).toBe(true);
    expect(page1.some((s) => s.includes("gallons per 100 miles"))).toBe(false);
    expect(page1.some((s) => s.includes("grams CO2"))).toBe(false);
    expect(page1.some((s) => s.includes("8-YEAR/100,000-MILE HIGH-VOLTAGE BATTERY LIMITED WARRANTY"))).toBe(true);
  });

  it("Ascent long-equipment produces a deliberate continuation page", () => {
    const model = buildRenderLayout(subaruAscentLongFixture(), themeFor(null));
    expect(model.pages.length).toBe(2);
    expect(pageStrings(model, 0)).toContain("$52,655.00");
    expect(pageStrings(model, 1)).toContain("PAGE 2 OF 2");
    expectMinFontRespected(model);
  });

  it("Mazda and Subaru outputs stay visibly distinct: band fills and keylines differ", () => {
    const paint = (fixture: () => ReturnType<typeof mazdaCx90Fixture>) => {
      const model = buildRenderLayout(fixture(), themeFor(null));
      const prims = model.pages[0].primitives;
      return {
        fills: new Set(prims.filter((p) => p.kind === "rect" && p.fill !== null).map((p) => (p.kind === "rect" ? String(p.fill) : ""))),
        rules: new Set(prims.filter((p) => p.kind === "rule").map((p) => (p.kind === "rule" ? String(p.color) : ""))),
      };
    };
    const mazda = paint(mazdaCx90Fixture);
    const subaru = paint(subaruOutbackFixture);
    expect(mazda.rules.has("#c8102e")).toBe(true);    // Mazda red keyline
    expect(subaru.rules.has("#c8102e")).toBe(false);
    expect(subaru.fills.has("#003b70")).toBe(true);   // Subaru blue band
    expect(mazda.fills.has("#003b70")).toBe(false);
  });
});
