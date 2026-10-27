import { describe, it, expect } from "vitest";
import { promoteNeovinExtras, structuredSheet } from "./neovinSheet.ts";

// Synthetic payloads only. The shapes are the ones the handoff names; none of
// the values is a production vehicle.
describe("promoteNeovinExtras", () => {
  it("lifts a warranty map as original factory terms and never derives remaining coverage", () => {
    const p = promoteNeovinExtras({
      warranty: {
        basic: { months: 48, miles: 60_000 },
        powertrain: { years: 6, mileage: "70,000" },
        corrosion: "7 yr/unlimited mi",
      },
    });
    expect(p.warranty).toEqual({
      basis: "original_factory",
      source: "neovin",
      terms: [
        { type: "basic", months: 48, miles: 60_000 },
        { type: "powertrain", months: 72, miles: 70_000 },
        { type: "corrosion", text: "7 yr/unlimited mi" },
      ],
    });
    expect(JSON.stringify(p)).not.toMatch(/remaining/i);
  });

  it("lifts a warranty list with typed items", () => {
    const p = promoteNeovinExtras({
      warranty: [
        { type: "Basic", months: 36, miles: 36_000 },
        { name: "Roadside", description: "3 years" },
        { nothing: true },
      ],
    });
    expect(p.warranty?.terms).toEqual([
      { type: "Basic", months: 36, miles: 36_000 },
      { type: "Roadside", text: "3 years" },
    ]);
  });

  it("omits warranty entirely when the provider sent nothing usable", () => {
    expect(promoteNeovinExtras({ warranty: {} }).warranty).toBeUndefined();
    expect(promoteNeovinExtras({ warranty: null }).warranty).toBeUndefined();
    expect(promoteNeovinExtras({}).warranty).toBeUndefined();
  });

  it("lifts the installed-options subtotal and the labelled MSRP variants separately", () => {
    const p = promoteNeovinExtras({
      msrp: 40_000, installed_options_msrp: "3,420", mc_msrp: 44_815, original_msrp: 41_000,
      build_specs_msrp: 40_000, oem_msrp: 40_000, msrp_label: "Base MSRP",
    });
    expect(p.installed_options_msrp).toBe(3_420);
    expect(p.msrp_variants).toEqual({ mc_msrp: 44_815, original_msrp: 41_000, build_specs_msrp: 40_000, oem_msrp: 40_000 });
    expect(p.msrp_label).toBe("Base MSRP");
  });

  it("keeps provider confidence as sent, number or label, and nothing else", () => {
    const p = promoteNeovinExtras({
      record_confidence: 0.97, listing_confidence: "high", trim_confidence: 1,
      version_confidence: "", transmission_confidence: null, rating: 4.5,
    });
    expect(p.confidence).toEqual({ record_confidence: 0.97, listing_confidence: "high", trim_confidence: 1 });
    expect(JSON.stringify(p)).not.toContain("rating");
  });

  it("records dimensions as raw numbers without a unit claim", () => {
    const p = promoteNeovinExtras({ height: 69.7, length: "198.2", width: 77.9, weight: 4_600 });
    expect(p.dimensions_raw).toEqual({ height: 69.7, length: 198.2, width: 77.9, weight: 4_600 });
    expect(Object.keys(p)).not.toContain("dimensions");
  });

  it("lifts country, EV range and the taxonomy identity", () => {
    const p = promoteNeovinExtras({
      country: "Japan", electric_range: 303, squish_vin: "ABCDEFG0H",
      manufacturer_code: "MC1", decode_version: "2026.1", record_source: "oem",
    });
    expect(p.country).toBe("Japan");
    expect(p.electric_range).toBe(303);
    expect(p.taxonomy).toEqual({ squish_vin: "ABCDEFG0H", manufacturer_code: "MC1", decode_version: "2026.1", record_source: "oem" });
  });

  it("is empty for an empty payload", () => {
    expect(promoteNeovinExtras({})).toEqual({});
    expect(promoteNeovinExtras(null)).toEqual({});
  });
});

describe("structuredSheet carries the promoted fields", () => {
  it("adds them beside the equipment tiers without changing the existing keys", () => {
    const sheet = structuredSheet({
      installed_options_details: [{ name: "Tow Hitch", code: "TH1", msrp: 500 }],
      msrp: 40_000, delivery_charges: 1_395, combined_msrp: 41_895,
      installed_options_msrp: 500, warranty: { basic: { months: 48, miles: 60_000 } },
      record_confidence: 0.9,
    });
    expect(sheet).not.toBeNull();
    expect(sheet!.options).toEqual([{ name: "Tow Hitch", code: "TH1", msrp: 500 }]);
    expect(sheet!.pricing).toEqual({ base_msrp: 40_000, destination_charge: 1_395, total_msrp: 41_895 });
    expect(sheet!.installed_options_msrp).toBe(500);
    expect((sheet!.warranty as { basis: string }).basis).toBe("original_factory");
    expect(sheet!.confidence).toEqual({ record_confidence: 0.9 });
    expect(sheet!.source).toBe("neovin");
  });

  it("does not turn extras alone into a build sheet", () => {
    expect(structuredSheet({ warranty: { basic: { months: 48 } }, record_confidence: 1 })).toBeNull();
  });
});
