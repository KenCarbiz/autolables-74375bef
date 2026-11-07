import { describe, expect, it } from "vitest";
import { buildRenderLayout, templateRoutingFacts, type FactoryStickerRenderData, type FactoryStickerTheme } from "./contract";
import { nhtsaFromRatingMetadata, withCatalogEpaGuard, withCatalogNeovin } from "./catalogNeovin";
import { hasBuiltCatalogTemplates } from "../oem/templateCatalog";
import { tucsonListings, tucsonRenderData } from "./__fixtures__/tucson";
import { wranglerRenderData } from "./__fixtures__/wrangler";
import { HYUNDAI_TUCSON_GAS_ID } from "./variants/hyundaiTucsonGas";
import { JEEP_WRANGLER_GAS_ID } from "./variants/jeepWranglerGas";
import { normalizeForSticker } from "../../../../supabase/functions/factory-sticker-orchestrate/normalize.ts";
import { canonicalPassportUrl } from "../reproduction";

const theme: FactoryStickerTheme = {
  oemThemeId: "o", oemThemeVersion: "1", canonicalOemId: null, templateFamilyId: "x",
  templateVersion: "1", logoAssetId: null, logoAssetVersion: null,
};

describe("NeoVIN decode facts for catalog templates", () => {
  it("reads stars from NHTSA rows only, and never from IIHS rows", () => {
    const rows = ["Standard-IIHS", "Side Impact-Good", "Standard-NHTSA", "Side Impact-5", "Rollover Rating-4", "Overall-5", "Frontal Crash Rating-5", "Top Safety Pick Status-TSP Plus", "Rear Crash Protect/Head Restraint Rating-Poor"];
    expect(nhtsaFromRatingMetadata(rows)).toEqual({ overall: 5, frontal: 5, side: 5, rollover: 4 });
    expect(nhtsaFromRatingMetadata(["Standard-IIHS", "Side Impact-Good", "Overall-5"])).toBeNull();
    expect(nhtsaFromRatingMetadata(["Standard-NHTSA", "Overall-0", "Overall-4", "Overall-3", "Rollover Rating-3"]))
      .toEqual({ overall: null, frontal: null, side: null, rollover: 3 });
  });

  it("prints combined frontal and side rows and never copies a value into driver, passenger or seat rows", () => {
    for (const listing of tucsonListings()) {
      const d = tucsonRenderData(listing);
      expect(d.neovin?.ratingMetadata).toContain("Standard-NHTSA");
      const enriched = withCatalogNeovin(d);
      expect(enriched.safety).toMatchObject({ overall: 5, frontal: 5, side: 5, rollover: 4, frontalDriver: null, frontalPassenger: null, sideFront: null, sideRear: null });
      const m = buildRenderLayout(d, theme, undefined, { sampleTemplateId: HYUNDAI_TUCSON_GAS_ID });
      const s = m.drawnStrings;
      // A combined decode rating is NHTSA's overall frontal / side rating, labeled as such.
      expect(s).toContain("Overall Frontal");
      expect(s).toContain("Overall Side");
      expect(s).not.toContain("Frontal");
      expect(s).not.toContain("Driver");
      expect(s).not.toContain("Passenger");
      expect(s).not.toContain("Front seat");
      expect(s).not.toContain("Rear seat");
    }
  });

  it("leaves categories the decode lacks as Not Available", () => {
    const m = buildRenderLayout(wranglerRenderData(), theme, undefined, { sampleTemplateId: JEEP_WRANGLER_GAS_ID });
    const s = m.drawnStrings;
    const idx = s.indexOf("Overall Vehicle Score");
    expect(s[idx + 1]).toBe("Not Available");
    expect(s).toContain("Rear seat");
  });

  it("prints the country of final assembly from made_in and invents no plant or city", () => {
    const d = tucsonRenderData(tucsonListings()[0]);
    expect(d.neovin?.madeIn).toBe("USA");
    expect(withCatalogNeovin(d).assembly).toEqual({ plant: null, city: null, country: "USA" });
    const m = buildRenderLayout(d, theme, undefined, { sampleTemplateId: HYUNDAI_TUCSON_GAS_ID });
    const all = m.drawnStrings.join(" ");
    expect(all).toContain("COUNTRY OF FINAL ASSEMBLY: USA");
    expect(all).not.toContain("FINAL ASSEMBLY POINT");
    expect(all).not.toMatch(/\d+ ?%/);
    const none = buildRenderLayout({ ...d, neovin: { ...d.neovin!, madeIn: null } }, theme, undefined, { sampleTemplateId: HYUNDAI_TUCSON_GAS_ID });
    // The Tucson template keeps Hyundai's line and says the value is missing rather than dropping it.
    expect(none.drawnStrings.join(" ")).not.toContain("COUNTRY OF FINAL ASSEMBLY");
    expect(none.drawnStrings.join(" ")).toContain("FINAL ASSEMBLY POINT: NOT AVAILABLE");
  });

  it("does nothing outside the catalog path and for makes without catalog templates", () => {
    const d = tucsonRenderData(tucsonListings()[0]);
    const production = buildRenderLayout(d, theme);
    expect(production.width).toBe(792);
    expect(hasBuiltCatalogTemplates("Hyundai")).toBe(true);
    for (const make of ["Kia", "Subaru", "Genesis", "Dodge", "Buick", "Ford", "Ram", "Chevrolet", "GMC"]) expect(hasBuiltCatalogTemplates(make), make).toBe(true);
    expect(hasBuiltCatalogTemplates("Infiniti")).toBe(false);
    const listing = { ...tucsonListings()[0], ymm: "2026 Infiniti QX60" };
    const n = normalizeForSticker(listing, {}, canonicalPassportUrl("x"), "t").data;
    expect(n.neovin).toBeUndefined();
    expect("neovin" in n).toBe(false);
  });

  it("carries the NeoVIN fuel type only when it states diesel, and uses it as the catalog fuel evidence when there is no EPA match", () => {
    const base = tucsonListings()[0];
    const withFuel = (fuel: string) => ({ ...base, ymm: "2026 Ford F-250", mc_attributes: { ...(base.mc_attributes as object), fuel_type: fuel } });
    const diesel = normalizeForSticker(withFuel("Diesel"), {}, canonicalPassportUrl("x"), "t").data;
    expect(diesel.neovin?.fuelType).toBe("Diesel");
    const gas = normalizeForSticker(withFuel("Unleaded"), {}, canonicalPassportUrl("x"), "t").data;
    expect(gas.neovin?.fuelType).toBeUndefined();
  });
});

