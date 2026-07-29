import { describe, it, expect } from "vitest";
import { structuredSheet } from "./neovinSheet.ts";

// These are the first tests this logic has ever had. It shipped behind a
// Deno.serve() and was never executed by any test in the repo, which is how a
// silent `!Array.isArray` reject went unnoticed while it blanked the build
// sheet for every VIN whose features arrived as an array.
describe("structuredSheet", () => {
  it("keeps features that arrive as a flat array, grouped by their own category", () => {
    const sheet = structuredSheet({
      features: [
        { description: "Heated Seats", category: "Comfort" },
        { description: "Blind Spot Warning", category: "Safety" },
        { description: "Lane Keep Assist", category: "Safety" },
      ],
    });
    expect(sheet).not.toBeNull();
    expect(sheet!.standard).toEqual({
      Comfort: ["Heated Seats"],
      Safety: ["Blind Spot Warning", "Lane Keep Assist"],
    });
  });

  it("still accepts the category-map shape", () => {
    const sheet = structuredSheet({ features: { Safety: ["Airbags", "ABS"] } });
    expect(sheet!.standard).toEqual({ Safety: ["Airbags", "ABS"] });
  });

  it("buckets an uncategorised array rather than dropping it", () => {
    const sheet = structuredSheet({ high_value_features: ["Panoramic Roof", "Bose Audio"] });
    expect(sheet!.key_features).toEqual({ "Key Features": ["Panoramic Roof", "Bose Audio"] });
  });

  it("accepts the alternate option and package list names", () => {
    const sheet = structuredSheet({
      installed_options: [{ name: "Splash Guards", msrp: 225 }],
      option_packages: [{ name: "Cargo Package", msrp: 350, options: ["Cargo Net"] }],
    });
    expect(sheet!.options).toEqual([{ name: "Splash Guards", code: undefined, msrp: 225 }]);
    expect((sheet!.packages as unknown[]).length).toBe(1);
  });

  it("keeps factory pricing even when no equipment parses, and says so", () => {
    // The guard used to test equipment only, so a payload carrying a real
    // base MSRP and destination charge was discarded whole.
    const sheet = structuredSheet({ msrp: 49150, delivery_charges: 1195, combined_msrp: 50920 });
    expect(sheet).not.toBeNull();
    expect(sheet!.equipment_absent).toBe(true);
    expect(sheet!.pricing).toMatchObject({ base_msrp: 49150, destination_charge: 1195, total_msrp: 50920 });
  });

  it("returns null only when there is genuinely nothing to keep", () => {
    expect(structuredSheet({})).toBeNull();
    expect(structuredSheet({ vin: "3PCAJ5JR1SF103167", year: 2025 })).toBeNull();
  });

  it("de-duplicates repeated names within a category", () => {
    const sheet = structuredSheet({
      features: [
        { description: "Heated Seats", category: "Comfort" },
        { description: "Heated Seats", category: "Comfort" },
      ],
    });
    expect(sheet!.standard).toEqual({ Comfort: ["Heated Seats"] });
  });
});
