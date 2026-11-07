import { describe, expect, it } from "vitest";
import { buildRenderLayout, productionLayoutKey, templateRoutingFacts, type FactoryStickerRenderData } from "./contract";
import { infinitiBenchmark, themeFor } from "./__fixtures__/renderData";
import {
  TEMPLATE_CATALOG, evaluateCatalogTemplate, getCatalogTemplate, type CatalogFuelClass, type CatalogVehicleInput,
} from "../oem/templateCatalog";

const theme = themeFor(null);

interface Config {
  make: string; year: number; model: string; trim: string | null; body: string; fuelType: string;
  drivetrain: string | null; neovin?: FactoryStickerRenderData["neovin"];
}

const record = (c: Config): FactoryStickerRenderData => {
  const base = infinitiBenchmark();
  return {
    ...base,
    identity: { year: String(c.year), make: c.make, model: c.model, trim: c.trim },
    bodyClass: c.body,
    mechanical: { engine: null, transmission: null, drivetrain: c.drivetrain },
    epa: { ...base.epa!, fuelType: c.fuelType },
    ...(c.neovin ? { neovin: c.neovin } : {}),
  };
};

const routing = (c: Config) => {
  const d = record(c);
  return { layout: productionLayoutKey(d, theme), facts: templateRoutingFacts(d) };
};

describe("Section 8: a template applies only to the configuration it was built from", () => {
  it("a Wrangler gasoline template is never applied to a Grand Cherokee 4xe", () => {
    const gc = { make: "Jeep", year: 2024, model: "Grand Cherokee 4xe", trim: "4xe", body: "SUV", fuelType: "Premium and Electricity", drivetrain: "4WD" };
    const r = routing(gc);
    expect(r.layout).toBe("jeep-2024-grand-cherokee-4xe-phev");
    expect(r.facts.template?.id).not.toBe("jeep_2026_wrangler_willys_392");
    const w = getCatalogTemplate("jeep_2026_wrangler_willys_392")!;
    for (const year of [2024, 2026]) {
      expect(evaluateCatalogTemplate(w, { make: "Jeep", modelYear: year, model: "Grand Cherokee", trim: "Limited", bodyClass: "SUV", fuelClass: "gasoline", drivetrain: "4WD" }).matched).toBe(false);
      expect(evaluateCatalogTemplate(w, { make: "Jeep", modelYear: year, model: "Grand Cherokee 4xe", trim: "Trailhawk 4xe", bodyClass: "SUV", fuelClass: "phev", drivetrain: "4WD" }).matched).toBe(false);
    }
    expect(evaluateCatalogTemplate(w, { make: "Jeep", modelYear: 2026, model: "Wrangler 4xe", trim: "Sahara 4xe", bodyClass: "SUV", fuelClass: "phev", drivetrain: "4WD" }).matched).toBe(false);
    expect(routing({ make: "Jeep", year: 2026, model: "Wrangler", trim: "Sahara 4xe", body: "SUV", fuelType: "Premium and Electricity", drivetrain: "4WD" }).facts.template?.id)
      .not.toBe("jeep_2026_wrangler_willys_392");
  });

  it("a Tucson gasoline template never replaces a Santa Fe Hybrid label", () => {
    const hev = { ratingMetadata: [], madeIn: null, hybridDecode: true as const };
    const sf = routing({ make: "Hyundai", year: 2026, model: "Santa Fe Hybrid", trim: "SE", body: "SUV", fuelType: "Hybrid", drivetrain: "AWD", neovin: hev });
    expect(sf.layout).toBe("hyundai-2026-santa-fe-hybrid-se-awd");
    expect(sf.facts.template?.id).not.toBe("hyundai_2026_tucson_se_awd");
    // FuelEconomy.gov files most hybrids under fuelType "Regular": the approved
    // master is then not reached, and the vehicle stays generic, never Tucson.
    const sfRegular = routing({ make: "Hyundai", year: 2026, model: "Santa Fe Hybrid", trim: "SE", body: "SUV", fuelType: "Regular", drivetrain: "AWD", neovin: hev });
    expect(sfRegular.layout).toBeNull();
    expect(sfRegular.facts.status).toBe("configuration_unsupported");
    const tucsonHybrid = routing({ make: "Hyundai", year: 2026, model: "Tucson", trim: "Blue Hybrid", body: "SUV", fuelType: "Regular", drivetrain: "AWD", neovin: { ratingMetadata: [], madeIn: null, hybridDecode: true } });
    expect(tucsonHybrid.facts.template?.id).not.toBe("hyundai_2026_tucson_se_awd");
    expect(tucsonHybrid.layout).not.toBe("hyundai_2026_tucson_se_awd");
  });

  it("an F-250 diesel template never applies to an F-250 gasoline truck", () => {
    const gas = routing({ make: "Ford", year: 2026, model: "F-250 Super Duty", trim: "XLT", body: "Pickup Truck", fuelType: "Regular", drivetrain: "4WD" });
    expect(gas.facts.status).toBe("configuration_unsupported");
    expect(gas.facts.flags).toContain("template_configuration_unsupported");
    expect(gas.layout).toBeNull();
    const diesel = routing({ make: "Ford", year: 2026, model: "F-250 Super Duty", trim: "Lariat", body: "Pickup Truck", fuelType: "Diesel", drivetrain: "4WD" });
    expect(diesel.facts).toMatchObject({ status: "pending_match", flags: ["template_pending_owner_approval"] });
    expect(diesel.layout).toBeNull();
  });

  it("an EV template never takes a gasoline or plug-in vehicle, and a gasoline template never takes an EV", () => {
    const evTemplates = TEMPLATE_CATALOG.filter((t) => t.match.fuelClasses.includes("ev"));
    expect(evTemplates.map((t) => t.id).sort()).toEqual(["cadillac_2026_escalade_iql_premium_sport", "fiat_2025_500e_giorgio_armani", "rolls-royce_2026_spectre"].sort());
    for (const t of evTemplates) expect(t.match.fuelClasses).toEqual(["ev"]);
    for (const t of TEMPLATE_CATALOG.filter((x) => !x.match.fuelClasses.includes("ev"))) {
      const v = sourceConfig(t.id);
      expect(evaluateCatalogTemplate(t, { ...v, fuelClass: "ev" }).matched).toBe(false);
    }
    const escaladeGas = routing({ make: "Cadillac", year: 2026, model: "Escalade", trim: "Premium Luxury", body: "SUV", fuelType: "Premium", drivetrain: "4WD" });
    expect(escaladeGas.facts.status).toBe("configuration_unsupported");
  });

  it("a Toyota Corolla never receives the 4Runner layout", () => {
    const c = routing({ make: "Toyota", year: 2026, model: "Corolla", trim: "LE", body: "Sedan", fuelType: "Regular", drivetrain: "FWD" });
    expect(c.facts.status).toBe("configuration_unsupported");
    expect(c.layout).toBeNull();
  });

  it("a make with no catalog template and no approved master stays on the generic layout without a flag", () => {
    const vw = routing({ make: "Volkswagen", year: 2026, model: "Atlas", trim: "SE", body: "SUV", fuelType: "Regular", drivetrain: "AWD" });
    expect(vw.layout).toBeNull();
    expect(vw.facts).toMatchObject({ status: "no_catalog_for_make", flags: [] });
  });
});