describe("EPA match conflict guard for catalog templates", () => {
  const base = tucsonListings()[0];
  const make = (ymm: string, trim: string, mc: Record<string, unknown>, epa: Record<string, unknown>) =>
    normalizeForSticker(
      { ...base, ymm, trim, mc_attributes: { ...(base.mc_attributes as object), ...mc }, epa_economy: { combined: 76, city: 78, highway: 72, annualFuelCost: 700, ghgScore: 10, ...epa } },
      {}, canonicalPassportUrl("x"), "t",
    ).data;

  const cases: Array<[string, ReturnType<typeof make>, string | null]> = [
    ["2024 F-150 XLT 3.5L V6 matched to the Lightning", make("2024 Ford F-150", "XLT", { fuel_type: "Unleaded", powertrain_type: "Combustion", engine: "3.5L V6", drivetrain: "4WD" }, { fuelType: "Electricity", matchedOption: "2024 Ford F-150 Lightning 4WD — Auto (A1)" }), "powertrain"],
    ["Grand Cherokee 4xe matched to a gasoline engine", make("2024 Jeep Grand Cherokee", "4xe", { fuel_type: "Electric / Premium Unleaded", powertrain_type: "PHEV", engine: "2.0L I4", drivetrain: "4WD" }, { fuelType: "Regular", matchedOption: "2024 Jeep Grand Cherokee 2WD — Auto 8-spd, 6 cyl, 3.6 L" }), "powertrain"],
    ["Fusion hybrid matched to another engine", make("2010 Ford Fusion", "Hybrid", { fuel_type: "Electric / Unleaded", powertrain_type: "HEV", engine: "2.5L I4", drivetrain: "FWD" }, { fuelType: "Regular", matchedOption: "2010 Ford Fusion FWD — Auto, 6 cyl, 3.0 L" }), "engine"],
    ["consistent gasoline", make("2026 Ford F-250", "XL", { fuel_type: "Unleaded", powertrain_type: "Combustion", engine: "6.8L V8", drivetrain: "4WD" }, { fuelType: "Regular", matchedOption: "2026 Ford F250 Pickup 4WD — Auto, 8 cyl, 6.8 L" }), null],
  ];

  for (const [label, data, expected] of cases) {
    it(`${expected ? "marks the EPA match unverified for" : "keeps the EPA match for"} ${label}`, () => {
      expect(data.neovin?.epaConflict).toBe(expected ?? undefined);
      expect(withCatalogEpaGuard(data).epa === null).toBe(expected !== null);
    });
  }

  it("carries the verdict only for catalog makes and records the routing flag", () => {
    const conflicted = cases[0][1];
    expect(templateRoutingFacts(conflicted).flags).toContain("epa_match_conflict");
    expect(templateRoutingFacts(cases[3][1]).flags).not.toContain("epa_match_conflict");
    const master = make("2026 Infiniti QX60", "Sport", { fuel_type: "Unleaded", powertrain_type: "Combustion" }, { fuelType: "Electricity", matchedOption: "2026 Lightning" });
    expect(master.neovin).toBeUndefined();
    expect(master.epa).not.toBeNull();
  });

  it("prints every EPA value as unavailable and no fuel-type tag when the verdict is set", () => {
    const layout = buildRenderLayout(cases[0][1], theme, undefined, { sampleTemplateId: "ford_2026_f250" });
    const all = layout.drawnStrings.join(" ");
    expect(all).not.toMatch(/Electric Vehicle|Gasoline Vehicle|Diesel Vehicle/);
    expect(layout.drawnStrings.filter((x) => x === "Not Available").length).toBeGreaterThanOrEqual(2);
  });

  it("treats the EPA match as unavailable when render data carries the verdict, and leaves it alone otherwise", () => {
    const d = cases[3][1];
    expect(withCatalogEpaGuard({ ...d, neovin: { ratingMetadata: [], madeIn: null, epaConflict: "engine" } }).epa).toBeNull();
    expect(withCatalogEpaGuard({ ...d, neovin: { ratingMetadata: [], madeIn: null } }).epa).not.toBeNull();
  });
});

