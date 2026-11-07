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
  it("holds the 28 handoff templates: 26 pending owner approval, 2 superseded by approved masters, none approved", () => {
    expect(TEMPLATE_CATALOG).toHaveLength(28);
    expect(new Set(TEMPLATE_CATALOG.map((t) => t.id)).size).toBe(28);
    for (const t of TEMPLATE_CATALOG) {
      const superseded = t.id === "infiniti_2026_qx60_sport" || t.id === "nissan_2026_pathfinder_platinum";
      expect(t.approval).toBe(superseded ? "superseded_by_approved_master" : "pending_owner_approval");
      expect(isRoutable(t)).toBe(false);
      expect(t.blockers).toContain("owner_exact_match_not_approved");
      expect(t.design.fileKey).toMatch(/^[A-Za-z0-9]{22}$/);
    }
  });

  it("records the reference page size and orientation", () => {
    expect(getCatalogTemplate("hyundai_2026_tucson_se_awd")!.page).toEqual({ widthPt: 1224, heightPt: 792, orientation: "landscape" });
    expect(getCatalogTemplate("mitsubishi_2026_outlander_sport_s")!.page).toEqual({ widthPt: 1224, heightPt: 792, orientation: "landscape" });
    expect(getCatalogTemplate("mitsubishi_2026_outlander_sport_s")!.blockers).toContain("reference_stored_rotated");
    expect(getCatalogTemplate("honda_2026_odyssey_touring")!.page).toEqual({ widthPt: 792, heightPt: 612, orientation: "landscape" });
    expect(getCatalogTemplate("honda_2026_odyssey_touring")!.blockers).toContain("reference_stored_rotated");
  });

  it("flags the 2025 references and marked online copies per template", () => {
    expect(getCatalogTemplate("fiat_2025_500e_giorgio_armani")!.blockers).toContain("reference_is_2025");
    expect(getCatalogTemplate("volvo_2025_xc60_b5_awd_plus")!.blockers).toContain("reference_is_2025");
    expect(getCatalogTemplate("toyota_2026_4runner_trd_sport")!.blockers).toContain("marked_online_copy");
    expect(getCatalogTemplate("ram_2026_2500_limited")!.blockers).toContain("carb_panel_pending");
    expect(getCatalogTemplate("cadillac_2026_escalade_iql_premium_sport")!.blockers).not.toContain("carb_panel_pending");
    expect(getCatalogTemplate("cadillac_2026_escalade_iql_premium_sport")!.blockers).toContain("carb_mdv_class_unverified");
    expect(getCatalogTemplate("maserati_2026_granturismo_trofeo")!.blockers).toContain("reference_msrp_unreconciled");
    expect(getCatalogTemplate("rolls-royce_2026_spectre")!.blockers).toContain("reference_msrp_unreconciled");
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

    it("keeps the Outlander Sport and the Voyager apart from their sibling models", () => {
      const sport = getCatalogTemplate("mitsubishi_2026_outlander_sport_s")!;
      const m: CatalogVehicleInput = { make: "Mitsubishi", modelYear: 2026, model: "Outlander Sport", trim: "2.0 ES", bodyClass: "SUV", fuelClass: "gasoline", drivetrain: null };
      expect(evaluateCatalogTemplate(sport, m).matched).toBe(true);
      expect(evaluateCatalogTemplate(sport, { ...m, drivetrain: "AWD" }).matched).toBe(true);
      for (const model of ["Outlander", "Outlander PHEV", "Eclipse Cross", "Mirage"]) {
        expect(evaluateCatalogTemplate(sport, { ...m, model }).matched, model).toBe(false);
      }
      expect(evaluateCatalogTemplate(sport, { ...m, modelYear: 2025 }).matched).toBe(false);
      expect(evaluateCatalogTemplate(sport, { ...m, fuelClass: "phev" }).matched).toBe(false);
      const outlander = resolveCatalogTemplate({ ...m, model: "Outlander" });
      expect(outlander.status).toBe("configuration_unsupported");
      expect(resolveCatalogTemplate(m).status).toBe("pending_match");

      const voyager = getCatalogTemplate("chrysler_2026_voyager_lx")!;
      const c: CatalogVehicleInput = { make: "Chrysler", modelYear: 2026, model: "Voyager", trim: "LX", bodyClass: "Minivan", fuelClass: "gasoline", drivetrain: "FWD" };
      expect(evaluateCatalogTemplate(voyager, c).matched).toBe(true);
      expect(evaluateCatalogTemplate(voyager, { ...c, trim: "Premium", drivetrain: null }).matched).toBe(true);
      for (const model of ["Pacifica", "Pacifica Hybrid", "Pacifica Plug-in Hybrid", "300", "Town & Country"]) {
        expect(evaluateCatalogTemplate(voyager, { ...c, model }).matched, model).toBe(false);
      }
      expect(evaluateCatalogTemplate(voyager, { ...c, fuelClass: "phev" }).matched).toBe(false);
      expect(evaluateCatalogTemplate(voyager, { ...c, bodyClass: "Sedan" }).matched).toBe(false);
      expect(resolveCatalogTemplate({ ...c, model: "Pacifica" }).flags).toEqual(["template_configuration_unsupported"]);
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

  it("marks the Sorento, Forester, GV80, Durango and Envista templates sample ready, pending approval, with accurate blockers", () => {
    for (const id of ["kia_2026_sorento_lx", "subaru_2026_forester_wilderness", "genesis_2026_gv80_3.5t_prestige", "dodge_2026_durango_gt_blacktop", "buick_2026_envista_avenir"]) {
      const t = getCatalogTemplate(id)!;
      expect(t.layoutStatus, id).toBe("sample_ready");
      expect(t.approval, id).toBe("pending_owner_approval");
      expect(t.page, id).toEqual({ widthPt: 1224, heightPt: 792, orientation: "landscape" });
      expect(t.blockers, id).not.toContain("layout_not_built");
      expect(t.blockers, id).toContain("owner_exact_match_not_approved");
      expect(t.blockers, id).not.toContain("missing_source_artwork");
    }
  });

  it("matches only the gasoline configuration of each new template", () => {
    const veh = (make: string, model: string, over: Partial<CatalogVehicleInput> = {}): CatalogVehicleInput =>
      ({ make, modelYear: 2026, model, trim: null, bodyClass: "SUV", fuelClass: "gasoline", drivetrain: null, ...over });
    const status = (v: CatalogVehicleInput): string => resolveCatalogTemplate(v).status;
    expect(status(veh("Kia", "Sorento"))).toBe("pending_match");
    expect(status(veh("Kia", "Sorento Hybrid", { fuelClass: "hybrid" }))).toBe("configuration_unsupported");
    expect(status(veh("Kia", "Sorento", { fuelClass: "phev" }))).toBe("configuration_unsupported");
    expect(status(veh("Subaru", "Forester"))).toBe("pending_match");
    expect(status(veh("Subaru", "Forester", { fuelClass: "hybrid" }))).toBe("configuration_unsupported");
    expect(status(veh("Subaru", "Forester Hybrid"))).toBe("configuration_unsupported");
    expect(status(veh("Genesis", "GV80", { trim: "3.5T Prestige" }))).toBe("pending_match");
    expect(status(veh("Genesis", "GV80 Coupe"))).toBe("configuration_unsupported");
    expect(status(veh("Dodge", "Durango", { trim: "SRT Hellcat" }))).toBe("pending_match");
    expect(status(veh("Dodge", "Durango", { fuelClass: "phev" }))).toBe("configuration_unsupported");
    expect(status(veh("Buick", "Envista"))).toBe("pending_match");
    expect(status(veh("Buick", "Envista", { bodyClass: "Sedan" }))).toBe("configuration_unsupported");
  });
});
