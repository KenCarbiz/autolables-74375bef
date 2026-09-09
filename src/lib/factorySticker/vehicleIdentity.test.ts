import { describe, expect, it } from "vitest";
import {
  canQueryIdentity,
  identityFromListing,
  identityTrim,
  identityYear,
  resolveVehicleIdentity,
} from "./vehicleIdentity";

describe("resolveVehicleIdentity", () => {
  it("takes the feed's own make and model over any split of the display string", () => {
    // The live row: mc_attributes says "Alfa Romeo" / "Stelvio" while the ymm
    // it was concatenated into splits to "Alfa" / "Romeo Stelvio".
    const id = identityFromListing({
      ymm: "2020 Alfa Romeo Stelvio",
      mc_attributes: { year: "2020", make: "Alfa Romeo", model: "Stelvio" },
    });
    expect(id).toEqual({
      year: "2020", make: "Alfa Romeo", model: "Stelvio",
      origin: "mc_attributes", structured: true,
    });
  });

  it("resolves ZASPAKBN5L7C99407 to make Alfa Romeo and model Stelvio", () => {
    const id = identityFromListing({
      ymm: "2020 Alfa Romeo Stelvio",
      mc_attributes: { year: 2020, make: "Alfa Romeo", model: "Stelvio" },
      mc_raw: { build: { year: 2020, make: "Alfa Romeo", model: "Stelvio" } },
    });
    expect(id.make).toBe("Alfa Romeo");
    expect(id.model).toBe("Stelvio");
    expect(identityYear(id)).toBe(2020);
  });

  it.each([
    ["2024 Land Rover Range Rover Sport", "Land Rover", "Range Rover Sport"],
    ["2025 Mercedes-Benz GLE 450", "Mercedes-Benz", "GLE 450"],
    ["2024 Aston Martin DB12", "Aston Martin", "DB12"],
    ["2020 Alfa Romeo Stelvio", "Alfa Romeo", "Stelvio"],
  ])("resolves %s from a structured field", (ymm, make, model) => {
    const id = identityFromListing({ ymm, mc_attributes: { make, model, year: ymm.slice(0, 4) } });
    expect({ make: id.make, model: id.model, structured: id.structured })
      .toEqual({ make, model, structured: true });
  });

  it.each([
    ["2024 Land Rover Range Rover Sport", "Land Rover", "Range Rover Sport"],
    ["2025 Mercedes-Benz GLE 450", "Mercedes-Benz", "GLE 450"],
    ["2024 Aston Martin DB12", "Aston Martin", "DB12"],
    ["2020 Alfa Romeo Stelvio", "Alfa Romeo", "Stelvio"],
  ])("resolves %s through the parser fallback when nothing structured exists", (ymm, make, model) => {
    const id = identityFromListing({ ymm });
    expect(id).toEqual({ year: ymm.slice(0, 4), make, model, origin: "ymm_parsed", structured: false });
  });

  it("does not truncate a multi-token model", () => {
    expect(identityFromListing({
      ymm: "2022 RAM Ram 1500 Pickup",
      mc_attributes: { year: "2022", make: "RAM", model: "Ram 1500 Pickup" },
    }).model).toBe("Ram 1500 Pickup");
    expect(identityFromListing({ ymm: "2023 Jeep Wrangler 4-Door" }).model).toBe("Wrangler 4-Door");
    expect(identityFromListing({ ymm: "2019 Ford Transit Van" }).model).toBe("Transit Van");
  });

  it("leaves a single-token make untouched, structured or parsed", () => {
    expect(identityFromListing({
      ymm: "2025 INFINITI QX80 Sensory",
      mc_attributes: { year: "2025", make: "INFINITI", model: "QX80" },
    })).toEqual({ year: "2025", make: "INFINITI", model: "QX80", origin: "mc_attributes", structured: true });
    expect(identityFromListing({ ymm: "2021 NISSAN Rogue" }))
      .toEqual({ year: "2021", make: "NISSAN", model: "Rogue", origin: "ymm_parsed", structured: false });
  });

  it("falls to mc_raw.build, then the NeoVIN payload, then vehicle_files", () => {
    expect(identityFromListing({
      ymm: "2020 Mazda MX-5 Miata",
      mc_raw: { build: { year: 2020, make: "Mazda", model: "MX-5 Miata" } },
    }).origin).toBe("mc_raw_build");

    // The 3 live rows with no MarketCheck bag at all are answered here.
    const neo = resolveVehicleIdentity({
      ymm: null,
      neovinPayload: { year: 2026, make: "INFINITI", model: "QX80" },
    });
    expect(neo).toEqual({
      year: "2026", make: "INFINITI", model: "QX80",
      origin: "neovin_payload", structured: true,
    });

    expect(resolveVehicleIdentity({ file: { year: 2021, make: "Nissan", model: "Rogue" } }).origin)
      .toBe("vehicle_files");
  });

  it("ignores a half-populated bag rather than letting it beat a complete one", () => {
    const id = identityFromListing({
      ymm: "2020 Alfa Romeo Stelvio",
      mc_attributes: { make: "Alfa Romeo" },
      mc_raw: { build: { year: 2020, make: "Alfa Romeo", model: "Stelvio" } },
    });
    expect(id.origin).toBe("mc_raw_build");
    expect(id.model).toBe("Stelvio");
  });

  it("borrows a year from a later tier when the winning one has none", () => {
    const id = identityFromListing({
      ymm: "2020 Alfa Romeo Stelvio",
      mc_attributes: { make: "Alfa Romeo", model: "Stelvio" },
    });
    expect(id.year).toBe("2020");
    expect(id.make).toBe("Alfa Romeo");
  });

  it("returns empty rather than guessing, and refuses the provider call", () => {
    expect(resolveVehicleIdentity({})).toEqual({
      year: "", make: "", model: "", origin: "none", structured: false,
    });
    expect(canQueryIdentity(resolveVehicleIdentity({}))).toBe(false);
    expect(canQueryIdentity(identityFromListing({ ymm: "2024 Nissan" }))).toBe(false);
    expect(canQueryIdentity(identityFromListing({ ymm: "2024 Nissan Rogue" }))).toBe(true);
    expect(identityYear(resolveVehicleIdentity({}))).toBeNull();
  });

  it("tolerates junk shapes without throwing", () => {
    for (const junk of [null, undefined, 42, "x", [], { build: [] }]) {
      expect(() => resolveVehicleIdentity({ mcAttributes: junk, mcRaw: junk, ymm: junk })).not.toThrow();
    }
    expect(identityFromListing(null).origin).toBe("none");
  });
});

describe("identityTrim", () => {
  it("charges a two-token make to the make, not to the trim", () => {
    const id = identityFromListing({
      ymm: "2020 Alfa Romeo Stelvio Ti Sport",
      mc_attributes: { year: "2020", make: "Alfa Romeo", model: "Stelvio" },
    });
    expect(identityTrim("2020 Alfa Romeo Stelvio Ti Sport", id)).toBe("Ti Sport");
  });

  it("returns empty when the string holds nothing beyond the identity", () => {
    const id = identityFromListing({ ymm: "2025 INFINITI QX80" });
    expect(identityTrim("2025 INFINITI QX80", id)).toBe("");
    expect(identityTrim(null, id)).toBe("");
  });

  it("returns empty rather than the whole string when the identity does not lead it", () => {
    const id = identityFromListing({ mc_attributes: { make: "Jeep", model: "Wrangler 4-Door" } });
    expect(identityTrim("Some other text", id)).toBe("");
  });
});