describe("EPA cost figures come from one timestamped retrieval", () => {
  const base = tucsonListings()[0];
  const norm = (epa: Record<string, unknown>) =>
    normalizeForSticker({ ...base, epa_economy: { ...(base.epa_economy as Record<string, unknown>), ...epa } }, {}, canonicalPassportUrl("x"), "t").data;

  it("reads the 5-year comparison only from a timestamped row and keeps a spend as negative", () => {
    expect(norm({ fiveYearCostDifference: -1000 }).epa).toMatchObject({ annualFuelCost: 2450, fiveYearCostDifference: -1000, checkedAt: "2026-11-05T14:22:47.944Z" });
    expect(norm({ fiveYearCostDifference: 750 }).epa?.fiveYearCostDifference).toBe(750);
    const untimed = norm({ fiveYearCostDifference: -1000, checkedAt: null }).epa;
    expect(untimed?.fiveYearCostDifference).toBeUndefined();
    expect(untimed?.checkedAt).toBeUndefined();
  });

  it("prints a spend from the same row as the annual cost, with the retrieval date", () => {
    const d = { ...tucsonRenderData(base) };
    const m = buildRenderLayout({ ...d, epa: { ...d.epa!, fiveYearCostDifference: -1000 } }, theme, undefined, { sampleTemplateId: HYUNDAI_TUCSON_GAS_ID });
    const all = m.drawnStrings.join(" ");
    expect(all).toContain("You spend");
    expect(all).toContain("$1,000");
    expect(all).toContain("$2,450");
    expect(all).toContain("retrieved Nov 5, 2026");
  });
});
