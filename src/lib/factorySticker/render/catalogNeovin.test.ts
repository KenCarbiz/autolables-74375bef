import { describe, expect, it } from "vitest";
import { buildRenderLayout, type FactoryStickerRenderData, type FactoryStickerTheme } from "./contract";
import { nhtsaFromRatingMetadata, withCatalogNeovin } from "./catalogNeovin";
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
      expect(s).toContain("Frontal");
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
    expect(none.drawnStrings.join(" ")).not.toContain("FINAL ASSEMBLY");
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
