import { describe, expect, it } from "vitest";
import { buildRenderLayout, type FactoryStickerTheme } from "../contract";
import type { TextPrimitive } from "../layout";
import { expectNoTextOverlap } from "../__fixtures__/layoutAsserts";
import { describeCatalogTemplate } from "../__fixtures__/catalogTemplateSuite";
import { HONDA_ODYSSEY_REFERENCE_VIN, hondaOdysseyListing, hondaOdysseyReferenceMatchData, hondaOdysseyRenderData } from "../__fixtures__/honda";
import { HONDA_MASTER, HONDA_ODYSSEY_GAS_ID, hondaW, hondaX } from "./hondaOdysseyGas";

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

  it("sets the column positions to the Figma master proportions", () => {
    const heading = findStart("Manufacturer's Suggested");
    expect(heading.x).toBeCloseTo(hondaX(HONDA_MASTER.price.x), 1);
    const fuel = find("Fuel Economy and Environment");
    expect(fuel.x).toBeGreaterThan(hondaX(HONDA_MASTER.epa.x));
    const parts = find("PARTS CONTENT INFORMATION");
    const safety = find("GOVERNMENT 5-STAR SAFETY RATINGS");
    expect(parts.x).toBeCloseTo(hondaX(HONDA_MASTER.parts.x) + (hondaX(HONDA_MASTER.safety.x) - hondaX(HONDA_MASTER.parts.x) - 2) / 2, 0);
    expect(safety.x).toBeCloseTo(hondaX(HONDA_MASTER.safety.x) + hondaW(HONDA_MASTER.safety.w) / 2, 0);
    const equipmentX = [...new Set(texts.filter((t) => t.y > 100 && t.y < 440 && t.x < heading.x && t.align !== "right").map((t) => Math.round(t.x)))];
    expect(equipmentX).toContain(Math.round(hondaX(HONDA_MASTER.equipment[0].x)));
    expect(equipmentX).toContain(Math.round(hondaX(HONDA_MASTER.equipment[1].x)));
  });

  it("keeps the master's column order and ratios between the price, fuel-economy and safety blocks", () => {
    const ratio = (a: number, b: number): number => a / b;
    expect(ratio(hondaW(HONDA_MASTER.epa.w), hondaW(HONDA_MASTER.price.w))).toBeCloseTo(HONDA_MASTER.epa.w / HONDA_MASTER.price.w, 6);
    expect(hondaX(HONDA_MASTER.equipment[1].x + HONDA_MASTER.equipment[1].w)).toBeLessThan(hondaX(HONDA_MASTER.price.x));
    expect(hondaX(HONDA_MASTER.price.x + HONDA_MASTER.price.w)).toBeLessThan(hondaX(HONDA_MASTER.epa.x));
    expect(hondaX(HONDA_MASTER.safety.x + HONDA_MASTER.safety.w)).toBeCloseTo(772, 0);
  });
});
