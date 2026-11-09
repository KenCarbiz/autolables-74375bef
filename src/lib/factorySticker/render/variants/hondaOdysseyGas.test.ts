import { describe, expect, it } from "vitest";
import { buildRenderLayout, type FactoryStickerTheme } from "../contract";
import type { TextPrimitive } from "../layout";
import { expectNoTextOverlap } from "../__fixtures__/layoutAsserts";
import { describeCatalogTemplate } from "../__fixtures__/catalogTemplateSuite";
import { HONDA_ODYSSEY_REFERENCE_VIN, hondaOdysseyListing, hondaOdysseyReferenceMatchData, hondaOdysseyRenderData } from "../__fixtures__/honda";
import { HONDA_ODYSSEY_GAS_ID } from "./hondaOdysseyGas";

describeCatalogTemplate({
  title: "Honda Odyssey gas minivan",
  templateId: HONDA_ODYSSEY_GAS_ID,
  make: "Honda",
  model: "Odyssey",
  stressLabel: "2025 Odyssey EX-L record",
  stressMatches: false,
  pageSize: [792, 612],
  listing: hondaOdysseyListing,
  renderData: hondaOdysseyRenderData,
  referenceMatch: hondaOdysseyReferenceMatchData,
  referenceVin: HONDA_ODYSSEY_REFERENCE_VIN,
  referenceStrings: ["47,495", "48,990", "1,495", "BRAUNABILITY", "WINAMAC", "$2,250", "$2,750", "70%", "LINCOLN"],
  referenceExpect: ["22", "19", "28", "4.5", "$2,750", "$2,250", "$47,495.00", "$48,990.00", "$1,495.00", "SMOKE BLUE PEARL", "3YR/36K"],
  ownExpect: [],
  supported: [
    { label: "other trim", patch: (d) => ({ ...d, identity: { ...d.identity, trim: "EX-L" } }) },
    { label: "no drivetrain", patch: (d) => ({ ...d, mechanical: { engine: null, transmission: null, drivetrain: null } }) },
  ],
  unsupported: [
    { label: "2027 model year", patch: (d) => ({ ...d, identity: { ...d.identity, year: "2027" } }) },
    { label: "hybrid powertrain", patch: (d) => ({ ...d, epa: { ...d.epa!, fuelType: "Electricity/Gas" } }) },
    { label: "other model", patch: (d) => ({ ...d, identity: { ...d.identity, model: "Pilot" } }) },
    { label: "sedan body", patch: (d) => ({ ...d, bodyClass: "Sedan" }) },
  ],
});

describe("Honda Odyssey price list column", () => {
  const theme: FactoryStickerTheme = {
    oemThemeId: "oem-honda", oemThemeVersion: "1", canonicalOemId: "honda", templateFamilyId: "x",
    templateVersion: "1.0.0", logoAssetId: null, logoAssetVersion: null,
  };
  const model = buildRenderLayout(hondaOdysseyReferenceMatchData(hondaOdysseyRenderData()), theme, undefined, { sampleTemplateId: HONDA_ODYSSEY_GAS_ID });
  const texts = model.pages[0].primitives.filter((p): p is TextPrimitive => p.kind === "text");
  const find = (s: string): TextPrimitive => texts.find((t) => t.str === s)!;
  const findStart = (s: string): TextPrimitive => texts.find((t) => t.str.startsWith(s))!;

  it("prints the price list as a third column between the equipment and the fuel-economy panel", () => {
    expect(model.fit.ok).toBe(true);
    expect(model.pages).toHaveLength(1);
    const heading = findStart("Manufacturer's Suggested");
    const total = find("TOTAL VEHICLE PRICE");
    const msrp = find("$47,495.00");
    const fuel = find("Fuel Economy and Environment");
    const equipment = find("STANDARD EQUIPMENT AT NO EXTRA COST");
    expect(heading).toBeDefined();
    expect(total.x).toBe(heading.x);
    expect(heading.x).toBeGreaterThan(equipment.x + 240);
    expect(msrp.x).toBeLessThan(fuel.x);
    expect(msrp.x).toBeGreaterThan(heading.x);
    const equipmentRight = Math.max(...texts.filter((t) => t.y > 100 && t.y < 440 && t.x < heading.x && t.align !== "right").map((t) => t.x));
    expect(equipmentRight).toBeLessThan(heading.x);
  });

  it("keeps the type at 5.5pt or larger, the 5.5pt floor and no overlapping text", () => {
    for (const t of texts) expect(t.size).toBeGreaterThanOrEqual(5.5);
    expectNoTextOverlap(model, 0);
  });
});
