import { describe, expect, it } from "vitest";
import { describeCatalogTemplate } from "../__fixtures__/catalogTemplateSuite";
import { RAM2500_GAS_REFERENCE_VIN, ram2500GasListing, ram2500GasReferenceMatchData, ram2500GasRenderData } from "../__fixtures__/ram2500Gas";
import { buildRenderLayout, templateRoutingFacts, type FactoryStickerRenderData, type FactoryStickerTheme } from "../contract";
import { getCatalogTemplate, resolveCatalogTemplate } from "../../oem/templateCatalog";
import { pinCatalogPending } from "../__fixtures__/catalogState";
import { RAM_2500_DIESEL_ID } from "./ramLimitedDiesel";
import { RAM_2500_GAS_ID } from "./ramBigHornGas";

const diesel = (d: FactoryStickerRenderData): FactoryStickerRenderData => ({ ...d, epa: null, neovin: { ratingMetadata: [], madeIn: null, fuelType: "Diesel" } });

describeCatalogTemplate({
  title: "Ram 2500 Big Horn gasoline",
  templateId: RAM_2500_GAS_ID,
  make: "Ram",
  model: "2500",
  stressLabel: "2022 RAM 2500 Tradesman gasoline record, off-year",
  carb: { safetyPanel: true },
  listing: ram2500GasListing,
  renderData: ram2500GasRenderData,
  referenceMatch: ram2500GasReferenceMatchData,
  referenceVin: RAM2500_GAS_REFERENCE_VIN,
  referenceStrings: ["MOLTEN RED", "SALTILLO", "57,155", "66,355", "6,605", "2,595", "HEMI", "8HP75", "3,035"],
  referenceExpect: ["$57,155.00", "$66,355.00", "$2,595.00", "$3,035.00", "$1,695.00", "MOLTEN RED PEARL-COAT EXTERIOR PAINT", "SALTILLO", "Gasoline Vehicle"],
  ownExpect: ["TEST 9.9L ENGINE", "TEST GEARBOX"],
  supported: [
    { label: "other trim", patch: (d) => ({ ...d, identity: { ...d.identity, trim: "Tradesman" } }) },
    { label: "two-wheel drive", patch: (d) => ({ ...d, mechanical: { engine: null, transmission: null, drivetrain: "2WD" } }) },
    { label: "gasoline from the NeoVIN decode", patch: (d) => ({ ...d, epa: null, neovin: { ratingMetadata: [], madeIn: null, fuelType: "Gasoline" } }) },
  ],
  unsupported: [
    { label: "no fuel evidence", patch: (d) => ({ ...d, epa: null, neovin: { ratingMetadata: [], madeIn: null } }) },
    { label: "2025 model year", patch: (d) => ({ ...d, identity: { ...d.identity, year: "2025" } }) },
    { label: "Ram 1500", patch: (d) => ({ ...d, identity: { ...d.identity, model: "1500" } }) },
    { label: "Ram 3500", patch: (d) => ({ ...d, identity: { ...d.identity, model: "3500" } }) },
    { label: "sedan body", patch: (d) => ({ ...d, bodyClass: "Sedan" }) },
  ],
});

describe("Ram 2500 gasoline reference label", () => {
  pinCatalogPending();

  const theme: FactoryStickerTheme = {
    oemThemeId: "oem-ram", oemThemeVersion: "1", canonicalOemId: "ram", templateFamilyId: "x",
    templateVersion: "1.0.0", logoAssetId: null, logoAssetVersion: null,
  };
  const ref = ram2500GasReferenceMatchData(ram2500GasRenderData());

  it("reconciles at $66,355 = $57,155 + $6,605 + $2,595 from the printed option lines", () => {
    const options = ref.options.reduce((a, o) => a + (o.msrp ?? 0), 0) + ref.packages.reduce((a, o) => a + (o.msrp ?? 0), 0);
    expect(options).toBe(6605);
    expect(57155 + options + 2595).toBe(66355);
    expect(ref.pricing).toEqual({ baseMsrp: 57155, destinationCharge: 2595, optionsTotal: 6605, totalMsrp: 66355 });
  });

  it("draws no EPA fuel-economy panel and prints the CARB scales as Not Available", () => {
    const m = buildRenderLayout(ref, theme, undefined, { sampleTemplateId: RAM_2500_GAS_ID });
    const all = m.drawnStrings.join(" ");
    expect(all).toContain("California Air Resources Board");
    expect(all).toContain("Gasoline Vehicle");
    expect(all).not.toMatch(/fueleconomy\.gov|Fuel Economy and Environment|MPG|Diesel Vehicle/);
    expect(m.drawnStrings.filter((x) => x === "Not Available")).toHaveLength(2);
    expect(all).toMatch(/Overall Vehicle Score/);
  });

  it("routes a gasoline Ram 2500 to the gasoline template and a diesel Ram 2500 to the diesel one, never crossing", () => {
    expect(templateRoutingFacts(ref).template?.id).toBe(RAM_2500_GAS_ID);
    expect(templateRoutingFacts(diesel(ref)).template?.id).toBe(RAM_2500_DIESEL_ID);
    const v = { make: "Ram", modelYear: 2026, model: "2500", trim: "Big Horn", bodyClass: "Crew Cab Pickup", drivetrain: "4WD" } as const;
    expect(resolveCatalogTemplate({ ...v, fuelClass: "gasoline" }).template?.id).toBe(RAM_2500_GAS_ID);
    expect(resolveCatalogTemplate({ ...v, fuelClass: "diesel" }).template?.id).toBe(RAM_2500_DIESEL_ID);
    expect(getCatalogTemplate(RAM_2500_DIESEL_ID)!.match.fuelClasses).toEqual(["diesel"]);
    expect(getCatalogTemplate(RAM_2500_GAS_ID)!.match.fuelClasses).toEqual(["gasoline"]);
  });

  it("is a pending sample: page size from the reference, owner approval still required", () => {
    const t = getCatalogTemplate(RAM_2500_GAS_ID)!;
    expect([t.approval, t.layoutStatus]).toEqual(["pending_owner_approval", "sample_ready"]);
    expect(t.page).toEqual({ widthPt: 1224, heightPt: 792, orientation: "landscape" });
    expect(t.blockers).toEqual(expect.arrayContaining(["owner_exact_match_not_approved", "carb_panel_pending", "font_substitution"]));
  });
});
