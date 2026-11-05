import { describe, expect, it } from "vitest";
import { buildRenderLayout, catalogResolutionFor, type FactoryStickerRenderData } from "../contract";
import { themeFor } from "../__fixtures__/renderData";
import { pathfinderReferenceMatchData, qx60ReferenceMatchData } from "../__fixtures__/letterMasters";
import { expectNoTextOverlap } from "../__fixtures__/layoutAsserts";
import { hasBuiltCatalogTemplates, evaluateCatalogTemplate, getCatalogTemplate, isRoutable, type CatalogVehicleInput } from "../../oem/templateCatalog";
import { LETTER_VARIANT_CONFIGS } from "./letterMonroney";
import { CATALOG_LAYOUTS } from "./index";
import { INFINITI_QX60_SPORT_ID } from "./infinitiQx60Sport";
import { NISSAN_PATHFINDER_PLATINUM_ID } from "./nissanPathfinderPlatinum";
import type { LayoutModel } from "../layout";

interface Case {
  id: string;
  masterKey: string;
  make: string;
  model: string;
  theme: string;
  data: () => FactoryStickerRenderData;
}

const cases: Case[] = [
  { id: INFINITI_QX60_SPORT_ID, masterKey: "infiniti-2026-qx60-sport-awd", make: "INFINITI", model: "QX60", theme: "infiniti", data: qx60ReferenceMatchData },
  { id: NISSAN_PATHFINDER_PLATINUM_ID, masterKey: "nissan-2026-pathfinder-platinum-4wd", make: "Nissan", model: "Pathfinder", theme: "nissan", data: pathfinderReferenceMatchData },
];

const vehicle = (c: Case, over: Partial<CatalogVehicleInput> = {}): CatalogVehicleInput => ({
  make: c.make, modelYear: 2026, model: c.model, trim: "Sport", bodyClass: "SUV", fuelClass: "gasoline", drivetrain: "AWD", ...over,
});

const text = (m: LayoutModel): string[] => m.pages[0].primitives.flatMap((p) => (p.kind === "text" ? [p.str] : []));

describe.each(cases)("$id served by the approved master", (c) => {
  const t = getCatalogTemplate(c.id)!;

  it("is sample_ready, pending owner approval, never routable, and says why", () => {
    expect(t.layoutStatus).toBe("sample_ready");
    expect(t.approval).toBe("pending_owner_approval");
    expect(isRoutable(t)).toBe(false);
    expect(t.existingMasterKey).toBe(c.masterKey);
    expect(t.blockers).toContain("served_by_approved_master");
    expect(t.blockers).toContain("owner_exact_match_not_approved");
    expect(t.blockers).not.toContain("layout_not_built");
    expect(LETTER_VARIANT_CONFIGS[c.masterKey]).toBeDefined();
    expect(CATALOG_LAYOUTS[c.id]).toBeDefined();
  });

  it("matches year, model, body and powertrain and flags the rest as unsupported", () => {
    expect(evaluateCatalogTemplate(t, vehicle(c)).matched).toBe(true);
    expect(evaluateCatalogTemplate(t, vehicle(c, { trim: null })).matched).toBe(true);
    expect(evaluateCatalogTemplate(t, vehicle(c, { modelYear: 2025 })).matched).toBe(false);
    expect(evaluateCatalogTemplate(t, vehicle(c, { model: "Other" })).matched).toBe(false);
    expect(evaluateCatalogTemplate(t, vehicle(c, { bodyClass: "Sedan" })).matched).toBe(false);
    expect(evaluateCatalogTemplate(t, vehicle(c, { fuelClass: "hybrid" })).matched).toBe(false);
    expect(evaluateCatalogTemplate(t, vehicle(c, { fuelClass: "ev" })).matched).toBe(false);
    expect(evaluateCatalogTemplate(t, vehicle(c, { fuelClass: null })).matched).toBe(false);
  });

  it("renders the sample byte-identically to the production master path", () => {
    const data = c.data();
    const production = buildRenderLayout(data, themeFor(c.theme));
    const sample = buildRenderLayout(data, themeFor(c.theme), undefined, { sampleTemplateId: c.id });
    expect(production.fit.ok).toBe(true);
    expect(text(production)).toContain("Standard Equipment Included at No Extra Charge");
    expect(JSON.stringify(sample)).toBe(JSON.stringify(production));
  });

  it("stays identical for a minimal record, with no reference value leaking in", () => {
    const base = c.data();
    const minimal: FactoryStickerRenderData = {
      ...base,
      pricing: { baseMsrp: null, destinationCharge: null, optionsTotal: null, totalMsrp: null, gasGuzzlerTax: 0 },
      options: [], packages: [], standardEquipment: {}, keyFeatures: {}, safety: null, passportUrl: "",
    };
    const production = buildRenderLayout(minimal, themeFor(c.theme));
    const sample = buildRenderLayout(minimal, themeFor(c.theme), undefined, { sampleTemplateId: c.id });
    expect(JSON.stringify(sample)).toBe(JSON.stringify(production));
    if (sample.fit.ok) {
      expectNoTextOverlap(sample, 0);
      expect(text(sample).join(" ")).not.toContain("{{");
    }
  });

  it("keeps the make out of the catalog-only data extras and out of catalog production routing", () => {
    expect(hasBuiltCatalogTemplates(c.make)).toBe(false);
    const resolved = catalogResolutionFor(c.data());
    expect(resolved.status).not.toBe("approved_match");
  });

  it("renders one page at the 792x612 Letter size with the approved master type sizes", () => {
    const m = buildRenderLayout(c.data(), themeFor(c.theme), undefined, { sampleTemplateId: c.id });
    expect(m.fit.ok).toBe(true);
    expect(m.pages).toHaveLength(1);
    expect([m.width, m.height]).toEqual([792, 612]);
    const sizes = m.pages[0].primitives.flatMap((p) => (p.kind === "text" ? [p.size] : []));
    const production = buildRenderLayout(c.data(), themeFor(c.theme));
    const productionSizes = production.pages[0].primitives.flatMap((p) => (p.kind === "text" ? [p.size] : []));
    expect(Math.min(...sizes)).toBe(Math.min(...productionSizes));
    expect(Math.min(...sizes)).toBe(5.2);
  });
});