const FUELS: CatalogFuelClass[] = ["gasoline", "diesel", "hybrid", "phev", "ev"];

function sourceConfig(id: string): CatalogVehicleInput {
  const t = getCatalogTemplate(id)!;
  const body = t.match.bodyClasses[0];
  return {
    make: t.canonicalMake, modelYear: t.source.modelYear, model: t.source.model.replace(/^Ram\s+/i, ""), trim: t.source.trim,
    bodyClass: body === "PICKUP" ? "Pickup Truck" : body.toLowerCase(), fuelClass: t.match.fuelClasses[0],
    drivetrain: t.match.drivetrains?.[0] ?? null,
  };
}

describe("Section 8: configuration matrix over all 28 catalog templates", () => {
  it("each template matches its own reference configuration and no other template's", () => {
    for (const t of TEMPLATE_CATALOG) {
      expect(evaluateCatalogTemplate(t, sourceConfig(t.id)), t.id).toMatchObject({ matched: true });
      for (const other of TEMPLATE_CATALOG.filter((o) => o.id !== t.id)) {
        expect(evaluateCatalogTemplate(other, sourceConfig(t.id)).matched, `${other.id} on ${t.id}`).toBe(false);
      }
    }
  });

  it("each template rejects every other powertrain, the adjacent model years and an unknown body", () => {
    for (const t of TEMPLATE_CATALOG) {
      const v = sourceConfig(t.id);
      for (const f of FUELS.filter((x) => !t.match.fuelClasses.includes(x))) {
        expect(evaluateCatalogTemplate(t, { ...v, fuelClass: f }).matched, `${t.id} ${f}`).toBe(false);
      }
      for (const y of [v.modelYear! - 1, v.modelYear! + 1].filter((x) => !t.match.modelYears.includes(x))) {
        expect(evaluateCatalogTemplate(t, { ...v, modelYear: y }).matched, `${t.id} ${y}`).toBe(false);
      }
      expect(evaluateCatalogTemplate(t, { ...v, bodyClass: null }).matched).toBe(false);
      expect(evaluateCatalogTemplate(t, { ...v, fuelClass: null }).matched).toBe(false);
      expect(evaluateCatalogTemplate(t, { ...v, model: null }).matched).toBe(false);
    }
  });

  it("no catalog template is routable to production while its approval is pending", () => {
    for (const t of TEMPLATE_CATALOG) {
      const v = sourceConfig(t.id);
      const r = routing({
        make: v.make!, year: v.modelYear!, model: v.model!, trim: v.trim, body: v.bodyClass!,
        fuelType: ({ gasoline: "Regular", diesel: "Diesel", hybrid: "Regular", phev: "Premium and Electricity", ev: "Electricity" } as const)[v.fuelClass!],
        drivetrain: v.drivetrain ?? "AWD",
        neovin: v.fuelClass === "hybrid" ? { ratingMetadata: [], madeIn: null, hybridDecode: true } : undefined,
      });
      expect(r.layout === t.id, t.id).toBe(false);
    }
  });
});

describe("Section 8: the generic layout's fuel panel follows the powertrain", () => {
  const generic = (fuelType: string, rangeMiles: number | null) => {
    const d = record({ make: "Volkswagen", year: 2026, model: "Atlas", trim: "SE", body: "SUV", fuelType, drivetrain: "AWD" });
    return buildRenderLayout({ ...d, epa: { ...d.epa!, rangeMiles } }, theme).drawnStrings;
  };

  it("labels FuelEconomy.gov plug-in fuel names as plug-in hybrid, never as an EV", () => {
    for (const f of ["Premium and Electricity", "Regular Gas and Electricity"]) {
      const s = generic(f, 21);
      expect(s, f).toContain("Plug-In Hybrid");
      expect(s, f).not.toContain("Electric Vehicle");
      expect(s.join(" "), f).not.toContain("miles driving range");
    }
  });

  it("keeps the EV and gasoline panels apart", () => {
    const ev = generic("Electricity", 300);
    expect(ev).toContain("Electric Vehicle");
    const gas = generic("Regular", null);
    expect(gas).toContain("Gasoline Vehicle");
    expect(gas).not.toContain("MPGe");
  });
});
