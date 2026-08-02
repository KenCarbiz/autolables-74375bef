import { describe, expect, it } from "vitest";
import { NeovinNormalizeError, normalizeNeovin, VinMismatchError } from "./normalizeNeovin";
import { validateStickerData } from "./validate";
import {
  ALL_FIXTURES,
  incompleteOptionPricing,
  infinitiLuxurySuv,
  materialMsrpMismatch,
  missingBaseMsrp,
  missingDestination,
  noEpaNhtsa,
  packagePricingTruck,
} from "./__fixtures__";

describe("normalizeNeovin — INFINITI luxury SUV fixture", () => {
  const data = normalizeNeovin(infinitiLuxurySuv());

  it("maps vehicle identity from ymm and mc_attributes", () => {
    expect(data.vehicle).toMatchObject({
      vin: "JN8AZ2NE8P9123456",
      year: 2026,
      make: "INFINITI",
      model: "QX80",
      trim: "Autograph",
      condition: "NEW",
      bodyStyle: "SUV",
      stockNumber: "N26041",
      exteriorColor: "Moonbow Blue",
      interiorColor: "Graphite Semi-Aniline Leather",
      engine: "3.5L V6 Twin-Turbo",
      transmission: "9-Speed Automatic",
      drivetrain: "AWD",
      fuelType: "Premium Unleaded",
    });
  });

  it("classifies a non-generic NeoVIN decode with options as OEM_BUILD_DATA / HIGH / AUTO_VERIFIED", () => {
    expect(data.document.sourceProvider).toBe("NEOVIN");
    expect(data.document.sourceClassification).toBe("OEM_BUILD_DATA");
    expect(data.document.confidence).toBe("HIGH");
    expect(data.document.verificationStatus).toBe("AUTO_VERIFIED");
  });

  it("reconciles pricing to the benchmark MATCHED result", () => {
    expect(data.pricing).toMatchObject({
      currency: "USD",
      baseMsrp: 89450,
      optionsTotal: 4250,
      factoryInstalledTotal: 4250,
      destinationCharge: 1995,
      calculatedTotalMsrp: 95695,
      sourceReportedTotalMsrp: 95695,
      reconciliationDifference: 0,
      reconciliationStatus: "MATCHED",
    });
    expect(data.pricing.packagesTotal).toBeUndefined();
  });

  it("keeps the unpriced package UNAVAILABLE with no invented price", () => {
    expect(data.equipment.packages).toHaveLength(1);
    const pkg = data.equipment.packages[0];
    expect(pkg.name).toBe("Premium Rear Seat Package");
    expect(pkg.priceStatus).toBe("UNAVAILABLE");
    expect(pkg.price).toBeUndefined();
    expect(pkg.features).toEqual(["Massaging Front Seats", "Rear Seat Entertainment", "Headrest Pillows"]);
  });

  it("drops the option that duplicates package content", () => {
    expect(data.equipment.options.map((o) => o.name)).toEqual([
      "Illuminated Kick Plates",
      "Welcome Lighting",
      "Roof Rail Crossbars",
      "Cargo Package",
      "22-Inch Dark Forged Wheels",
    ]);
  });

  it("groups standard equipment by hinted categories in stable order", () => {
    const categories = data.equipment.standard.map((g) => g.category);
    expect(categories).toEqual(["EXTERIOR", "INTERIOR", "POWERTRAIN", "SAFETY_SECURITY", "TECHNOLOGY"]);
    const byCat = Object.fromEntries(data.equipment.standard.map((g) => [g.category, g.items]));
    expect(byCat.SAFETY_SECURITY).toContain("ProPILOT Assist 2.1");
    expect(byCat.TECHNOLOGY).toContain("Bose Performance Audio - 24 Speakers");
    expect(byCat.POWERTRAIN).toContain("Tow Hitch Receiver");
  });

  it("marks EPA VERIFIED when decoded MPG figures exist", () => {
    expect(data.regulatory.epaStatus).toBe("VERIFIED");
    expect(data.regulatory.cityMpg).toBe(16);
    expect(data.regulatory.highwayMpg).toBe(19);
    expect(data.regulatory.combinedMpg).toBe(17);
    expect(data.regulatory.epaSourceReference).toBe("neovin:build");
  });

  it("marks NHTSA UNAVAILABLE because the payload carries no ratings", () => {
    expect(data.regulatory.nhtsaStatus).toBe("UNAVAILABLE");
    expect(data.regulatory.overallRating).toBeUndefined();
  });

  it("maps warranty terms with the source-verified flag", () => {
    expect(data.warranty).toEqual({
      basic: "4 years / 60,000 miles",
      powertrain: "6 years / 70,000 miles",
      corrosion: "7 years / unlimited miles",
      roadside: "4 years / unlimited miles",
      sourceVerified: true,
    });
  });

  it("leaves factory build details undefined rather than inventing them", () => {
    expect(data.factory).toEqual({});
  });

  it("maps dealer and document passthrough fields", () => {
    expect(data.dealer.tenantId).toBe("tn_01hfixture000000000000001");
    expect(data.dealer.name).toBe("Harte INFINITI");
    expect(data.document.vehicleId).toBe("veh_qx80_0001");
    expect(data.document.documentId).toBe("doc_qx80_0001");
    expect(data.document.passportUrl).toBe("https://autolabels.io/v/demo-qx80");
    expect(data.document.generatedAt).toBe("2026-07-21T12:00:00.000Z");
  });
});

