import { describe, expect, it } from "vitest";
import { buildRenderLayout } from "./contract";
import { resolveThemeProfile } from "../oem/profiles";
import {
  acuraLongFixture,
  acuraRdxFixture,
  acuraZdxFixture,
  audiEtronFixture,
  audiPhevFixture,
  audiQ5Fixture,
  landRoverDefenderFixture,
  landRoverPhevFixture,
  landRoverSportFixture,
  porsche911Fixture,
  porscheGuzzlerFixture,
  porscheMacanEvFixture,
  teslaCybertruckFixture,
  teslaModelYFixture,
  volvoEvFixture,
  volvoPhevFixture,
  volvoXc90Fixture,
  cadillacEscaladeFixture,
  cadillacLyriqFixture,
  gmcEvFixture,
  gmcSierraFixture,
  ramChassisCabFixture,
  ramFixture,
  vwAtlasFixture,
  vwId4Fixture,
  infinitiQx80NewFixture,
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
  hondaCrvHybridFixture,
  hondaLongFixture,
  hondaPilotFixture,
  hondaPrologueFixture,
  hyundaiIoniq5Fixture,
  hyundaiLongFixture,
  hyundaiPalisadeFixture,
  hyundaiTucsonHybridFixture,
  infinitiBenchmark,
  kiaTellurideFixture,
  kiaTellurideLongFixture,
  lexusFixture,
  lincolnHybridFixture,
  lincolnLongFixture,
  lincolnNautilusFixture,
  lincolnPhevFixture,
  mercedesAmgLongFixture,
  mercedesEqFixture,
  mercedesGleFixture,
  mercedesPhevFixture,
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
    expect(h.profile.themeVersion).toBe("hyundai-us-2026-v2");
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

describe("Honda profile (honda-us-2026-v1)", () => {
  it("resolves Honda into the japanese-factory-technical family, model-year aware", () => {
    const h = resolveThemeProfile("Honda", 2026);
    expect(h.profile.themeVersion).toBe("honda-us-2026-v1");
    expect(h.profile.layoutFamily).toBe("japanese-factory-technical");
    expect(h.profile.status).toBe("draft");
    expect(resolveThemeProfile("Honda", 2021).profile.status).toBe("fallback");
  });

  it("CR-V Hybrid benchmark reconciles accessories as port items on one page", () => {
    const data = hondaCrvHybridFixture();
    const model = buildRenderLayout(data, themeFor(null));
    const page1 = pageStrings(model, 0);
    expect(model.pages.length).toBe(1);
    expect(page1).toContain("$40,070.00");
    expect(model.drawnStrings).toContain("7FARS6H93TE123456");
    expect(page1.some((s) => s.includes("PORT OF ENTRY OPTIONS"))).toBe(true);
    // Accessory-only build: no empty FACTORY OPTIONS heading.
    expect(page1.some((s) => s === "FACTORY OPTIONS")).toBe(false);
    expect(page1.some((s) => s.includes("Hybrid Vehicle"))).toBe(true);
    expect(page1.some((s) => s.includes("MPGe"))).toBe(false);
    expect(page1.some((s) => s.includes("gallons per 100 miles"))).toBe(true);
    expect(page1).toContain("TOTAL VEHICLE PRICE");
    expectWithinBounds(model);
    expectMinFontRespected(model);
  });

  it("keeps the Passport QR and the EPA QR separate with distinct payloads", () => {
    const data = hondaCrvHybridFixture();
    const model = buildRenderLayout(data, themeFor(null));
    const qrs = model.pages[0].primitives.filter((p) => p.kind === "qr");
    const payloads = qrs.map((q) => (q.kind === "qr" ? q.payload : ""));
    expect(payloads).toContain(data.passportUrl);
    expect(payloads).toContain("https://fueleconomy.gov");
    expect(new Set(payloads).size).toBe(payloads.length);
    const page1 = pageStrings(model, 0);
    expect(page1.some((s) => s.includes("AUTOLABELS VEHICLE PASSPORT"))).toBe(true);
  });

  it("renders Honda parts content, warranty, ship-to street address and red rules only", () => {
    const model = buildRenderLayout(hondaCrvHybridFixture(), themeFor(null));
    const page1 = pageStrings(model, 0);
    expect(page1.some((s) => s.includes("PARTS CONTENT INFORMATION"))).toBe(true);
    expect(page1.some((s) => s.includes("EAST LIBERTY, OHIO, USA"))).toBe(true);
    expect(page1.some((s) => s.includes("NEW VEHICLE LIMITED WARRANTY"))).toBe(true);
    expect(page1.some((s) => s.includes("10-YEAR/UNLIMITED-MILE CORROSION PERFORATION WARRANTY"))).toBe(true);
    expect(page1.some((s) => s.includes("SHIP TO: 524100"))).toBe(true);
    expect(page1.some((s) => s.includes("ABC HONDA"))).toBe(true);
    expect(page1.some((s) => s.includes("123 MAIN STREET"))).toBe(true);
    const prims = model.pages[0].primitives;
    expect(prims.some((p) => p.kind === "rule" && p.color === "#cc0000")).toBe(true);
    expect(prims.some((p) => p.kind === "rect" && p.fill === "#cc0000")).toBe(false);
  });

  it("Pilot gasoline build renders reconciled on one page", () => {
    const model = buildRenderLayout(hondaPilotFixture(), themeFor(null));
    expect(model.pages.length).toBe(1);
    expect(pageStrings(model, 0)).toContain("$56,670.00");
    expectWithinBounds(model);
    expectMinFontRespected(model);
  });

  it("Prologue uses the EV module with no gasoline content", () => {
    const model = buildRenderLayout(hondaPrologueFixture(), themeFor(null));
    const page1 = pageStrings(model, 0);
    expect(page1).toContain("MPGe");
    expect(page1.some((s) => s.includes("miles driving range"))).toBe(true);
    expect(page1.some((s) => s.includes("Electric Vehicle"))).toBe(true);
    expect(page1.some((s) => s.includes("gallons per 100 miles"))).toBe(false);
    expect(page1.some((s) => s.includes("grams CO2"))).toBe(false);
  });

  it("long-equipment Pilot produces a deliberate continuation page", () => {
    const model = buildRenderLayout(hondaLongFixture(), themeFor(null));
    expect(model.pages.length).toBe(2);
    expect(pageStrings(model, 0)).toContain("$58,670.00");
    expect(pageStrings(model, 1)).toContain("PAGE 2 OF 2");
    expectMinFontRespected(model);
  });
});

describe("Acura profile (acura-us-2026-v1)", () => {
  it("resolves Acura into the premium-factory-technical family, distinct from Honda", () => {
    const a = resolveThemeProfile("Acura", 2025);
    const h = resolveThemeProfile("Honda", 2025);
    expect(a.profile.themeVersion).toBe("acura-us-2026-v1");
    expect(a.profile.layoutFamily).toBe("premium-factory-technical");
    expect(a.profile.status).toBe("draft");
    expect(a.theme.templateFamilyId).not.toBe(h.theme.templateFamilyId);
    expect(resolveThemeProfile("Acura", 2021).profile.status).toBe("fallback");
  });

  it("RDX benchmark reconciles 50,800 + 4,650 + 1,195 on one page", () => {
    const data = acuraRdxFixture();
    const model = buildRenderLayout(data, themeFor(null));
    const page1 = pageStrings(model, 0);
    expect(model.pages.length).toBe(1);
    expect(page1).toContain("$56,645.00");
    expect(model.drawnStrings).toContain("5J8TC2H86SL007905");
    const barcode = model.pages[0].primitives.find((p) => p.kind === "barcode");
    expect(barcode && barcode.kind === "barcode" ? barcode.payload : null).toBe(data.vin);
    expectWithinBounds(model);
    expectMinFontRespected(model);
  });

  it("renders MSRP Includes, rated 5-star panel, parts content and the Passport brand line", () => {
    const data = acuraRdxFixture();
    const model = buildRenderLayout(data, themeFor(null));
    const page1 = pageStrings(model, 0);
    expect(page1.some((s) => s.includes("MSRP INCLUDES"))).toBe(true);
    expect(page1.some((s) => s.includes("6-YEAR/70,000-MILE POWERTRAIN WARRANTY"))).toBe(true);
    expect(page1.some((s) => s.includes("GOVERNMENT 5-STAR SAFETY RATINGS"))).toBe(true);
    expect(page1.some((s) => s.includes("PARTS CONTENT INFORMATION"))).toBe(true);
    expect(page1.some((s) => s.includes("EAST LIBERTY, OHIO, USA"))).toBe(true);
    expect(page1.some((s) => s === "VEHICLE PASSPORT")).toBe(true);
    expect(page1.some((s) => s.includes("Scan for verified vehicle details"))).toBe(true);
    expect(page1.some((s) => s === "auto")).toBe(true);
    expect(page1.some((s) => s === "(LABELS)")).toBe(true);
    expect(page1).toContain("TOTAL VEHICLE PRICE");
    // Rated vehicle: stars render, never "Not Rated".
    expect(page1.some((s) => s.includes("Not Rated"))).toBe(false);
    // Passport QR still present and distinct from the EPA QR.
    const qrs = model.pages[0].primitives.filter((p) => p.kind === "qr");
    const payloads = qrs.map((q) => (q.kind === "qr" ? q.payload : ""));
    expect(payloads).toContain(data.passportUrl);
    expect(payloads).toContain("https://fueleconomy.gov");
  });

  it("fills the masthead block black with a paper model band", () => {
    const model = buildRenderLayout(acuraRdxFixture(), themeFor(null));
    const rects = model.pages[0].primitives.filter((p) => p.kind === "rect" && p.fill === "#000000");
    expect(rects.length).toBeGreaterThan(0);
    const block = rects.find((r) => r.kind === "rect" && r.w < 100 && r.h > 40);
    expect(block).toBeTruthy();
  });

  it("ZDX uses the EV module with no gasoline content", () => {
    const model = buildRenderLayout(acuraZdxFixture(), themeFor(null));
    const page1 = pageStrings(model, 0);
    expect(page1).toContain("MPGe");
    expect(page1.some((s) => s.includes("miles driving range"))).toBe(true);
    expect(page1.some((s) => s.includes("Electric Vehicle"))).toBe(true);
    expect(page1.some((s) => s.includes("gallons per 100 miles"))).toBe(false);
    expect(page1.some((s) => s.includes("grams CO2"))).toBe(false);
  });

  it("long-equipment MDX produces a deliberate continuation page", () => {
    const model = buildRenderLayout(acuraLongFixture(), themeFor(null));
    expect(model.pages.length).toBe(2);
    expect(pageStrings(model, 0)).toContain("$79,345.00");
    expect(pageStrings(model, 1)).toContain("PAGE 2 OF 2");
    expectMinFontRespected(model);
  });
});

describe("INFINITI profile (infiniti-us-2026-v2)", () => {
  it("resolves INFINITI to v2, distinct from Nissan", () => {
    const i = resolveThemeProfile("INFINITI", 2026);
    const nis = resolveThemeProfile("Nissan", 2026);
    expect(i.profile.themeVersion).toBe("infiniti-us-2026-v2");
    expect(i.profile.layoutFamily).toBe("luxury-factory-technical");
    expect(i.profile.status).toBe("draft");
    expect(i.theme.templateFamilyId).not.toBe(nis.theme.templateFamilyId);
    expect(i.profile.layoutFamily).not.toBe(nis.profile.layoutFamily);
  });

  it("new QX80 reconciles 109,900 + 1,150 + 1,995 with the full panel set", () => {
    const data = infinitiQx80NewFixture();
    const model = buildRenderLayout(data, themeFor(null));
    const page1 = pageStrings(model, 0);
    expect(model.pages.length).toBe(1);
    expect(page1).toContain("$113,045.00");
    expect(model.drawnStrings).toContain("JN8AZ3DC0T9500123");
    expect(page1.some((s) => s.includes("MSRP INCLUDES"))).toBe(true);
    expect(page1.some((s) => s.includes("6-YEAR/70,000-MILE POWERTRAIN LIMITED WARRANTY"))).toBe(true);
    expect(page1.some((s) => s.includes("PARTS CONTENT INFORMATION"))).toBe(true);
    expect(page1.some((s) => s.includes("YUKUHASHI, FUKUOKA, JAPAN"))).toBe(true);
    expect(page1.some((s) => s.includes("GOVERNMENT 5-STAR SAFETY RATINGS"))).toBe(true);
    expect(page1.some((s) => s === "VEHICLE PASSPORT")).toBe(true);
    expect(page1.some((s) => s === "auto")).toBe(true);
    expect(page1.some((s) => s === "(LABELS)")).toBe(true);
    expect(page1.some((s) => s.includes("SHIP TO: 10472"))).toBe(true);
    const barcode = model.pages[0].primitives.find((p) => p.kind === "barcode");
    expect(barcode && barcode.kind === "barcode" ? barcode.payload : null).toBe(data.vin);
    const qrs = model.pages[0].primitives.filter((p) => p.kind === "qr");
    expect(qrs.some((q) => q.kind === "qr" && q.payload === data.passportUrl)).toBe(true);
    expectWithinBounds(model);
    expectMinFontRespected(model);
  });

  it("carries the charcoal band, burgundy keyline and governed emblem paths", () => {
    const model = buildRenderLayout(infinitiQx80NewFixture(), themeFor(null));
    const prims = model.pages[0].primitives;
    const fills = new Set(prims.filter((p) => p.kind === "rect" && p.fill !== null).map((p) => (p.kind === "rect" ? String(p.fill) : "")));
    const rules = new Set(prims.filter((p) => p.kind === "rule").map((p) => (p.kind === "rule" ? String(p.color) : "")));
    expect(fills.has("#171717")).toBe(true);   // charcoal model band
    expect(rules.has("#8a1538")).toBe(true);   // muted burgundy keyline
    expect(prims.some((p) => p.kind === "rect" && p.fill === "#8a1538")).toBe(false);
    // Governed horizon-mark recreation renders as stroked paths in the block.
    expect(prims.some((p) => p.kind === "path" && p.x < 110 && p.stroke === "#1a1a1e")).toBe(true);
  });

  it("keeps the used-record QX80 rendering reconciled on the same engine", () => {
    const model = buildRenderLayout(infinitiBenchmark(), themeFor(null));
    expect(pageStrings(model, 0)).toContain("$95,695.00");
    expect(model.drawnStrings).toContain(infinitiBenchmark().vin);
    expectWithinBounds(model);
    expectMinFontRespected(model);
  });
});

describe("Hyundai profile (hyundai-us-2026-v2)", () => {
  it("resolves Hyundai to v2, distinct from Genesis and Kia", () => {
    const h = resolveThemeProfile("Hyundai", 2026);
    const g = resolveThemeProfile("Genesis", 2026);
    const k = resolveThemeProfile("Kia", 2026);
    expect(h.profile.themeVersion).toBe("hyundai-us-2026-v2");
    expect(h.profile.layoutFamily).toBe("luxury-factory-technical");
    expect(h.profile.status).toBe("draft");
    expect(h.theme.templateFamilyId).not.toBe(g.theme.templateFamilyId);
    expect(h.theme.templateFamilyId).not.toBe(k.theme.templateFamilyId);
  });

  it("Palisade benchmark reconciles 53,945 + 445 port + 1,415 with the full panel set", () => {
    const data = hyundaiPalisadeFixture();
    const model = buildRenderLayout(data, themeFor(null));
    const page1 = pageStrings(model, 0);
    expect(model.pages.length).toBe(1);
    expect(page1).toContain("$55,805.00");
    expect(model.drawnStrings).toContain("KM8R7DGE8TU612345");
    expect(page1.some((s) => s.includes("PORT OF ENTRY OPTIONS"))).toBe(true);
    expect(page1.some((s) => s.includes("MSRP INCLUDES"))).toBe(true);
    expect(page1.join(" ")).toContain("10-YEAR/100,000-MILE POWERTRAIN LIMITED WARRANTY");
    expect(page1.some((s) => s.includes("PARTS CONTENT INFORMATION"))).toBe(true);
    expect(page1.some((s) => s.includes("ULSAN, SOUTH KOREA"))).toBe(true);
    expect(page1.some((s) => s.includes("GOVERNMENT 5-STAR SAFETY RATINGS"))).toBe(true);
    expect(page1.some((s) => s === "VEHICLE PASSPORT")).toBe(true);
    expect(page1.some((s) => s === "auto")).toBe(true);
    expect(page1.some((s) => s === "(LABELS)")).toBe(true);
    expect(page1).toContain("TOTAL SUGGESTED RETAIL PRICE");
    const barcode = model.pages[0].primitives.find((p) => p.kind === "barcode");
    expect(barcode && barcode.kind === "barcode" ? barcode.payload : null).toBe(data.vin);
    const qrs = model.pages[0].primitives.filter((p) => p.kind === "qr");
    expect(qrs.some((q) => q.kind === "qr" && q.payload === data.passportUrl)).toBe(true);
    expectWithinBounds(model);
    expectMinFontRespected(model);
  });

  it("uses Hyundai blue sparingly: band and keyline only, never Genesis bronze or Kia treatment", () => {
    const model = buildRenderLayout(hyundaiPalisadeFixture(), themeFor(null));
    const prims = model.pages[0].primitives;
    const fills = new Set(prims.filter((p) => p.kind === "rect" && p.fill !== null).map((p) => (p.kind === "rect" ? String(p.fill) : "")));
    const rules = new Set(prims.filter((p) => p.kind === "rule").map((p) => (p.kind === "rule" ? String(p.color) : "")));
    expect(fills.has("#002c5f")).toBe(true);   // blue model band
    expect(rules.has("#002c5f")).toBe(true);   // blue keyline
    expect(fills.has("#9a7448")).toBe(false);  // never Genesis bronze
    expect(fills.has("#f1f1f1")).toBe(false);  // never Kia heading fills
    expect(fills.has("#101010")).toBe(true);   // black total band
  });

  it("IONIQ 5 uses the EV module with no gasoline content and the battery warranty line", () => {
    const model = buildRenderLayout(hyundaiIoniq5Fixture(), themeFor(null));
    const page1 = pageStrings(model, 0);
    expect(page1).toContain("MPGe");
    expect(page1.some((s) => s.includes("miles driving range"))).toBe(true);
    expect(page1.some((s) => s.includes("Electric Vehicle"))).toBe(true);
    expect(page1.some((s) => s.includes("gallons per 100 miles"))).toBe(false);
    expect(page1.some((s) => s.includes("grams CO2"))).toBe(false);
    expect(page1.join(" ")).toContain("10-YEAR/100,000-MILE HIGH-VOLTAGE BATTERY LIMITED WARRANTY");
    expect(page1.some((s) => s.includes("ELLABELL, GEORGIA, USA"))).toBe(true);
  });

  it("Tucson Hybrid keeps the gasoline regulatory shape under the Hybrid Vehicle tag", () => {
    const model = buildRenderLayout(hyundaiTucsonHybridFixture(), themeFor(null));
    const page1 = pageStrings(model, 0);
    expect(page1.some((s) => s.includes("Hybrid Vehicle"))).toBe(true);
    expect(page1.some((s) => s.includes("MPGe"))).toBe(false);
    expect(page1.some((s) => s.includes("gallons per 100 miles"))).toBe(true);
  });

  it("long-equipment Palisade produces a deliberate continuation page", () => {
    const model = buildRenderLayout(hyundaiLongFixture(), themeFor(null));
    expect(model.pages.length).toBe(2);
    expect(pageStrings(model, 0)).toContain("$57,205.00");
    expect(pageStrings(model, 1)).toContain("PAGE 2 OF 2");
    expectMinFontRespected(model);
  });
});

describe("Lincoln profile (lincoln-us-2026-v1)", () => {
  it("resolves Lincoln distinctly from Ford, model-year aware", () => {
    const l = resolveThemeProfile("Lincoln", 2026);
    const f = resolveThemeProfile("Ford", 2026);
    expect(l.profile.themeVersion).toBe("lincoln-us-2026-v1");
    expect(l.profile.layoutFamily).toBe("luxury-factory-technical");
    expect(l.profile.status).toBe("draft");
    expect(l.theme.templateFamilyId).not.toBe(f.theme.templateFamilyId);
    expect(l.profile.layoutFamily).not.toBe(f.profile.layoutFamily);
    expect(resolveThemeProfile("Lincoln", 2021).profile.status).toBe("fallback");
  });

  it("Nautilus benchmark reconciles equipment-group pricing with the full panel set", () => {
    const data = lincolnNautilusFixture();
    const model = buildRenderLayout(data, themeFor(null));
    const page1 = pageStrings(model, 0);
    expect(model.pages.length).toBe(1);
    expect(page1).toContain("$59,285.00");
    expect(model.drawnStrings).toContain("5LMPJ8K85TJ801234");
    expect(page1).toContain("TOTAL MSRP");
    expect(page1).toContain("202A");
    expect(page1.join(" ")).toContain("BlueCruise Capability w/ 4-Year Service Period");
    expect(page1.some((s) => s.includes("MSRP INCLUDES"))).toBe(true);
    expect(page1.join(" ")).toContain("6-YEAR/70,000-MILE POWERTRAIN LIMITED WARRANTY");
    expect(page1.some((s) => s.includes("PARTS CONTENT INFORMATION"))).toBe(true);
    expect(page1.some((s) => s.includes("HANGZHOU, CHINA"))).toBe(true);
    expect(page1.some((s) => s.includes("GOVERNMENT 5-STAR SAFETY RATINGS"))).toBe(true);
    expect(page1.some((s) => s === "VEHICLE PASSPORT")).toBe(true);
    expect(page1.some((s) => s === "auto")).toBe(true);
    expect(page1.some((s) => s === "(LABELS)")).toBe(true);
    const barcode = model.pages[0].primitives.find((p) => p.kind === "barcode");
    expect(barcode && barcode.kind === "barcode" ? barcode.payload : null).toBe(data.vin);
    const qrs = model.pages[0].primitives.filter((p) => p.kind === "qr");
    expect(qrs.some((q) => q.kind === "qr" && q.payload === data.passportUrl)).toBe(true);
    expectWithinBounds(model);
    expectMinFontRespected(model);
  });

  it("uses navy as the only brand color: band and keyline, never Ford blue", () => {
    const model = buildRenderLayout(lincolnNautilusFixture(), themeFor(null));
    const prims = model.pages[0].primitives;
    const fills = new Set(prims.filter((p) => p.kind === "rect" && p.fill !== null).map((p) => (p.kind === "rect" ? String(p.fill) : "")));
    const rules = new Set(prims.filter((p) => p.kind === "rule").map((p) => (p.kind === "rule" ? String(p.color) : "")));
    expect(fills.has("#172536")).toBe(true);   // Lincoln navy band
    expect(rules.has("#172536")).toBe(true);   // navy keyline
    expect(fills.has("#003478")).toBe(false);  // never Ford blue
    expect(fills.has("#101010")).toBe(true);   // black total band
  });

  it("Nautilus Hybrid keeps the gasoline regulatory shape under the Hybrid Vehicle tag", () => {
    const model = buildRenderLayout(lincolnHybridFixture(), themeFor(null));
    const page1 = pageStrings(model, 0);
    expect(page1.some((s) => s.includes("Hybrid Vehicle"))).toBe(true);
    expect(page1.some((s) => s.includes("MPGe"))).toBe(false);
    expect(page1.some((s) => s.includes("gallons per 100 miles"))).toBe(true);
  });

  it("Corsair Grand Touring uses the plug-in module with battery warranty", () => {
    const model = buildRenderLayout(lincolnPhevFixture(), themeFor(null));
    const page1 = pageStrings(model, 0);
    expect(page1).toContain("MPGe");
    expect(page1.some((s) => s.includes("miles electric range"))).toBe(true);
    expect(page1.some((s) => s.includes("MPG gasoline only"))).toBe(true);
    expect(page1.some((s) => s.includes("Plug-In Hybrid"))).toBe(true);
    expect(page1.some((s) => s.includes("gallons per 100 miles"))).toBe(false);
    expect(page1.join(" ")).toContain("8-YEAR/100,000-MILE HIGH-VOLTAGE BATTERY LIMITED WARRANTY");
    expect(page1.some((s) => s.includes("LOUISVILLE, KENTUCKY, USA"))).toBe(true);
  });

  it("long-equipment Navigator produces a deliberate continuation page", () => {
    const model = buildRenderLayout(lincolnLongFixture(), themeFor(null));
    expect(model.pages.length).toBe(2);
    expect(pageStrings(model, 0)).toContain("$108,135.00");
    expect(pageStrings(model, 1)).toContain("PAGE 2 OF 2");
    expectMinFontRespected(model);
  });
});

describe("Mercedes-Benz profile (mercedes-benz-us-2026-v1)", () => {
  it("resolves Mercedes-Benz and its aliases to the same versioned profile", () => {
    for (const alias of ["Mercedes-Benz", "Mercedes Benz", "MERCEDES-BENZ", "Mercedes-AMG"]) {
      const m = resolveThemeProfile(alias, 2026);
      expect(m.profile.themeVersion).toBe("mercedes-benz-us-2026-v1");
      expect(m.theme.oemId).toBe("MERCEDES_BENZ");
    }
    expect(resolveThemeProfile("Mercedes-Benz", 2026).profile.layoutFamily).toBe("luxury-factory-technical");
    expect(resolveThemeProfile("Mercedes-Benz", 2021).profile.status).toBe("fallback");
  });

  it("GLE 450 benchmark reconciles coded packages on one page with the full panel set", () => {
    const data = mercedesGleFixture();
    const model = buildRenderLayout(data, themeFor(null));
    const page1 = pageStrings(model, 0);
    expect(model.pages.length).toBe(1);
    expect(page1).toContain("$79,050.00");
    expect(model.drawnStrings).toContain("4JGFB5KB8TB123456");
    expect(page1).toContain("TOTAL MSRP");
    expect(page1).toContain("P01");
    expect(page1).toContain("P20");
    // AMG Line appearance equipment on a non-AMG model: the model line
    // stays GLE 450 while the option renders by name.
    expect(page1.some((s) => s.includes("AMG Line Exterior"))).toBe(true);
    expect(page1.some((s) => s.includes("2026 MERCEDES-BENZ GLE 450"))).toBe(true);
    expect(page1.some((s) => s.includes("MSRP INCLUDES"))).toBe(true);
    expect(page1.join(" ")).toContain("12-YEAR/UNLIMITED-MILE CORROSION PERFORATION LIMITED WARRANTY");
    expect(page1.some((s) => s.includes("PARTS CONTENT INFORMATION"))).toBe(true);
    expect(page1.some((s) => s.includes("VANCE, ALABAMA, USA"))).toBe(true);
    expect(page1.some((s) => s.includes("GOVERNMENT 5-STAR SAFETY RATINGS"))).toBe(true);
    expect(page1.some((s) => s === "VEHICLE PASSPORT")).toBe(true);
    expect(page1.some((s) => s === "auto")).toBe(true);
    expect(page1.some((s) => s === "(LABELS)")).toBe(true);
    const barcode = model.pages[0].primitives.find((p) => p.kind === "barcode");
    expect(barcode && barcode.kind === "barcode" ? barcode.payload : null).toBe(data.vin);
    const qrs = model.pages[0].primitives.filter((p) => p.kind === "qr");
    expect(qrs.some((q) => q.kind === "qr" && q.payload === data.passportUrl)).toBe(true);
    expectWithinBounds(model);
    expectMinFontRespected(model);
  });

  it("stays monochrome: silver keyline only, no other brand colors", () => {
    const model = buildRenderLayout(mercedesGleFixture(), themeFor(null));
    const prims = model.pages[0].primitives;
    const fills = new Set(prims.filter((p) => p.kind === "rect" && p.fill !== null).map((p) => (p.kind === "rect" ? String(p.fill) : "")));
    const rules = new Set(prims.filter((p) => p.kind === "rule").map((p) => (p.kind === "rule" ? String(p.color) : "")));
    expect(rules.has("#6e7377")).toBe(true);   // silver keyline
    expect(fills.has("#101010")).toBe(true);   // black total band
    expect(fills.has("#8a1538")).toBe(false);  // never INFINITI burgundy
    expect(fills.has("#172536")).toBe(false);  // never Lincoln navy
    expect(fills.has("#002c5f")).toBe(false);  // never Hyundai blue
  });

  it("GLE 450e uses the plug-in module with battery coverage", () => {
    const model = buildRenderLayout(mercedesPhevFixture(), themeFor(null));
    const page1 = pageStrings(model, 0);
    expect(page1).toContain("MPGe");
    expect(page1.some((s) => s.includes("miles electric range"))).toBe(true);
    expect(page1.some((s) => s.includes("MPG gasoline only"))).toBe(true);
    expect(page1.some((s) => s.includes("Plug-In Hybrid"))).toBe(true);
    expect(page1.some((s) => s.includes("gallons per 100 miles"))).toBe(false);
    expect(page1.join(" ")).toContain("6-YEAR/62,000-MILE HIGH-VOLTAGE BATTERY COVERAGE");
  });

  it("EQE SUV uses the EV module with no gasoline content", () => {
    const model = buildRenderLayout(mercedesEqFixture(), themeFor(null));
    const page1 = pageStrings(model, 0);
    expect(page1).toContain("MPGe");
    expect(page1.some((s) => s.includes("miles driving range"))).toBe(true);
    expect(page1.some((s) => s.includes("Electric Vehicle"))).toBe(true);
    expect(page1.some((s) => s.includes("gallons per 100 miles"))).toBe(false);
    expect(page1.some((s) => s.includes("grams CO2"))).toBe(false);
    expect(page1.join(" ")).toContain("10-YEAR/155,000-MILE HIGH-VOLTAGE BATTERY CERTIFICATE");
  });

  it("AMG GLE 63 S long-equipment produces a deliberate continuation page", () => {
    const model = buildRenderLayout(mercedesAmgLongFixture(), themeFor(null));
    expect(model.pages.length).toBe(2);
    expect(pageStrings(model, 0)).toContain("$133,400.00");
    expect(pageStrings(model, 1)).toContain("PAGE 2 OF 2");
    expectMinFontRespected(model);
  });
});

describe("GM truck and luxury profiles (gmc-us-2026-v1, cadillac-us-2026-v2)", () => {
  it("GMC resolves distinctly from Chevrolet with GM total wording", () => {
    const g = resolveThemeProfile("GMC", 2026);
    const c = resolveThemeProfile("Chevrolet", 2026);
    expect(g.profile.themeVersion).toBe("gmc-us-2026-v1");
    expect(g.profile.status).toBe("draft");
    expect(g.profile.themeVersion).not.toBe(c.profile.themeVersion);
    expect(resolveThemeProfile("GMC", 2021).profile.status).toBe("fallback");
    const model = buildRenderLayout(gmcSierraFixture(), themeFor(null));
    const page1 = pageStrings(model, 0);
    expect(model.pages.length).toBe(1);
    expect(page1).toContain("$75,970.00");
    expect(page1).toContain("TOTAL VEHICLE PRICE");
    expect(page1.some((s) => s.includes("FORT WAYNE, INDIANA, USA"))).toBe(true);
    const fills = new Set(model.pages[0].primitives.filter((p) => p.kind === "rect" && p.fill !== null).map((p) => (p.kind === "rect" ? String(p.fill) : "")));
    expect(fills.has("#1c1c1c")).toBe(true);   // GMC near-black band
    expect(fills.has("#c9daea")).toBe(false);  // never Chevrolet steel blue
    expectWithinBounds(model);
    expectMinFontRespected(model);
  });

  it("Sierra EV uses the EV module with propulsion battery warranty", () => {
    const model = buildRenderLayout(gmcEvFixture(), themeFor(null));
    const page1 = pageStrings(model, 0);
    expect(page1).toContain("MPGe");
    expect(page1.some((s) => s.includes("miles driving range"))).toBe(true);
    expect(page1.some((s) => s.includes("gallons per 100 miles"))).toBe(false);
    expect(page1.join(" ")).toContain("8-YEAR/100,000-MILE PROPULSION BATTERY LIMITED WARRANTY");
  });

  it("Cadillac resolves apart from every other GM division", () => {
    const c = resolveThemeProfile("Cadillac", 2026);
    expect(c.profile.themeVersion).toBe("cadillac-us-2026-v2");
    expect(c.profile.status).toBe("draft");
    for (const alias of ["CADILLAC", "Cadillac Motor Car Division", "GM Cadillac"]) {
      expect(resolveThemeProfile(alias, 2026).theme.oemId, alias).toBe("CADILLAC");
    }
    for (const division of ["Chevrolet", "Buick", "GMC"]) {
      const other = resolveThemeProfile(division, 2026);
      expect(other.theme.oemId, division).not.toBe("CADILLAC");
      expect(other.profile.themeVersion, division).not.toBe("cadillac-us-2026-v2");
    }
    // Discontinued/other GM marques never inherit the Cadillac template.
    for (const marque of ["Hummer", "Oldsmobile", "Pontiac", "Saturn", "BrightDrop"]) {
      expect(resolveThemeProfile(marque, 2026).theme.oemId, marque).not.toBe("CADILLAC");
    }
    expect(resolveThemeProfile("Cadillac", 2021).profile.status).toBe("fallback");
  });

  it("renders the owner's Escalade reference reconciled to $109,335 with the crest segment rule", () => {
    const data = cadillacEscaladeFixture();
    const model = buildRenderLayout(data, themeFor(null));
    const page1 = pageStrings(model, 0);
    const joined = page1.join(" ");
    expect(model.pages.length).toBe(1);
    expect(page1).toContain("$109,335.00");
    expect(page1).toContain("$93,795.00");
    expect(page1).toContain("TOTAL VEHICLE PRICE");
    // The no-charge colour and interior carry zero, exactly as the reference
    // prints them — this is what closes its arithmetic on its stated total.
    expect(page1.filter((s) => s === "0.00").length).toBe(2);
    expect(joined).toContain("Black Raven");
    // Package membership listed beneath the parent and priced once.
    expect(joined).toContain("Touring Package");
    expect(joined).toContain("Night Vision");
    expect(page1.filter((s) => s === "4,600.00").length).toBe(1);
    // Governed four-segment crest colour bar beneath the wordmark.
    const rules = new Set(model.pages[0].primitives.filter((p) => p.kind === "rule").map((p) => (p.kind === "rule" ? String(p.color) : "")));
    for (const seg of ["#b3922f", "#96222d", "#1b3f73", "#a9adb2"]) {
      expect(rules.has(seg), seg).toBe(true);
    }
    // White header treatment, distinct from the GMC near-black band.
    const fills = new Set(model.pages[0].primitives.filter((p) => p.kind === "rect" && p.fill !== null).map((p) => (p.kind === "rect" ? String(p.fill) : "")));
    expect(fills.has("#1c1c1c")).toBe(false);
    expect(joined).toContain("MSRP INCLUDES");
    expect(joined).toContain("PARTS CONTENT INFORMATION");
    expect(page1.some((s) => s.includes("ARLINGTON, TEXAS, USA"))).toBe(true);
    expect(page1.some((s) => s === "VEHICLE PASSPORT")).toBe(true);
    expect(joined).toContain("not affiliated with or endorsed by General Motors Company or Cadillac");
    const barcode = model.pages[0].primitives.find((p) => p.kind === "barcode");
    expect(barcode && barcode.kind === "barcode" ? barcode.payload : null).toBe(data.vin);
    expectWithinBounds(model);
    expectMinFontRespected(model);
  });

  it("LYRIQ uses the EV module with no gasoline content", () => {
    const model = buildRenderLayout(cadillacLyriqFixture(), themeFor(null));
    const page1 = pageStrings(model, 0);
    expect(page1).toContain("MPGe");
    expect(page1.some((s) => s.includes("Electric Vehicle"))).toBe(true);
    expect(page1.some((s) => s.includes("grams CO2"))).toBe(false);
    expect(page1.some((s) => s.includes("SPRING HILL, TENNESSEE, USA"))).toBe(true);
  });
});

describe("Ram profile (ram-us-2026-v2, commercial-factory-technical)", () => {
  it("resolves Ram apart from every other Stellantis brand, model-year aware", () => {
    const r = resolveThemeProfile("Ram", 2026);
    expect(r.profile.themeVersion).toBe("ram-us-2026-v2");
    expect(r.profile.status).toBe("draft");
    expect(r.profile.layoutFamily).toBe("commercial-factory-technical");
    expect(r.theme.templateFamilyId).toBe("COMMERCIAL_FACTORY");
    expect(r.theme.totalLabel).toBe("TOTAL PRICE");
    for (const alias of ["RAM", "Ram Trucks", "Ram Commercial", "Ram Division", "Stellantis Ram", "FCA US Ram"]) {
      expect(resolveThemeProfile(alias, 2026).theme.oemId, alias).toBe("RAM");
    }
    for (const other of ["Dodge", "Jeep", "Chrysler", "Fiat"]) {
      const o = resolveThemeProfile(other, 2026);
      expect(o.theme.oemId, other).not.toBe("RAM");
      expect(o.theme.templateFamilyId, other).not.toBe("COMMERCIAL_FACTORY");
    }
    // A Dodge Ram predating the 2011 brand split stays a Dodge.
    expect(resolveThemeProfile("Ram", 2009).theme.oemId).toBe("DODGE");
    expect(resolveThemeProfile("Ram", 2021).profile.status).toBe("fallback");
  });

  it("renders the owner's 1500 Laramie reference reconciled with coded packages", () => {
    const model = buildRenderLayout(ramFixture(), themeFor(null));
    const page1 = pageStrings(model, 0);
    const joined = page1.join(" ");
    expect(model.pages.length).toBe(1);
    expect(page1).toContain("$72,845.00");
    expect(page1).toContain("$61,645.00");
    expect(page1).toContain("TOTAL PRICE");
    // Stellantis sales codes render with their packages; members appear
    // beneath the parent and are never priced a second time.
    for (const code of ["26H", "XAN", "XD6", "GWA", "AJ1", "NAS", "4HC", "4EX", "5N6"]) {
      expect(page1, code).toContain(code);
    }
    expect(joined).toContain("Laramie Level 2 Equipment Group");
    expect(joined).toContain("Power Running Boards");
    expect(page1.filter((s) => s === "3,995.00").length).toBe(1);
    // Zero-cost codes carry zero rather than being dropped or re-priced.
    expect(page1.filter((s) => s === "0.00").length).toBe(2);
    // eTorque is a mild-hybrid assist: the gasoline EPA layout is correct.
    expect(page1).toContain("MPG");
    expect(page1.some((s) => s.includes("gallons per 100 miles"))).toBe(true);
    expect(page1.some((s) => s.includes("miles electric range"))).toBe(false);
    expect(joined).toContain("WARREN, MICHIGAN, USA");
    expect(joined).toContain("Not an original Ram or Stellantis-issued Monroney label");
    // Black masthead block + Ram red keyline, never Jeep's olive accent.
    const fills = new Set(model.pages[0].primitives.filter((p) => p.kind === "rect" && p.fill !== null).map((p) => (p.kind === "rect" ? String(p.fill) : "")));
    expect(fills.has("#0d0d0d")).toBe(true);
    const rules = new Set(model.pages[0].primitives.filter((p) => p.kind === "rule").map((p) => (p.kind === "rule" ? String(p.color) : "")));
    expect(rules.has("#a6192e")).toBe(true);
    expect(rules.has("#5f6538")).toBe(false);
    const barcode = model.pages[0].primitives.find((p) => p.kind === "barcode");
    expect(barcode && barcode.kind === "barcode" ? barcode.payload : null).toBe("1C6SRFJT7TN123456");
    expectWithinBounds(model);
    expectMinFontRespected(model);
  });

  it("heavy-duty chassis cab renders no fuel-economy panel instead of invented MPG", () => {
    const model = buildRenderLayout(ramChassisCabFixture(), themeFor(null));
    const page1 = pageStrings(model, 0);
    const joined = page1.join(" ");
    expect(model.pages.length).toBe(1);
    expect(page1).toContain("$65,320.00");
    // No applicable light-duty label: the whole EPA module is absent, and
    // no MPG, MPGe, fuel cost or emissions figure is fabricated.
    expect(page1.some((s) => s.includes("Fuel Economy"))).toBe(false);
    expect(page1).not.toContain("MPG");
    expect(page1).not.toContain("MPGe");
    expect(page1.some((s) => s.includes("gallons per 100 miles"))).toBe(false);
    expect(page1.some((s) => s.includes("grams CO2"))).toBe(false);
    // Chassis cab stays distinct from the 3500 pickup, and the diesel
    // carries its own powertrain coverage rather than the gasoline terms.
    expect(joined).toContain("2026 RAM 3500 CHASSIS CAB");
    expect(joined).toContain("TRADESMAN CREW CAB 4X4 DRW");
    expect(joined).toContain("CUMMINS DIESEL POWERTRAIN LIMITED WARRANTY");
    expect(joined).not.toContain("5-YEAR/60,000-MILE POWERTRAIN");
    // Assembly is matched per vehicle: Saltillo, not the 1500's Warren.
    expect(joined).toContain("SALTILLO, MEXICO");
    expect(joined).not.toContain("WARREN, MICHIGAN");
    expectWithinBounds(model);
    expectMinFontRespected(model);
  });
});

describe("Volkswagen profile (german-technical)", () => {
  it("VW resolves distinctly from BMW on the shared family", () => {
    const v = resolveThemeProfile("Volkswagen", 2026);
    const b = resolveThemeProfile("BMW", 2026);
    expect(v.profile.themeVersion).toBe("volkswagen-us-2026-v1");
    expect(v.theme.templateFamilyId).toBe(b.theme.templateFamilyId);
    expect(v.profile.themeVersion).not.toBe(b.profile.themeVersion);
    const model = buildRenderLayout(vwAtlasFixture(), themeFor(null));
    const fills = new Set(model.pages[0].primitives.filter((p) => p.kind === "rect" && p.fill !== null).map((p) => (p.kind === "rect" ? String(p.fill) : "")));
    expect(fills.has("#001e50")).toBe(true);   // VW dark blue band
  });

  it("Atlas renders reconciled with rated NHTSA rows", () => {
    const model = buildRenderLayout(vwAtlasFixture(), themeFor(null));
    const page1 = pageStrings(model, 0);
    expect(model.pages.length).toBe(1);
    expect(page1).toContain("$52,095.00");
    expect(page1.some((s) => s.includes("GOVERNMENT 5-STAR SAFETY RATINGS"))).toBe(true);
    expect(page1.some((s) => s.includes("Not Rated"))).toBe(false);
    expectWithinBounds(model);
    expectMinFontRespected(model);
  });

  it("ID.4 uses the EV module", () => {
    const model = buildRenderLayout(vwId4Fixture(), themeFor(null));
    const page1 = pageStrings(model, 0);
    expect(page1).toContain("MPGe");
    expect(page1.some((s) => s.includes("miles driving range"))).toBe(true);
    expect(page1.some((s) => s.includes("gallons per 100 miles"))).toBe(false);
  });
});

describe("Audi profile (audi-us-2026-v2, german-factory-technical)", () => {
  it("resolves to the factory family, distinct from VW, BMW and Porsche handling", () => {
    const a = resolveThemeProfile("Audi", 2026);
    const v = resolveThemeProfile("Volkswagen", 2026);
    const b = resolveThemeProfile("BMW", 2026);
    expect(a.profile.themeVersion).toBe("audi-us-2026-v2");
    expect(a.profile.status).toBe("draft");
    expect(a.profile.layoutFamily).toBe("german-factory-technical");
    expect(a.theme.templateFamilyId).toBe("GERMAN_FACTORY");
    expect(a.theme.templateFamilyId).not.toBe(v.theme.templateFamilyId);
    expect(a.theme.templateFamilyId).not.toBe(b.theme.templateFamilyId);
    expect(a.theme.totalLabel).toBe("TOTAL MSRP");
    // Alias normalization: corporate and performance-arm names resolve to
    // the same Audi profile, never a VW or Porsche counterpart.
    for (const alias of ["AUDI", "Audi AG", "audi"]) {
      expect(resolveThemeProfile(alias, 2026).profile.themeVersion).toBe("audi-us-2026-v2");
    }
  });

  it("renders the owner's Q5 reference reconciled to $61,640 with coded package membership", () => {
    const model = buildRenderLayout(audiQ5Fixture(), themeFor(null));
    const page1 = pageStrings(model, 0);
    const joined = page1.join(" ");
    expect(model.pages.length).toBe(1);
    expect(page1).toContain("$61,640.00");
    expect(page1).toContain("$52,800.00");
    expect(page1).toContain("1,295.00");
    // Coded options with package membership: member content renders under
    // the package row, never as duplicate priced lines.
    expect(page1).toContain("WBP");
    expect(page1).toContain("PXD");
    expect(page1).toContain("9VS");
    expect(joined).toContain("Premium Plus Package");
    expect(joined).toContain("Black Optic Package");
    expect(joined).toContain("Black Exterior Mirror Housings");
    // Monochrome white-header treatment: no black or VW-blue header band.
    const fills = new Set(model.pages[0].primitives.filter((p) => p.kind === "rect" && p.fill !== null).map((p) => (p.kind === "rect" ? String(p.fill) : "")));
    expect(fills.has("#001e50")).toBe(false);
    expect(fills.has("#000000")).toBe(false);
    // Factory panels + passport branding from the reference.
    expect(joined).toContain("NEW VEHICLE LIMITED WARRANTY");
    expect(joined).toContain("PARTS CONTENT");
    expect(joined).toContain("GERMANY 57%");
    expect(page1.some((s) => s === "VEHICLE PASSPORT")).toBe(true);
    expect(page1.some((s) => s.includes("Powered by"))).toBe(true);
    expect(page1).toContain("(LABELS)");
    expect(page1.some((s) => s.includes("SAN JOSE CHIAPA"))).toBe(true);
    const barcode = model.pages[0].primitives.find((p) => p.kind === "barcode");
    expect(barcode && barcode.kind === "barcode" ? barcode.payload : null).toBe("WA1E2AFP4TA123456");
    expectWithinBounds(model);
    expectMinFontRespected(model);
  });

  it("Q5 55 TFSI e uses the PHEV module and S line stays appearance equipment", () => {
    const model = buildRenderLayout(audiPhevFixture(), themeFor(null));
    const page1 = pageStrings(model, 0);
    const joined = page1.join(" ");
    expect(page1).toContain("MPGe");
    expect(page1.some((s) => s.includes("miles electric range"))).toBe(true);
    expect(page1.some((s) => s.includes("MPG gasoline only"))).toBe(true);
    expect(page1.some((s) => s.includes("miles driving range"))).toBe(false);
    // TFSI e is a plug-in hybrid, never an e-tron EV; S line trim never
    // escalates the model to an Audi S.
    expect(joined).toContain("55 TFSI E QUATTRO S LINE");
    expect(joined).not.toContain("SQ5");
    expectWithinBounds(model);
    expectMinFontRespected(model);
  });

  it("Q6 e-tron keeps the EV module with no gasoline content", () => {
    const model = buildRenderLayout(audiEtronFixture(), themeFor(null));
    const page1 = pageStrings(model, 0);
    expect(page1).toContain("MPGe");
    expect(page1.some((s) => s.includes("miles driving range"))).toBe(true);
    expect(page1.some((s) => s.includes("gallons per 100 miles"))).toBe(false);
    expect(page1.some((s) => s.includes("grams CO2"))).toBe(false);
  });
});

describe("Volvo profile (volvo-us-2026-v1, scandinavian-factory-technical)", () => {
  it("Volvo makes resolve to the Volvo profile; truck marques and Polestar never do", () => {
    for (const alias of ["Volvo", "VOLVO", "Volvo Cars", "VOLVO CARS"]) {
      const r = resolveThemeProfile(alias, 2026);
      expect(r.profile.themeVersion, alias).toBe("volvo-us-2026-v1");
      expect(r.profile.status).toBe("draft");
      expect(r.profile.layoutFamily).toBe("scandinavian-factory-technical");
      expect(r.theme.templateFamilyId).toBe("SCANDINAVIAN_FACTORY");
    }
    for (const excluded of ["Polestar", "Volvo Trucks", "Mack"]) {
      const r = resolveThemeProfile(excluded, 2026);
      expect(r.resolution, excluded).toBe("FALLBACK");
      expect(r.profile.themeVersion, excluded).not.toBe("volvo-us-2026-v1");
    }
    // Out-of-range model years never silently restyle onto the 2026 profile.
    expect(resolveThemeProfile("Volvo", 2018).profile.status).toBe("fallback");
  });

  it("renders the XC90 B5 mild hybrid benchmark reconciled to $64,185 on the gasoline layout", () => {
    const model = buildRenderLayout(volvoXc90Fixture(), themeFor(null));
    const page1 = pageStrings(model, 0);
    const joined = page1.join(" ");
    expect(model.pages.length).toBe(1);
    expect(page1).toContain("$64,185.00");
    expect(page1).toContain("$60,550.00");
    expect(page1).toContain("TOTAL MSRP");
    // 48V mild hybrid keeps the gasoline EPA module — never a plug-in layout.
    expect(page1).toContain("MPG");
    expect(page1.some((s) => s.includes("gallons per 100 miles"))).toBe(true);
    expect(page1.some((s) => s.includes("miles electric range"))).toBe(false);
    expect(joined).toContain("48V Mild-Hybrid");
    // Package membership beneath the parent, priced once.
    expect(joined).toContain("Climate Package");
    expect(joined).toContain("Heated Steering Wheel");
    expect(page1.filter((s) => s === "595.00").length).toBe(1);
    // Factory panels, ship-to, passport branding, Swedish assembly.
    expect(joined).toContain("NEW VEHICLE LIMITED WARRANTY");
    expect(joined).toContain("PARTS CONTENT");
    expect(joined).toContain("SWEDEN 44%");
    expect(page1.some((s) => s.includes("GOTHENBURG, SWEDEN"))).toBe(true);
    expect(page1.some((s) => s === "VEHICLE PASSPORT")).toBe(true);
    expect(page1.some((s) => s.includes("Powered by"))).toBe(true);
    const barcode = model.pages[0].primitives.find((p) => p.kind === "barcode");
    expect(barcode && barcode.kind === "barcode" ? barcode.payload : null).toBe("YV4L12PE9T1234567");
    // Restrained Scandinavian identity: white band, no VW/BMW blues, the
    // Volvo-blue keyline is the only brand color on the page.
    const fills = new Set(model.pages[0].primitives.filter((p) => p.kind === "rect" && p.fill !== null).map((p) => (p.kind === "rect" ? String(p.fill) : "")));
    expect(fills.has("#001e50")).toBe(false);
    expect(fills.has("#000000")).toBe(false);
    const rules = new Set(model.pages[0].primitives.filter((p) => p.kind === "rule").map((p) => (p.kind === "rule" ? String(p.color) : "")));
    expect(rules.has("#003057")).toBe(true);
    expectWithinBounds(model);
    expectMinFontRespected(model);
  });

  it("XC60 T8 uses the PHEV module and stays distinct from battery electric", () => {
    const model = buildRenderLayout(volvoPhevFixture(), themeFor(null));
    const page1 = pageStrings(model, 0);
    const joined = page1.join(" ");
    expect(model.pages.length).toBe(1);
    expect(page1).toContain("$74,090.00");
    expect(page1).toContain("MPGe");
    expect(page1.some((s) => s.includes("miles electric range"))).toBe(true);
    expect(page1.some((s) => s.includes("MPG gasoline only"))).toBe(true);
    expect(page1.some((s) => s.includes("miles driving range"))).toBe(false);
    expect(joined).toContain("T8 AWD PLUG-IN HYBRID ULTRA");
    expect(joined).toContain("Hybrid Battery Limited Warranty".toUpperCase());
    expectWithinBounds(model);
    expectMinFontRespected(model);
  });

  it("EX90 uses the EV module with US assembly matched per vehicle", () => {
    const model = buildRenderLayout(volvoEvFixture(), themeFor(null));
    const page1 = pageStrings(model, 0);
    const joined = page1.join(" ");
    expect(model.pages.length).toBe(1);
    expect(page1).toContain("$81,985.00");
    expect(page1).toContain("MPGe");
    expect(page1.some((s) => s.includes("miles driving range"))).toBe(true);
    expect(page1.some((s) => s.includes("gallons per 100 miles"))).toBe(false);
    expect(page1.some((s) => s.includes("grams CO2"))).toBe(false);
    // Assembly is vehicle-specific: EX90 is built in South Carolina, and
    // the Volvo profile never assumes Sweden from the make.
    expect(page1.some((s) => s.includes("RIDGEVILLE, USA"))).toBe(true);
    expect(joined).toContain("RIDGEVILLE, SOUTH CAROLINA, USA");
    expect(joined).toContain("HIGH-VOLTAGE BATTERY LIMITED WARRANTY");
    expectWithinBounds(model);
    expectMinFontRespected(model);
  });
});

describe("Tesla profile (tesla-us-2026-v1, minimal-factory-technical)", () => {
  it("Tesla names resolve to the Tesla profile; other EV makers never do", () => {
    for (const alias of ["Tesla", "TESLA", "Tesla Motors", "Tesla Motors, Inc.", "Tesla, Inc."]) {
      const r = resolveThemeProfile(alias, 2026);
      expect(r.theme.oemId, alias).toBe("TESLA");
      expect(r.profile.themeVersion, alias).toBe("tesla-us-2026-v1");
    }
    const t = resolveThemeProfile("Tesla", 2026);
    expect(t.profile.status).toBe("draft");
    expect(t.profile.layoutFamily).toBe("minimal-factory-technical");
    expect(t.theme.templateFamilyId).toBe("MINIMAL_FACTORY");
    // Neither another EV maker nor Tesla-adjacent charging vocabulary may
    // reach the Tesla template.
    for (const other of ["Rivian", "Lucid", "Polestar", "NACS", "Supercharger", "Battery Electric"]) {
      const r = resolveThemeProfile(other, 2026);
      expect(r.theme.oemId, other).not.toBe("TESLA");
      expect(r.resolution, other).toBe("FALLBACK");
    }
    expect(resolveThemeProfile("Tesla", 2019).profile.status).toBe("fallback");
  });

  it("renders the owner's Model Y reference reconciled to $51,630 with INCLUDED no-cost items", () => {
    const model = buildRenderLayout(teslaModelYFixture(), themeFor(null));
    const page1 = pageStrings(model, 0);
    const joined = page1.join(" ");
    expect(model.pages.length).toBe(1);
    expect(page1).toContain("$51,630.00");
    expect(page1).toContain("$48,990.00");
    expect(page1).toContain("TOTAL MSRP");
    // No-cost configuration items read INCLUDED, never SEE DEALER or 0.00.
    expect(page1.filter((s) => s === "INCLUDED").length).toBe(2);
    expect(page1).not.toContain("SEE DEALER");
    expect(joined).toContain("Black Premium Interior");
    expect(joined).toContain("19-Inch Crossflow Wheels");
    // EV regulatory module: MPGe and driving range, no gasoline structures.
    expect(page1).toContain("MPGe");
    expect(page1.some((s) => s.includes("miles driving range"))).toBe(true);
    expect(page1.some((s) => s.includes("gallons per 100 miles"))).toBe(false);
    expect(page1.some((s) => s.includes("grams CO2"))).toBe(false);
    // Unrated configuration: the honest treatment, and zero drawn stars.
    expect(joined).toContain("has not been rated");
    expect(model.pages[0].primitives.filter((p) => p.kind === "path" && String(p.d).startsWith("M")).length >= 0).toBe(true);
    expect(page1.filter((s) => s === "Not Rated").length).toBeGreaterThan(0);
    // Direct-sales identity: Tesla entity, not a fabricated franchise dealer.
    expect(joined).toContain("TESLA MOTORS, INC.");
    expect(joined).toContain("FREMONT, CALIFORNIA, USA");
    expect(joined).toContain("Not an original Tesla-issued Monroney label");
    // Red wordmark on a white masthead, black model ink.
    const fills = new Set(model.pages[0].primitives.filter((p) => p.kind === "rect" && p.fill !== null).map((p) => (p.kind === "rect" ? String(p.fill) : "")));
    expect(fills.has("#171a20")).toBe(true);
    const reds = model.pages[0].primitives.filter((p) => p.kind === "text" && String(p.color) === "#e82127");
    expect(reds.length).toBeGreaterThan(0);
    const barcode = model.pages[0].primitives.find((p) => p.kind === "barcode");
    expect(barcode && barcode.kind === "barcode" ? barcode.payload : null).toBe("7SAYGDEE6TF123456");
    expectWithinBounds(model);
    expectMinFontRespected(model);
  });

  it("Cybertruck keeps its own model line, EPA record, plant and coverage", () => {
    const model = buildRenderLayout(teslaCybertruckFixture(), themeFor(null));
    const page1 = pageStrings(model, 0);
    const joined = page1.join(" ");
    expect(model.pages.length).toBe(1);
    expect(page1).toContain("$84,880.00");
    expect(joined).toContain("2026 TESLA CYBERTRUCK");
    // Never given Model Y/X figures: its own range, plant and battery term.
    expect(joined).not.toContain("MODEL Y");
    expect(page1.some((s) => s === "325")).toBe(true);
    expect(page1.some((s) => s === "320")).toBe(false);
    expect(joined).toContain("AUSTIN, TEXAS, USA");
    expect(joined).toContain("8-YEAR/150,000-MILE BATTERY & DRIVE UNIT LIMITED WARRANTY");
    // Purchased software is a priced factory line; hardware capability is
    // never presented as an activated entitlement.
    expect(joined).toContain("Full Self-Driving (Supervised) - Purchased");
    expectWithinBounds(model);
    expectMinFontRespected(model);
  });
});

describe("Porsche profile (porsche-us-2026-v1, sport-factory-technical)", () => {
  it("Porsche names resolve to the Porsche profile; other VW Group brands never do", () => {
    for (const alias of ["Porsche", "PORSCHE", "Porsche AG", "Porsche Cars North America", "Dr. Ing. h.c. F. Porsche AG"]) {
      const r = resolveThemeProfile(alias, 2026);
      expect(r.theme.oemId, alias).toBe("PORSCHE");
      expect(r.profile.themeVersion, alias).toBe("porsche-us-2026-v1");
    }
    const p = resolveThemeProfile("Porsche", 2026);
    expect(p.profile.status).toBe("draft");
    expect(p.profile.layoutFamily).toBe("sport-factory-technical");
    expect(p.theme.templateFamilyId).toBe("SPORT_FACTORY");
    // Sibling VW Group brands and Porsche-adjacent vocabulary stay out.
    for (const other of ["Volkswagen", "Audi", "Bentley", "Lamborghini"]) {
      expect(resolveThemeProfile(other, 2026).theme.oemId, other).not.toBe("PORSCHE");
    }
    for (const noise of ["PDK", "Stuttgart", "Weissach", "Zuffenhausen"]) {
      expect(resolveThemeProfile(noise, 2026).resolution, noise).toBe("FALLBACK");
    }
    expect(resolveThemeProfile("Porsche", 2019).profile.status).toBe("fallback");
  });

  it("renders the owner's 911 Carrera 4 GTS reference reconciled to $182,785", () => {
    const model = buildRenderLayout(porsche911Fixture(), themeFor(null));
    const page1 = pageStrings(model, 0);
    const joined = page1.join(" ");
    expect(model.pages.length).toBe(1);
    expect(page1).toContain("$182,785.00");
    expect(page1).toContain("$164,900.00");
    expect(page1).toContain("TOTAL MSRP");
    // Porsche option codes render alongside their descriptions.
    for (const code of ["0Q", "Q1J", "8JU", "9VL", "3FE", "1N3", "KA6", "FI8", "UD1"]) {
      expect(page1, code).toContain(code);
    }
    // T-Hybrid is a performance hybrid, not a plug-in: gasoline EPA layout,
    // no electric range and no charging content.
    expect(page1).toContain("MPG");
    expect(page1.some((s) => s.includes("gallons per 100 miles"))).toBe(true);
    expect(page1.some((s) => s.includes("miles electric range"))).toBe(false);
    expect(page1).not.toContain("MPGe");
    // No gas-guzzler line unless the source record carries one.
    expect(joined).not.toContain("GAS GUZZLER TAX");
    // Unrated configuration: honest treatment, no fabricated stars.
    expect(joined).toContain("has not been rated");
    expect(joined).toContain("STUTTGART-ZUFFENHAUSEN, GERMANY");
    expect(joined).toContain("GERMANY 75%");
    expect(joined).toContain("Not an original Porsche-issued Monroney label");
    // Black masthead block with the Porsche-red keyline, never Audi or VW.
    const fills = new Set(model.pages[0].primitives.filter((p) => p.kind === "rect" && p.fill !== null).map((p) => (p.kind === "rect" ? String(p.fill) : "")));
    expect(fills.has("#0a0a0a")).toBe(true);
    const rules = new Set(model.pages[0].primitives.filter((p) => p.kind === "rule").map((p) => (p.kind === "rule" ? String(p.color) : "")));
    expect(rules.has("#d5001c")).toBe(true);
    expect(rules.has("#001e50")).toBe(false);
    const barcode = model.pages[0].primitives.find((p) => p.kind === "barcode");
    expect(barcode && barcode.kind === "barcode" ? barcode.payload : null).toBe("WP0AB2A99TS223847");
    expectWithinBounds(model);
    expectMinFontRespected(model);
  });

  it("gas-guzzler tax prints and reconciles only when it is on the price record", () => {
    const model = buildRenderLayout(porscheGuzzlerFixture(), themeFor(null));
    const page1 = pageStrings(model, 0);
    const joined = page1.join(" ");
    expect(model.pages.length).toBe(1);
    // 165,650 + 8,940 + 1,995 + 2,600 — the tax participates in the total.
    expect(page1).toContain("$179,185.00");
    expect(joined).toContain("GAS GUZZLER TAX");
    expect(page1).toContain("2,600.00");
    // Weissach and Paint to Sample are priced options; the no-cost bucket
    // seat selection reads INCLUDED rather than as a priced line.
    expect(joined).toContain("Weissach Package");
    expect(joined).toContain("Paint to Sample");
    expect(page1.filter((s) => s === "INCLUDED").length).toBe(1);
    expect(joined).toContain("718 CAYMAN");
    expect(joined).not.toContain("2026 PORSCHE 911");
    expectWithinBounds(model);
    expectMinFontRespected(model);
  });

  it("Macan Electric keeps its own EPA record, plant and battery coverage", () => {
    const model = buildRenderLayout(porscheMacanEvFixture(), themeFor(null));
    const page1 = pageStrings(model, 0);
    const joined = page1.join(" ");
    expect(model.pages.length).toBe(1);
    expect(page1).toContain("$85,485.00");
    expect(page1).toContain("MPGe");
    expect(page1.some((s) => s.includes("miles driving range"))).toBe(true);
    expect(page1.some((s) => s.includes("gallons per 100 miles"))).toBe(false);
    expect(page1.some((s) => s.includes("grams CO2"))).toBe(false);
    // Leipzig, not the 911's Zuffenhausen: assembly is matched per vehicle.
    expect(joined).toContain("LEIPZIG, GERMANY");
    expect(joined).not.toContain("STUTTGART-ZUFFENHAUSEN");
    expect(joined).toContain("HIGH-VOLTAGE BATTERY LIMITED WARRANTY");
    // Package membership listed beneath the parent, priced once.
    expect(joined).toContain("Premium Package");
    expect(joined).toContain("Ventilated Front Seats");
    expect(page1.filter((s) => s === "3,300.00").length).toBe(1);
    expectWithinBounds(model);
    expectMinFontRespected(model);
  });
});

describe("Land Rover profile (land-rover-us-2026-v1, british-factory-technical)", () => {
  it("JLR names resolve to Land Rover; Jaguar, Rover and styling qualifiers never do", () => {
    for (const alias of ["Land Rover", "LAND ROVER", "LandRover", "Jaguar Land Rover", "JLR", "Range Rover"]) {
      const r = resolveThemeProfile(alias, 2026);
      expect(r.theme.oemId, alias).toBe("LAND_ROVER");
      expect(r.profile.themeVersion, alias).toBe("land-rover-us-2026-v1");
    }
    const lr = resolveThemeProfile("Land Rover", 2026);
    expect(lr.profile.status).toBe("draft");
    expect(lr.profile.layoutFamily).toBe("british-factory-technical");
    expect(lr.theme.templateFamilyId).toBe("BRITISH_FACTORY");
    // Jaguar shares JLR but is a separate marque; Rover alone is ambiguous;
    // compatibility and styling qualifiers describe aftermarket goods.
    for (const excluded of [
      "Jaguar", "Rover", "MG Rover", "Austin Rover",
      "Land Rover-compatible", "Range Rover-style", "Defender", "Discovery", "Evoque",
    ]) {
      const r = resolveThemeProfile(excluded, 2026);
      expect(r.theme.oemId, excluded).not.toBe("LAND_ROVER");
      expect(r.resolution, excluded).toBe("FALLBACK");
    }
    expect(resolveThemeProfile("Land Rover", 2019).profile.status).toBe("fallback");
  });

  it("renders the owner's Range Rover Sport reference reconciled to $99,150", () => {
    const model = buildRenderLayout(landRoverSportFixture(), themeFor(null));
    const page1 = pageStrings(model, 0);
    const joined = page1.join(" ");
    expect(model.pages.length).toBe(1);
    expect(page1).toContain("$99,150.00");
    expect(page1).toContain("$92,175.00");
    // Land Rover is the manufacturer; Range Rover Sport is the model name.
    expect(joined).toContain("2026 LAND ROVER RANGE ROVER SPORT");
    expect(joined).toContain("P400 DYNAMIC SE");
    // MHEV is a 48V mild hybrid: gasoline EPA layout, no plug-in content.
    expect(page1).toContain("MPG");
    expect(page1.some((s) => s.includes("gallons per 100 miles"))).toBe(true);
    expect(page1.some((s) => s.includes("miles electric range"))).toBe(false);
    expect(page1).not.toContain("MPGe");
    expect(joined).toContain("MHEV");
    // Cold Climate Pack members sit beneath the parent and price once.
    expect(joined).toContain("Cold Climate Pack");
    expect(joined).toContain("Heated Windshield");
    expect(page1.filter((s) => s === "1,150.00").length).toBe(1);
    expect(joined).toContain("SOLIHULL, UNITED KINGDOM");
    expect(joined).toContain("UNITED KINGDOM 60%");
    expect(joined).toContain("PARTS CONTENT INFORMATION");
    expect(joined).toContain("has not been rated");
    expect(joined).toContain("Not an original Land Rover-issued Monroney label");
    // Deep-navy band with the restrained Land Rover green keyline.
    const fills = new Set(model.pages[0].primitives.filter((p) => p.kind === "rect" && p.fill !== null).map((p) => (p.kind === "rect" ? String(p.fill) : "")));
    expect(fills.has("#0b1c2c")).toBe(true);
    const rules = new Set(model.pages[0].primitives.filter((p) => p.kind === "rule").map((p) => (p.kind === "rule" ? String(p.color) : "")));
    expect(rules.has("#005a2b")).toBe(true);
    const barcode = model.pages[0].primitives.find((p) => p.kind === "barcode");
    expect(barcode && barcode.kind === "barcode" ? barcode.payload : null).toBe("SAL1L9FUXSA123456");
    expectWithinBounds(model);
    expectMinFontRespected(model);
  });

  it("Range Rover SV LWB uses the PHEV module and stays distinct from the Sport", () => {
    const model = buildRenderLayout(landRoverPhevFixture(), themeFor(null));
    const page1 = pageStrings(model, 0);
    const joined = page1.join(" ");
    expect(model.pages.length).toBe(1);
    expect(page1).toContain("$201,725.00");
    expect(page1).toContain("MPGe");
    expect(page1.some((s) => s.includes("miles electric range"))).toBe(true);
    expect(page1.some((s) => s.includes("MPG gasoline only"))).toBe(true);
    expect(page1.some((s) => s.includes("miles driving range"))).toBe(false);
    // Long-wheelbase SV is its own model line, not Range Rover Sport.
    expect(joined).toContain("2026 LAND ROVER RANGE ROVER");
    expect(joined).toContain("P550E SV LWB");
    expect(joined).not.toContain("RANGE ROVER SPORT");
    // SV Bespoke equipment is priced from the record; the no-cost ceramic
    // controls read INCLUDED rather than as a priced line.
    expect(joined).toContain("SV Bespoke Premium Palette Paint");
    expect(page1.filter((s) => s === "INCLUDED").length).toBe(1);
    expect(joined).toContain("HIGH-VOLTAGE BATTERY LIMITED WARRANTY");
    expectWithinBounds(model);
    expectMinFontRespected(model);
  });

  it("Defender 130 keeps its own body length, plant and EPA record", () => {
    const model = buildRenderLayout(landRoverDefenderFixture(), themeFor(null));
    const page1 = pageStrings(model, 0);
    const joined = page1.join(" ");
    expect(model.pages.length).toBe(1);
    expect(page1).toContain("$88,425.00");
    expect(joined).toContain("DEFENDER 130");
    expect(joined).not.toContain("DEFENDER 110");
    expect(joined).not.toContain("RANGE ROVER");
    // Built in Nitra, not the Range Rover's Solihull.
    expect(joined).toContain("NITRA, SLOVAKIA");
    expect(joined).not.toContain("SOLIHULL");
    expect(joined).toContain("SLOVAKIA 45%");
    expectWithinBounds(model);
    expectMinFontRespected(model);
  });
});
