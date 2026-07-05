import { describe, it, expect } from "vitest";
import type { VehicleListing } from "@/hooks/useVehicleListing";
import type { PassportData } from "@/lib/passportV2Data";
import {
  buildVehiclePassportDataContract,
  VEHICLE_PASSPORT_CONTRACT_VERSION,
  type DataHealthStatus,
} from "./dataContract";

// ── Fixtures ────────────────────────────────────────────────────────────
// Minimal listings that exercise only the fields the contract's composed
// normalizers read. Cast through unknown — the real types are large and the
// functions touch a known subset.

const listing = (mc: Record<string, unknown>, extra: Record<string, unknown> = {}): VehicleListing =>
  ({
    year: 2026, make: "INFINITI", model: "QX60", trim: "LUXE", vin: "5N1AL1FS7TC339685",
    mileage: 17, mc_attributes: mc, features: null, available_accessories: null, key_specs: null,
    ...extra,
  } as unknown as VehicleListing);

const passport = (): PassportData =>
  ({ highlights: [{ key: "engine", label: "3.5L V6", sub: "Engine" }], belowMarket: 2000 } as unknown as PassportData);

const RICH_MC = {
  options: [
    "Panoramic Moonroof", "Heated Steering Wheel", "Around View Monitor", "Bose Premium Audio",
    "Ventilated Front Seats", "Wireless Phone Charger", "Power Liftgate", "Tri-Zone Climate Control",
  ],
  features: [
    "Apple CarPlay", "Blind Spot Warning", "Adaptive Cruise Control", "Lane Departure Warning",
    "Rear Cross Traffic Alert", "LED Headlights", "Navigation System", "Leather Seats",
  ],
  build_sheet: {
    packages: [{ name: "Premium Package", msrp: 2500, contents: ["Heated Seats", "Moonroof"] }],
    options: [{ name: "Trailer Tow Package", msrp: 1200 }],
    key_features: { Safety: ["Blind Spot Warning", "Lane Departure Warning"], Technology: ["Navigation System"] },
    standard: { Comfort: ["Dual Zone Climate Control", "Power Liftgate"] },
    generic: false,
    decoded_at: "2026-07-01T00:00:00Z",
    source: "neovin",
  },
  engine: "3.5L V6", engine_size: "3.5", cylinders: 6, horsepower: 295, transmission: "Automatic",
  drivetrain: "AWD", fuel_type: "Gasoline", city_mpg: 20, highway_mpg: 26, combined_mpg: 22,
  body_type: "SUV", doors: 4, seating: 7, exterior_color: "Black", interior_color: "Graphite",
  specs_decoded_at: "2026-07-01T00:00:00Z",
};

// Flat specs present (nightly feed sync wrote them) but the NeoVIN equipment
// decode never ran → options/features/build_sheet absent.
const HICCUP_MC = {
  engine: "3.5L V6", transmission: "Automatic", drivetrain: "AWD", fuel_type: "Gasoline",
  city_mpg: 20, highway_mpg: 26, exterior_color: "Black", interior_color: "Graphite",
};

// NeoVIN answered but the VIN genuinely carries no rich installed options.
const DECODED_EMPTY_MC = {
  options: [], features: [], engine: "3.5L V6", transmission: "Automatic", drivetrain: "AWD",
  specs_decoded_at: "2026-07-02T00:00:00Z",
};

describe("vehicle passport data contract — versioned shape", () => {
  it("stamps the contract version", () => {
    const c = buildVehiclePassportDataContract(listing(RICH_MC), passport());
    expect(c.version).toBe("vehicle-passport-v1");
    expect(VEHICLE_PASSPORT_CONTRACT_VERSION).toBe("vehicle-passport-v1");
  });

  it("always returns a non-null equipment object with array fields, whatever the input", () => {
    for (const mc of [RICH_MC, HICCUP_MC, DECODED_EMPTY_MC, {}]) {
      const c = buildVehiclePassportDataContract(listing(mc), passport());
      expect(c.equipment).toBeTruthy();
      expect(Array.isArray(c.equipment.categories)).toBe(true);
      expect(Array.isArray(c.equipment.featuredHighlights)).toBe(true);
      expect(Array.isArray(c.equipmentList)).toBe(true);
      expect(Array.isArray(c.health.sections)).toBe(true);
    }
  });
});

describe("vehicle passport data contract — health grading", () => {
  it("grades a full decode as rich, with no degradation flags", () => {
    const c = buildVehiclePassportDataContract(listing(RICH_MC), passport());
    expect(c.health.status).toBe("rich");
    expect(c.equipment.featuredHighlights.length).toBeGreaterThan(0);
    expect(c.buildSheet).not.toBeNull();
    expect(c.health.decodedAt).toBe("2026-07-01T00:00:00Z");
    expect(c.health.flags.join(" ")).not.toMatch(/not yet decoded|decoded no installed/i);
    const equip = c.health.sections.find((s) => s.key === "equipment")!;
    expect(equip.status).toBe("rich");
  });

  it("detects a NeoVIN hiccup: equipment degrades but specs still render, and it says why", () => {
    const c = buildVehiclePassportDataContract(listing(HICCUP_MC), passport());
    // Equipment collapses to missing/thin — but the contract does NOT throw or
    // return a broken shape, and the health report names the cause.
    const equip = c.health.sections.find((s) => s.key === "equipment")!;
    expect<DataHealthStatus[]>(["thin", "missing"]).toContain(equip.status);
    expect(c.health.flags.some((f) => /not yet decoded/i.test(f))).toBe(true);
    // Specs survive off the flat feed fields — never a blank spec panel.
    const specs = c.health.sections.find((s) => s.key === "specs")!;
    expect(specs.count).toBeGreaterThan(0);
    expect(specs.status).not.toBe("missing");
    // Overall status is the worst of equipment+specs.
    expect(c.health.status).toBe(equip.status);
  });

  it("distinguishes decoded-empty from never-decoded", () => {
    const c = buildVehiclePassportDataContract(listing(DECODED_EMPTY_MC), passport());
    expect(c.health.flags.some((f) => /decoded no installed options/i.test(f))).toBe(true);
    expect(c.health.flags.some((f) => /not yet decoded/i.test(f))).toBe(false);
  });

  it("survives a totally empty mc_attributes without throwing, flagged as missing", () => {
    const c = buildVehiclePassportDataContract(listing({}), passport());
    expect(c.health.status).toBe("missing");
    expect(c.health.flags.length).toBeGreaterThan(0);
    // The customer surface still gets a valid (empty) object to render an honest
    // empty state from — not a crash.
    expect(c.equipment.factoryFeatureCount).toBe(0);
  });

  it("flags a generic (typical-for-trim) build sheet as not VIN-specific", () => {
    const genericMc = { ...RICH_MC, build_sheet: { ...RICH_MC.build_sheet, generic: true } };
    const c = buildVehiclePassportDataContract(listing(genericMc), passport());
    expect(c.health.generic).toBe(true);
    expect(c.health.flags.some((f) => /typical-for-trim/i.test(f))).toBe(true);
  });
});
