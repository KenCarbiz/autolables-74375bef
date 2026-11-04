import { describe, expect, it } from "vitest";
import {
  TEMPLATE_CATALOG, evaluateCatalogTemplate, getCatalogTemplate, isRoutable, normalizeBodyClass,
  resolveCatalogTemplate, type CatalogVehicleInput,
} from "./templateCatalog";

const tucson = (over: Partial<CatalogVehicleInput> = {}): CatalogVehicleInput => ({
  make: "Hyundai", modelYear: 2026, model: "Tucson", trim: "SEL", bodyClass: "SUV",
  fuelClass: "gasoline", drivetrain: "AWD", ...over,
});

describe("template catalog", () => {
  it("holds the 28 handoff templates, all pending owner approval", () => {
    expect(TEMPLATE_CATALOG).toHaveLength(28);
    expect(new Set(TEMPLATE_CATALOG.map((t) => t.id)).size).toBe(28);
    for (const t of TEMPLATE_CATALOG) {
      expect(t.approval).toBe("pending_owner_approval");
      expect(isRoutable(t)).toBe(false);
      expect(t.blockers).toContain("owner_exact_match_not_approved");
      expect(t.design.fileKey).toMatch(/^[A-Za-z0-9]{22}$/);
    }
  });

  it("records the reference page size and orientation", () => {
    expect(getCatalogTemplate("hyundai_2026_tucson_se_awd")!.page).toEqual({ widthPt: 1224, heightPt: 792, orientation: "landscape" });
    expect(getCatalogTemplate("mitsubishi_2026_outlander_sport_s")!.page.orientation).toBe("portrait");
    expect(getCatalogTemplate("honda_2026_odyssey_touring")!.page).toMatchObject({ widthPt: 612, heightPt: 792 });
  });

  it("flags the 2025 references and marked online copies per template", () => {
    expect(getCatalogTemplate("fiat_2025_500e_giorgio_armani")!.blockers).toContain("reference_is_2025");
    expect(getCatalogTemplate("volvo_2025_xc60_b5_awd_plus")!.blockers).toContain("reference_is_2025");
    expect(getCatalogTemplate("toyota_2026_4runner_trd_sport")!.blockers).toContain("marked_online_copy");
    expect(getCatalogTemplate("ram_2026_2500_limited")!.blockers).toContain("carb_panel_pending");
    expect(getCatalogTemplate("hyundai_2026_tucson_se_awd")!.blockers).not.toContain("reference_is_2025");
  });

  describe("matching", () => {
    const t = getCatalogTemplate("hyundai_2026_tucson_se_awd")!;

    it("matches year, model, body and powertrain regardless of trim", () => {
      for (const trim of ["SE", "SEL", "XRT", "Limited", null]) {
        expect(evaluateCatalogTemplate(t, tucson({ trim })).matched).toBe(true);
      }
    });

    it("rejects another year, model, body or powertrain", () => {
      expect(evaluateCatalogTemplate(t, tucson({ modelYear: 2025 })).matched).toBe(false);
      expect(evaluateCatalogTemplate(t, tucson({ modelYear: null })).matched).toBe(false);
      expect(evaluateCatalogTemplate(t, tucson({ model: "Santa Fe" })).matched).toBe(false);
      expect(evaluateCatalogTemplate(t, tucson({ model: "Tucson Hybrid" })).matched).toBe(false);
      expect(evaluateCatalogTemplate(t, tucson({ bodyClass: "Sedan" })).matched).toBe(false);
      expect(evaluateCatalogTemplate(t, tucson({ fuelClass: "hybrid" })).matched).toBe(false);
      expect(evaluateCatalogTemplate(t, tucson({ fuelClass: "phev" })).matched).toBe(false);
      expect(evaluateCatalogTemplate(t, tucson({ fuelClass: null })).matched).toBe(false);
    });

    it("never matches on make alone and treats an unknown body as a non-match", () => {
      expect(evaluateCatalogTemplate(t, tucson({ bodyClass: null })).matched).toBe(false);
      expect(evaluateCatalogTemplate(t, tucson({ model: null })).matched).toBe(false);
    });

    it("requires the declared drivetrain family where the rule names one", () => {
      const wrangler = getCatalogTemplate("jeep_2026_wrangler_willys_392")!;
      const v: CatalogVehicleInput = { make: "Jeep", modelYear: 2026, model: "Wrangler", trim: "Rubicon 392", bodyClass: "SUV", fuelClass: "gasoline", drivetrain: "4WD" };
      expect(evaluateCatalogTemplate(wrangler, v).matched).toBe(true);
      expect(evaluateCatalogTemplate(wrangler, { ...v, drivetrain: "RWD" }).matched).toBe(false);
      expect(evaluateCatalogTemplate(wrangler, { ...v, model: "Wrangler 4xe" }).matched).toBe(false);
    });

    it("normalizes body styles from record text", () => {
      expect(normalizeBodyClass("Sport Utility")).toBe("SUV");
      expect(normalizeBodyClass("Mini-van")).toBe("MINIVAN");
      expect(normalizeBodyClass("Crew Cab Pickup")).toBe("PICKUP");
      expect(normalizeBodyClass("")).toBeNull();
    });
  });

  describe("resolution and flags", () => {
    it("a matching template pending approval is never selected for production", () => {
      const r = resolveCatalogTemplate(tucson());
      expect(r.status).toBe("pending_match");
      expect(r.template!.id).toBe("hyundai_2026_tucson_se_awd");
      expect(r.flags).toEqual(["template_pending_owner_approval"]);
      expect(r.status).not.toBe("approved_match");
    });

    it("flags a make with catalog templates but no matching configuration", () => {
      for (const over of [{ modelYear: 2025 }, { model: "Santa Fe" }, { fuelClass: "hybrid" as const }, { bodyClass: "Sedan" }]) {
        const r = resolveCatalogTemplate(tucson(over));
        expect(r.status).toBe("configuration_unsupported");
        expect(r.template).toBeNull();
        expect(r.flags).toEqual(["template_configuration_unsupported"]);
        expect(r.candidates).toEqual(["hyundai_2026_tucson_se_awd"]);
      }
    });

    it("records no flag for a make with no catalog template", () => {
      const r = resolveCatalogTemplate(tucson({ make: "Mazda" }));
      expect(r).toMatchObject({ status: "no_catalog_for_make", template: null, flags: [] });
    });

    it("selects an approved template only when owner approval and layout approval both hold", () => {
      const t = getCatalogTemplate("hyundai_2026_tucson_se_awd")!;
      expect(isRoutable({ ...t, approval: "approved" })).toBe(false);
      expect(isRoutable({ ...t, approval: "approved", layoutStatus: "approved" })).toBe(true);
    });
  });
});
