import { describe, expect, it } from "vitest";
import { buildRenderLayout } from "../contract";
import { describeCatalogTemplate } from "../__fixtures__/catalogTemplateSuite";
import { ASTON_REFERENCE_VIN, astonListing, astonReferenceMatchData, astonRenderData } from "../__fixtures__/aston";
import { ASTON_MARTIN_VANTAGE_ROADSTER_GAS_ID } from "./astonMartinVantageRoadsterGas";

describeCatalogTemplate({
  title: "Aston Martin Vantage Roadster gasoline",
  templateId: ASTON_MARTIN_VANTAGE_ROADSTER_GAS_ID,
  make: "Aston Martin",
  model: "Vantage",
  stressLabel: "2022 Toyota 4Runner SR5 record (other make)",
  listing: astonListing,
  renderData: astonRenderData,
  referenceMatch: astonReferenceMatchData,
  referenceVin: ASTON_REFERENCE_VIN,
  referenceStrings: ["LUNAR WHITE", "GAYDON", "205,900", "221,525", "4,925", "UK: 66%", "498 GRAMS", "$8,500", "OXFORD TAN", "BATTERY MAINTAINER", "AML UMBRELLA", "SCFSMGGW0TG", "KERBECK", "656HP"],
  referenceExpect: ["18", "15", "22", "5.6", "$8,500", "$3,450", "$205,900.00", "$221,525.00", "$3,500.00", "$445.00", "UK: 66%", "LUNAR WHITE", "3 years unlimited mileage warranty"],
  referenceGap: 7200,
  ownExpect: [],
  supported: [
    { label: "other trim", patch: (d) => ({ ...d, identity: { ...d.identity, trim: "Roadster Auto" } }) },
    { label: "no drivetrain", patch: (d) => ({ ...d, mechanical: { engine: null, transmission: null, drivetrain: null } }) },
  ],
  unsupported: [
    { label: "coupe body", patch: (d) => ({ ...d, bodyClass: "Coupe" }) },
    { label: "plug-in powertrain", patch: (d) => ({ ...d, epa: { ...d.epa!, fuelType: "Plug-in Hybrid" } }) },
    { label: "2025 model year", patch: (d) => ({ ...d, identity: { ...d.identity, year: "2025" } }) },
    { label: "other model", patch: (d) => ({ ...d, identity: { ...d.identity, model: "DB12" } }) },
    { label: "SUV body", patch: (d) => ({ ...d, bodyClass: "SUV" }) },
  ],
});

describe("Aston Martin price table reconciles on the label's own lines", () => {
  it("prints the import-costs line, so base + options + import + transport = total", () => {
    const d = astonReferenceMatchData(astonRenderData());
    const m = buildRenderLayout(d, { oemThemeId: "o", oemThemeVersion: "1", canonicalOemId: null, templateFamilyId: "x", templateVersion: "1", logoAssetId: null, logoAssetVersion: null }, undefined, { sampleTemplateId: ASTON_MARTIN_VANTAGE_ROADSTER_GAS_ID });
    const s = m.drawnStrings;
    expect(s).toContain("Import Costs");
    expect(s).toContain("$7,200.00");
    expect(s).toContain("$221,525.00");
    const p = d.pricing;
    expect(p.baseMsrp! + p.optionsTotal! + (p.importCharge ?? 0) + p.destinationCharge! + (p.gasGuzzlerTax ?? 0)).toBe(p.totalMsrp);
  });
});