describe("normalizeNeovin — other fixtures", () => {
  it("package pricing: priced and INCLUDED packages reconcile MATCHED", () => {
    const data = normalizeNeovin(packagePricingTruck());
    const pkgs = Object.fromEntries(data.equipment.packages.map((p) => [p.name, p]));
    expect(pkgs["Trailer Tow Package"].priceStatus).toBe("PRICED");
    expect(pkgs["Trailer Tow Package"].price).toBe(2200);
    expect(pkgs["Lariat Equipment Group 501A"].priceStatus).toBe("INCLUDED");
    expect(pkgs["Lariat Equipment Group 501A"].price).toBeUndefined();
    expect(data.pricing.packagesTotal).toBe(2200);
    expect(data.pricing.calculatedTotalMsrp).toBe(55695);
    expect(data.pricing.reconciliationStatus).toBe("MATCHED");
  });

  it("incomplete option pricing: unpriced option stays UNAVAILABLE and status is MINOR_VARIATION", () => {
    const data = normalizeNeovin(incompleteOptionPricing());
    const opts = Object.fromEntries(data.equipment.options.map((o) => [o.name, o]));
    expect(opts["All-Season Floor Mats"].priceStatus).toBe("UNAVAILABLE");
    expect(opts["All-Season Floor Mats"].price).toBeUndefined();
    expect(data.pricing.optionsTotal).toBe(800);
    expect(data.pricing.reconciliationDifference).toBe(-55);
    expect(data.pricing.reconciliationStatus).toBe("MINOR_VARIATION");
  });

  it("no EPA/NHTSA: both statuses are UNAVAILABLE", () => {
    const data = normalizeNeovin(noEpaNhtsa());
    expect(data.regulatory.epaStatus).toBe("UNAVAILABLE");
    expect(data.regulatory.nhtsaStatus).toBe("UNAVAILABLE");
    expect(data.regulatory.cityMpg).toBeUndefined();
    expect(data.regulatory.epaSourceReference).toBeUndefined();
  });

  it("feed-only listing classifies as CONFIGURATION_MATCH / MEDIUM / REVIEW_REQUIRED", () => {
    const data = normalizeNeovin(noEpaNhtsa());
    expect(data.document.sourceClassification).toBe("CONFIGURATION_MATCH");
    expect(data.document.confidence).toBe("MEDIUM");
    expect(data.document.verificationStatus).toBe("REVIEW_REQUIRED");
    expect(data.equipment.standard.flatMap((g) => g.items)).toEqual(
      expect.arrayContaining(["Power Back Door", "Blind Spot Monitor"]),
    );
  });

  it("no equipment anywhere classifies as CONFIGURATION_MATCH / LOW", () => {
    const input = noEpaNhtsa();
    input.listing.features = [];
    const data = normalizeNeovin(input);
    expect(data.document.sourceClassification).toBe("CONFIGURATION_MATCH");
    expect(data.document.confidence).toBe("LOW");
  });

  it("a generic NeoVIN decode never claims OEM_BUILD_DATA", () => {
    const input = infinitiLuxurySuv();
    (input.listing.mc_attributes as { build_sheet: { generic: boolean } }).build_sheet.generic = true;
    const data = normalizeNeovin(input);
    expect(data.document.sourceClassification).toBe("CONFIGURATION_MATCH");
    expect(data.document.confidence).toBe("MEDIUM");
    expect(data.document.verificationStatus).toBe("REVIEW_REQUIRED");
  });

  it("material MSRP mismatch reconciles REVIEW_REQUIRED", () => {
    const data = normalizeNeovin(materialMsrpMismatch());
    expect(data.pricing.reconciliationDifference).toBe(-1050);
    expect(data.pricing.reconciliationStatus).toBe("REVIEW_REQUIRED");
  });

  it("missing base MSRP reconciles INSUFFICIENT_DATA with no calculated total", () => {
    const data = normalizeNeovin(missingBaseMsrp());
    expect(data.pricing.baseMsrp).toBeUndefined();
    expect(data.pricing.calculatedTotalMsrp).toBeUndefined();
    expect(data.pricing.reconciliationStatus).toBe("INSUFFICIENT_DATA");
    expect(data.pricing.packagesTotal).toBe(3300);
  });

  it("missing destination keeps the field undefined and flags REVIEW_REQUIRED", () => {
    const data = normalizeNeovin(missingDestination());
    expect(data.pricing.destinationCharge).toBeUndefined();
    expect(data.pricing.calculatedTotalMsrp).toBe(46000);
    expect(data.pricing.reconciliationDifference).toBe(-1495);
    expect(data.pricing.reconciliationStatus).toBe("REVIEW_REQUIRED");
  });

  it("every fixture normalizes into data that passes validateStickerData", () => {
    for (const [name, fixture] of Object.entries(ALL_FIXTURES)) {
      const res = validateStickerData(normalizeNeovin(fixture()));
      expect(res.errors, name).toEqual([]);
      expect(res.ok, name).toBe(true);
    }
  });
});

