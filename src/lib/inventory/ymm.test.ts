import { describe, it, expect } from "vitest";
import { parseYmm, canQueryMakeModel, MULTIWORD_MAKES } from "../../../supabase/functions/_shared/ymm";

// The bug this pins cost real money: splitting on whitespace and taking one
// token as the make sent make="Land", model="Rover Range Rover Sport" to a
// metered API, which rejected it and billed for it anyway — 90 of 500 calls in
// one week, and the feature it powers never once worked.

describe("multi-word makes", () => {
  it("keeps Land Rover together", () => {
    expect(parseYmm("2024 Land Rover Range Rover Sport"))
      .toEqual({ year: "2024", make: "Land Rover", model: "Range Rover Sport" });
  });

  it("keeps Alfa Romeo together", () => {
    // Both of these are in the dealer's actual used inventory.
    expect(parseYmm("2023 Alfa Romeo Stelvio Ti"))
      .toEqual({ year: "2023", make: "Alfa Romeo", model: "Stelvio Ti" });
  });

  it("handles a spaced Mercedes Benz as well as the hyphenated spelling", () => {
    expect(parseYmm("2022 Mercedes Benz GLE 350").make).toBe("Mercedes Benz");
    expect(parseYmm("2022 Mercedes-Benz GLE 350").make).toBe("Mercedes-Benz");
  });

  it("echoes the feed's own spelling, not the table's", () => {
    // A downstream exact-match against the listing has to still succeed.
    expect(parseYmm("2024 LAND ROVER Defender").make).toBe("LAND ROVER");
    expect(parseYmm("2024 land rover Defender").make).toBe("land rover");
  });

  it("does not swallow a single-word make that merely shares a prefix", () => {
    // "Landini" is not "Land Rover".
    expect(parseYmm("2024 Landini Tractor").make).toBe("Landini");
  });
});

describe("ordinary makes still parse", () => {
  it("splits year, make and multi-word model", () => {
    expect(parseYmm("2025 INFINITI QX80 Sensory AWD"))
      .toEqual({ year: "2025", make: "INFINITI", model: "QX80 Sensory AWD" });
  });

  it("handles a single-word model", () => {
    expect(parseYmm("2025 Nissan Z")).toEqual({ year: "2025", make: "Nissan", model: "Z" });
  });

  it("treats a missing year as make + model", () => {
    expect(parseYmm("Toyota Camry XSE"))
      .toEqual({ year: "", make: "Toyota", model: "Camry XSE" });
  });

  it("does not mistake a non-year first token for a year", () => {
    expect(parseYmm("Ram 1500 Big Horn").make).toBe("Ram");
    expect(parseYmm("Ram 1500 Big Horn").year).toBe("");
  });

  it("collapses irregular whitespace", () => {
    expect(parseYmm("  2024   Ford   Edge  SEL "))
      .toEqual({ year: "2024", make: "Ford", model: "Edge SEL" });
  });
});

describe("degenerate input never throws", () => {
  for (const bad of [null, undefined, "", "   ", "2024"]) {
    it(`survives ${JSON.stringify(bad)}`, () => {
      const v = parseYmm(bad as string | null | undefined);
      expect(typeof v.make).toBe("string");
      expect(typeof v.model).toBe("string");
    });
  }

  it("returns the year alone when nothing follows it", () => {
    expect(parseYmm("2024")).toEqual({ year: "2024", make: "", model: "" });
  });

  it("treats a make with no model as unqueryable", () => {
    expect(parseYmm("2024 Nissan")).toEqual({ year: "2024", make: "Nissan", model: "" });
  });
});

describe("the spend guard", () => {
  it("refuses a query that the provider would reject and still bill", () => {
    expect(canQueryMakeModel(parseYmm("2024"))).toBe(false);
    expect(canQueryMakeModel(parseYmm("2024 Nissan"))).toBe(false);
    expect(canQueryMakeModel(parseYmm(""))).toBe(false);
  });

  it("allows a complete vehicle", () => {
    expect(canQueryMakeModel(parseYmm("2024 Land Rover Range Rover Sport"))).toBe(true);
    expect(canQueryMakeModel(parseYmm("2025 Nissan Z"))).toBe(true);
  });
});

describe("the make table", () => {
  it("lists every entry as more than one token or hyphenated", () => {
    for (const m of MULTIWORD_MAKES) {
      expect(m.includes(" ") || m.includes("-")).toBe(true);
    }
  });
});
