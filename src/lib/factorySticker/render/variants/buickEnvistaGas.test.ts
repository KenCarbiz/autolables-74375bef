import { describe, expect, it } from "vitest";
import { buildRenderLayout, type FactoryStickerRenderData, type FactoryStickerTheme } from "../contract";
import { expectNoTextOverlap } from "../__fixtures__/layoutAsserts";
import { describeCatalogTemplate } from "../__fixtures__/catalogTemplateSuite";
import { ENVISTA_REFERENCE_VIN, envistaListing, envistaReferenceMatchData, envistaRenderData } from "../__fixtures__/envista";
import { BUICK_ENVISTA_GAS_ID } from "./buickEnvistaGas";

describeCatalogTemplate({
  title: "Buick Envista gasoline",
  templateId: BUICK_ENVISTA_GAS_ID,
  make: "Buick",
  model: "Envista",
  stressLabel: "synthetic record, no saved Buick row exists",
  stressMatches: true,
  listing: envistaListing,
  renderData: envistaRenderData,
  referenceMatch: envistaReferenceMatchData,
  referenceVin: ENVISTA_REFERENCE_VIN,
  referenceStrings: ["OCEAN BLUE METALLIC", "PEBBLE GRAY W/WHISPER", "CHAMPION BUICK", "BRIGHTON", "BUPYEONG", "29,500", "33,449", "1,795", "2,154", "KOREA: 53%", "CHINA: 20%", "297 GRAMS", "$250", "$1,650", "ECOTEC", "6-SPD", "SMALL STATION WAGONS"],
  referenceExpect: ["30", "28", "32", "3.3", "$250", "$1,650", "$29,500.00", "$33,449.00", "$1,795.00", "$2,154.00", "$795.00", "$299.00", "KOREA: 53%", "CHINA: 20%", "BUPYEONG GU, IN", "CHAMPION BUICK GMC INC", "ENGINE: ECOTEC 1.2L TURBO"],
  ownExpect: ["ENGINE: TEST 9.9L ENGINE", "TRANSMISSION: TEST GEARBOX"],
  supported: [
    { label: "other trim", patch: (d) => ({ ...d, identity: { ...d.identity, trim: "Sport Touring" } }) },
    { label: "all-wheel drive", patch: (d) => ({ ...d, mechanical: { engine: null, transmission: null, drivetrain: "AWD" } }) },
  ],
  unsupported: [
    { label: "hybrid powertrain", patch: (d) => ({ ...d, epa: { ...d.epa!, fuelType: "Hybrid" } }) },
    { label: "2025 model year", patch: (d) => ({ ...d, identity: { ...d.identity, year: "2025" } }) },
    { label: "other model", patch: (d) => ({ ...d, identity: { ...d.identity, model: "Encore GX" } }) },
    { label: "sedan body", patch: (d) => ({ ...d, bodyClass: "Sedan" }) },
  ],
});

describe("Buick Envista EPA panel by fuel type", () => {
  const theme: FactoryStickerTheme = {
    oemThemeId: "oem-buick", oemThemeVersion: "1", canonicalOemId: "buick", templateFamilyId: "x",
    templateVersion: "1.0.0", logoAssetId: null, logoAssetVersion: null,
  };
  const render = (d: FactoryStickerRenderData) => buildRenderLayout(d, theme, undefined, { sampleTemplateId: BUICK_ENVISTA_GAS_ID });
  const base = envistaReferenceMatchData(envistaRenderData());
  const flexRecord = (patch: Partial<NonNullable<FactoryStickerRenderData["epa"]>>): FactoryStickerRenderData => ({ ...base, epa: { ...base.epa!, ...patch } });

  it("prints the flexible-fuel panel when the EPA fuel type is E85", () => {
    const m = render(flexRecord({ fuelType: "Gasoline or E85", atvType: null }));
    const s = m.drawnStrings;
    expect(s).toContain("Flexible-Fuel Vehicle");
    expect(s).toContain("Gasoline-Ethanol (E85)");
    expect(s).not.toContain("Gasoline Vehicle");
    expect(s).toContain("Driving Range");
    expect(s).toContain("Ethanol (E85): Not Available");
    expect(s).toContain("Gasoline: Not Available");
    expect(s).toContain("30");
    expect(m.fit.ok).toBe(true);
    expect(m.pages).toHaveLength(1);
    expectNoTextOverlap(m, 0);
  });

  it("prints the flexible-fuel panel when only the EPA advanced-technology type says FFV", () => {
    const m = render(flexRecord({ fuelType: "Regular Gasoline", atvType: "FFV" }));
    expect(m.drawnStrings).toContain("Flexible-Fuel Vehicle");
    expect(m.drawnStrings).not.toContain("Gasoline Vehicle");
  });

  it("keeps the plain gasoline panel for a gasoline record", () => {
    const m = render(flexRecord({ fuelType: "Regular Gasoline", atvType: null, classNote: "Small station wagons range from 17 to 121 MPG." }));
    const s = m.drawnStrings;
    expect(s).toContain("Gasoline Vehicle");
    expect(s).not.toContain("Flexible-Fuel Vehicle");
    expect(s).not.toContain("Driving Range");
    expect(s.join(" ")).not.toContain("E85");
  });

  it("never prints an E85 range the record does not carry", () => {
    const s = render(flexRecord({ fuelType: "Gasoline or E85", rangeMiles: 288 })).drawnStrings.join(" ");
    expect(s).not.toContain("288");
  });

  it("routes a flexible-fuel Envista to this template", () => {
    const m = buildRenderLayout(flexRecord({ fuelType: "Gasoline or E85" }), theme);
    expect(m.fit.ok).toBe(true);
  });
});