describe("normalizeNeovin — guards", () => {
  it("throws a typed VinMismatchError when the payload VIN differs from the listing VIN", () => {
    const input = infinitiLuxurySuv();
    (input.listing.mc_attributes as Record<string, unknown>).vin = "5N1DL1GS8PC300012";
    let caught: unknown;
    try {
      normalizeNeovin(input);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(VinMismatchError);
    const err = caught as VinMismatchError;
    expect(err.listingVin).toBe("JN8AZ2NE8P9123456");
    expect(err.payloadVin).toBe("5N1DL1GS8PC300012");
  });

  it("normalizes VIN casing before comparing, so casing alone is not a mismatch", () => {
    const input = infinitiLuxurySuv();
    input.listing.vin = "jn8az2ne8p9123456";
    (input.listing.mc_attributes as Record<string, unknown>).vin = "JN8AZ2NE8P9123456";
    expect(normalizeNeovin(input).vehicle.vin).toBe("JN8AZ2NE8P9123456");
  });

  it("throws when ymm is missing or unparseable", () => {
    const input = infinitiLuxurySuv();
    input.listing.ymm = null;
    expect(() => normalizeNeovin(input)).toThrow(NeovinNormalizeError);
    const input2 = infinitiLuxurySuv();
    input2.listing.ymm = "QX80";
    expect(() => normalizeNeovin(input2)).toThrow(NeovinNormalizeError);
  });

  it("parses multi-word makes from ymm", () => {
    const input = noEpaNhtsa();
    input.listing.ymm = "2025 Land Rover Defender 110";
    const data = normalizeNeovin(input);
    expect(data.vehicle.make).toBe("Land Rover");
    expect(data.vehicle.model).toBe("Defender 110");
  });

  it("maps condition strings onto the sticker enum", () => {
    const cases: Array<[string, string]> = [
      ["new", "NEW"],
      ["used", "USED"],
      ["cpo", "CPO"],
      ["certified", "CPO"],
      ["demo", "DEMO"],
      ["", "USED"],
    ];
    for (const [raw, expected] of cases) {
      const input = noEpaNhtsa();
      input.listing.condition = raw;
      expect(normalizeNeovin(input).vehicle.condition, raw).toBe(expected);
    }
  });
});
